"""Routing, validation and execution - exercised without calling the model.

The point of the two-call design is that everything between the two calls is
ordinary deterministic code. These tests feed the router the tool call a model
would have produced and check what the system does with it, so the behaviour
that matters is covered without a network round trip or an API key.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.ai.router import (
    SUPPORTED_EXAMPLES,
    ToolInputRejected,
    ask,
    run_forecast_tool,
    run_query_tool,
)
from app.ai.tools import FORECAST_TOOL, QUERY_TOOL, all_tools


def tool_use_block(name: str, payload: dict):
    return SimpleNamespace(type="tool_use", id="toolu_test", name=name, input=payload)


def text_block(text: str):
    return SimpleNamespace(type="text", text=text)


class FakeClient:
    """Returns a scripted routing message, then a scripted narration."""

    def __init__(self, blocks):
        self._responses = [
            SimpleNamespace(content=blocks),
            SimpleNamespace(content=[text_block("Narrated answer.")]),
        ]
        self.calls: list[dict] = []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        return self._responses.pop(0)


# --- tool schemas -----------------------------------------------------------


def test_tool_schemas_only_offer_identifiers_the_builder_supports():
    """The schema is generated from the registry, so the two cannot drift."""
    from app.semantic.schema import Dimension, FilterField, Metric

    query = next(t for t in all_tools() if t["name"] == QUERY_TOOL)
    properties = query["input_schema"]["properties"]

    assert set(properties["metrics"]["items"]["enum"]) == {m.value for m in Metric}
    assert set(properties["group_by"]["items"]["enum"]) == {d.value for d in Dimension}
    assert set(properties["filters"]["items"]["properties"]["field"]["enum"]) == {
        f.value for f in FilterField
    }
    assert query["input_schema"]["additionalProperties"] is False


# --- the happy path ---------------------------------------------------------


def test_a_routed_question_is_computed_and_narrated(session):
    client = FakeClient([tool_use_block(QUERY_TOOL, {"metrics": ["delayed_orders"]})])
    result = ask(session, "How many orders were delayed?", client=client)

    assert result.tool == QUERY_TOOL
    assert result.rows == [{"delayed_orders": 55}]
    assert result.answer == "Narrated answer."
    assert result.plan is not None and result.plan.row_count == 1
    assert not result.unsupported


def test_the_narration_call_cannot_trigger_another_computation(session):
    client = FakeClient([tool_use_block(QUERY_TOOL, {"metrics": ["total_orders"]})])
    ask(session, "How many orders?", client=client)

    routing, narration = client.calls
    assert "tool_choice" not in routing
    # Numbers are computed exactly once; the second call may only write prose.
    assert narration["tool_choice"] == {"type": "none"}


def test_the_model_receives_the_computed_rows_not_the_raw_question_again(session):
    client = FakeClient(
        [tool_use_block(QUERY_TOOL, {"metrics": ["on_time_rate"]})]
    )
    ask(session, "What is our on-time rate?", client=client)

    tool_result = client.calls[1]["messages"][-1]["content"][0]
    assert tool_result["type"] == "tool_result"
    assert tool_result["tool_use_id"] == "toolu_test"
    assert "0.82" in tool_result["content"]
    assert "sample_size" in tool_result["content"]


# --- refusing to answer -----------------------------------------------------


def test_a_question_the_data_cannot_answer_is_reported_not_invented(session):
    """No tool call means no numbers - and no fabricated ones either."""
    client = FakeClient([text_block("This dataset has no cost or margin columns.")])
    result = ask(session, "What is our profit margin?", client=client)

    assert result.unsupported
    assert result.rows is None
    assert result.tool is None
    assert result.supported_examples == SUPPORTED_EXAMPLES
    assert "margin" in result.answer


@pytest.mark.parametrize(
    "payload",
    [
        {"metrics": ["profit_margin"]},
        {"metrics": ["total_orders"], "group_by": ["shipping_cost"]},
        {"metrics": ["total_orders"], "filters": [{"field": "quantity", "values": ["3"]}]},
        {"metrics": ["total_orders"], "time_range": {"start": "2025-01-01", "last_n_months": 3}},
    ],
    ids=["invented metric", "invented dimension", "unfilterable field", "contradictory window"],
)
def test_hallucinated_arguments_are_rejected_rather_than_executed(session, payload):
    with pytest.raises(ToolInputRejected) as excinfo:
        run_query_tool(session, payload)
    assert "not supported" in str(excinfo.value)


def test_a_rejected_tool_call_is_not_retried(session):
    """One question, one computation. No loop that could answer it two ways."""
    client = FakeClient([tool_use_block(QUERY_TOOL, {"metrics": ["profit_margin"]})])
    with pytest.raises(ToolInputRejected):
        ask(session, "What is our profit margin by carrier?", client=client)
    assert len(client.calls) == 1


# --- forecasting through the router ----------------------------------------


def test_a_sku_forecast_is_lifted_to_its_category_and_says_so(session):
    result = run_forecast_tool(session, {"grain": "total", "sku": "PENCIL-0213", "periods": 4})

    assert result.grain == "product_category"
    assert result.grain_value == "PENCIL"
    assert len(result.forecast) == 4
    assert any("PENCIL-0213" in note for note in result.notes)
    assert any("category" in note for note in result.notes)


def test_forecast_arguments_are_bounds_checked(session):
    with pytest.raises(ToolInputRejected):
        run_forecast_tool(session, {"grain": "total", "periods": 99})
    with pytest.raises(ToolInputRejected):
        run_forecast_tool(session, {"grain": "product_category"})  # no value given
    with pytest.raises(ToolInputRejected):
        run_forecast_tool(session, {"grain": "total", "sku": "NOT-A-REAL-SKU"})


def test_forecast_questions_route_to_the_forecast_tool(session):
    client = FakeClient(
        [tool_use_block(FORECAST_TOOL, {"grain": "product_category", "grain_value": "PENCIL"})]
    )
    result = ask(session, "How much PENCIL stock should I plan?", client=client)

    assert result.tool == FORECAST_TOOL
    assert result.forecast is not None
    assert result.rows is None
    assert result.forecast.inventory_recommendation["recommended_units"] > 0
