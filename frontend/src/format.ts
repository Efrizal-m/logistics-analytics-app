import type { MetricFormat } from "./types";

export function formatValue(value: number | null | undefined, format: MetricFormat): string {
  if (value === null || value === undefined) return "—";
  switch (format) {
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "currency":
      return value.toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });
    case "days":
      return `${value.toFixed(2)} days`;
    case "count":
    case "number":
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    default:
      return String(value);
  }
}

/** Axis ticks: "2025-01-01" is noise on a monthly axis; "Jan 2025" is not. */
export function formatPeriod(period: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (!match) return period;
  const date = new Date(`${period}T00:00:00Z`);
  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function titleCase(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
