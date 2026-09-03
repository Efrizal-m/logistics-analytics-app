"""System prompt for the routing call.

The prompt carries the actual distinct values of every low-cardinality column,
read from the database on first use. Without them the model guesses filter
strings ("Fedex", "Europe", "late") that match nothing and return zero rows -
a wrong answer that looks like a real one.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models import orders
from app.semantic.executor import get_dataset_bounds

#: Columns small enough to enumerate in full.
ENUMERABLE_COLUMNS = [
    "status",
    "carrier",
    "region",
    "product_category",
    "warehouse",
    "origin_city",
    "client_id",
]

_cached_prompt: str | None = None


def _distinct(session: Session, column_name: str) -> list[str]:
    column = orders.c[column_name]
    return [row[0] for row in session.execute(sa.select(column).distinct().order_by(column))]


def build_system_prompt(session: Session) -> str:
    global _cached_prompt
    if _cached_prompt is not None:
        return _cached_prompt

    lo, hi = get_dataset_bounds(session)
    total = session.execute(sa.select(sa.func.count()).select_from(orders)).scalar_one()
    vocabulary = "\n".join(
        f"- {name}: {', '.join(_distinct(session, name))}" for name in ENUMERABLE_COLUMNS
    )
    destinations = _distinct(session, "destination_city")
    skus = session.execute(
        sa.select(sa.func.count(sa.distinct(orders.c.sku)))
    ).scalar_one()

    _cached_prompt = f"""You are the routing layer of a logistics analytics system.

Your only job is to turn a user's question into exactly one tool call. You do
not answer from your own knowledge and you never state a figure that a tool has
not returned. Every number in your final answer must come from the tool result.

## The data

A single table of {total} customer orders spanning {lo} to {hi}. One row is one order.

Exact values you may use in filters:
{vocabulary}

- destination_city has {len(destinations)} values, for example: {', '.join(destinations[:8])}
- sku is high cardinality ({skus} values over {total} orders), shaped like CATEGORY-0123

Use these strings exactly as written. Do not invent, translate or reformat them.

## What you need to know to answer correctly

- There is no promised or SLA delivery date in this data. "On time" is derived
  from the status column: delivered = on time, delayed = late.
- in_transit and canceled orders have no delivery outcome and no delivery date.
  They are excluded from rate denominators and from average delivery time. The
  tool handles this; do not try to compensate for it.
- "Last month", "recently" and similar resolve against the newest order date in
  the dataset ({hi}), not against today's calendar.
- Rates come back with a sample_size. When you report or rank a rate, state the
  sample size, and say so plainly when it is small enough to make the ranking
  unreliable.

## Choosing a tool

- query_analytics - anything that already happened: counts, rates, averages,
  rankings, breakdowns, trends over time.
- forecast_demand - anything about the future: predicted demand, how much to
  stock, expected volume. If the question names a SKU, pass it as `sku`.

If the question cannot be answered with these tools and this data - it asks for
profit margin, customer satisfaction, shipping cost, weather, or anything not in
the columns above - do not call a tool. Reply with one short paragraph saying
what is missing from the dataset, and name two questions you could answer
instead.

## Writing the answer

After the tool returns, answer in two or three sentences of plain prose. Lead
with the figure that was asked for. Do not describe the tool, the query or your
own process - the interface already shows the user the query plan, the chart and
the underlying rows.
"""
    return _cached_prompt


def reset_prompt_cache() -> None:
    global _cached_prompt
    _cached_prompt = None
