from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import cache
from app.ai.client import is_configured
from app.ai.router import SUPPORTED_EXAMPLES
from app.auth import require_auth
from app.db import get_session
from app.ratelimit import dashboard_rate_limit
from app.semantic.executor import get_dataset_bounds
from app.semantic.registry import DIMENSIONS, METRICS
from app.semantic.schema import Dimension, Metric

router = APIRouter()


class MetricDescription(BaseModel):
    key: str
    label: str
    definition: str
    format: str


class DimensionDescription(BaseModel):
    key: str
    label: str
    temporal: bool


class SchemaResponse(BaseModel):
    metrics: list[MetricDescription]
    dimensions: list[DimensionDescription]
    dataset_start: str
    dataset_end: str
    ai_enabled: bool
    example_questions: list[str]


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _build_schema(session: Session) -> SchemaResponse:
    lo, hi = get_dataset_bounds(session)
    return SchemaResponse(
        metrics=[
            MetricDescription(
                key=m.value,
                label=METRICS[m].label,
                definition=METRICS[m].definition,
                format=METRICS[m].format,
            )
            for m in Metric
        ],
        dimensions=[
            DimensionDescription(
                key=d.value, label=DIMENSIONS[d].label, temporal=DIMENSIONS[d].is_temporal
            )
            for d in Dimension
        ],
        dataset_start=lo.isoformat(),
        dataset_end=hi.isoformat(),
        ai_enabled=is_configured(),
        example_questions=SUPPORTED_EXAMPLES,
    )


@router.get(
    "/api/schema",
    response_model=SchemaResponse,
    # Auth before rate limit - see the comment on routes_dashboard.router.
    dependencies=[Depends(require_auth), Depends(dashboard_rate_limit)],
)
def get_schema(session: Session = Depends(get_session)) -> SchemaResponse:
    """What the system can compute. Drives the UI's metric tooltips."""
    return cache.payload("schema", lambda: _build_schema(session))
