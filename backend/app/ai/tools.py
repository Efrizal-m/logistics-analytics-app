"""Tool schemas, generated from the semantic registry.

The enums the model is allowed to choose from are read out of the registry, so
the tool schema cannot drift from what the query builder actually supports:
adding a metric in one place adds it in both.

These tools are deliberately not declared `strict`. Strict mode requires every
property to appear in `required`, which forces optional things - a time window,
a sort - into sentinel encodings that are easy for the model to get subtly
wrong. The real enforcement boundary is the Pydantic QuerySpec: whatever comes
back is validated against it before a single character of SQL is built, and an
identifier outside the enums cannot survive that.
"""

from __future__ import annotations

from typing import Any

from app.forecasting.grain import ForecastGrain
from app.semantic.registry import DIMENSIONS, METRICS
from app.semantic.schema import Dimension, FilterField, Metric

QUERY_TOOL = "query_analytics"
FORECAST_TOOL = "forecast_demand"


def _metric_enum() -> list[str]:
    return [m.value for m in Metric]


def _metric_catalogue() -> str:
    return "\n".join(f"- {m.value}: {METRICS[m].definition}" for m in Metric)


def _dimension_catalogue() -> str:
    return "\n".join(f"- {d.value}: {DIMENSIONS[d].label}" for d in Dimension)


def query_tool_schema() -> dict[str, Any]:
    return {
        "name": QUERY_TOOL,
        "description": (
            "Compute an aggregate over the logistics orders table. Use this for "
            "counts, rates, averages, rankings, breakdowns and time series - "
            "anything about what has already happened.\n\n"
            "Available metrics:\n" + _metric_catalogue() + "\n\n"
            "Available dimensions to group by:\n" + _dimension_catalogue() + "\n\n"
            "Group by month/week/day for a trend over time. Use time_range for "
            "recency ('last 3 months' -> last_n_months: 3); relative windows are "
            "resolved against the newest order date in the dataset, not today."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "metrics": {
                    "type": "array",
                    "items": {"type": "string", "enum": _metric_enum()},
                    "minItems": 1,
                    "maxItems": 6,
                    "description": "One or more metrics to compute.",
                },
                "group_by": {
                    "type": "array",
                    "items": {"type": "string", "enum": [d.value for d in Dimension]},
                    "maxItems": 2,
                    "description": (
                        "Dimensions to break the result down by. Omit for a single "
                        "headline number. At most one time bucket."
                    ),
                },
                "filters": {
                    "type": "array",
                    "maxItems": 8,
                    "items": {
                        "type": "object",
                        "properties": {
                            "field": {
                                "type": "string",
                                "enum": [f.value for f in FilterField],
                            },
                            "op": {"type": "string", "enum": ["in", "not_in"]},
                            "values": {
                                "type": "array",
                                "items": {"type": "string"},
                                "minItems": 1,
                                "description": "Exact values as they appear in the data, e.g. 'FedEx', 'EU', 'delayed'.",
                            },
                        },
                        "required": ["field", "values"],
                        "additionalProperties": False,
                    },
                },
                "time_range": {
                    "type": "object",
                    "properties": {
                        "start": {"type": "string", "description": "ISO date, inclusive."},
                        "end": {"type": "string", "description": "ISO date, inclusive."},
                        "last_n_months": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 36,
                            "description": "The N most recent calendar months in the dataset.",
                        },
                        "last_n_days": {"type": "integer", "minimum": 1, "maximum": 1095},
                    },
                    "additionalProperties": False,
                    "description": "Either an absolute window (start/end) or a relative one - never both.",
                },
                "sort": {
                    "type": "object",
                    "properties": {
                        "by": {
                            "type": "string",
                            "description": "A selected metric or a grouped dimension.",
                        },
                        "direction": {"type": "string", "enum": ["asc", "desc"]},
                    },
                    "required": ["by"],
                    "additionalProperties": False,
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 1000},
            },
            "required": ["metrics"],
            "additionalProperties": False,
        },
    }


def forecast_tool_schema() -> dict[str, Any]:
    return {
        "name": FORECAST_TOOL,
        "description": (
            "Forecast future monthly demand from historical orders, and recommend "
            "how much inventory to plan. Use this for any question about the "
            "future: predicted demand, how much to stock, expected volume.\n\n"
            "Forecasts are produced at category, region, carrier or total level. "
            "If the question names a specific SKU, pass it as `sku` - the tool "
            "lifts it to that SKU's product category and says so, because SKUs "
            "average about one order per year in this dataset and cannot be "
            "forecast individually."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "grain": {
                    "type": "string",
                    "enum": [g.value for g in ForecastGrain],
                    "description": "Level to forecast at. Use 'total' for the whole business.",
                },
                "grain_value": {
                    "type": "string",
                    "description": "The specific category/region/carrier, e.g. 'PENCIL'. Omit when grain is 'total'.",
                },
                "sku": {
                    "type": "string",
                    "description": "Set only if the question names a SKU, e.g. 'PENCIL-0213'.",
                },
                "metric": {
                    "type": "string",
                    "enum": ["total_quantity", "total_orders"],
                    "description": "Units demanded (default) or number of orders.",
                },
                "periods": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 12,
                    "description": "Months ahead to forecast. Default 4.",
                },
                "method": {
                    "type": "string",
                    "enum": ["auto", "moving_average", "linear_regression"],
                    "description": "Leave as 'auto' unless the user names a method; auto picks by holdout error.",
                },
            },
            "required": ["grain"],
            "additionalProperties": False,
        },
    }


def all_tools() -> list[dict[str, Any]]:
    return [query_tool_schema(), forecast_tool_schema()]
