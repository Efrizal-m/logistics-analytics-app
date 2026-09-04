/**
 * Pure derivation for display strings the design specifies but the API does
 * not send verbatim - plan summaries, chart-type labels, KPI trend health,
 * forecast stat tiles. No React, no DOM: every function here takes plain data
 * and returns a string or a small object, so it can be tested without a
 * browser and reused by any component that needs the same derived value.
 */

import { formatDelta, formatParts, formatPeriodShort, titleCase } from "./format";
import type { AskResponse, ChartSpec, ForecastResult, Kpi, QueryPlan, Row } from "./types";

// --- plan / chart summaries --------------------------------------------------

/** "1 metric · grouped by month · no filters · 12 rows" (or "top 10" when the
 * result was truncated to the query's limit rather than being the whole
 * result set). */
export function planSummary(plan: QueryPlan): string {
  const metricPart = plan.metrics.length === 1 ? "1 metric" : `${plan.metrics.length} metrics`;
  const groupPart = plan.group_by.length
    ? `grouped by ${plan.group_by.map((g) => g.label.toLowerCase()).join(", ")}`
    : "not grouped";
  const filterPart = plan.filters.length
    ? `${plan.filters.length} filter${plan.filters.length === 1 ? "" : "s"}`
    : "no filters";
  const rowPart =
    plan.limit < 100 && plan.row_count === plan.limit
      ? `top ${plan.limit}`
      : `${plan.row_count} row${plan.row_count === 1 ? "" : "s"}`;
  return [metricPart, groupPart, filterPart, rowPart].join(" · ");
}

/** AskResponse carries no chart title the way ChartPayload does, so one is
 * built from the plan that actually ran: "Delay rate by carrier". */
export function askChartTitle(plan: QueryPlan): string {
  const metrics = plan.metrics.map((m) => m.label).join(", ");
  if (plan.group_by.length === 0) return metrics;
  return `${metrics} by ${plan.group_by.map((g) => g.label.toLowerCase()).join(", ")}`;
}

export function chartTypeLabel(spec: ChartSpec): string {
  switch (spec.type) {
    case "line":
      return spec.series.length > 1 ? "Multi-series line" : "Line";
    case "bar":
      return "Vertical bar";
    case "horizontal_bar":
      return "Horizontal bar";
    case "grouped_bar":
      return "Grouped bar";
    case "donut":
      return "Donut";
    case "kpi":
      return "Key figures";
    case "table":
      return "Table";
    default:
      return titleCase(spec.type);
  }
}

/** "5 metrics · period 2025" (or "2025–2026" if the dataset spans years). */
export function figuresNote(kpiCount: number, datasetStart: string, datasetEnd: string): string {
  const startYear = datasetStart.slice(0, 4);
  const endYear = datasetEnd.slice(0, 4);
  const period = startYear === endYear ? startYear : `${startYear}–${endYear}`;
  return `${kpiCount} metric${kpiCount === 1 ? "" : "s"} · period ${period}`;
}

/** "4 charts · 43 rows" - the row total is a real sum over what was fetched,
 * not a guess. */
export function chartsNote(payloads: { rows: Row[] }[]): string {
  const totalRows = payloads.reduce((sum, c) => sum + c.rows.length, 0);
  return `${payloads.length} chart${payloads.length === 1 ? "" : "s"} · ${totalRows} rows`;
}

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/** "Applies to all five figures" */
export function defsNote(kpiCount: number): string {
  const word = NUMBER_WORDS[kpiCount] ?? String(kpiCount);
  return `Applies to all ${word} figure${kpiCount === 1 ? "" : "s"}`;
}

// --- KPI trends (sparkline + delta + health) --------------------------------

export interface KpiTrend {
  key: string;
  periods: string[];
  values: (number | null)[];
  first: number | null;
  latest: number | null;
  /** The whole-dataset value for this KPI (KpisPayload.kpis[].value) - used
   * as the sparkline's baseline. Not a mean of the monthly points: for a
   * rate, averaging twelve monthly rates would weight every month equally
   * regardless of order volume, which is exactly the small-sample distortion
   * this app's registry warns about elsewhere. The period figure is already
   * computed correctly weighted, so it is reused rather than re-derived. */
  periodValue: number | null;
  /** "+1.5 pts vs Jan" - empty when there's no first/latest pair to compare. */
  delta: string;
  health: "none" | "warn";
  /** "Dec 81.5% vs 82.2% period" - empty when health is "none". */
  healthNote: string;
}

/**
 * `rows` is the kpi_trends chart payload's rows (one per month, keyed by
 * `xKey` plus each KPI's metric key). `kpis` is the KpisPayload's own list,
 * which supplies each metric's format/direction/period-value.
 */
export function buildKpiTrends(rows: Row[], xKey: string, kpis: Kpi[]): Map<string, KpiTrend> {
  const map = new Map<string, KpiTrend>();
  if (rows.length === 0) return map;

  const periods = rows.map((r) => String(r[xKey]));

  for (const kpi of kpis) {
    const values = rows.map((r) => {
      const raw = r[kpi.key];
      return typeof raw === "number" ? raw : null;
    });
    const first = values[0] ?? null;
    const latest = values[values.length - 1] ?? null;
    const periodValue = kpi.value;

    const delta =
      first !== null && latest !== null
        ? `${formatDelta(first, latest, kpi.format)} vs ${formatPeriodShort(periods[0])}`
        : "";

    let health: "none" | "warn" = "none";
    let healthNote = "";
    if (kpi.direction && latest !== null && periodValue !== null) {
      const worse = kpi.direction === "up" ? latest < periodValue : latest > periodValue;
      if (worse) {
        health = "warn";
        const latestParts = formatParts(latest, kpi.format);
        const periodParts = formatParts(periodValue, kpi.format);
        const lastPeriod = formatPeriodShort(periods[periods.length - 1]);
        healthNote = `${lastPeriod} ${latestParts.main}${latestParts.unit} vs ${periodParts.main}${periodParts.unit} period`;
      }
    }

    map.set(kpi.key, { key: kpi.key, periods, values, first, latest, periodValue, delta, health, healthNote });
  }

  return map;
}

// --- Ask ---------------------------------------------------------------

/** Split on blank lines. A single-paragraph answer round-trips as a
 * one-element array. */
export function answerParagraphs(answer: string): string[] {
  return answer
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** "1 query · 9 rows" / "1 query · 1 forecast · 12 rows" / "Request rejected
 * before execution". */
export function answerMeta(r: AskResponse): string {
  if (r.unsupported) return "Request rejected before execution";
  if (r.forecast) {
    const total = r.forecast.history.length + r.forecast.forecast.length;
    return `1 query · 1 forecast · ${total} row${total === 1 ? "" : "s"}`;
  }
  const rowCount = r.plan?.row_count ?? r.rows?.length ?? 0;
  return `1 query · ${rowCount} row${rowCount === 1 ? "" : "s"}`;
}

// --- forecast ----------------------------------------------------------

export interface StatTile {
  label: string;
  value: string;
  unit: string;
}

const STAT_LABELS: Record<string, string> = {
  expected_demand: "Expected demand",
  safety_stock: "Safety stock",
  recommended_units: "Recommended units",
  horizon_months: "Horizon",
};
const STAT_ORDER = ["expected_demand", "safety_stock", "recommended_units", "horizon_months"];

/** Unit comes from the field's key, not a regex over a pre-formatted string:
 * every quantity field shares one unit (units vs orders, by forecast metric),
 * and horizon is always months. */
export function forecastStats(f: ForecastResult): StatTile[] {
  const quantityUnit = f.metric === "total_quantity" ? "units" : "orders";
  return STAT_ORDER.filter((key) => key in f.inventory_recommendation).map((key) => {
    const raw = f.inventory_recommendation[key];
    const unit = key === "horizon_months" ? "months" : quantityUnit;
    const value = typeof raw === "number" ? Math.round(raw).toLocaleString() : String(raw);
    return { label: STAT_LABELS[key] ?? titleCase(key), value, unit };
  });
}

export interface MaeRow {
  name: string;
  value: string;
  chosen: boolean;
}

const METHOD_LABELS: Record<string, string> = {
  moving_average: "moving average",
  linear_regression: "linear regression",
};
// Only two methods actually exist (app/forecasting/engine.py). This renders
// however many the backend reports - not a fixed count - so it neither
// invents methods that were never run nor silently drops a future addition.
const METHOD_ORDER = ["moving_average", "linear_regression"];

export function maeRows(f: ForecastResult): MaeRow[] {
  const known = METHOD_ORDER.filter((key) => key in f.holdout_mae);
  const unknown = Object.keys(f.holdout_mae).filter((key) => !METHOD_ORDER.includes(key));
  return [...known, ...unknown].map((key) => {
    const raw = f.holdout_mae[key];
    return {
      name: METHOD_LABELS[key] ?? titleCase(key),
      value: raw === null || raw === undefined ? "n/a" : raw.toFixed(2),
      chosen: key === f.method,
    };
  });
}

// --- data table --------------------------------------------------------

/** Which row keys should render right-aligned/tabular. Declared from the
 * plan that actually ran (every selected metric, plus sample_size when a
 * rate metric added it) rather than sniffed from the first row's value type -
 * sniffing left-aligns a numeric column whose first row happens to be null. */
export function numericKeys(plan: QueryPlan): Set<string> {
  const keys = new Set(plan.metrics.map((m) => m.key));
  keys.add("sample_size");
  return keys;
}
