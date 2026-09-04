"""Load the CSV into Postgres and lock the API's role down to SELECT.

Idempotent: drops and recreates the table, so re-running is safe. Uses the
owner role; the API itself connects as a separate role that only ever holds
SELECT on orders, which is how "treat all data as read-only" is enforced at
the database rather than by convention in the application code.
"""

from __future__ import annotations

import csv
import sys
from datetime import date
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from psycopg import sql as pgsql

from app.config import get_settings
from app.models import metadata, orders

CSV_PATH = Path(__file__).resolve().parent.parent / "data" / "mock_logistics_data.csv"


def parse_date(value: str) -> date | None:
    value = value.strip()
    return date.fromisoformat(value) if value else None


def read_rows(csv_path: Path) -> list[dict[str, Any]]:
    with csv_path.open(newline="", encoding="utf-8") as handle:
        rows = []
        for raw in csv.DictReader(handle):
            rows.append(
                {
                    "order_id": raw["order_id"].strip(),
                    "client_id": raw["client_id"].strip(),
                    "order_date": parse_date(raw["order_date"]),
                    "delivery_date": parse_date(raw["delivery_date"]),
                    "carrier": raw["carrier"].strip(),
                    "origin_city": raw["origin_city"].strip(),
                    "destination_city": raw["destination_city"].strip(),
                    "status": raw["status"].strip(),
                    "sku": raw["sku"].strip(),
                    "product_category": raw["product_category"].strip(),
                    "quantity": int(raw["quantity"]),
                    "unit_price_usd": raw["unit_price_usd"].strip(),
                    "order_value_usd": raw["order_value_usd"].strip(),
                    "is_promo": raw["is_promo"].strip() in {"1", "true", "True"},
                    "promo_discount_pct": raw["promo_discount_pct"].strip() or "0",
                    "region": raw["region"].strip(),
                    "warehouse": raw["warehouse"].strip(),
                }
            )
    return rows


def grant_readonly(connection: sa.Connection, user: str, password: str, db: str) -> None:
    """Create (or update) the API's role and give it SELECT and nothing else.

    Postgres does not accept bind parameters in DDL, so the statements are
    composed with psycopg's sql module, which quotes the identifier and the
    password literal properly instead of interpolating raw strings.
    """
    raw = connection.connection.driver_connection
    role = pgsql.Identifier(user)
    database = pgsql.Identifier(db)

    with raw.cursor() as cursor:
        cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (user,))
        exists = cursor.fetchone() is not None

        verb = "ALTER ROLE {} WITH LOGIN PASSWORD {}" if exists else "CREATE ROLE {} LOGIN PASSWORD {}"
        cursor.execute(pgsql.SQL(verb).format(role, pgsql.Literal(password)))

        cursor.execute(pgsql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(database, role))
        cursor.execute(pgsql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(role))
        cursor.execute(pgsql.SQL("GRANT SELECT ON TABLE orders TO {}").format(role))
        # Belt and braces: no writes, ever, even if another table appears later.
        cursor.execute(
            pgsql.SQL(
                "REVOKE INSERT, UPDATE, DELETE, TRUNCATE "
                "ON ALL TABLES IN SCHEMA public FROM {}"
            ).format(role)
        )


def main() -> int:
    settings = get_settings()
    if not CSV_PATH.exists():
        print(f"CSV not found at {CSV_PATH}", file=sys.stderr)
        return 1

    rows = read_rows(CSV_PATH)
    engine = sa.create_engine(settings.owner_dsn)

    with engine.begin() as connection:
        metadata.drop_all(connection)
        metadata.create_all(connection)
        connection.execute(orders.insert(), rows)
        grant_readonly(
            connection,
            settings.readonly_user,
            settings.readonly_password,
            settings.postgres_db,
        )

    with engine.connect() as connection:
        count = connection.execute(sa.select(sa.func.count()).select_from(orders)).scalar()
        lo, hi = connection.execute(
            sa.select(sa.func.min(orders.c.order_date), sa.func.max(orders.c.order_date))
        ).one()

    print(f"Seeded {count} orders spanning {lo} .. {hi}")
    print(f"Read-only role '{settings.readonly_user}' granted SELECT on orders")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
