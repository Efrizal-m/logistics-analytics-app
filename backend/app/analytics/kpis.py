"""Dashboard KPIs and preset charts.

Every one of these goes through the same QuerySpec -> builder path as a
natural-language question, so a KPI card and a chat answer are computed by the
same code and cannot disagree. Each preset returns its plan too, which means
the dashboard is as explainable as the ask endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.analytics.charts import ChartSpec, select_chart
from app.semantic.builder import build_query
from app.semantic.executor import execute, get_dataset_bounds
from app.semantic.registry import METRICS
from app.semantic.schema import Dimension, Metric, QueryPlan, QuerySpec

#: The five headline numbers the spec asks for.
KPI_METRICS = [
    Metric.total_orders,
    Metric.delivered_orders,
    Metric.delayed_orders,
    Metric.on_time_rate,
    Metric.avg_delivery_days,
]


@dataclass
class Kpi:
    key: str
    label: str
    value: float | None
    format: str
    definition: str
    sample_size: int | None = None


def compute_kpis(session: Session) -> tuple[list[Kpi], QueryPlan]:
    _, max_date = get_dataset_bounds(session)
    spec = QuerySpec(metrics=KPI_METRICS)
    rows, plan = execute(session, build_query(spec, max_date))
    row = rows[0]
    sample_size = row.get("sample_size")

    kpis = [
        Kpi(
            key=metric.value,
            label=METRICS[metric].label,
            value=row[metric.value],
            format=METRICS[metric].format,
            definition=METRICS[metric].definition,
            # Only rate metrics have a denominator worth showing.
            sample_size=sample_size if METRICS[metric].is_ratio else None,
        )
        for metric in KPI_METRICS
    ]
    return kpis, plan


#: Named presets, mirroring the three charts the spec asks for.
PRESET_CHARTS: dict[str, tuple[str, QuerySpec]] = {
    "orders_over_time": (
        "Order volume by month",
        QuerySpec(metrics=[Metric.total_orders], group_by=[Dimension.month]),
    ),
    "delivery_performance": (
        "Delivery outcomes by month",
        QuerySpec(
            metrics=[
                Metric.delivered_orders,
                Metric.delayed_orders,
                Metric.exception_orders,
            ],
            group_by=[Dimension.month],
        ),
    ),
    "carrier_breakdown": (
        "Delay rate by carrier",
        QuerySpec(metrics=[Metric.delay_rate], group_by=[Dimension.carrier]),
    ),
    "destination_breakdown": (
        "Orders by destination city (top 10)",
        QuerySpec(
            metrics=[Metric.total_orders], group_by=[Dimension.destination_city], limit=10
        ),
    ),
}


def compute_preset_chart(
    session: Session, name: str
) -> tuple[str, list[dict[str, Any]], ChartSpec, QueryPlan]:
    if name not in PRESET_CHARTS:
        raise KeyError(name)
    title, spec = PRESET_CHARTS[name]
    _, max_date = get_dataset_bounds(session)
    rows, plan = execute(session, build_query(spec, max_date))
    return title, rows, select_chart(spec, rows), plan
