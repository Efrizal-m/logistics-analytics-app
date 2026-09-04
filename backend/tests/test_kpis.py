"""The KPI band and the internal-only preset that feeds its sparklines.

compute_kpis and compute_preset_chart both go through the same QuerySpec ->
builder path as everything else, so these tests are about the two things that
are specific to this layer: which presets are public, and that `direction`
(the frontend's health-marker input) is metric semantics, not invented here.
"""

from __future__ import annotations

from app.analytics.kpis import PRESET_CHARTS, compute_kpis, compute_preset_chart


def test_kpi_trends_is_not_a_public_preset(session):
    # /api/charts returns list(PRESET_CHARTS). kpi_trends exists to source the
    # KPI band's sparklines, not to be drawn as its own dashboard chart card.
    assert "kpi_trends" not in PRESET_CHARTS


def test_kpi_trends_returns_one_row_per_month_per_kpi_metric(session):
    title, rows, chart, plan = compute_preset_chart(session, "kpi_trends")

    assert title
    assert len(rows) == 12
    assert len(chart.series) == 5
    assert plan.row_count == 12
    # Every row carries all five KPI metric keys plus the grouping column.
    metric_keys = {m.key for m in plan.metrics}
    assert metric_keys == {
        "total_orders",
        "delivered_orders",
        "delayed_orders",
        "on_time_rate",
        "avg_delivery_days",
    }
    assert metric_keys <= rows[0].keys()


def test_compute_kpis_carries_direction_from_the_registry(session):
    kpis, _ = compute_kpis(session)
    by_key = {k.key: k for k in kpis}

    # A rate has a "good" direction; a plain count does not.
    assert by_key["on_time_rate"].direction == "up"
    assert by_key["avg_delivery_days"].direction == "down"
    assert by_key["total_orders"].direction is None
