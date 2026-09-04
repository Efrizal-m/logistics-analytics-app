"""Metric and dimension definitions - the single source of truth.

Every number the application can produce is defined exactly once, here. The
dashboard, the natural-language endpoint and the forecasting tool all read
from this registry, so a KPI card and a chat answer cannot disagree.

Two definitions deserve their reasoning in writing, because the dataset does
not settle them on its own:

* The dataset has **no promised/SLA delivery date**, so "on time" cannot be
  derived from dates. It is derived from `status` instead. Lead times back
  this up: delivered averages 3.25 days, delayed 6.11, exception 8.45 - the
  status column is a coherent outcome label.

* `in_transit` and `canceled` orders have no delivery outcome yet (and no
  delivery_date - 30 rows). They are excluded from the denominator of every
  outcome rate, so on_time_rate + delay_rate + exception share sum to 1 over
  concluded orders.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import sqlalchemy as sa
from sqlalchemy import Date, Integer, Numeric, cast, func

from app.models import orders
from app.semantic.schema import Dimension, FilterField, Metric

# --- status predicates ------------------------------------------------------

DELIVERED = orders.c.status == "delivered"
DELAYED = orders.c.status == "delayed"
EXCEPTION = orders.c.status == "exception"
IN_TRANSIT = orders.c.status == "in_transit"
CANCELED = orders.c.status == "canceled"

#: Orders whose delivery outcome is known. The denominator of every rate.
CONCLUDED = orders.c.status.in_(["delivered", "delayed", "exception"])

HAS_DELIVERY_DATE = orders.c.delivery_date.isnot(None)

#: Postgres returns integer days for date - date.
DELIVERY_DAYS = cast(orders.c.delivery_date - orders.c.order_date, Integer)


@dataclass(frozen=True)
class MetricDef:
    key: Metric
    label: str
    #: Shown in the UI tooltip and reproduced in the README.
    definition: str
    expression: Callable[[], sa.ColumnElement]
    format: str  # count | percent | currency | days | number
    #: Rate metrics carry their denominator so a 2-of-9 carrier is never
    #: presented as comparable to an 11-of-49 one.
    denominator: Callable[[], sa.ColumnElement] | None = None
    #: Surfaced in QueryPlan.notes whenever the metric is used.
    note: str | None = None

    @property
    def is_ratio(self) -> bool:
        return self.denominator is not None


def _count(predicate: sa.ColumnElement | None = None) -> sa.ColumnElement:
    agg = func.count()
    return agg.filter(predicate) if predicate is not None else agg


def _rate(numerator: sa.ColumnElement) -> sa.ColumnElement:
    return cast(_count(numerator), Numeric) / func.nullif(_count(CONCLUDED), 0)


METRICS: dict[Metric, MetricDef] = {
    Metric.total_orders: MetricDef(
        key=Metric.total_orders,
        label="Total orders",
        definition="COUNT of all order rows, every status included.",
        expression=lambda: _count(),
        format="count",
    ),
    Metric.delivered_orders: MetricDef(
        key=Metric.delivered_orders,
        label="Delivered orders",
        definition="COUNT of orders with status = 'delivered'.",
        expression=lambda: _count(DELIVERED),
        format="count",
    ),
    Metric.delayed_orders: MetricDef(
        key=Metric.delayed_orders,
        label="Delayed orders",
        definition="COUNT of orders with status = 'delayed'.",
        expression=lambda: _count(DELAYED),
        format="count",
    ),
    Metric.exception_orders: MetricDef(
        key=Metric.exception_orders,
        label="Exception orders",
        definition="COUNT of orders with status = 'exception'.",
        expression=lambda: _count(EXCEPTION),
        format="count",
    ),
    Metric.in_transit_orders: MetricDef(
        key=Metric.in_transit_orders,
        label="In-transit orders",
        definition="COUNT of orders with status = 'in_transit' (no outcome yet).",
        expression=lambda: _count(IN_TRANSIT),
        format="count",
    ),
    Metric.canceled_orders: MetricDef(
        key=Metric.canceled_orders,
        label="Canceled orders",
        definition="COUNT of orders with status = 'canceled'.",
        expression=lambda: _count(CANCELED),
        format="count",
    ),
    Metric.on_time_rate: MetricDef(
        key=Metric.on_time_rate,
        label="On-time delivery rate",
        definition=(
            "delivered / (delivered + delayed + exception). The dataset has no "
            "promised delivery date, so on-time is taken from the status "
            "column. Orders still in transit or canceled have no outcome and "
            "are excluded from the denominator."
        ),
        expression=lambda: _rate(DELIVERED),
        format="percent",
        denominator=lambda: _count(CONCLUDED),
        note=(
            "on_time_rate excludes in_transit and canceled orders from the "
            "denominator - they have no delivery outcome yet."
        ),
    ),
    Metric.delay_rate: MetricDef(
        key=Metric.delay_rate,
        label="Delay rate",
        definition=(
            "delayed / (delivered + delayed + exception). Same denominator as "
            "the on-time rate, so the two are directly comparable."
        ),
        expression=lambda: _rate(DELAYED),
        format="percent",
        denominator=lambda: _count(CONCLUDED),
        note=(
            "Rate metrics are reported with sample_size. Rankings over small "
            "groups are not statistically meaningful - check the denominator "
            "before acting on a rate."
        ),
    ),
    Metric.avg_delivery_days: MetricDef(
        key=Metric.avg_delivery_days,
        label="Average delivery time (days)",
        definition=(
            "AVG(delivery_date - order_date) over orders that actually have a "
            "delivery_date. 30 of 400 orders (in_transit and canceled) have "
            "none and are excluded."
        ),
        expression=lambda: func.avg(DELIVERY_DAYS).filter(HAS_DELIVERY_DATE),
        format="days",
        note=(
            "avg_delivery_days is computed over orders with a delivery_date "
            "only (370 of 400 in the full dataset)."
        ),
    ),
    Metric.total_revenue: MetricDef(
        key=Metric.total_revenue,
        label="Total order value (USD)",
        definition=(
            "SUM(order_value_usd). Booked order value, not shipped revenue - "
            "canceled orders are included unless filtered out."
        ),
        expression=lambda: func.sum(orders.c.order_value_usd),
        format="currency",
    ),
    Metric.avg_order_value: MetricDef(
        key=Metric.avg_order_value,
        label="Average order value (USD)",
        definition="AVG(order_value_usd).",
        expression=lambda: func.avg(orders.c.order_value_usd),
        format="currency",
    ),
    Metric.total_quantity: MetricDef(
        key=Metric.total_quantity,
        label="Total units",
        definition="SUM(quantity).",
        expression=lambda: func.sum(orders.c.quantity),
        format="number",
    ),
}


@dataclass(frozen=True)
class DimensionDef:
    key: Dimension
    label: str
    expression: sa.ColumnElement
    is_temporal: bool = False


DIMENSIONS: dict[Dimension, DimensionDef] = {
    Dimension.carrier: DimensionDef(Dimension.carrier, "Carrier", orders.c.carrier),
    Dimension.region: DimensionDef(Dimension.region, "Region", orders.c.region),
    Dimension.warehouse: DimensionDef(
        Dimension.warehouse, "Warehouse", orders.c.warehouse
    ),
    Dimension.product_category: DimensionDef(
        Dimension.product_category, "Product category", orders.c.product_category
    ),
    Dimension.sku: DimensionDef(Dimension.sku, "SKU", orders.c.sku),
    Dimension.destination_city: DimensionDef(
        Dimension.destination_city, "Destination city", orders.c.destination_city
    ),
    Dimension.origin_city: DimensionDef(
        Dimension.origin_city, "Origin city", orders.c.origin_city
    ),
    Dimension.client_id: DimensionDef(Dimension.client_id, "Client", orders.c.client_id),
    Dimension.status: DimensionDef(Dimension.status, "Status", orders.c.status),
    Dimension.month: DimensionDef(
        Dimension.month,
        "Month",
        cast(func.date_trunc("month", orders.c.order_date), Date),
        is_temporal=True,
    ),
    Dimension.week: DimensionDef(
        Dimension.week,
        "Week",
        cast(func.date_trunc("week", orders.c.order_date), Date),
        is_temporal=True,
    ),
    Dimension.day: DimensionDef(
        Dimension.day, "Day", orders.c.order_date, is_temporal=True
    ),
}

#: Physical column behind each filterable dimension.
FILTER_COLUMNS: dict[FilterField, sa.Column] = {
    FilterField.carrier: orders.c.carrier,
    FilterField.region: orders.c.region,
    FilterField.warehouse: orders.c.warehouse,
    FilterField.product_category: orders.c.product_category,
    FilterField.sku: orders.c.sku,
    FilterField.destination_city: orders.c.destination_city,
    FilterField.origin_city: orders.c.origin_city,
    FilterField.client_id: orders.c.client_id,
    FilterField.status: orders.c.status,
}
