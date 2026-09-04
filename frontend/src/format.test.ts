import { describe, expect, it } from "vitest";
import { formatDelta, formatParts, formatPeriodShort, formatValue } from "./format";

describe("formatValue", () => {
  it("renders days to one decimal, matching the design", () => {
    expect(formatValue(3.8297, "days")).toBe("3.8 days");
  });

  it("renders null as an em dash", () => {
    expect(formatValue(null, "count")).toBe("—");
  });
});

describe("formatParts", () => {
  it("splits a percent into main + unit", () => {
    expect(formatParts(0.822, "percent")).toEqual({ main: "82.2", unit: "%" });
  });

  it("splits days into main + unit", () => {
    expect(formatParts(3.8297, "days")).toEqual({ main: "3.8", unit: "days" });
  });

  it("splits a plain count with no unit", () => {
    expect(formatParts(400, "count")).toEqual({ main: "400", unit: "" });
  });

  it("does not put a currency symbol in `main` - the bug a regex split would hit", () => {
    // formatValue(1234, "currency") is "$1,234", which a /^([\d.,]+)(.*)$/
    // split would collapse entirely into the "unit" capture group with an
    // empty main - formatParts must not reproduce that.
    const parts = formatParts(1234, "currency");
    expect(parts.main).not.toContain("$");
    expect(parts.main).toBe("1,234");
    expect(parts.unit).toBe("USD");
  });

  it("returns an em dash with no unit for null", () => {
    expect(formatParts(null, "percent")).toEqual({ main: "—", unit: "" });
  });
});

describe("formatDelta", () => {
  it("signs a percent-point increase with +", () => {
    expect(formatDelta(0.8, 0.822, "percent")).toBe("+2.2 pts");
  });

  it("signs a decrease with U+2212, not a hyphen", () => {
    const result = formatDelta(0.85, 0.822, "percent");
    expect(result.startsWith("−")).toBe(true);
    expect(result).not.toMatch(/^-/); // an ASCII hyphen would be the wrong glyph
  });

  it("formats a days delta to one decimal with its unit", () => {
    expect(formatDelta(3.2, 3.8, "days")).toBe("+0.6 days");
  });

  it("formats a count delta as a bare signed integer", () => {
    expect(formatDelta(70, 75, "count")).toBe("+5");
    expect(formatDelta(75, 70, "count")).toBe("−5");
  });

  it("returns empty when either side is null", () => {
    expect(formatDelta(null, 5, "count")).toBe("");
    expect(formatDelta(5, null, "count")).toBe("");
  });
});

describe("formatPeriodShort", () => {
  it("abbreviates a month with no year suffix by default", () => {
    expect(formatPeriodShort("2025-03-01")).toBe("Mar");
  });

  it("appends a short year suffix only when the year differs from baseYear", () => {
    expect(formatPeriodShort("2025-03-01", 2025)).toBe("Mar");
    expect(formatPeriodShort("2026-01-01", 2025)).toBe("Jan '26");
  });

  it("passes through a non-ISO value unchanged", () => {
    expect(formatPeriodShort("DHL")).toBe("DHL");
  });
});
