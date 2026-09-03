"""Forecasting: method selection, guards, and the arithmetic underneath."""

from __future__ import annotations

import pytest

from app.forecasting.engine import (
    HOLDOUT_MONTHS,
    Method,
    forecast,
    holdout_mae,
    linear_regression,
    load_monthly_history,
    moving_average,
)
from app.forecasting.grain import ForecastGrain, GrainError, resolve_grain


def test_moving_average_projects_the_recent_level():
    assert moving_average([10, 20, 30], 1, window=3) == pytest.approx([20.0])
    # Each prediction feeds the next window, so a flat series stays flat.
    assert moving_average([10, 10, 10], 3, window=3) == pytest.approx([10.0, 10.0, 10.0])


def test_linear_regression_follows_a_clean_trend():
    assert linear_regression([1, 2, 3, 4], 2) == pytest.approx([5.0, 6.0], abs=1e-6)


@pytest.mark.parametrize("method", [Method.moving_average, Method.linear_regression])
def test_forecasts_never_go_negative(method):
    """A steep decline extrapolates below zero; demand cannot."""
    steep = [100, 80, 60, 40, 20, 5]
    predictions = {
        Method.moving_average: moving_average,
        Method.linear_regression: linear_regression,
    }[method](steep, 12)
    assert all(value >= 0 for value in predictions)


def test_holdout_scores_are_computed_on_data_the_method_did_not_see():
    values = [10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17]
    mae = holdout_mae(values, Method.linear_regression)
    assert mae is not None and mae >= 0
    assert holdout_mae([1, 2], Method.linear_regression) is None


def test_method_is_chosen_by_measurement_not_by_preference(session):
    resolved = resolve_grain(session, ForecastGrain.total, None)
    result = forecast(session, resolved, metric="total_orders", periods=4)

    scored = {k: v for k, v in result.holdout_mae.items() if v is not None}
    assert len(scored) == 2
    assert result.method == min(scored, key=lambda k: scored[k])
    assert f"{HOLDOUT_MONTHS}-month holdout" in result.method_reason


def test_history_covers_every_month_including_empty_ones(session):
    resolved = resolve_grain(session, ForecastGrain.product_category, "PENCIL")
    history = load_monthly_history(session, resolved, "total_orders")

    assert len(history) == 12, "one point per month of the dataset, gaps filled with zero"
    assert [p.period for p in history] == sorted(p.period for p in history)


def test_total_history_matches_the_dashboard(session):
    resolved = resolve_grain(session, ForecastGrain.total, None)
    history = load_monthly_history(session, resolved, "total_orders")
    assert sum(p.value for p in history) == 400


def test_sku_grain_is_refused_and_substituted(session):
    resolved = resolve_grain(session, ForecastGrain.total, None, sku="CRAYON-0008")
    assert resolved.grain is ForecastGrain.product_category
    assert resolved.value == "CRAYON"
    assert resolved.substituted_from_sku == "CRAYON-0008"
    assert resolved.notes, "the substitution must be reported, not silent"


def test_thin_groups_are_flagged(session):
    """Small groups still forecast, but the answer says the history is thin."""
    resolved = resolve_grain(session, ForecastGrain.carrier, "GLS")
    assert any("only" in note for note in resolved.notes)


def test_unknown_values_fail_loudly(session):
    with pytest.raises(GrainError, match="No orders found"):
        resolve_grain(session, ForecastGrain.carrier, "Pony Express")
    with pytest.raises(GrainError, match="needs a specific"):
        resolve_grain(session, ForecastGrain.region, None)


def test_inventory_recommendation_adds_safety_stock(session):
    resolved = resolve_grain(session, ForecastGrain.total, None)
    result = forecast(session, resolved, metric="total_quantity", periods=4)
    recommendation = result.inventory_recommendation

    assert recommendation["recommended_units"] == pytest.approx(
        recommendation["expected_demand"] + recommendation["safety_stock"]
    )
    assert recommendation["safety_stock"] > 0
    assert result.limitations, "the 12-point history must be disclosed"
