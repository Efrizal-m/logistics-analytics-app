import { line as d3Line } from "d3-shape";
import { CARDINAL_SPARK } from "../charts/curve";

interface SparklineProps {
  values: (number | null)[];
  width: number;
  height?: number;
  color?: string;
  /** The dashed reference line - the KPI band draws this at the whole-period
   * value, not the sparkline's own mean, so it reads as "here" vs "now". */
  baseline?: number | null;
  baselineWarn?: boolean;
  strokeWidth?: number;
}

/**
 * Raw inline SVG, not Recharts: this is a fixed ~78x22 mark, and five of them
 * per page don't want a ResponsiveContainer each. design/chart-svg.js's own
 * implementation is raw SVG for the same reason.
 */
export function Sparkline({
  values,
  width,
  height = 22,
  color = "var(--accent)",
  baseline = null,
  baselineWarn = false,
  strokeWidth = 1.4,
}: SparklineProps) {
  const numeric = values.filter((v): v is number => v !== null);

  if (numeric.length === 0) {
    return (
      <span
        className="la-hatch"
        aria-hidden="true"
        style={{ display: "block", width, height, flex: "none", opacity: 0.7 }}
      />
    );
  }

  const pad = 2;
  let lo = Math.min(...numeric);
  let hi = Math.max(...numeric);
  if (baseline !== null) {
    lo = Math.min(lo, baseline);
    hi = Math.max(hi, baseline);
  }
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }

  const n = values.length;
  const xAt = (i: number) => (n <= 1 ? width / 2 : (i / (n - 1)) * width);
  const yAt = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2);

  const points: [number, number][] = [];
  values.forEach((v, i) => {
    if (v !== null) points.push([xAt(i), yAt(v)]);
  });

  const path =
    d3Line<[number, number]>()
      .x((p) => p[0])
      .y((p) => p[1])
      .curve(CARDINAL_SPARK)(points) ?? "";

  let lastIndex = -1;
  values.forEach((v, i) => {
    if (v !== null) lastIndex = i;
  });
  const lastValue = lastIndex >= 0 ? values[lastIndex] : null;
  const baselineY = baseline !== null ? yAt(baseline) : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ display: "block", flex: "none" }}
    >
      {baselineY !== null && (
        <line
          x1={0}
          x2={width}
          y1={baselineY}
          y2={baselineY}
          stroke={baselineWarn ? "var(--warn)" : "var(--line-2)"}
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      )}
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      {lastValue !== null && <circle cx={xAt(lastIndex)} cy={yAt(lastValue)} r={2} fill={color} />}
    </svg>
  );
}
