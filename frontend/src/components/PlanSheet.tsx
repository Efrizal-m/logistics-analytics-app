import { useState } from "react";
import { numericKeys } from "../derive";
import { titleCase } from "../format";
import type { QueryPlan, Row } from "../types";
import { Caveat } from "./Caveat";

interface Props {
  plan: QueryPlan;
  rows?: Row[] | null;
  toolInput?: Record<string, unknown> | null;
  /** Space-separated initial-open set: "sql", "rows", "defs" in any
   * combination. Read once at mount, same as the artboard - a caller that
   * wants a different starting state re-mounts the sheet (a fresh `key`),
   * rather than this component reacting to prop changes after the fact. */
  openSubs?: string;
}

function Strip({
  label,
  cta,
  open,
  onToggle,
  children,
}: {
  label: string;
  cta: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <button type="button" onClick={onToggle} aria-expanded={open} className="la-strip" style={{ padding: "0 4px" }}>
        <span className="la-strip-sign">{open ? "−" : "+"}</span>
        <span
          style={{
            fontFamily: "var(--font-m)",
            fontSize: "var(--t-cap)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        <span className="la-cta">{cta}</span>
      </button>
      {open && <div style={{ padding: "2px 4px 12px" }}>{children}</div>}
    </>
  );
}

/**
 * The audit sheet. Every row is read off the plan the backend actually
 * executed, so it cannot describe a query other than the one that produced
 * the number.
 */
export function PlanSheet({ plan, rows, toolInput, openSubs = "" }: Props) {
  const [defsOpen, setDefsOpen] = useState(() => openSubs.includes("defs"));
  const [sqlOpen, setSqlOpen] = useState(() => openSubs.includes("sql"));
  const [rowsOpen, setRowsOpen] = useState(() => openSubs.includes("rows"));

  const MAX_ROWS = 200;
  const hasRows = !!rows && rows.length > 0;
  const numeric = numericKeys(plan);
  const columns = hasRows ? Object.keys(rows![0]) : [];
  const visibleRows = hasRows ? rows!.slice(0, MAX_ROWS) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          paddingBottom: 9,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-m)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--accent-text)",
          }}
        >
          How this was calculated
        </span>
        <span className="la-meta">Plan as executed</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--line-2)" }}>
        <div className="la-sheet-row" style={{ borderTop: 0 }}>
          <div className="la-sheet-key">Metrics</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {plan.metrics.map((m) => (
              <span key={m.key} className="la-pill la-pill--accent">
                {m.label}
              </span>
            ))}
          </div>
        </div>

        <div className="la-sheet-row">
          <div className="la-sheet-key">Grouped by</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", minHeight: 20 }}>
            {plan.group_by.length ? (
              plan.group_by.map((g) => (
                <span key={g.key} className="la-pill">
                  {g.label}
                </span>
              ))
            ) : (
              <span style={{ fontSize: "var(--t-note)", color: "var(--muted)" }}>
                Not grouped — one row for the whole selection
              </span>
            )}
          </div>
        </div>

        <div className="la-sheet-row">
          <div className="la-sheet-key">Filters</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", minHeight: 20 }}>
            {plan.filters.length ? (
              plan.filters.map((f) => (
                <span key={f.field + f.values.join()} className="la-pill">
                  {f.description}
                </span>
              ))
            ) : (
              <span style={{ fontSize: "var(--t-note)", color: "var(--muted)" }}>None — all orders</span>
            )}
          </div>
        </div>

        <div className="la-sheet-row">
          <div className="la-sheet-key">Time range</div>
          <div>
            <div className="la-num" style={{ fontSize: "var(--t-sm)", color: "var(--text)" }}>
              {plan.time_range?.description ?? "Entire dataset"}
            </div>
            <div style={{ fontFamily: "var(--font-m)", fontSize: 10, color: "var(--faint)", marginTop: 2 }}>
              Anchor: {plan.time_range?.basis ?? "dataset bounds"}
            </div>
          </div>
        </div>

        <div className="la-sheet-row" style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="la-sheet-key">Result</div>
          <div className="la-num" style={{ fontSize: "var(--t-sm)", color: "var(--muted)" }}>
            {plan.row_count} row{plan.row_count === 1 ? "" : "s"}
            {plan.sort && <> · sorted by {plan.sort}</>} · limit {plan.limit}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Caveat notes={plan.notes} />
      </div>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column" }}>
        <Strip
          label="Metric definitions"
          cta={`${plan.metrics.length} metric${plan.metrics.length === 1 ? "" : "s"}`}
          open={defsOpen}
          onToggle={() => setDefsOpen((v) => !v)}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            {plan.metrics.map((m) => (
              <div
                key={m.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "132px 1fr",
                  gap: 14,
                  padding: "7px 0",
                  borderTop: "1px solid var(--line)",
                  alignItems: "start",
                }}
              >
                <div style={{ fontFamily: "var(--font-m)", fontSize: "var(--t-cap)", color: "var(--text)" }}>
                  {m.label}
                </div>
                <div style={{ fontSize: "var(--t-sm)", lineHeight: 1.5, color: "var(--muted)" }}>
                  {m.definition}
                </div>
              </div>
            ))}
          </div>
        </Strip>

        <Strip
          label="Generated SQL"
          cta={`${plan.sql.split("\n").length} lines`}
          open={sqlOpen}
          onToggle={() => setSqlOpen((v) => !v)}
        >
          <p style={{ fontSize: "var(--t-code)", lineHeight: 1.5, color: "var(--muted)", maxWidth: "64ch" }}>
            Built by the query builder from validated parameters — the model never writes SQL.
          </p>
          <pre className="la-pre">{plan.sql}</pre>
          {toolInput && (
            <div style={{ marginTop: 12 }}>
              <div className="la-meta" style={{ textAlign: "left" }}>
                Parameters the model supplied, after validation
              </div>
              <pre className="la-pre">{JSON.stringify(toolInput, null, 2)}</pre>
            </div>
          )}
        </Strip>

        {hasRows && (
          <>
            <button
              type="button"
              onClick={() => setRowsOpen((v) => !v)}
              aria-expanded={rowsOpen}
              className="la-strip"
              style={{ padding: "0 4px", borderBottom: "1px solid var(--line)" }}
            >
              <span className="la-strip-sign">{rowsOpen ? "−" : "+"}</span>
              <span
                style={{
                  fontFamily: "var(--font-m)",
                  fontSize: "var(--t-cap)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Underlying data ({rows!.length} row{rows!.length === 1 ? "" : "s"})
              </span>
              <span className="la-cta">Check by hand</span>
            </button>
            {rowsOpen && (
              <div style={{ overflowX: "auto", paddingBottom: 2 }}>
                <table className="la-table">
                  <thead>
                    <tr>
                      {columns.map((c) => (
                        <th key={c} className={numeric.has(c) ? "n" : undefined}>
                          {titleCase(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, i) => (
                      <tr key={i} className="la-rowh">
                        {columns.map((c) => (
                          <td key={c} className={numeric.has(c) ? "n" : undefined}>
                            {row[c] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows!.length > visibleRows.length && (
                  <p style={{ marginTop: 8, fontSize: "var(--t-sm)", color: "var(--muted)" }}>
                    Showing {visibleRows.length} of {rows!.length} rows.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
