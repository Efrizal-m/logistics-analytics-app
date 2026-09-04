import { api } from "../api/client";
import { ChartRenderer } from "../components/ChartRenderer";
import { KpiCard } from "../components/KpiCard";
import { QueryPlanPanel } from "../components/QueryPlanPanel";
import type { ChartPayload } from "../types";
import { useAsync } from "../useAsync";

const CHARTS = [
  "orders_over_time",
  "delivery_performance",
  "carrier_breakdown",
  "destination_breakdown",
];

export function Dashboard() {
  const kpis = useAsync(() => api.kpis(), []);
  const charts = useAsync(() => Promise.all(CHARTS.map((name) => api.chart(name))), []);

  return (
    <>
      <section>
        <div className="section-title">Key figures</div>
        {kpis.error && <div className="banner error">{kpis.error}</div>}
        <div className="kpi-grid">
          {kpis.loading
            ? CHARTS.map((name) => <div className="skeleton" key={name} />)
            : kpis.data?.kpis.map((kpi) => <KpiCard kpi={kpi} key={kpi.key} />)}
        </div>
      </section>

      <section>
        <div className="section-title">Charts</div>
        {charts.error && <div className="banner error">{charts.error}</div>}
        <div className="chart-grid">
          {charts.loading
            ? CHARTS.map((name) => <div className="skeleton" style={{ height: 320 }} key={name} />)
            : charts.data?.map((payload) => <ChartCard payload={payload} key={payload.name} />)}
        </div>
      </section>

      {kpis.data && (
        <section>
          <div className="section-title">Definitions behind these figures</div>
          <QueryPlanPanel plan={kpis.data.plan} />
        </section>
      )}
    </>
  );
}

function ChartCard({ payload }: { payload: ChartPayload }) {
  return (
    <div className="card chart-card">
      <div className="chart-head">
        <h3>{payload.title}</h3>
        <div className="chart-why">{payload.chart.reason}</div>
      </div>
      <ChartRenderer spec={payload.chart} rows={payload.rows} />
      <details>
        <summary>Query plan and data</summary>
        <div style={{ marginTop: 10 }}>
          <QueryPlanPanel plan={payload.plan} rows={payload.rows} />
        </div>
      </details>
    </div>
  );
}
