"""Physical schema. One table - the dataset is a single flat fact table.

Every column maps 1:1 to a column in mock_logistics_data.csv. Nothing is
derived here; derived quantities live in app/semantic/registry.py so there is
exactly one place where a metric is defined.
"""

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    Index,
    Integer,
    MetaData,
    Numeric,
    String,
    Table,
)

metadata = MetaData()

orders = Table(
    "orders",
    metadata,
    Column("order_id", String(40), primary_key=True),
    Column("client_id", String(20), nullable=False),
    Column("order_date", Date, nullable=False),
    # NULL for in_transit and canceled orders - 30 rows in the shipped dataset.
    # Every duration metric must guard against this.
    Column("delivery_date", Date, nullable=True),
    Column("carrier", String(40), nullable=False),
    Column("origin_city", String(80), nullable=False),
    Column("destination_city", String(80), nullable=False),
    Column("status", String(20), nullable=False),
    Column("sku", String(40), nullable=False),
    Column("product_category", String(40), nullable=False),
    Column("quantity", Integer, nullable=False),
    Column("unit_price_usd", Numeric(10, 2), nullable=False),
    Column("order_value_usd", Numeric(12, 2), nullable=False),
    Column("is_promo", Boolean, nullable=False),
    Column("promo_discount_pct", Numeric(5, 2), nullable=False),
    Column("region", String(20), nullable=False),
    Column("warehouse", String(20), nullable=False),
    Index("ix_orders_order_date", "order_date"),
    Index("ix_orders_status", "status"),
    Index("ix_orders_carrier", "carrier"),
    Index("ix_orders_product_category", "product_category"),
)
