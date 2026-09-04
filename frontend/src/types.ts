// Mirrors the Pydantic response models in backend/app/api. Kept by hand rather
// than generated - it is one file, and the shapes are small.

export type ChartType =
  | "line"
  | "bar"
  | "horizontal_bar"
  | "grouped_bar"
  | "donut"
  | "kpi"
  | "table";

export type MetricFormat = "count" | "percent" | "currency" | "days" | "number";

export interface ChartSeries {
  key: string;
  label: string;
  format: MetricFormat;
}

export interface ChartSpec {
  type: ChartType;
  x_key: string | null;
  x_label: string | null;
  series: ChartSeries[];
  /** Why this chart type was chosen - surfaced in the UI. */
  reason: string;
}

export type MetricDirection = "up" | "down";

export interface MetricInfo {
  key: string;
  label: string;
  definition: string;
  format: MetricFormat;
  /** Which way is good. Absent when a count is neither good nor bad. */
  direction: MetricDirection | null;
}

export interface FilterInfo {
  field: string;
  op: string;
  values: string[];
  description: string;
}

export interface ResolvedTimeRange {
  start: string | null;
  end: string | null;
  description: string;
  basis: string;
}

export interface QueryPlan {
  metrics: MetricInfo[];
  group_by: { key: string; label: string }[];
  filters: FilterInfo[];
  time_range: ResolvedTimeRange | null;
  sort: string | null;
  limit: number;
  row_count: number;
  sql: string;
  notes: string[];
}

export type Row = Record<string, string | number | null>;

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  format: MetricFormat;
  definition: string;
  sample_size: number | null;
  direction: MetricDirection | null;
}

export interface KpisPayload {
  kpis: Kpi[];
  plan: QueryPlan;
}

export interface ChartPayload {
  name: string;
  title: string;
  rows: Row[];
  chart: ChartSpec;
  plan: QueryPlan;
}

export interface SeriesPoint {
  period: string;
  value: number;
}

export interface ForecastResult {
  grain: string;
  grain_value: string | null;
  metric: string;
  method: string;
  method_reason: string;
  history: SeriesPoint[];
  forecast: SeriesPoint[];
  holdout_mae: Record<string, number | null>;
  inventory_recommendation: Record<string, number | string>;
  limitations: string[];
  notes: string[];
}

export interface AskResponse {
  question: string;
  answer: string;
  tool: string | null;
  tool_input: Record<string, unknown> | null;
  plan: QueryPlan | null;
  rows: Row[] | null;
  chart: ChartSpec | null;
  forecast: ForecastResult | null;
  unsupported: boolean;
  supported_examples: string[];
}

export interface SchemaResponse {
  metrics: MetricInfo[];
  dimensions: { key: string; label: string; temporal: boolean }[];
  dataset_start: string;
  dataset_end: string;
  ai_enabled: boolean;
  example_questions: string[];
}
