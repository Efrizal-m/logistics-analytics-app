import type { QueryPlan, Row } from "../types";
import { DataTable } from "./DataTable";

interface Props {
  plan: QueryPlan;
  rows?: Row[] | null;
  toolInput?: Record<string, unknown> | null;
}

/**
 * The explainability panel.
 *
 * Everything shown here is read off the plan the backend actually executed -
 * the same object the query builder consumed - so it cannot describe a
 * different query from the one that produced the numbers. The SQL is emitted
 * by our builder, never by the model.
 */
export function QueryPlanPanel({ plan, rows, toolInput }: Props) {
  return (
    <div className="card plan">
      <div className="section-title">How this was calculated</div>

      <div className="plan-grid">
        <div className="plan-key">Metrics</div>
        <div>
          {plan.metrics.map((metric) => (
            <span className="pill" key={metric.key} title={metric.definition}>
              {metric.label}
            </span>
          ))}
        </div>

        <div className="plan-key">Grouped by</div>
        <div>
          {plan.group_by.length ? (
            plan.group_by.map((dimension) => (
              <span className="pill plain" key={dimension.key}>
                {dimension.label}
              </span>
            ))
          ) : (
            <span className="muted">Not grouped — one row for the whole selection</span>
          )}
        </div>

        <div className="plan-key">Filters</div>
        <div>
          {plan.filters.length ? (
            plan.filters.map((filter) => (
              <span className="pill plain" key={filter.field + filter.values.join()}>
                {filter.description}
              </span>
            ))
          ) : (
            <span className="muted">None — all orders</span>
          )}
        </div>

        <div className="plan-key">Time range</div>
        <div>
          {plan.time_range ? (
            <>
              {plan.time_range.description}
              <div className="muted small">Anchor: {plan.time_range.basis}</div>
            </>
          ) : (
            <span className="muted">Entire dataset</span>
          )}
        </div>

        <div className="plan-key">Result</div>
        <div className="muted">
          {plan.row_count} row{plan.row_count === 1 ? "" : "s"}
          {plan.sort && <> · sorted by {plan.sort}</>} · limit {plan.limit}
        </div>
      </div>

      {plan.notes.length > 0 && (
        <div className="notes">
          <ul>
            {plan.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.metrics.length > 0 && (
        <details>
          <summary>Metric definitions</summary>
          <div className="plan-grid" style={{ marginTop: 10 }}>
            {plan.metrics.map((metric) => (
              <FragmentRow key={metric.key} label={metric.label} value={metric.definition} />
            ))}
          </div>
        </details>
      )}

      <details>
        <summary>Generated SQL</summary>
        <p className="muted small" style={{ margin: "8px 0 0" }}>
          Built by the query builder from the validated parameters below — the model never
          writes SQL.
        </p>
        <pre className="sql">{plan.sql}</pre>
        {toolInput && (
          <>
            <p className="muted small" style={{ margin: "12px 0 0" }}>
              Parameters the model supplied, after validation:
            </p>
            <pre className="sql">{JSON.stringify(toolInput, null, 2)}</pre>
          </>
        )}
      </details>

      {rows && rows.length > 0 && (
        <details>
          <summary>Underlying data ({rows.length} rows)</summary>
          <DataTable rows={rows} />
        </details>
      )}
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="plan-key">{label}</div>
      <div className="muted small">{value}</div>
    </>
  );
}
