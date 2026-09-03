"""Grain guard.

The dataset holds 355 distinct SKUs across 400 orders: most appear exactly
once, none more than three times in a full year. A per-SKU forecast would be
fitting a model to a single observation, so SKU grain is refused rather than
answered with a confident-looking number. When a question names a SKU the
request is lifted to that SKU's product category, and the substitution is
reported back instead of being made silently.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models import orders

#: Below this many observations per group, a fitted trend is noise.
MIN_OBSERVATIONS_PER_GROUP = 24


class ForecastGrain(str, Enum):
    total = "total"
    product_category = "product_category"
    region = "region"
    carrier = "carrier"


GRAIN_COLUMNS = {
    ForecastGrain.product_category: orders.c.product_category,
    ForecastGrain.region: orders.c.region,
    ForecastGrain.carrier: orders.c.carrier,
}


@dataclass
class ResolvedGrain:
    grain: ForecastGrain
    value: str | None
    notes: list[str] = field(default_factory=list)
    substituted_from_sku: str | None = None


class GrainError(ValueError):
    """The requested grain cannot be forecast and has no sensible substitute."""


def category_for_sku(session: Session, sku: str) -> tuple[str | None, int]:
    row = session.execute(
        sa.select(orders.c.product_category, sa.func.count())
        .where(orders.c.sku == sku)
        .group_by(orders.c.product_category)
    ).first()
    return (row[0], row[1]) if row else (None, 0)


def resolve_grain(
    session: Session,
    grain: ForecastGrain,
    value: str | None,
    sku: str | None = None,
) -> ResolvedGrain:
    if sku:
        category, observations = category_for_sku(session, sku)
        if category is None:
            raise GrainError(
                f"SKU '{sku}' does not appear in the dataset, so there is no history to forecast."
            )
        return ResolvedGrain(
            grain=ForecastGrain.product_category,
            value=category,
            substituted_from_sku=sku,
            notes=[
                f"SKU {sku} has {observations} order(s) in the entire dataset "
                f"(355 SKUs across 400 orders). A per-SKU forecast would be fitted to "
                f"almost no data, so this forecasts the {category} category instead.",
                "Treat the result as category-level demand, not a SKU-level plan.",
            ],
        )

    if grain is ForecastGrain.total:
        return ResolvedGrain(grain=grain, value=None)

    if value is None:
        raise GrainError(f"Forecasting by {grain.value} needs a specific {grain.value} to forecast.")

    column = GRAIN_COLUMNS[grain]
    observations = session.execute(
        sa.select(sa.func.count()).select_from(orders).where(column == value)
    ).scalar_one()
    if observations == 0:
        raise GrainError(f"No orders found for {grain.value} = '{value}'.")

    notes: list[str] = []
    if observations < MIN_OBSERVATIONS_PER_GROUP:
        notes.append(
            f"{grain.value} '{value}' has only {observations} orders across 12 months; "
            "the forecast is indicative at best."
        )
    return ResolvedGrain(grain=grain, value=value, notes=notes)
