from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import cache
from app.analytics.charts import ChartSpec
from app.analytics.kpis import PRESET_CHARTS, compute_kpis, compute_preset_chart
from app.db import get_session
from app.ratelimit import dashboard_rate_limit
from app.semantic.schema import QueryPlan

router = APIRouter(prefix="/api", dependencies=[Depends(dashboard_rate_limit)])


class KpiResponse(BaseModel):
    key: str
    label: str
    value: float | None
    format: str
    definition: str
    sample_size: int | None = None
    direction: Literal["up", "down"] | None = None


class KpisPayload(BaseModel):
    kpis: list[KpiResponse]
    plan: QueryPlan


class ChartPayload(BaseModel):
    name: str
    title: str
    rows: list[dict[str, Any]]
    chart: ChartSpec
    plan: QueryPlan


def _build_kpis(session: Session) -> KpisPayload:
    kpis, plan = compute_kpis(session)
    return KpisPayload(kpis=[KpiResponse(**vars(k)) for k in kpis], plan=plan)


def _build_chart(session: Session, name: str) -> ChartPayload:
    title, rows, chart, plan = compute_preset_chart(session, name)
    return ChartPayload(name=name, title=title, rows=rows, chart=chart, plan=plan)


@router.get("/kpis", response_model=KpisPayload)
def get_kpis(session: Session = Depends(get_session)) -> KpisPayload:
    return cache.payload("kpis", lambda: _build_kpis(session))


@router.get("/charts", response_model=list[str])
def list_charts() -> list[str]:
    return list(PRESET_CHARTS)


@router.get("/charts/{name}", response_model=ChartPayload)
def get_chart(name: str, session: Session = Depends(get_session)) -> ChartPayload:
    try:
        return cache.payload(f"chart:{name}", lambda: _build_chart(session, name))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown chart '{name}'")
