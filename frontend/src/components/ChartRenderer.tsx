import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartSpec, Row } from "../types";
import { formatPeriod, formatValue } from "../format";

const SERIES_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
];

const AXIS = { stroke: "#8b98a5", fontSize: 11 };
const GRID = "#eceff3";

interface Props {
  spec: ChartSpec;
  rows: Row[];
  height?: number;
}

/**
 * Renders whatever the backend decided to draw. The chart type is not chosen
 * here - it arrives on the ChartSpec - so the same question always produces
 * the same visual.
 */
export function ChartRenderer({ spec, rows, height = 260 }: Props) {
  if (!rows.length) {
    return <p className="muted small">No rows matched this query.</p>;
  }

  const primary = spec.series[0];
  const tickFormatter = (value: string) => formatPeriod(String(value));
  const tooltip = (
    <Tooltip
      formatter={(value: number, name: string) => {
        const series = spec.series.find((s) => s.label === name || s.key === name);
        return [formatValue(value, series?.format ?? "number"), series?.label ?? name];
      }}
      labelFormatter={tickFormatter}
      contentStyle={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontSize: 12,
        boxShadow: "var(--shadow)",
      }}
    />
  );

  if (spec.type === "kpi") {
    return (
      <div className="kpi-grid">
        {spec.series.map((series) => (
          <div className="kpi" key={series.key}>
            <div className="kpi-label">{series.label}</div>
            <div className="kpi-value">
              {formatValue(Number(rows[0][series.key]), series.format)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (spec.type === "donut") {
    const data = rows.map((row) => ({
      name: String(row[spec.x_key ?? ""] ?? ""),
      value: Number(row[primary.key] ?? 0),
    }));
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%">
            {data.map((_, index) => (
              <Cell key={index} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />
            ))}
          </Pie>
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          {tooltip}
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (spec.type === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={spec.x_key ?? ""} tickFormatter={tickFormatter} {...AXIS} />
          <YAxis {...AXIS} />
          {tooltip}
          {spec.series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />}
          {spec.series.map((series, index) => (
            <Line
              key={series.key}
              type="monotone"
              dataKey={series.key}
              name={series.label}
              stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 2.5 }}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  const horizontal = spec.type === "horizontal_bar";
  const barHeight = horizontal ? Math.max(height, rows.length * 26 + 40) : height;

  return (
    <ResponsiveContainer width="100%" height={barHeight}>
      <BarChart
        data={rows}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 4, right: 12, bottom: 0, left: horizontal ? 40 : -12 }}
      >
        <CartesianGrid stroke={GRID} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...AXIS} />
            <YAxis type="category" dataKey={spec.x_key ?? ""} width={110} {...AXIS} />
          </>
        ) : (
          <>
            <XAxis dataKey={spec.x_key ?? ""} tickFormatter={tickFormatter} {...AXIS} />
            <YAxis {...AXIS} />
          </>
        )}
        {tooltip}
        {spec.series.length > 1 && <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />}
        {spec.series.map((series, index) => (
          <Bar
            key={series.key}
            dataKey={series.key}
            name={series.label}
            fill={SERIES_COLORS[index % SERIES_COLORS.length]}
            radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}
            maxBarSize={horizontal ? 18 : 46}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
