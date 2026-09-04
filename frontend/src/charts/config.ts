import type { Variant } from "../useVariant";

export interface Geometry {
  line: number;
  vbar: number;
  hbar: number;
  forecast: number;
  axisFont: number;
  endLabel: number;
  valueLabel: number;
  barV: number;
  barH: number;
  marginRightSeries: number;
  yWidth: number;
  catWidth: number;
  xAngleDashboard: number;
  xAngleAsk: number;
}

export const GEOM: Record<Variant, Geometry> = {
  desktop: {
    line: 236,
    vbar: 258,
    hbar: 300,
    forecast: 280,
    axisFont: 10.5,
    endLabel: 10,
    valueLabel: 9.5,
    barV: 34,
    barH: 15,
    marginRightSeries: 76,
    yWidth: 34,
    // The backend switches to horizontal_bar once a category label exceeds
    // 12 chars (app/analytics/charts.py's LONG_LABEL_CHARS), so labels here
    // are routinely 13+ chars ("Washington, DC") - 96 wrapped them to two
    // lines; wide enough to fit ~18 chars at this font on one line.
    catWidth: 120,
    xAngleDashboard: -38,
    xAngleAsk: -30,
  },
  mobile: {
    line: 190,
    vbar: 212,
    hbar: 272,
    forecast: 240,
    axisFont: 9.5,
    endLabel: 9,
    valueLabel: 8.5,
    barV: 22,
    barH: 12,
    marginRightSeries: 46,
    yWidth: 30,
    catWidth: 104,
    xAngleDashboard: -38,
    xAngleAsk: -30,
  },
};

// `var()` is legal inside SVG presentation attributes, same as the design
// relies on (chart-svg.js:91) - Recharts passes these straight through.
export const CHART_TICK_FILL = "var(--axis)";
export const CHART_GRID_STROKE = "var(--grid)";
