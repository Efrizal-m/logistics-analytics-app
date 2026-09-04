"""The builder is the security boundary between the model and the database."""

from __future__ import annotations

from datetime import date

import pytest
import sqlalchemy as sa
from pydantic import ValidationError

from app.semantic.builder import QueryBuildError, build_query, resolve_time_range
from app.semantic.executor import execute
from app.semantic.schema import (
    Dimension,
    Filter,
    FilterField,
    Metric,
    QuerySpec,
    Sort,
    TimeRange,
)

MAX_DATE = date(2025, 12, 30)


# --- the whitelist ----------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        {"metrics": ["profit_margin"]},
        {"metrics": ["total_orders"], "group_by": ["customer_lifetime_value"]},
        {"metrics": ["total_orders"], "filters": [{"field": "order_value_usd", "values": ["10"]}]},
        {"metrics": ["total_orders"], "filters": [{"field": "carrier", "op": "like", "values": ["Fed%"]}]},
        {"metrics": []},
        {"metrics": ["total_orders"], "limit": 100000},
        {"metrics": ["total_orders"], "drop_table": True},
    ],
    ids=[
        "unknown metric",
        "unknown dimension",
        "non-filterable field",
        "unsupported operator",
        "no metric",
        "limit above cap",
        "extra key",
    ],
)
def test_anything_outside_the_registry_is_rejected_before_sql_exists(payload):
    """Rejection happens at validation, so an invented identifier never reaches the builder."""
    with pytest.raises(ValidationError):
        QuerySpec(**payload)


def test_sort_must_name_something_that_was_actually_selected(session):
    spec = QuerySpec(
        metrics=[Metric.total_orders],
        group_by=[Dimension.carrier],
        sort=Sort(by="total_revenue"),
    )
    with pytest.raises(QueryBuildError, match="Cannot sort by"):
        build_query(spec, MAX_DATE)


def test_filter_values_are_bound_parameters_not_interpolated_sql(session, max_date, engine):
    """A hostile filter value is data, not code.

    Values reach Postgres as bound parameters, so this returns no rows and
    leaves the table intact rather than executing anything.
    """
    hostile = "FedEx'; DROP TABLE orders; --"
    spec = QuerySpec(
        metrics=[Metric.total_orders],
        filters=[Filter(field=FilterField.carrier, values=[hostile])],
    )
    rows, _ = execute(session, build_query(spec, max_date))
    assert rows[0]["total_orders"] == 0

    with engine.connect() as connection:
        surviving = connection.execute(sa.text("SELECT count(*) FROM orders")).scalar()
    assert surviving == 400


def test_generated_sql_is_the_builders_own_and_is_parameterized(session):
    spec = QuerySpec(
        metrics=[Metric.total_orders],
        filters=[Filter(field=FilterField.carrier, values=["FedEx"])],
    )
    built = build_query(spec, MAX_DATE)
    compiled = built.statement.compile()
    assert "FedEx" not in str(compiled), "value must travel as a parameter"
    # IN uses an expanding parameter, so the bound value is the list itself.
    assert ["FedEx"] in compiled.params.values()


# --- relative time windows --------------------------------------------------


def test_relative_windows_anchor_to_the_dataset_not_to_today():
    """The data ends 2025-12-30. Anchoring to the wall clock returns nothing."""
    resolved = resolve_time_range(TimeRange(last_n_months=1), MAX_DATE)
    assert resolved is not None
    assert resolved.start == date(2025, 12, 1)
    assert resolved.end == MAX_DATE
    assert "2025-12-30" in resolved.basis
    assert date.today().year != 2025, "if this fails the test below is meaningless"


def test_last_three_months_spans_three_calendar_months():
    resolved = resolve_time_range(TimeRange(last_n_months=3), MAX_DATE)
    assert resolved is not None
    assert (resolved.start, resolved.end) == (date(2025, 10, 1), MAX_DATE)


def test_year_boundary_is_handled():
    resolved = resolve_time_range(TimeRange(last_n_months=3), date(2025, 2, 15))
    assert resolved is not None
    assert resolved.start == date(2024, 12, 1)


def test_absolute_and_relative_windows_are_mutually_exclusive():
    with pytest.raises(ValidationError):
        TimeRange(start=date(2025, 1, 1), last_n_months=3)
    with pytest.raises(ValidationError):
        TimeRange(last_n_months=3, last_n_days=30)
    with pytest.raises(ValidationError):
        TimeRange(start=date(2025, 6, 1), end=date(2025, 1, 1))


def test_plan_explains_what_was_executed(session, max_date):
    spec = QuerySpec(
        metrics=[Metric.on_time_rate],
        group_by=[Dimension.carrier],
        filters=[Filter(field=FilterField.region, values=["EU", "UK"])],
        time_range=TimeRange(last_n_months=3),
    )
    rows, plan = execute(session, build_query(spec, max_date))

    assert plan.row_count == len(rows)
    assert [m.key for m in plan.metrics] == ["on_time_rate"]
    assert [d.key for d in plan.group_by] == ["carrier"]
    assert plan.filters[0].description == "region is one of EU, UK"
    assert plan.time_range is not None and "last 3 calendar months" in plan.time_range.description
    assert "SELECT" in plan.sql
    assert plan.metrics[0].definition.startswith("delivered / ")
