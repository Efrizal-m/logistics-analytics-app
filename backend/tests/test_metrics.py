"""Metric definitions, pinned to values computed independently from the CSV.

These numbers were derived by reading mock_logistics_data.csv directly, not by
running the application, so a regression in the SQL shows up as a failure here
rather than as a plausible-looking wrong number on the dashboard.
"""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

import pytest

from app.seed import CSV_PATH
from app.semantic.builder import build_query
from app.semantic.executor import execute
from app.semantic.schema import (
    Dimension,
    Filter,
    FilterField,
    Metric,
    QuerySpec,
    TimeRange,
)


def scalar(session, max_date, spec: QuerySpec, column: str):
    rows, _ = execute(session, build_query(spec, max_date))
    assert len(rows) == 1
    return rows[0][column]


# --- ground truth read straight from the CSV --------------------------------


@pytest.fixture(scope="module")
def csv_rows():
    with Path(CSV_PATH).open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def test_status_counts_match_the_csv(session, max_date, csv_rows):
    expected = {
        Metric.total_orders: len(csv_rows),
        Metric.delivered_orders: sum(r["status"] == "delivered" for r in csv_rows),
        Metric.delayed_orders: sum(r["status"] == "delayed" for r in csv_rows),
        Metric.exception_orders: sum(r["status"] == "exception" for r in csv_rows),
        Metric.in_transit_orders: sum(r["status"] == "in_transit" for r in csv_rows),
        Metric.canceled_orders: sum(r["status"] == "canceled" for r in csv_rows),
    }
    # Guards the guard: if the CSV is swapped out, these are still the shipped numbers.
    assert expected[Metric.total_orders] == 400
    assert expected[Metric.delivered_orders] == 304

    rows, _ = execute(session, build_query(QuerySpec(metrics=list(expected)), max_date))
    for metric, count in expected.items():
        assert rows[0][metric.value] == count, metric


def test_avg_delivery_days_excludes_orders_that_were_never_delivered(
    session, max_date, csv_rows
):
    """The 30 rows with no delivery_date are exactly the in_transit and canceled ones.

    Dividing by 400 instead of 370 is the easy mistake here, and it silently
    understates delivery time by about 8%.
    """
    delivered_leadtimes = [
        (date.fromisoformat(r["delivery_date"]) - date.fromisoformat(r["order_date"])).days
        for r in csv_rows
        if r["delivery_date"].strip()
    ]
    assert len(delivered_leadtimes) == 370
    assert len(csv_rows) - len(delivered_leadtimes) == 30

    expected = sum(delivered_leadtimes) / len(delivered_leadtimes)
    actual = scalar(
        session, max_date, QuerySpec(metrics=[Metric.avg_delivery_days]), "avg_delivery_days"
    )
    assert actual == pytest.approx(expected, abs=1e-9)

    naive = sum(delivered_leadtimes) / len(csv_rows)
    assert actual != pytest.approx(naive, abs=1e-3), "must not divide by the full row count"


def test_on_time_rate_denominator_is_concluded_orders_only(session, max_date, csv_rows):
    concluded = [r for r in csv_rows if r["status"] in {"delivered", "delayed", "exception"}]
    delivered = [r for r in concluded if r["status"] == "delivered"]
    expected = len(delivered) / len(concluded)

    rows, _ = execute(
        session, build_query(QuerySpec(metrics=[Metric.on_time_rate]), max_date)
    )
    assert rows[0]["on_time_rate"] == pytest.approx(expected)
    assert rows[0]["sample_size"] == len(concluded) == 370
    # in_transit (27) and canceled (3) carry no outcome and must not dilute it.
    assert rows[0]["sample_size"] != len(csv_rows)


def test_outcome_rates_sum_to_one(session, max_date):
    rows, _ = execute(
        session,
        build_query(
            QuerySpec(
                metrics=[
                    Metric.on_time_rate,
                    Metric.delay_rate,
                    Metric.exception_orders,
                    Metric.delivered_orders,
                    Metric.delayed_orders,
                ]
            ),
            max_date,
        ),
    )
    row = rows[0]
    exception_share = row["exception_orders"] / row["sample_size"]
    assert row["on_time_rate"] + row["delay_rate"] + exception_share == pytest.approx(1.0)


def test_every_rate_row_carries_its_denominator(session, max_date):
    """A 2-of-8 carrier must never be presented as comparable to an 11-of-47 one."""
    rows, plan = execute(
        session,
        build_query(
            QuerySpec(metrics=[Metric.delay_rate], group_by=[Dimension.carrier]), max_date
        ),
    )
    assert rows, "expected one row per carrier"
    assert all("sample_size" in row for row in rows)
    assert all(row["sample_size"] > 0 for row in rows)
    # Ranked by rate, so the top row is the "highest delay rate" answer...
    assert rows[0]["delay_rate"] >= rows[1]["delay_rate"]
    # ...and its sample size is small enough that the caveat matters.
    assert any("sample_size" in note for note in plan.notes)


def test_filters_and_time_range_narrow_the_result(session, max_date):
    total = scalar(session, max_date, QuerySpec(metrics=[Metric.total_orders]), "total_orders")
    fedex = scalar(
        session,
        max_date,
        QuerySpec(
            metrics=[Metric.total_orders],
            filters=[Filter(field=FilterField.carrier, values=["FedEx"])],
        ),
        "total_orders",
    )
    december = scalar(
        session,
        max_date,
        QuerySpec(metrics=[Metric.total_orders], time_range=TimeRange(last_n_months=1)),
        "total_orders",
    )
    assert 0 < fedex < total
    assert 0 < december < total


def test_monthly_grouping_returns_one_row_per_month_in_order(session, max_date):
    rows, plan = execute(
        session,
        build_query(
            QuerySpec(metrics=[Metric.total_orders], group_by=[Dimension.month]), max_date
        ),
    )
    assert len(rows) == 12
    assert [r["month"] for r in rows] == sorted(r["month"] for r in rows)
    assert sum(r["total_orders"] for r in rows) == 400
    assert plan.sort == "month asc"
