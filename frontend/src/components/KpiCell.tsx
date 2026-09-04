import type { KpiTrend } from "../derive";
import { formatParts } from "../format";
import type { MetricFormat } from "../types";
import type { Variant } from "../useVariant";
import { Sparkline } from "./Sparkline";

interface Props {
  label: string;
  ready: boolean;
  value: number | null;
  format: MetricFormat;
  sampleSize: number | null;
  trend: KpiTrend | null;
  open: boolean;
  onToggle: () => void;
  variant: Variant;
}

export function KpiCell({ label, ready, value, format, sampleSize, trend, open, onToggle, variant }: Props) {
  const parts = ready ? formatParts(value, format) : { main: "—", unit: "" };
  const sparkWidth = variant === "mobile" ? 96 : 78;
  const isRate = format === "percent" || format === "days";
  const warn = ready && trend?.health === "warn";

  return (
    <div className="la-kpicell">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, minHeight: 20 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", lineHeight: 1.3 }}>{label}</span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`How ${label} is calculated`}
          className="la-ibtn"
          style={{
            width: 32,
            height: 32,
            flex: "none",
            margin: "-7px -7px -7px auto",
            border: "1px solid transparent",
            padding: 0,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 18,
              border: `1px solid ${open ? "var(--accent)" : "var(--line-2)"}`,
              background: open ? "var(--accent)" : "transparent",
              color: open ? "var(--on-accent)" : "var(--faint)",
              fontFamily: "var(--font-m)",
              fontSize: 10,
              lineHeight: 1,
            }}
          >
            i
          </span>
        </button>
      </div>

      <div style={{ marginTop: 5, display: "flex", alignItems: "baseline", gap: 5, minHeight: 44 }}>
        <span
          className="la-num"
          style={{
            fontWeight: 500,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            fontSize: variant === "mobile" ? "var(--t-fig-mobile)" : "var(--t-fig)",
            color: ready ? "var(--text)" : "var(--line-2)",
          }}
        >
          {parts.main}
        </span>
        {parts.unit && (
          <span style={{ fontFamily: "var(--font-m)", fontSize: 14, fontWeight: 500, color: "var(--muted)" }}>
            {parts.unit}
          </span>
        )}
      </div>

      <div
        className="la-num"
        style={{ minHeight: 15, fontSize: 10, color: "var(--faint)" }}
      >
        {ready && sampleSize !== null ? `over ${sampleSize.toLocaleString()} concluded orders` : ""}
      </div>

      <div
        style={{
          marginTop: 9,
          paddingTop: 9,
          borderTop: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 9,
          minHeight: 32,
        }}
      >
        {ready && trend ? (
          <Sparkline
            values={trend.values}
            width={sparkWidth}
            color="var(--accent)"
            baseline={isRate ? trend.periodValue : null}
            baselineWarn={warn}
          />
        ) : (
          <span
            className="la-hatch"
            style={{ display: "block", width: sparkWidth, height: 22, flex: "none", opacity: 0.7 }}
          />
        )}
        <span
          className="la-num"
          style={{ fontSize: 10, letterSpacing: "0.02em", color: "var(--muted)", whiteSpace: "nowrap" }}
        >
          {ready && trend ? trend.delta : ""}
        </span>
      </div>

      <div style={{ minHeight: 15, display: "flex", alignItems: "center", gap: 5 }}>
        {warn && trend && (
          <>
            <span style={{ width: 5, height: 5, background: "var(--warn)", display: "block", flex: "none" }} />
            <span className="la-num" style={{ fontSize: "var(--t-micro)", letterSpacing: "0.04em", color: "var(--warn-text)" }}>
              {trend.healthNote}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
