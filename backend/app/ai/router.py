"""Question -> tool call -> deterministic computation -> narrated answer.

Three steps, two model calls, and the model never touches the database:

  1. Route.   Claude picks one tool and fills in its arguments.
  2. Compute. Those arguments are validated into a QuerySpec (or a forecast
              request) and executed by our own code. This is the only step that
              produces numbers.
  3. Narrate. The computed rows go back to Claude, which writes prose over
              them with tool_choice disabled so it cannot loop.

There is deliberately no agentic loop. A loop would let the model retry a
failed validation with a different guess, which is slower, costs more, and
makes the same question answerable two different ways. A rejected tool call is
returned to the user as a plain error instead.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from anthropic.types import Message
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.ai.client import get_client
from app.ai.prompts import build_system_prompt
from app.ai.tools import FORECAST_TOOL, QUERY_TOOL, all_tools
from app.analytics.charts import ChartSpec, select_chart
from app.config import get_settings
from app.forecasting.engine import ForecastResult, Method, forecast
from app.forecasting.grain import ForecastGrain, GrainError, resolve_grain
from app.semantic.builder import QueryBuildError, build_query
from app.semantic.executor import execute, get_dataset_bounds
from app.semantic.schema import QueryPlan, QuerySpec

MAX_TOKENS = 16000
#: Routing is a classification task and narration is three sentences; neither
#: gets better with more deliberation, and low effort keeps both calls cheap.
EFFORT = "low"

#: Offered to the user whenever a question falls outside the tools.
SUPPORTED_EXAMPLES = [
    "Show delayed orders by week for the last 3 months",
    "Which carrier has the highest delay rate?",
    "How many orders were delivered late last month?",
    "What is the on-time delivery rate by region?",
    "Average delivery time by warehouse",
    "Predict demand for the PENCIL category for the next 4 months",
]


@dataclass
class AskResult:
    question: str
    answer: str
    tool: str | None = None
    tool_input: dict[str, Any] | None = None
    plan: QueryPlan | None = None
    rows: list[dict[str, Any]] | None = None
    chart: ChartSpec | None = None
    forecast: ForecastResult | None = None
    unsupported: bool = False
    supported_examples: list[str] = field(default_factory=list)


class ToolInputRejected(ValueError):
    """The model's arguments did not survive validation. Not retried on purpose."""


def _text_of(message: Message) -> str:
    return "\n".join(block.text for block in message.content if block.type == "text").strip()


def _tool_use_of(message: Message):
    return next((block for block in message.content if block.type == "tool_use"), None)


def _route(client, system: str, question: str) -> Message:
    return client.messages.create(
        model=get_settings().anthropic_model,
        max_tokens=MAX_TOKENS,
        system=system,
        thinking={"type": "adaptive"},
        output_config={"effort": EFFORT},
        tools=all_tools(),
        messages=[{"role": "user", "content": question}],
    )


def _narrate(
    client, system: str, question: str, routing: Message, tool_use, payload: dict[str, Any]
) -> str:
    """Second call: prose over numbers that are already computed.

    tool_choice is set to none so the model answers instead of calling another
    tool - the computation has already happened and must not happen twice.
    """
    message = client.messages.create(
        model=get_settings().anthropic_model,
        max_tokens=MAX_TOKENS,
        system=system,
        thinking={"type": "adaptive"},
        output_config={"effort": EFFORT},
        tools=all_tools(),
        tool_choice={"type": "none"},
        messages=[
            {"role": "user", "content": question},
            {"role": "assistant", "content": routing.content},
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use.id,
                        "content": json.dumps(payload, default=str),
                    }
                ],
            },
        ],
    )
    return _text_of(message)


# --- tool implementations ---------------------------------------------------


def run_query_tool(
    session: Session, raw_input: dict[str, Any]
) -> tuple[list[dict[str, Any]], QueryPlan, ChartSpec]:
    try:
        spec = QuerySpec(**raw_input)
    except ValidationError as exc:
        raise ToolInputRejected(_explain_validation_error(exc)) from exc

    _, max_date = get_dataset_bounds(session)
    try:
        built = build_query(spec, max_date)
    except QueryBuildError as exc:
        raise ToolInputRejected(str(exc)) from exc

    rows, plan = execute(session, built)
    return rows, plan, select_chart(spec, rows)


def run_forecast_tool(session: Session, raw_input: dict[str, Any]) -> ForecastResult:
    try:
        grain = ForecastGrain(raw_input.get("grain", "total"))
        method = Method(raw_input.get("method", "auto"))
        periods = int(raw_input.get("periods", 4))
        metric = raw_input.get("metric", "total_quantity")
        if metric not in {"total_quantity", "total_orders"}:
            raise ValueError(f"Unknown forecast metric '{metric}'")
        if not 1 <= periods <= 12:
            raise ValueError("periods must be between 1 and 12")
        resolved = resolve_grain(
            session, grain, raw_input.get("grain_value"), raw_input.get("sku")
        )
    except (ValueError, GrainError) as exc:
        raise ToolInputRejected(str(exc)) from exc

    return forecast(session, resolved, metric=metric, periods=periods, method=method)


def _explain_validation_error(exc: ValidationError) -> str:
    parts = []
    for error in exc.errors()[:4]:
        location = ".".join(str(p) for p in error["loc"]) or "input"
        parts.append(f"{location}: {error['msg']}")
    return "The requested query is not supported - " + "; ".join(parts)


# --- entry point ------------------------------------------------------------


def ask(session: Session, question: str, client=None) -> AskResult:
    client = client or get_client()
    system = build_system_prompt(session)

    routing = _route(client, system, question)
    tool_use = _tool_use_of(routing)

    if tool_use is None:
        # The model declined to route. That is a valid outcome: the question is
        # outside what this dataset can answer, and inventing a number would be
        # worse than saying so.
        return AskResult(
            question=question,
            answer=_text_of(routing)
            or "That question cannot be answered from this dataset.",
            unsupported=True,
            supported_examples=SUPPORTED_EXAMPLES,
        )

    # Tool inputs may carry non-standard JSON escaping; always parse, never
    # string-match.
    raw_input = json.loads(json.dumps(tool_use.input))

    if tool_use.name == QUERY_TOOL:
        rows, plan, chart = run_query_tool(session, raw_input)
        payload = {
            "rows": rows[:100],
            "row_count": plan.row_count,
            "metrics": [m.key for m in plan.metrics],
            "grouped_by": [d.key for d in plan.group_by],
            "filters": [f.description for f in plan.filters],
            "time_range": plan.time_range.description if plan.time_range else "all data",
            "notes": plan.notes,
        }
        answer = _narrate(client, system, question, routing, tool_use, payload)
        return AskResult(
            question=question,
            answer=answer,
            tool=QUERY_TOOL,
            tool_input=raw_input,
            plan=plan,
            rows=rows,
            chart=chart,
        )

    if tool_use.name == FORECAST_TOOL:
        result = run_forecast_tool(session, raw_input)
        payload = {
            "grain": result.grain,
            "grain_value": result.grain_value,
            "metric": result.metric,
            "method": result.method,
            "method_reason": result.method_reason,
            "history": [(p.period, p.value) for p in result.history],
            "forecast": [(p.period, p.value) for p in result.forecast],
            "inventory_recommendation": result.inventory_recommendation,
            "limitations": result.limitations,
            "notes": result.notes,
        }
        answer = _narrate(client, system, question, routing, tool_use, payload)
        return AskResult(
            question=question,
            answer=answer,
            tool=FORECAST_TOOL,
            tool_input=raw_input,
            forecast=result,
        )

    raise ToolInputRejected(f"Unknown tool '{tool_use.name}'")
