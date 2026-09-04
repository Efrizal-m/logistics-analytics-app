"""Tests run against a real Postgres, because the metrics being tested are SQL.

Bring one up with `docker compose up -d db` (or the container in the README)
and seed it with `python -m app.seed` before running pytest.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db import get_engine
from app.semantic.executor import get_dataset_bounds


@pytest.fixture(scope="session")
def engine():
    try:
        engine = get_engine()
        with engine.connect() as connection:
            connection.execute(sa.text("SELECT 1 FROM orders LIMIT 1"))
    except Exception as exc:  # pragma: no cover - environment guard
        pytest.skip(f"Postgres not reachable or not seeded ({exc.__class__.__name__}). "
                    "Run: docker compose up -d db && python -m app.seed")
    return engine


@pytest.fixture
def session(engine):
    with Session(engine) as session:
        yield session


@pytest.fixture
def max_date(session):
    return get_dataset_bounds(session)[1]
