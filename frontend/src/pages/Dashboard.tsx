import { useState } from "react";
import { api, BASE_URL } from "../api/client";
import { BlueprintMarks } from "../components/Blueprint";
import { ChartCard } from "../components/ChartCard";
import { ErrorPanel } from "../components/ErrorPanel";
import { KpiBand } from "../components/KpiBand";
import { PlanSheet } from "../components/PlanSheet";
import { buildKpiTrends, chartsNote, defsNote, figuresNote } from "../derive";
import type { SchemaResponse } from "../types";
import { useAsync } from "../useAsync";
import { useVariant } from "../useVariant";

const CHART_NAMES = ["orders_over_time", "delivery_performance", "carrier_breakdown", "destination_breakdown"];

export function Dashboard({ schema }: { schema: SchemaResponse | null }) {
  const variant = useVariant();
  const kpis = useAsync(() => api.kpis(), []);
  const charts = useAsync(
    () => Promise.all([...CHART_NAMES.map((name) => api.chart(name)), api.chart("kpi_trends")]),
    [],
  );
  const [openStrip, setOpenStrip] = useState<string | null>(null);

  const chartPayloads = charts.data ? charts.data.slice(0, CHART_NAMES.length) : null;
  const trendsPayload = charts.data ? charts.data[CHART_NAMES.length] : null;
  const trends =
    kpis.data && trendsPayload
      ? buildKpiTrends(trendsPayload.rows, trendsPayload.chart.x_key ?? "month", kpis.data.kpis)
      : null;

  // A 401 means the session just expired - api/client.ts's global handler is
  // already clearing it and this whole page is about to unmount in favor of
  // the login screen. Rendering the "backend might be down" ErrorPanel for
  // the one frame before that commit would be actively misleading.
  const kpisFailed = !!kpis.error && kpis.status !== 401;
  const chartsFailed = !!charts.error && charts.status !== 401;
  const anyFailed = kpisFailed || chartsFailed;
  const bothFailed = kpisFailed && chartsFailed;

  return (
    <>
      {anyFailed && (
        <section className="la-sec">
          <ErrorPanel
            endpoints={["GET /api/kpis", "GET /api/charts ×5"]}
            failedAt={kpis.failedAt ?? charts.failedAt}
            kind={kpis.kind ?? charts.kind}
            message={kpis.error ?? charts.error ?? ""}
            baseUrl={BASE_URL}
            onRetry={() => {
              kpis.refetch();
              charts.refetch();
            }}
            partial={!bothFailed}
          />
        </section>
      )}

      <section className="la-sec">
        <div className="la-sec-head">
          <h2 className="la-kicker" style={{ fontSize: 10, letterSpacing: "0.16em" }}>
            Key figures
          </h2>
          <span className="la-meta">
            {kpis.data
              ? figuresNote(kpis.data.kpis.length, schema?.dataset_start ?? "", schema?.dataset_end ?? "")
              : kpis.loading
                ? "Loading…"
                : "Unavailable"}
          </span>
        </div>
        <KpiBand kpis={kpis.data?.kpis ?? null} trends={trends} variant={variant} />
      </section>

      <section className="la-sec">
        <div className="la-sec-head">
          <h2 className="la-kicker" style={{ fontSize: 10, letterSpacing: "0.16em" }}>
            Charts
          </h2>
          <span className="la-meta">
            {chartPayloads ? chartsNote(chartPayloads) : charts.loading ? "Loading…" : "Unavailable"}
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 528px), 1fr))",
          }}
        >
          {CHART_NAMES.map((name, i) => (
            <ChartCard
              key={name}
              payload={chartPayloads?.[i] ?? null}
              variant={variant}
              open={openStrip === name}
              onToggle={() => setOpenStrip((current) => (current === name ? null : name))}
            />
          ))}
        </div>
      </section>

      <section className="la-sec">
        <div className="la-sec-head">
          <h2 className="la-kicker" style={{ fontSize: 10, letterSpacing: "0.16em" }}>
            Definitions behind these figures
          </h2>
          <span className="la-meta">{kpis.data ? defsNote(kpis.data.kpis.length) : ""}</span>
        </div>
        {kpis.data ? (
          <div className="la-bp la-card" style={{ padding: "14px 16px 15px" }}>
            <BlueprintMarks />
            <PlanSheet plan={kpis.data.plan} />
          </div>
        ) : (
          <div
            style={{
              border: "1px dashed var(--line)",
              padding: 16,
              fontFamily: "var(--font-m)",
              fontSize: "var(--t-cap)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--faint)",
            }}
          >
            {kpis.loading ? "Definitions arrive with the figures" : "Definitions could not be loaded"}
          </div>
        )}
      </section>
    </>
  );
}
