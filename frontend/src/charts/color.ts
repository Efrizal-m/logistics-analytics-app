/**
 * Series color is assigned semantically, not positionally: a delivery-outcome
 * chart always paints "delayed" in the red step of the ramp regardless of
 * which position it happens to occupy in a given response, so a bad outcome
 * reads as bad on sight. Everything without a semantic meaning falls back to
 * the ramp in order.
 */

export interface SeriesStyle {
  color: string;
  /** Vertical nudge (px) for this series' end-of-line label, so labels for
   * series that finish close together (e.g. Delivered/Exception) don't
   * collide. Only meaningful when a chart uses end labels. */
  dy: number;
  /** End-label text for the desktop variant. The margin reserved for these
   * labels (charts/config.ts's marginRightSeries) is tuned for this word,
   * not the full metric label ("Delivered orders") - using the full label
   * here clips it against the chart's right edge. */
  long: string;
  /** Abbreviated end-label text for the mobile variant. */
  short: string;
}

const RAMP = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

const SEMANTIC: Record<string, SeriesStyle> = {
  delivered_orders: { color: "var(--chart-1)", dy: -1, long: "Delivered", short: "Del." },
  delayed_orders: { color: "var(--chart-5)", dy: -6, long: "Delayed", short: "Dly." },
  exception_orders: { color: "var(--chart-2)", dy: 7, long: "Exception", short: "Exc." },
};

export function seriesStyle(key: string, index: number, total: number): SeriesStyle {
  if (total <= 1) return { color: "var(--chart-1)", dy: 0, long: "", short: "" };
  return SEMANTIC[key] ?? { color: RAMP[index % RAMP.length], dy: 0, long: "", short: "" };
}
