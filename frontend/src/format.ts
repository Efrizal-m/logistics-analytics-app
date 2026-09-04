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
      return `${value.toFixed(1)} days`;
    case "count":
    case "number":
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    default:
      return String(value);
  }
}

export interface ValueParts {
  main: string;
  unit: string;
}

/**
 * The KPI band splits a value into a big numeral and a small unit ("3.8" +
 * "days", "82.2" + "%"). formatValue's output isn't safely splittable by
 * regex - currency starts with "$" - so this builds the parts directly
 * instead of parsing formatValue's string back apart.
 */
export function formatParts(value: number | null | undefined, format: MetricFormat): ValueParts {
  if (value === null || value === undefined) return { main: "—", unit: "" };
  switch (format) {
    case "percent":
      return { main: (value * 100).toFixed(1), unit: "%" };
    case "currency":
      return {
        main: value.toLocaleString(undefined, { maximumFractionDigits: 0 }),
        unit: "USD",
      };
    case "days":
      return { main: value.toFixed(1), unit: "days" };
    case "count":
    case "number":
      return { main: value.toLocaleString(undefined, { maximumFractionDigits: 2 }), unit: "" };
    default:
      return { main: String(value), unit: "" };
  }
}

const MINUS = "−";

/** Signed magnitude between two values of the same metric format - "+1.5 pts",
 * "−0.6 days", "+2". The caller appends its own comparison label
 * ("vs Jan"), since only it knows what the comparison period actually is. */
export function formatDelta(
  from: number | null,
  to: number | null,
  format: MetricFormat,
): string {
  if (from === null || to === null) return "";
  switch (format) {
    case "percent": {
      const rounded = Math.round((to - from) * 1000) / 10; // pp, 1dp
      const sign = rounded < 0 ? MINUS : "+";
      return `${sign}${Math.abs(rounded).toFixed(1)} pts`;
    }
    case "days": {
      const rounded = Math.round((to - from) * 10) / 10;
      const sign = rounded < 0 ? MINUS : "+";
      return `${sign}${Math.abs(rounded).toFixed(1)} days`;
    }
    case "count":
    case "number": {
      const diff = Math.round(to - from);
      const sign = diff < 0 ? MINUS : "+";
      return `${sign}${Math.abs(diff)}`;
    }
    case "currency": {
      const diff = Math.round(to - from);
      const sign = diff < 0 ? MINUS : "+";
      return `${sign}${Math.abs(diff).toLocaleString()}`;
    }
    default:
      return "";
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

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * The design's chart labels: just the month, "Jan" - except a period that
 * rolls into a year other than `baseYear` gets a short year suffix, "Jan '26",
 * so a forecast crossing a year boundary is still legible. `baseYear` is
 * normally the first period's year.
 */
export function formatPeriodShort(period: string, baseYear?: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (!match) return period;
  const year = Number(match[1]);
  const abbr = MONTH_ABBR[Number(match[2]) - 1] ?? period;
  if (baseYear !== undefined && year !== baseYear) {
    return `${abbr} '${String(year).slice(2)}`;
  }
  return abbr;
}

export function titleCase(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
