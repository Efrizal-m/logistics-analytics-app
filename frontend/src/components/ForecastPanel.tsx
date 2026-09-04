import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GEOM } from "../charts/config";
import { CARDINAL } from "../charts/curve";
import { niceScale } from "../charts/scale";
import { maeRows, forecastStats } from "../derive";
import { formatPeriodShort } from "../format";
import type { ForecastResult } from "../types";
import type { Variant } from "../useVariant";
import { BlueprintMarks } from "./Blueprint";
import { Caveat } from "./Caveat";

interface Props {
  forecast: ForecastResult;
  variant: Variant;
}

const METHOD_LABEL: Record<string, string> = {
  moving_average: "moving average",
  linear_regression: "linear regression",
};

/**
 * History solid, forecast dashed, drawn on one continuous axis. The two
 * series are joined at the last observed point so the line does not appear
 * to break.
 */
export function ForecastPanel({ forecast, variant }: Props) {
  const [methodOpen, setMethodOpen] = useState(true);
  const geom = GEOM[variant];

  const historyLen = forecast.history.length;
  const periods = [...forecast.history.map((p) => p.period), ...forecast.forecast.map((p) => p.period)];
  const data = periods.map((period, i) => {
    if (i < historyLen) {
      const isLast = i === historyLen - 1;
      return {
        period,
        history: forecast.history[i].value,
        forecast: isLast ? forecast.history[i].value : null,
      };
    }
    return { period, history: null, forecast: forecast.forecast[i - historyLen].value };
  });

  const maxValue = Math.max(0, ...forecast.history.map((p) => p.value), ...forecast.forecast.map((p) => p.value));
  const scale = niceScale(maxValue);
  const baseYear = periods.length ? Number(periods[0].slice(0, 4)) : undefined;
  const subject = forecast.grain_value ?? "all orders";
  const quantityLabel = forecast.metric === "total_quantity" ? "Units" : "Orders";
  const mae = maeRows(forecast);

  return (
    <div className="la-bp la-card" style={{ display: "flex", flexDirection: "column" }}>
      <BlueprintMarks />

      <div style={{ padding: "13px 14px 10px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div
            style={{
              fontFamily: "var(--font-m)",
              fontSize: "var(--t-micro)",
              fontWeight: 600,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              color: "var(--accent-text)",
            }}
          >
            Forecast · {METHOD_LABEL[forecast.method] ?? forecast.method.replace(/_/g, " ")}
          </div>
          <div className="la-meta">
            {historyLen} actuals → {forecast.forecast.length} projected
          </div>
        </div>
        <h3 style={{ fontSize: "var(--t-h3)", marginTop: 4 }}>
          {quantityLabel} — {subject}
        </h3>
        <p style={{ marginTop: 5, fontSize: "var(--t-sm)", lineHeight: 1.45, color: "var(--muted)", maxWidth: "70ch", textWrap: "pretty" }}>
          {forecast.method_reason}
        </p>
      </div>

      <div style={{ padding: "0 14px 4px", overflow: "hidden" }}>
        <ResponsiveContainer width="100%" height={geom.forecast}>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis
              dataKey="period"
              interval={1}
              tickFormatter={(v: string) => formatPeriodShort(v, baseYear)}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--axis)", fontFamily: "var(--font-m)", fontSize: geom.axisFont }}
            />
            <YAxis
              width={geom.yWidth + 8}
              domain={[0, scale.max]}
              ticks={scale.ticks}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--axis)", fontFamily: "var(--font-m)", fontSize: geom.axisFont }}
            />
            <Tooltip
              labelFormatter={(v: string) => formatPeriodShort(v, baseYear)}
              contentStyle={{ border: "1px solid var(--line)", borderRadius: 0, background: "var(--raise)", fontSize: 12 }}
            />
            <Line
              type={CARDINAL}
              dataKey="history"
              name="Actual"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 2.5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type={CARDINAL}
              dataKey="forecast"
              name="Forecast"
              stroke="var(--chart-2)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 2.5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          padding: "0 14px 12px",
          fontFamily: "var(--font-m)",
          fontSize: 10,
          letterSpacing: "0.04em",
          color: "var(--muted)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 16, height: 2, background: "var(--chart-1)", display: "block" }} />
          Actual
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 16, height: 0, borderTop: "2px dashed var(--chart-2)", display: "block" }} />
          Forecast
        </span>
      </div>

      <div style={{ padding: "0 14px 12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 8 }}>
        {forecastStats(forecast).map((stat) => (
          <div key={stat.label} className="la-stat">
            <div className="la-stat-label">{stat.label}</div>
            <div className="la-stat-value">
              <span className="la-stat-num">{stat.value}</span>
              <span className="la-stat-unit">{stat.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: "0 14px 12px" }}>
        <p style={{ fontSize: "var(--t-sm)", lineHeight: 1.5, color: "var(--muted)", maxWidth: "82ch", textWrap: "pretty" }}>
          {forecast.inventory_recommendation.basis as string}
        </p>
      </div>

      <div style={{ padding: "0 14px 12px" }}>
        <Caveat notes={forecast.notes} />
      </div>

      <button
        type="button"
        onClick={() => setMethodOpen((v) => !v)}
        aria-expanded={methodOpen}
        className="la-strip"
      >
        <span className="la-strip-sign">{methodOpen ? "−" : "+"}</span>
        <span style={{ fontFamily: "var(--font-m)", fontSize: "var(--t-mono)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Method and limitations
        </span>
        <span className="la-cta">
          {mae.length} method{mae.length === 1 ? "" : "s"} tested
        </span>
      </button>

      {methodOpen && (
        <div style={{ padding: "12px 14px 14px", borderTop: "1px solid var(--line)" }}>
          <div
            style={{
              fontFamily: "var(--font-m)",
              fontSize: "var(--t-micro)",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--faint)",
            }}
          >
            Holdout mean absolute error — last three months
          </div>
          <table style={{ width: "100%", maxWidth: 420, marginTop: 7, fontSize: "var(--t-sm)" }}>
            <tbody>
              {mae.map((row) => (
                <tr key={row.name} className="la-rowh">
                  <td style={{ padding: "5px 0", borderBottom: "1px solid var(--line)", width: 18 }}>
                    {row.chosen ? "▪" : ""}
                  </td>
                  <td
                    style={{
                      padding: "5px 0",
                      borderBottom: "1px solid var(--line)",
                      fontFamily: "var(--font-m)",
                      fontSize: "var(--t-code)",
                      color: row.chosen ? "var(--text)" : "var(--muted)",
                    }}
                  >
                    {row.name}
                  </td>
                  <td
                    className="la-num"
                    style={{
                      padding: "5px 0",
                      borderBottom: "1px solid var(--line)",
                      textAlign: "right",
                      fontSize: "var(--t-code)",
                      color: row.chosen ? "var(--text)" : "var(--muted)",
                    }}
                  >
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul style={{ margin: "11px 0 0", paddingLeft: 15, display: "flex", flexDirection: "column", gap: 3 }}>
            {forecast.limitations.map((limitation) => (
              <li key={limitation} style={{ fontSize: "var(--t-sm)", lineHeight: 1.5, color: "var(--muted)" }}>
                {limitation}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
