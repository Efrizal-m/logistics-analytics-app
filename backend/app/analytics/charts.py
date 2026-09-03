"""Chart selection - deterministic, derived from the shape of the result.

The spec asks the system to pick an appropriate chart type automatically. That
choice is made here, from the query's own structure, rather than by asking the
model: it costs nothing, it cannot drift between identical questions, and it is
testable. The rule that fired is returned as `reason` so the UI can say why it
drew what it drew.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

from app.semantic.registry import DIMENSIONS, METRICS
from app.semantic.schema import Dimension, Metric, QuerySpec

ChartType = Literal["line", "bar", "horizontal_bar", "grouped_bar", "donut", "kpi", "table"]

#: Wide category labels ("San Francisco, CA") are unreadable on a vertical axis.
LONG_LABEL_CHARS = 12
DONUT_MAX_SLICES = 8


class ChartSeries(BaseModel):
    key: str
    label: str
    format: str


class ChartSpec(BaseModel):
    type: ChartType
    x_key: str | None = None
    x_label: str | None = None
    series: list[ChartSeries]
    reason: str


def _series_for(spec: QuerySpec) -> list[ChartSeries]:
    return [
        ChartSeries(
            key=m.value, label=METRICS[m].label, format=METRICS[m].format
        )
        for m in spec.metrics
    ]


def select_chart(spec: QuerySpec, rows: list[dict[str, Any]]) -> ChartSpec:
    series = _series_for(spec)

    if not spec.group_by:
        return ChartSpec(
            type="kpi",
            series=series,
            reason="No grouping dimension, so the result is a single value per metric.",
        )

    temporal = [d for d in spec.group_by if DIMENSIONS[d].is_temporal]
    if temporal:
        bucket = temporal[0]
        if len(spec.group_by) > 1:
            other = next(d for d in spec.group_by if d != bucket)
            return ChartSpec(
                type="grouped_bar",
                x_key=bucket.value,
                x_label=DIMENSIONS[bucket].label,
                series=series,
                reason=(
                    f"Grouped by time ({bucket.value}) and {other.value}; "
                    "grouped bars compare categories within each period."
                ),
            )
        return ChartSpec(
            type="line",
            x_key=bucket.value,
            x_label=DIMENSIONS[bucket].label,
            series=series,
            reason=f"Grouped by {bucket.value}, a time bucket, so the trend reads as a line.",
        )

    if len(spec.group_by) == 2:
        primary = spec.group_by[0]
        return ChartSpec(
            type="grouped_bar",
            x_key=primary.value,
            x_label=DIMENSIONS[primary].label,
            series=series,
            reason="Two categorical dimensions compare as grouped bars.",
        )

    dimension = spec.group_by[0]
    x_key = dimension.value

    is_share_of_whole = (
        dimension is Dimension.status
        and len(spec.metrics) == 1
        and METRICS[spec.metrics[0]].format == "count"
        and len(rows) <= DONUT_MAX_SLICES
    )
    if is_share_of_whole:
        return ChartSpec(
            type="donut",
            x_key=x_key,
            x_label=DIMENSIONS[dimension].label,
            series=series,
            reason="A single count split by status is a composition of one total.",
        )

    labels = [str(row.get(x_key, "")) for row in rows]
    longest = max((len(label) for label in labels), default=0)
    if longest > LONG_LABEL_CHARS or len(rows) > 12:
        return ChartSpec(
            type="horizontal_bar",
            x_key=x_key,
            x_label=DIMENSIONS[dimension].label,
            series=series,
            reason=(
                f"{len(rows)} categories with labels up to {longest} characters; "
                "horizontal bars keep them readable."
            ),
        )

    return ChartSpec(
        type="bar",
        x_key=x_key,
        x_label=DIMENSIONS[dimension].label,
        series=series,
        reason=f"One categorical dimension ({x_key}) with {len(rows)} groups compares as bars.",
    )
