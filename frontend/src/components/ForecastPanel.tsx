import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ForecastResult } from "../types";
import { formatPeriod } from "../format";

/**
 * History solid, forecast dashed, drawn on one continuous axis. The two series
 * are joined at the last observed point so the line does not appear to break.
 */
export function ForecastPanel({ forecast }: { forecast: ForecastResult }) {
  const lastHistory = forecast.history[forecast.history.length - 1];

  const data = [
    ...forecast.history.map((point) => ({
      period: point.period,
      history: point.value,
      forecast: point.period === lastHistory?.period ? point.value : null,
    })),
    ...forecast.forecast.map((point) => ({
      period: point.period,
      history: null,
      forecast: point.value,
    })),
  ];

  const recommendation = forecast.inventory_recommendation;
  const subject = forecast.grain_value ?? "all orders";

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <h3>
          {forecast.metric === "total_quantity" ? "Units" : "Orders"} — {subject}
        </h3>
        <div className="chart-why">{forecast.method_reason}</div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#eceff3" vertical={false} />
          <XAxis
            dataKey="period"
            tickFormatter={(value: string) => formatPeriod(value)}
            stroke="#8b98a5"
            fontSize={11}
          />
          <YAxis stroke="#8b98a5" fontSize={11} />
          <Tooltip
            labelFormatter={(value: string) => formatPeriod(value)}
            contentStyle={{ border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="history"
            name="Actual"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={{ r: 2.5 }}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="forecast"
            name={`Forecast (${forecast.method.replace(/_/g, " ")})`}
            stroke="var(--series-3)"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={{ r: 2.5 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="forecast-stats">
        <Stat label="Expected demand" value={String(recommendation.expected_demand)} />
        <Stat label="Safety stock" value={String(recommendation.safety_stock)} />
        <Stat label="Recommended units" value={String(recommendation.recommended_units)} />
        <Stat label="Horizon" value={`${recommendation.horizon_months} months`} />
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        {recommendation.basis}
      </p>

      {forecast.notes.length > 0 && (
        <div className="notes">
          <ul>
            {forecast.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      <details>
        <summary>Method and limitations</summary>
        <ul className="muted small" style={{ paddingLeft: 16 }}>
          <li>
            Holdout MAE —{" "}
            {Object.entries(forecast.holdout_mae)
              .map(([name, value]) => `${name.replace(/_/g, " ")}: ${value?.toFixed(2) ?? "n/a"}`)
              .join(", ")}
          </li>
          {forecast.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
