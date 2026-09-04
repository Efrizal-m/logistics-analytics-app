import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_GRID_STROKE, CHART_TICK_FILL, GEOM } from "../charts/config";
import { CARDINAL } from "../charts/curve";
import { seriesStyle } from "../charts/color";
import { niceScale, niceScalePercent, withHeadroom } from "../charts/scale";
import { formatPeriodShort, formatValue } from "../format";
import type { ChartSpec, Row } from "../types";
import type { Variant } from "../useVariant";

const PERIOD_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  spec: ChartSpec;
  rows: Row[];
  variant: Variant;
  /** Overrides for a chart drawn outside the dashboard grid (Ask's result
   * chart is bigger and rotated less steeply than the 4-up grid version). */
  height?: number;
  maxBarSize?: number;
  xAngle?: number;
  xAxisHeight?: number;
  /** Paint the first row in the "bad" ramp step - used when the query was
   * explicitly sorted by the metric being drawn, so row 0 means "what the
   * query ranked first," not an invented notion of "worst." */
  highlightFirst?: boolean;
}

const AXIS_TEXT = { fill: CHART_TICK_FILL, fontFamily: "var(--font-m)" };

function RotatedTick(props: {
  x?: number;
  y?: number;
  payload?: { value: string | number };
  angle: number;
  fontSize: number;
}) {
  const { x = 0, y = 0, payload, angle, fontSize } = props;
  return (
    <text
      x={x}
      y={y}
      dy={13}
      textAnchor="end"
      transform={`rotate(${angle} ${x} ${y})`}
      fill={CHART_TICK_FILL}
      fontFamily="var(--font-m)"
      fontSize={fontSize}
    >
      {payload?.value}
    </text>
  );
}

/**
 * Recharts' default category tick auto-wraps a label onto a second line (via
 * internal <tspan>s) once its own width estimate exceeds the axis `width`,
 * even when there's visibly enough room ("Washington, DC" onto two lines).
 * A plain custom tick opts out of that wrapping - city/carrier names read on
 * one line, same as the backend's own reason for choosing this chart type
 * ("labels up to 14 characters; horizontal bars keep them readable").
 */
function CategoryTick(props: { x?: number; y?: number; payload?: { value: string | number }; fontSize: number }) {
  const { x = 0, y = 0, payload, fontSize } = props;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill={CHART_TICK_FILL} fontFamily="var(--font-m)" fontSize={fontSize}>
      {payload?.value}
    </text>
  );
}

interface LabelProps {
  x?: string | number;
  y?: string | number;
  value?: string | number;
  width?: string | number;
  height?: string | number;
  index?: number;
}

function ValueLabel(
  props: LabelProps & { fontSize: number; format: (v: number) => string; position: "top" | "right" },
) {
  const { value, fontSize, format, position } = props;
  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const width = Number(props.width ?? 0);
  const height = Number(props.height ?? 0);
  if (value === undefined || value === null) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  const label = format(numeric);
  const px = position === "top" ? x + width / 2 : x + width + 7;
  const py = position === "top" ? y - 6 : y + height / 2 + 4;
  return (
    <text
      x={px}
      y={py}
      textAnchor={position === "top" ? "middle" : "start"}
      fill="var(--muted)"
      fontFamily="var(--font-m)"
      fontWeight={500}
      fontSize={fontSize}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {label}
    </text>
  );
}

function endLabelContent(rows: Row[], dataKey: string, label: string, dy: number, color: string, fontSize: number) {
  let lastIndex = -1;
  rows.forEach((r, i) => {
    if (r[dataKey] !== null && r[dataKey] !== undefined) lastIndex = i;
  });
  return (props: LabelProps) => {
    const { index } = props;
    if (index !== lastIndex || props.x === undefined || props.y === undefined) return null;
    const x = Number(props.x);
    const y = Number(props.y);
    return (
      <text x={x + 7} y={y + 4 + dy} fill={color} fontFamily="var(--font-m)" fontWeight={500} fontSize={fontSize}>
        {label}
      </text>
    );
  };
}

const TOOLTIP_STYLE = {
  border: "1px solid var(--line)",
  borderRadius: 0,
  background: "var(--raise)",
  fontSize: 12,
  fontFamily: "var(--font-b)",
};

/**
 * Renders whatever the backend decided to draw. The chart type is not chosen
 * here - it arrives on the ChartSpec - so the same question always produces
 * the same visual.
 */
export function ChartRenderer({
  spec,
  rows,
  variant,
  height,
  maxBarSize,
  xAngle,
  xAxisHeight,
  highlightFirst = false,
}: Props) {
  const geom = GEOM[variant];

  if (!rows.length) {
    return <p style={{ color: "var(--muted)", fontSize: 12 }}>No rows matched this query.</p>;
  }

  const xKey = spec.x_key ?? "";
  const xValues = rows.map((r) => String(r[xKey] ?? ""));
  const periodLike = PERIOD_RE.test(xValues[0] ?? "");
  const baseYear = periodLike ? Number(xValues[0].slice(0, 4)) : undefined;
  const xTickFormatter = (value: string) =>
    periodLike ? formatPeriodShort(String(value), baseYear) : String(value);

  const primary = spec.series[0];
  // Only true when EVERY series is a percent - a chart mixing delay_rate
  // (0-1 fraction) with total_orders (a raw count), which the AI can
  // legitimately ask for, must not have the whole axis multiplied by 100 on
  // the strength of series[0] alone. Falls back to a plain numeric scale,
  // same as this app did before any axis scaling existed.
  const isPercent = spec.series.length > 0 && spec.series.every((s) => s.format === "percent");

  const tooltipFormatter = (value: number, name: string) => {
    const series = spec.series.find((s) => s.label === name || s.key === name);
    return [formatValue(value, series?.format ?? "number"), series?.label ?? name];
  };

  if (spec.type === "kpi") {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {spec.series.map((series) => (
          <div key={series.key}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{series.label}</div>
            <div className="la-num" style={{ fontSize: 22, fontWeight: 500, color: "var(--text)" }}>
              {formatValue(Number(rows[0][series.key]), series.format)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (spec.type === "donut") {
    const data = rows.map((row) => ({
      name: String(row[xKey] ?? ""),
      value: Number(row[primary.key] ?? 0),
    }));
    return (
      <ResponsiveContainer width="100%" height={height ?? geom.vbar}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%">
            {data.map((_, index) => (
              <Cell key={index} fill={seriesStyle("", index, 6).color} />
            ))}
          </Pie>
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-b)" }} />
          <Tooltip formatter={tooltipFormatter} labelFormatter={xTickFormatter} contentStyle={TOOLTIP_STYLE} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (spec.type === "line") {
    const values = rows.flatMap((r) =>
      spec.series.map((s) => (typeof r[s.key] === "number" ? (r[s.key] as number) : 0)),
    );
    const maxValue = Math.max(0, ...values);
    const scale = isPercent ? niceScalePercent(maxValue) : niceScale(maxValue);
    const isMulti = spec.series.length > 1;

    return (
      <ResponsiveContainer width="100%" height={height ?? geom.line}>
        <LineChart
          data={rows}
          margin={{ top: 4, right: isMulti ? geom.marginRightSeries : 8, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
          <XAxis
            dataKey={xKey}
            tickFormatter={xTickFormatter}
            axisLine={false}
            tickLine={false}
            tick={{ ...AXIS_TEXT, fontSize: geom.axisFont }}
          />
          <YAxis
            width={geom.yWidth}
            domain={[0, scale.max]}
            ticks={scale.ticks}
            axisLine={false}
            tickLine={false}
            tickFormatter={isPercent ? (t: number) => `${Math.round(t * 100)}%` : undefined}
            tick={{ ...AXIS_TEXT, fontSize: geom.axisFont }}
          />
          <Tooltip formatter={tooltipFormatter} labelFormatter={xTickFormatter} contentStyle={TOOLTIP_STYLE} />
          {spec.series.map((series, index) => {
            const style = seriesStyle(series.key, index, spec.series.length);
            return (
              <Line
                key={series.key}
                type={CARDINAL}
                dataKey={series.key}
                name={series.label}
                stroke={style.color}
                strokeWidth={2}
                dot={{ r: 2.5 }}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              >
                {isMulti && (
                  <LabelList
                    dataKey={series.key}
                    content={endLabelContent(
                      rows,
                      series.key,
                      variant === "mobile" ? style.short || series.label : style.long || series.label,
                      style.dy,
                      style.color,
                      geom.endLabel,
                    )}
                  />
                )}
              </Line>
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  const horizontal = spec.type === "horizontal_bar";

  if (horizontal) {
    const values = rows.map((r) => Number(r[primary.key] ?? 0));
    const scale = withHeadroom(niceScale(Math.max(0, ...values)));
    const barSize = maxBarSize ?? geom.barH;
    const barHeight = Math.max(height ?? geom.hbar, rows.length * 26 + 40);

    return (
      <ResponsiveContainer width="100%" height={barHeight}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_GRID_STROKE} vertical horizontal={false} />
          <XAxis
            type="number"
            domain={[0, scale.max]}
            ticks={scale.ticks}
            axisLine={false}
            tickLine={false}
            tick={{ ...AXIS_TEXT, fontSize: geom.axisFont }}
          />
          <YAxis
            type="category"
            dataKey={xKey}
            width={geom.catWidth}
            axisLine={false}
            tickLine={false}
            tick={<CategoryTick fontSize={geom.axisFont} />}
          />
          <Bar dataKey={primary.key} name={primary.label} fill="var(--chart-1)" radius={0} maxBarSize={barSize} isAnimationActive={false}>
            {rows.map((_, index) => (
              <Cell
                key={index}
                fill={highlightFirst && index === 0 ? "var(--chart-5)" : "var(--chart-1)"}
              />
            ))}
            <LabelList
              dataKey={primary.key}
              content={(p: LabelProps) => (
                <ValueLabel {...p} position="right" fontSize={geom.valueLabel} format={(v) => String(v)} />
              )}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Vertical bar (single or grouped).
  const isGrouped = spec.series.length > 1;
  const values = rows.flatMap((r) =>
    spec.series.map((s) => (typeof r[s.key] === "number" ? (r[s.key] as number) : 0)),
  );
  const maxValue = Math.max(0, ...values);
  const scale = isPercent ? niceScalePercent(maxValue) : niceScale(maxValue);
  const angle = xAngle ?? geom.xAngleDashboard;
  const bottomHeight = xAxisHeight ?? 46;
  const barSize = maxBarSize ?? geom.barV;

  return (
    <ResponsiveContainer width="100%" height={height ?? geom.vbar}>
      <BarChart data={rows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
        <XAxis
          dataKey={xKey}
          interval={0}
          height={bottomHeight}
          axisLine={false}
          tickLine={false}
          tick={<RotatedTick angle={angle} fontSize={geom.axisFont} />}
        />
        <YAxis
          width={geom.yWidth}
          domain={[0, scale.max]}
          ticks={scale.ticks}
          axisLine={false}
          tickLine={false}
          tickFormatter={isPercent ? (t: number) => `${Math.round(t * 100)}%` : undefined}
          tick={{ ...AXIS_TEXT, fontSize: geom.axisFont }}
        />
        {isGrouped && (
          <Legend iconType="square" wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-b)" }} />
        )}
        {spec.series.map((series, index) => {
          const style = seriesStyle(series.key, index, spec.series.length);
          return (
            <Bar
              key={series.key}
              dataKey={series.key}
              name={series.label}
              fill={style.color}
              radius={0}
              maxBarSize={barSize}
              isAnimationActive={false}
            >
              {!isGrouped &&
                rows.map((_, i) => (
                  <Cell key={i} fill={highlightFirst && i === 0 ? "var(--chart-5)" : style.color} />
                ))}
              {!isGrouped && (
                <LabelList
                  dataKey={series.key}
                  content={(p: LabelProps) => (
                    <ValueLabel
                      {...p}
                      position="top"
                      fontSize={geom.valueLabel}
                      format={(v) => (isPercent ? (v * 100).toFixed(1) : String(v))}
                    />
                  )}
                />
              )}
            </Bar>
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}
