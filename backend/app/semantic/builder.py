"""QuerySpec -> parameterized SQLAlchemy select.

This is the only place in the application that constructs SQL against the
orders table, and it accepts nothing but a validated QuerySpec. Every metric,
dimension and filter field is looked up in the registry; an identifier that is
not in the registry cannot reach the database, because it cannot survive
Pydantic validation of the enum in the first place. No string from the model
is ever interpolated into SQL - filter values become bound parameters.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from app.models import orders
from app.semantic.registry import DIMENSIONS, FILTER_COLUMNS, METRICS
from app.semantic.schema import (
    Dimension,
    DimensionInfo,
    Filter,
    FilterInfo,
    FilterOp,
    Metric,
    MetricInfo,
    QueryPlan,
    QuerySpec,
    ResolvedTimeRange,
    SortDirection,
    TimeRange,
)

SAMPLE_SIZE_COLUMN = "sample_size"


class QueryBuildError(ValueError):
    """The spec is structurally valid but does not describe a runnable query."""


@dataclass
class BuiltQuery:
    statement: sa.Select
    metric_keys: list[str]
    dimension_keys: list[str]
    has_sample_size: bool
    time_range: ResolvedTimeRange | None
    filters: list[FilterInfo]
    sort_description: str | None
    limit: int
    notes: list[str] = field(default_factory=list)

    def plan(self, row_count: int) -> QueryPlan:
        return QueryPlan(
            metrics=[
                MetricInfo(
                    key=k,
                    label=METRICS[Metric(k)].label,
                    definition=METRICS[Metric(k)].definition,
                    format=METRICS[Metric(k)].format,
                    direction=METRICS[Metric(k)].direction,
                )
                for k in self.metric_keys
            ],
            group_by=[
                DimensionInfo(key=k, label=DIMENSIONS[Dimension(k)].label)
                for k in self.dimension_keys
            ],
            filters=self.filters,
            time_range=self.time_range,
            sort=self.sort_description,
            limit=self.limit,
            row_count=row_count,
            sql=render_sql(self.statement),
            notes=self.notes,
        )


def _month_start(d: date, months_back: int) -> date:
    """First day of the calendar month `months_back` months before d's month."""
    total = d.year * 12 + (d.month - 1) - months_back
    return date(total // 12, total % 12 + 1, 1)


def resolve_time_range(
    time_range: TimeRange | None, dataset_max_date: date
) -> ResolvedTimeRange | None:
    """Turn a relative window into concrete dates.

    Relative windows resolve against the newest order_date in the dataset, not
    against today. The data ends 2025-12-30, so anchoring "last month" to the
    real calendar would silently return an empty result for every recency
    question. The anchor is reported in the plan so the choice is visible.
    """
    if time_range is None or time_range.is_empty():
        return None

    anchor_note = f"relative to the most recent order date in the dataset ({dataset_max_date})"

    if time_range.last_n_months is not None:
        n = time_range.last_n_months
        start = _month_start(dataset_max_date, n - 1)
        return ResolvedTimeRange(
            start=start,
            end=dataset_max_date,
            description=(
                f"{start} to {dataset_max_date} - the last {n} calendar "
                f"month{'s' if n > 1 else ''}, {anchor_note}"
            ),
            basis=f"dataset_max_order_date={dataset_max_date}",
        )

    if time_range.last_n_days is not None:
        n = time_range.last_n_days
        start = dataset_max_date - timedelta(days=n - 1)
        return ResolvedTimeRange(
            start=start,
            end=dataset_max_date,
            description=f"{start} to {dataset_max_date} - the last {n} days, {anchor_note}",
            basis=f"dataset_max_order_date={dataset_max_date}",
        )

    start, end = time_range.start, time_range.end
    if start and end:
        desc = f"{start} to {end}"
    elif start:
        desc = f"from {start} onwards"
    else:
        desc = f"up to {end}"
    return ResolvedTimeRange(
        start=start, end=end, description=desc, basis="absolute dates from the question"
    )


def _describe_filter(f: Filter) -> FilterInfo:
    verb = "is one of" if f.op is FilterOp.in_ else "is not one of"
    if len(f.values) == 1:
        verb = "is" if f.op is FilterOp.in_ else "is not"
    return FilterInfo(
        field=f.field.value,
        op=f.op.value,
        values=f.values,
        description=f"{f.field.value} {verb} {', '.join(f.values)}",
    )


def render_sql(statement: sa.Select) -> str:
    """Compile for display only - never executed from this string.

    The SQL shown to the user is emitted by this builder, not by the model.
    It is here so a reviewer can check the arithmetic behind an answer.
    """
    try:
        compiled = statement.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
        return str(compiled)
    except Exception:  # pragma: no cover - display-only fallback
        return str(statement.compile(dialect=postgresql.dialect()))


def build_query(spec: QuerySpec, dataset_max_date: date) -> BuiltQuery:
    columns: list[sa.ColumnElement] = []
    dimension_keys: list[str] = []
    notes: list[str] = []

    for dim in spec.group_by:
        definition = DIMENSIONS[dim]
        columns.append(definition.expression.label(dim.value))
        dimension_keys.append(dim.value)

    metric_keys: list[str] = []
    needs_sample_size = False
    for metric in spec.metrics:
        definition = METRICS[metric]
        columns.append(definition.expression().label(metric.value))
        metric_keys.append(metric.value)
        if definition.is_ratio:
            needs_sample_size = True
        if definition.note and definition.note not in notes:
            notes.append(definition.note)

    if needs_sample_size:
        ratio = next(METRICS[m] for m in spec.metrics if METRICS[m].is_ratio)
        assert ratio.denominator is not None
        columns.append(ratio.denominator().label(SAMPLE_SIZE_COLUMN))

    statement = sa.select(*columns).select_from(orders)

    conditions: list[sa.ColumnElement] = []
    filter_infos: list[FilterInfo] = []
    for f in spec.filters:
        column = FILTER_COLUMNS[f.field]
        # Bound parameters - filter values never enter the SQL text.
        clause = column.in_(f.values)
        conditions.append(clause if f.op is FilterOp.in_ else sa.not_(clause))
        filter_infos.append(_describe_filter(f))

    resolved = resolve_time_range(spec.time_range, dataset_max_date)
    if resolved:
        if resolved.start:
            conditions.append(orders.c.order_date >= resolved.start)
        if resolved.end:
            conditions.append(orders.c.order_date <= resolved.end)

    if conditions:
        statement = statement.where(sa.and_(*conditions))

    if dimension_keys:
        statement = statement.group_by(
            *[DIMENSIONS[d].expression for d in spec.group_by]
        )

    sort_description = None
    if dimension_keys or spec.sort:
        order_column, sort_description = _resolve_sort(spec, dimension_keys, metric_keys)
        if order_column is not None:
            statement = statement.order_by(order_column)

    statement = statement.limit(spec.limit)

    return BuiltQuery(
        statement=statement,
        metric_keys=metric_keys,
        dimension_keys=dimension_keys,
        has_sample_size=needs_sample_size,
        time_range=resolved,
        filters=filter_infos,
        sort_description=sort_description,
        limit=spec.limit,
        notes=notes,
    )


def _resolve_sort(
    spec: QuerySpec, dimension_keys: list[str], metric_keys: list[str]
) -> tuple[sa.ColumnElement | None, str | None]:
    if spec.sort is not None:
        key = spec.sort.by
        if key not in metric_keys and key not in dimension_keys:
            raise QueryBuildError(
                f"Cannot sort by '{key}': it is neither a selected metric nor a grouped dimension."
            )
        column = sa.column(key)
        ordered = column.desc() if spec.sort.direction is SortDirection.desc else column.asc()
        return ordered, f"{key} {spec.sort.direction.value}"

    # A time series reads chronologically; a ranking reads largest first.
    temporal = [d for d in spec.group_by if DIMENSIONS[d].is_temporal]
    if temporal:
        key = temporal[0].value
        return sa.column(key).asc(), f"{key} asc"
    if dimension_keys and metric_keys:
        key = metric_keys[0]
        return sa.column(key).desc(), f"{key} desc"
    return None, None
