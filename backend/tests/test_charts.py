"""Chart type is a function of the query's shape, not of the model's opinion."""

from __future__ import annotations

import pytest

from app.analytics.charts import select_chart
from app.semantic.schema import Dimension, Metric, QuerySpec


def spec(**kwargs) -> QuerySpec:
    kwargs.setdefault("metrics", [Metric.total_orders])
    return QuerySpec(**kwargs)


def test_a_bare_aggregate_is_a_single_number():
    assert select_chart(spec(), [{"total_orders": 400}]).type == "kpi"


@pytest.mark.parametrize("bucket", [Dimension.month, Dimension.week, Dimension.day])
def test_time_buckets_become_lines(bucket):
    chart = select_chart(spec(group_by=[bucket]), [{bucket.value: "2025-01-01"}])
    assert chart.type == "line"
    assert chart.x_key == bucket.value


def test_a_short_categorical_breakdown_is_a_bar_chart():
    rows = [{"carrier": name} for name in ["UPS", "DHL", "FedEx"]]
    assert select_chart(spec(group_by=[Dimension.carrier]), rows).type == "bar"


def test_long_labels_flip_the_bars_horizontal():
    rows = [{"destination_city": "San Francisco, CA"}, {"destination_city": "Boston, MA"}]
    assert select_chart(spec(group_by=[Dimension.destination_city]), rows).type == "horizontal_bar"


def test_many_categories_flip_the_bars_horizontal():
    rows = [{"carrier": f"C{i}"} for i in range(15)]
    assert select_chart(spec(group_by=[Dimension.carrier]), rows).type == "horizontal_bar"


def test_a_count_split_by_status_is_a_composition():
    rows = [{"status": s} for s in ["delivered", "delayed", "in_transit"]]
    assert select_chart(spec(group_by=[Dimension.status]), rows).type == "donut"


def test_a_rate_by_status_is_not_a_composition():
    """Rates do not sum to a whole, so a donut would be a lie."""
    rows = [{"status": s} for s in ["delivered", "delayed"]]
    chart = select_chart(spec(metrics=[Metric.on_time_rate], group_by=[Dimension.status]), rows)
    assert chart.type == "bar"


def test_two_dimensions_group_the_bars():
    rows = [{"month": "2025-01-01", "carrier": "UPS"}]
    chart = select_chart(spec(group_by=[Dimension.month, Dimension.carrier]), rows)
    assert chart.type == "grouped_bar"


def test_every_choice_explains_itself():
    chart = select_chart(spec(group_by=[Dimension.carrier]), [{"carrier": "UPS"}])
    assert chart.reason
    assert [s.label for s in chart.series] == ["Total orders"]
