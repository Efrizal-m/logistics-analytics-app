from __future__ import annotations

from dataclasses import asdict
from typing import Any

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai.client import AnthropicUnavailable
from app.ai.router import ToolInputRejected, ask
from app.analytics.charts import ChartSpec
from app.db import get_session
from app.semantic.schema import QueryPlan

router = APIRouter(prefix="/api")


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=500)


class AskResponse(BaseModel):
    question: str
    answer: str
    tool: str | None = None
    tool_input: dict[str, Any] | None = None
    plan: QueryPlan | None = None
    rows: list[dict[str, Any]] | None = None
    chart: ChartSpec | None = None
    forecast: dict[str, Any] | None = None
    unsupported: bool = False
    supported_examples: list[str] = Field(default_factory=list)


@router.post("/ask", response_model=AskResponse)
def post_ask(payload: AskRequest, session: Session = Depends(get_session)) -> AskResponse:
    try:
        result = ask(session, payload.question.strip())
    except AnthropicUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ToolInputRejected as exc:
        # The model produced arguments outside the supported vocabulary. Report
        # it rather than letting it retry into a different answer.
        raise HTTPException(status_code=422, detail=str(exc))
    except anthropic.APIStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Model API error: {exc.status_code}")
    except anthropic.APIConnectionError:
        raise HTTPException(status_code=502, detail="Could not reach the model API.")

    return AskResponse(
        question=result.question,
        answer=result.answer,
        tool=result.tool,
        tool_input=result.tool_input,
        plan=result.plan,
        rows=result.rows,
        chart=result.chart,
        forecast=asdict(result.forecast) if result.forecast else None,
        unsupported=result.unsupported,
        supported_examples=result.supported_examples,
    )
