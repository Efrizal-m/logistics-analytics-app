import { useState } from "react";
import type { KpiTrend } from "../derive";
import type { Kpi } from "../types";
import type { Variant } from "../useVariant";
import { KpiCell } from "./KpiCell";

interface Props {
  kpis: Kpi[] | null;
  trends: Map<string, KpiTrend> | null;
  variant: Variant;
}

// Used only while kpis is null (loading/error), so the band shows the right
// identities with no data yet. Once real data lands, the API's own labels are
// the source of truth - see displayLabel below for the one presentational
// exception.
const KPI_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: "total_orders", label: "Total orders" },
  { key: "delivered_orders", label: "Delivered orders" },
  { key: "delayed_orders", label: "Delayed orders" },
  { key: "on_time_rate", label: "On-time delivery rate" },
  { key: "avg_delivery_days", label: "Average delivery time (days)" },
];

// The KPI band already shows the unit in its own chip ("3.8" + "days"), so
// repeating it in the label reads redundant here specifically.
function displayLabel(key: string, label: string): string {
  return key === "avg_delivery_days" ? label.replace(/\s*\(days\)\s*$/, "") : label;
}

export function KpiBand({ kpis, trends, variant }: Props) {
  const [openDef, setOpenDef] = useState<string | null>(null);

  const items = kpis ?? KPI_PLACEHOLDERS;
  const openKpi = kpis?.find((k) => k.key === openDef) ?? null;
  const openTrend = openDef ? trends?.get(openDef) ?? null : null;

  return (
    <>
      <div
        className="la-kpiband"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))",
          borderBottom: "1px solid var(--line-2)",
        }}
      >
        {items.map((item, i) => {
          const kpi = kpis ? kpis[i] : null;
          return (
            <KpiCell
              key={item.key}
              label={displayLabel(item.key, item.label)}
              ready={!!kpi}
              value={kpi?.value ?? null}
              format={kpi?.format ?? "count"}
              sampleSize={kpi?.sample_size ?? null}
              trend={trends?.get(item.key) ?? null}
              open={openDef === item.key}
              onToggle={() => setOpenDef((current) => (current === item.key ? null : item.key))}
              variant={variant}
            />
          );
        })}
      </div>

      {openKpi && (
        <div className="la-defband">
          <div
            style={{
              fontFamily: "var(--font-m)",
              fontSize: "var(--t-micro)",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--accent-text)",
              width: 150,
              flex: "none",
              paddingTop: 2,
            }}
          >
            {displayLabel(openKpi.key, openKpi.label)}
          </div>
          <p style={{ flex: 1, fontSize: "var(--t-note)", lineHeight: 1.55, color: "var(--text)", maxWidth: "92ch", textWrap: "pretty" }}>
            {openKpi.definition} {openTrend?.healthNote ?? ""}
          </p>
          <button
            type="button"
            onClick={() => setOpenDef(null)}
            aria-label="Close definition"
            className="la-ibtn"
            style={{
              width: 32,
              height: 32,
              flex: "none",
              margin: "-6px -6px 0 0",
              border: "1px solid transparent",
              color: "var(--accent-text)",
              fontFamily: "var(--font-m)",
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
