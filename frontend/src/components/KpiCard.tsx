import { useState } from "react";
import type { Kpi } from "../types";
import { formatValue } from "../format";

/**
 * The definition tooltip is not decoration. Two of these numbers depend on a
 * judgement call - what counts as "on time", and which orders are excluded
 * from average delivery time - so the definition travels with the value.
 */
export function KpiCard({ kpi }: { kpi: Kpi }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card kpi">
      <div className="kpi-label">
        {kpi.label}
        <button
          className="info"
          onClick={() => setOpen((value) => !value)}
          aria-label={`How ${kpi.label} is calculated`}
          aria-expanded={open}
        >
          i
        </button>
      </div>
      <div className="kpi-value">{formatValue(kpi.value, kpi.format)}</div>
      {kpi.sample_size !== null && (
        <div className="kpi-sample">over {kpi.sample_size.toLocaleString()} concluded orders</div>
      )}
      {open && <div className="tooltip">{kpi.definition}</div>}
    </div>
  );
}
