"""The contract.

One object - QuerySpec - serves three roles at once:

  1. the argument schema Claude fills in when it routes a question,
  2. the only accepted input to the SQL builder,
  3. the basis of the QueryPlan shown to the user as an explanation.

Because the plan rendered in the UI *is* the object that was executed, the
explanation cannot drift from the computation. Anything not expressible here
is, by construction, not answerable - which is the point: the AI selects from
a fixed vocabulary, it never writes SQL.
"""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Metric(str, Enum):
    total_orders = "total_orders"
    delivered_orders = "delivered_orders"
    delayed_orders = "delayed_orders"
    exception_orders = "exception_orders"
    in_transit_orders = "in_transit_orders"
    canceled_orders = "canceled_orders"
    on_time_rate = "on_time_rate"
    delay_rate = "delay_rate"
    avg_delivery_days = "avg_delivery_days"
    total_revenue = "total_revenue"
    avg_order_value = "avg_order_value"
    total_quantity = "total_quantity"


class Dimension(str, Enum):
    carrier = "carrier"
    region = "region"
    warehouse = "warehouse"
    product_category = "product_category"
    sku = "sku"
    destination_city = "destination_city"
    origin_city = "origin_city"
    client_id = "client_id"
    status = "status"
    # Temporal buckets, derived from order_date.
    month = "month"
    week = "week"
    day = "day"


TEMPORAL_DIMENSIONS = {Dimension.month, Dimension.week, Dimension.day}


class FilterField(str, Enum):
    """Categorical dimensions only.

    Time is expressed through TimeRange, never through a filter, so there is a
    single code path that resolves date windows.
    """

    carrier = "carrier"
    region = "region"
    warehouse = "warehouse"
    product_category = "product_category"
    sku = "sku"
    destination_city = "destination_city"
    origin_city = "origin_city"
    client_id = "client_id"
    status = "status"


class FilterOp(str, Enum):
    in_ = "in"
    not_in = "not_in"


class Filter(BaseModel):
    field: FilterField
    op: FilterOp = FilterOp.in_
    values: list[str] = Field(min_length=1, max_length=50)


class TimeRange(BaseModel):
    """Either an absolute window or a relative one - never both.

    Relative windows resolve against the dataset's most recent order_date, not
    against wall-clock today. The dataset ends 2025-12-30; resolving "last
    month" against the real calendar would return zero rows and quietly answer
    every recency question with nothing.
    """

    start: date | None = None
    end: date | None = None
    last_n_months: int | None = Field(default=None, ge=1, le=36)
    last_n_days: int | None = Field(default=None, ge=1, le=1095)

    @model_validator(mode="after")
    def _exclusive(self) -> TimeRange:
        relative = [self.last_n_months, self.last_n_days]
        if sum(x is not None for x in relative) > 1:
            raise ValueError("Use only one of last_n_months / last_n_days")
        if any(x is not None for x in relative) and (self.start or self.end):
            raise ValueError("Use either an absolute window or a relative one")
        if self.start and self.end and self.start > self.end:
            raise ValueError("start must not be after end")
        return self

    def is_empty(self) -> bool:
        return not any([self.start, self.end, self.last_n_months, self.last_n_days])


class SortDirection(str, Enum):
    asc = "asc"
    desc = "desc"


class Sort(BaseModel):
    # Must name a metric or a grouped dimension; enforced in the builder.
    by: str
    direction: SortDirection = SortDirection.desc


class QuerySpec(BaseModel):
    model_config = {"extra": "forbid"}

    metrics: list[Metric] = Field(min_length=1, max_length=6)
    group_by: list[Dimension] = Field(default_factory=list, max_length=2)
    filters: list[Filter] = Field(default_factory=list, max_length=8)
    time_range: TimeRange | None = None
    sort: Sort | None = None
    limit: int = Field(default=100, ge=1, le=1000)

    @model_validator(mode="after")
    def _at_most_one_temporal_grouping(self) -> QuerySpec:
        temporal = [d for d in self.group_by if d in TEMPORAL_DIMENSIONS]
        if len(temporal) > 1:
            raise ValueError("Group by at most one time bucket")
        if len(set(self.group_by)) != len(self.group_by):
            raise ValueError("Duplicate dimension in group_by")
        return self


# --------------------------------------------------------------------------
# Explanation objects - what the UI renders. Mirrors of what was executed.
# --------------------------------------------------------------------------


class MetricInfo(BaseModel):
    key: str
    label: str
    definition: str
    format: str
    #: Which way is good for this metric - None when a count is neither good
    #: nor bad. Drives the UI's health marker; never inferred client-side.
    direction: Literal["up", "down"] | None = None


class DimensionInfo(BaseModel):
    key: str
    label: str


class FilterInfo(BaseModel):
    field: str
    op: str
    values: list[str]
    description: str


class ResolvedTimeRange(BaseModel):
    start: date | None
    end: date | None
    description: str
    basis: str


class QueryPlan(BaseModel):
    """Structured interpretation of the question, as executed."""

    metrics: list[MetricInfo]
    group_by: list[DimensionInfo]
    filters: list[FilterInfo]
    time_range: ResolvedTimeRange | None
    sort: str | None
    limit: int
    row_count: int
    # Emitted by our own builder, never by the model. Shown so a reviewer can
    # check the arithmetic rather than take the answer on trust.
    sql: str
    notes: list[str] = Field(default_factory=list)
