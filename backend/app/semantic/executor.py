"""Run a BuiltQuery and package the result with its plan."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models import orders
from app.semantic.builder import BuiltQuery
from app.semantic.schema import QueryPlan

_bounds_cache: tuple[date, date] | None = None


def get_dataset_bounds(session: Session) -> tuple[date, date]:
    """(min, max) order_date. Cached - the dataset is static and read-only."""
    global _bounds_cache
    if _bounds_cache is None:
        row = session.execute(
            sa.select(
                sa.func.min(orders.c.order_date), sa.func.max(orders.c.order_date)
            )
        ).one()
        _bounds_cache = (row[0], row[1])
    return _bounds_cache


def reset_bounds_cache() -> None:
    global _bounds_cache
    _bounds_cache = None


def to_jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def execute(session: Session, built: BuiltQuery) -> tuple[list[dict[str, Any]], QueryPlan]:
    result = session.execute(built.statement)
    rows = [
        {key: to_jsonable(value) for key, value in row._mapping.items()}
        for row in result
    ]
    return rows, built.plan(row_count=len(rows))
