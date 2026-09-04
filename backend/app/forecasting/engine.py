"""Demand forecasting on monthly aggregates.

The series is 12 monthly points, noisy and declining (75 orders in January
down to 18 in September). That rules out anything seasonal or
autoregressive - there is not enough history to fit it, and a complicated
model here would look rigorous while being worse. Two simple methods are
offered, both named in the spec, and the choice between them is made by
measuring on a holdout rather than by preference.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Literal

import numpy as np
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.forecasting.grain import GRAIN_COLUMNS, ForecastGrain, ResolvedGrain
from app.models import orders
from app.semantic.executor import get_dataset_bounds

#: Months held back to score a method before it is used to predict.
HOLDOUT_MONTHS = 3
MOVING_AVERAGE_WINDOW = 3
#: 95% service level, the usual default for safety stock.
SERVICE_LEVEL_Z = 1.645

ForecastMetric = Literal["total_quantity", "total_orders"]


class Method(str, Enum):
    auto = "auto"
    moving_average = "moving_average"
    linear_regression = "linear_regression"


@dataclass
class SeriesPoint:
    period: str
    value: float


@dataclass
class ForecastResult:
    grain: str
    grain_value: str | None
    metric: str
    method: str
    method_reason: str
    history: list[SeriesPoint]
    forecast: list[SeriesPoint]
    holdout_mae: dict[str, float | None]
    inventory_recommendation: dict[str, float | str]
    limitations: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


# --- history ----------------------------------------------------------------


def _month_sequence(start: date, end: date) -> list[date]:
    months, cursor = [], date(start.year, start.month, 1)
    last = date(end.year, end.month, 1)
    while cursor <= last:
        months.append(cursor)
        cursor = (
            date(cursor.year + 1, 1, 1)
            if cursor.month == 12
            else date(cursor.year, cursor.month + 1, 1)
        )
    return months


def load_monthly_history(
    session: Session, resolved: ResolvedGrain, metric: ForecastMetric
) -> list[SeriesPoint]:
    """Monthly totals with empty months filled as zero.

    A month with no orders is real demand information - dropping it would let
    a moving average silently skip gaps and overstate the level.
    """
    aggregate = (
        sa.func.sum(orders.c.quantity)
        if metric == "total_quantity"
        else sa.func.count()
    )
    bucket = sa.cast(sa.func.date_trunc("month", orders.c.order_date), sa.Date)

    statement = sa.select(bucket.label("month"), aggregate.label("value")).group_by(bucket)
    if resolved.grain is not ForecastGrain.total:
        statement = statement.where(GRAIN_COLUMNS[resolved.grain] == resolved.value)

    observed = {row.month: float(row.value or 0) for row in session.execute(statement)}

    lo, hi = get_dataset_bounds(session)
    return [
        SeriesPoint(period=month.isoformat(), value=observed.get(month, 0.0))
        for month in _month_sequence(lo, hi)
    ]


# --- methods ----------------------------------------------------------------


def moving_average(values: list[float], periods: int, window: int = MOVING_AVERAGE_WINDOW) -> list[float]:
    """Recursive moving average: each prediction feeds the next window."""
    if not values:
        return [0.0] * periods
    series = list(values)
    out = []
    for _ in range(periods):
        nxt = float(np.mean(series[-window:]))
        out.append(max(nxt, 0.0))
        series.append(nxt)
    return out


def linear_regression(values: list[float], periods: int) -> list[float]:
    if len(values) < 2:
        return [max(values[0] if values else 0.0, 0.0)] * periods
    x = np.arange(len(values), dtype=float)
    slope, intercept = np.polyfit(x, np.asarray(values, dtype=float), 1)
    future = np.arange(len(values), len(values) + periods, dtype=float)
    # Demand cannot go negative; a declining fit would otherwise cross zero.
    return [float(max(slope * t + intercept, 0.0)) for t in future]


METHODS = {
    Method.moving_average: moving_average,
    Method.linear_regression: linear_regression,
}


def holdout_mae(values: list[float], method: Method) -> float | None:
    """Mean absolute error over the last HOLDOUT_MONTHS, fitted without them."""
    if len(values) <= HOLDOUT_MONTHS + 1:
        return None
    train, test = values[:-HOLDOUT_MONTHS], values[-HOLDOUT_MONTHS:]
    predicted = METHODS[method](train, HOLDOUT_MONTHS)
    return float(np.mean(np.abs(np.asarray(predicted) - np.asarray(test))))


def choose_method(values: list[float]) -> tuple[Method, dict[str, float | None], str]:
    scores = {m.value: holdout_mae(values, m) for m in METHODS}
    scored = {k: v for k, v in scores.items() if v is not None}
    if not scored:
        return (
            Method.moving_average,
            scores,
            "Too few periods to score methods; defaulted to a 3-month moving average.",
        )
    best = min(scored, key=lambda k: scored[k])
    reason = (
        f"Both methods were scored on a {HOLDOUT_MONTHS}-month holdout "
        + ", ".join(f"{k} MAE={v:.2f}" for k, v in scored.items())
        + f"; {best} was lower."
    )
    return Method(best), scores, reason


# --- entry point ------------------------------------------------------------


def _next_months(last_period: str, periods: int) -> list[str]:
    year, month, _ = (int(p) for p in last_period.split("-"))
    out = []
    for _ in range(periods):
        month += 1
        if month == 13:
            year, month = year + 1, 1
        out.append(date(year, month, 1).isoformat())
    return out


def forecast(
    session: Session,
    resolved: ResolvedGrain,
    metric: ForecastMetric = "total_quantity",
    periods: int = 4,
    method: Method = Method.auto,
) -> ForecastResult:
    history = load_monthly_history(session, resolved, metric)
    values = [point.value for point in history]

    if method is Method.auto:
        chosen, scores, reason = choose_method(values)
    else:
        chosen = method
        scores = {m.value: holdout_mae(values, m) for m in METHODS}
        reason = f"{chosen.value} was requested explicitly."

    predictions = METHODS[chosen](values, periods)
    future_periods = _next_months(history[-1].period, periods)
    forecast_points = [
        SeriesPoint(period=p, value=round(v, 2)) for p, v in zip(future_periods, predictions)
    ]

    # Safety stock over the horizon, from the volatility of observed demand.
    sigma = float(np.std(values, ddof=1)) if len(values) > 1 else 0.0
    horizon_demand = float(sum(predictions))
    safety_stock = SERVICE_LEVEL_Z * sigma * float(np.sqrt(periods))

    return ForecastResult(
        grain=resolved.grain.value,
        grain_value=resolved.value,
        metric=metric,
        method=chosen.value,
        method_reason=reason,
        history=history,
        forecast=forecast_points,
        holdout_mae=scores,
        inventory_recommendation={
            "horizon_months": periods,
            "expected_demand": round(horizon_demand, 2),
            "safety_stock": round(safety_stock, 2),
            "recommended_units": round(horizon_demand + safety_stock, 2),
            "basis": (
                f"Expected demand over {periods} months plus {SERVICE_LEVEL_Z} sigma "
                f"safety stock at a 95% service level (sigma={sigma:.2f} from monthly history)."
            ),
        },
        limitations=[
            f"Fitted on {len(values)} monthly observations - the dataset covers one year.",
            "Order volume declines sharply across the year in this sample; that is a "
            "property of the mock data, not an established seasonal pattern.",
            "No seasonality or external drivers (promotions, holidays) are modelled.",
        ],
        notes=list(resolved.notes),
    )
