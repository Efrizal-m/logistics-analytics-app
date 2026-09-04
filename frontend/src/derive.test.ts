import { describe, expect, it } from "vitest";
import {
  answerMeta,
  answerParagraphs,
  buildKpiTrends,
  chartTypeLabel,
  maeRows,
  numericKeys,
  planSummary,
} from "./derive";
import type { AskResponse, ChartSpec, ForecastResult, Kpi, QueryPlan, Row } from "./types";

function plan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    metrics: [{ key: "total_orders", label: "Total orders", definition: "…", format: "count", direction: null }],
    group_by: [],
    filters: [],
    time_range: null,
    sort: null,
    limit: 100,
    row_count: 12,
    sql: "SELECT 1",
    notes: [],
    ...overrides,
  };
}

describe("planSummary", () => {
  it("matches the design's example exactly", () => {
    const p = plan({
      metrics: [{ key: "total_orders", label: "Total orders", definition: "…", format: "count", direction: null }],
      group_by: [{ key: "month", label: "Month" }],
      row_count: 12,
    });
    expect(planSummary(p)).toBe("1 metric · grouped by month · no filters · 12 rows");
  });

  it("says 'top N' only when the result was actually truncated to the limit", () => {
    const truncated = plan({ limit: 10, row_count: 10 });
    expect(planSummary(truncated)).toContain("top 10");

    const notTruncated = plan({ limit: 10, row_count: 7 });
    expect(planSummary(notTruncated)).toContain("7 rows");
    expect(planSummary(notTruncated)).not.toContain("top");
  });

  it("pluralizes filters and metrics correctly", () => {
    const p = plan({
      metrics: [
        { key: "a", label: "A", definition: "", format: "count", direction: null },
        { key: "b", label: "B", definition: "", format: "count", direction: null },
      ],
      filters: [{ field: "carrier", op: "in", values: ["DHL"], description: "carrier is DHL" }],
    });
    const summary = planSummary(p);
    expect(summary).toContain("2 metrics");
    expect(summary).toContain("1 filter");
    expect(summary).not.toContain("1 filters");
  });
});

describe("chartTypeLabel", () => {
  const base: ChartSpec = { type: "line", x_key: "month", x_label: null, series: [], reason: "" };

  it("distinguishes a single-series line from a multi-series one", () => {
    expect(chartTypeLabel({ ...base, series: [{ key: "a", label: "A", format: "count" }] })).toBe("Line");
    expect(
      chartTypeLabel({
        ...base,
        series: [
          { key: "a", label: "A", format: "count" },
          { key: "b", label: "B", format: "count" },
        ],
      }),
    ).toBe("Multi-series line");
  });

  it("labels bar chart variants", () => {
    expect(chartTypeLabel({ ...base, type: "bar" })).toBe("Vertical bar");
    expect(chartTypeLabel({ ...base, type: "horizontal_bar" })).toBe("Horizontal bar");
  });
});

describe("buildKpiTrends", () => {
  const rows: Row[] = [
    { month: "2025-01-01", on_time_rate: 0.8 },
    { month: "2025-02-01", on_time_rate: 0.81 },
    { month: "2025-12-01", on_time_rate: 0.7 },
  ];
  const kpi: Kpi = {
    key: "on_time_rate",
    label: "On-time delivery rate",
    value: 0.822, // the whole-period figure - deliberately higher than any monthly point
    format: "percent",
    definition: "…",
    sample_size: 370,
    direction: "up",
  };

  it("flags warn when the latest month is below the period figure for an 'up' metric", () => {
    const trends = buildKpiTrends(rows, "month", [kpi]);
    const trend = trends.get("on_time_rate")!;
    expect(trend.health).toBe("warn");
    expect(trend.healthNote).toContain("70.0%");
    expect(trend.healthNote).toContain("82.2%");
  });

  it("does not flag warn when the latest month is at or above the period figure", () => {
    const betterKpi: Kpi = { ...kpi, value: 0.65 };
    const trends = buildKpiTrends(rows, "month", [betterKpi]);
    expect(trends.get("on_time_rate")!.health).toBe("none");
  });

  it("never flags warn for a metric with no direction", () => {
    const noDirection: Kpi = { ...kpi, direction: null };
    const trends = buildKpiTrends(rows, "month", [noDirection]);
    expect(trends.get("on_time_rate")!.health).toBe("none");
  });

  it("computes delta against the first period, not the mean", () => {
    const trends = buildKpiTrends(rows, "month", [kpi]);
    // first=0.8, latest=0.7 -> -10.0 pts
    expect(trends.get("on_time_rate")!.delta).toBe("−10.0 pts vs Jan");
  });
});

describe("maeRows", () => {
  function forecast(holdout_mae: Record<string, number | null>, method = "linear_regression"): ForecastResult {
    return {
      grain: "total",
      grain_value: null,
      metric: "total_orders",
      method,
      method_reason: "",
      history: [],
      forecast: [],
      holdout_mae,
      inventory_recommendation: {},
      limitations: [],
      notes: [],
    };
  }

  it("renders however many methods the backend actually reports - not a fixed count", () => {
    const rows = maeRows(forecast({ moving_average: 12.3, linear_regression: 8.1 }));
    expect(rows).toHaveLength(2);
  });

  it("marks the chosen method and renders a missing score as n/a", () => {
    const rows = maeRows(forecast({ moving_average: null, linear_regression: 8.1 }, "linear_regression"));
    const chosen = rows.find((r) => r.chosen);
    expect(chosen?.name).toBe("linear regression");
    expect(rows.find((r) => r.name === "moving average")?.value).toBe("n/a");
  });

  it("keeps a known ordering (moving average before linear regression)", () => {
    const rows = maeRows(forecast({ linear_regression: 8.1, moving_average: 12.3 }));
    expect(rows.map((r) => r.name)).toEqual(["moving average", "linear regression"]);
  });
});

describe("answerParagraphs", () => {
  it("splits on blank lines and trims each paragraph", () => {
    expect(answerParagraphs("First.\n\nSecond.")).toEqual(["First.", "Second."]);
  });

  it("returns a single-element array for a one-paragraph answer", () => {
    expect(answerParagraphs("Just one sentence.")).toEqual(["Just one sentence."]);
  });
});

describe("answerMeta", () => {
  function ask(overrides: Partial<AskResponse> = {}): AskResponse {
    return {
      question: "q",
      answer: "a",
      tool: null,
      tool_input: null,
      plan: null,
      rows: null,
      chart: null,
      forecast: null,
      unsupported: false,
      supported_examples: [],
      ...overrides,
    };
  }

  it("reports rejection before execution for an unsupported question", () => {
    expect(answerMeta(ask({ unsupported: true }))).toBe("Request rejected before execution");
  });

  it("reports query + row count for a normal answer", () => {
    expect(answerMeta(ask({ plan: plan({ row_count: 9 }) }))).toBe("1 query · 9 rows");
  });

  it("reports query + forecast + combined row count for a forecast answer", () => {
    const forecast: ForecastResult = {
      grain: "total",
      grain_value: "PENCIL",
      metric: "total_quantity",
      method: "linear_regression",
      method_reason: "",
      history: Array.from({ length: 12 }, (_, i) => ({ period: `2025-${i}`, value: 1 })),
      forecast: Array.from({ length: 4 }, (_, i) => ({ period: `2026-${i}`, value: 1 })),
      holdout_mae: {},
      inventory_recommendation: {},
      limitations: [],
      notes: [],
    };
    expect(answerMeta(ask({ forecast }))).toBe("1 query · 1 forecast · 16 rows");
  });
});

describe("numericKeys", () => {
  it("includes every selected metric plus sample_size", () => {
    const p = plan({
      metrics: [{ key: "delay_rate", label: "Delay rate", definition: "", format: "percent", direction: "down" }],
    });
    const keys = numericKeys(p);
    expect(keys.has("delay_rate")).toBe(true);
    expect(keys.has("sample_size")).toBe(true);
    expect(keys.has("carrier")).toBe(false);
  });
});
