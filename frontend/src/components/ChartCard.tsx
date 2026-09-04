import { GEOM } from "../charts/config";
import { chartTypeLabel, planSummary } from "../derive";
import type { ChartPayload } from "../types";
import type { Variant } from "../useVariant";
import { BlueprintMarks } from "./Blueprint";
import { ChartRenderer } from "./ChartRenderer";
import { PlanSheet } from "./PlanSheet";

interface Props {
  payload: ChartPayload | null;
  variant: Variant;
  open: boolean;
  onToggle: () => void;
}

/** payload === null renders the loading/degraded placeholder: a hatched
 * title bar and an empty (axes-only) chart, never an invented title. */
export function ChartCard({ payload, variant, open, onToggle }: Props) {
  return (
    <div className="la-bp la-card" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <BlueprintMarks />

      <div style={{ padding: "13px 14px 10px" }}>
        {payload ? (
          <>
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
              {chartTypeLabel(payload.chart)}
            </div>
            <h3 style={{ fontSize: "var(--t-h3)", marginTop: 4 }}>{payload.title}</h3>
            <p
              style={{
                marginTop: 5,
                fontSize: "var(--t-sm)",
                lineHeight: 1.45,
                color: "var(--muted)",
                maxWidth: "56ch",
                textWrap: "pretty",
              }}
            >
              {payload.chart.reason}
            </p>
          </>
        ) : (
          <span className="la-hatch" style={{ display: "block", height: 15, width: 180, opacity: 0.75 }} />
        )}
      </div>

      <div style={{ padding: "0 14px 10px", overflow: "hidden" }}>
        {payload ? (
          <ChartRenderer spec={payload.chart} rows={payload.rows} variant={variant} />
        ) : (
          <div style={{ height: GEOM[variant].line, border: "1px solid var(--line)" }} />
        )}
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        disabled={!payload}
        className="la-strip"
        style={{ marginTop: "auto" }}
      >
        <span className="la-strip-sign">{open ? "−" : "+"}</span>
        <span
          style={{
            fontFamily: "var(--font-m)",
            fontSize: "var(--t-mono)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--accent-text)",
          }}
        >
          Plan
        </span>
        <span
          style={{
            fontFamily: "var(--font-m)",
            fontSize: "var(--t-mono)",
            color: "var(--faint)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {payload ? planSummary(payload.plan) : ""}
        </span>
        <span className="la-cta">{open ? "Hide" : "Audit"}</span>
      </button>

      {open && payload && (
        <div style={{ padding: "12px 14px 14px", borderTop: "1px solid var(--line)" }}>
          <PlanSheet plan={payload.plan} rows={payload.rows} openSubs="sql" />
        </div>
      )}
    </div>
  );
}
