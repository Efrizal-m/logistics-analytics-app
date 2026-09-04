import { useState } from "react";
import { api, ApiError } from "../api/client";
import { GEOM } from "../charts/config";
import { AnswerBlock } from "../components/AnswerBlock";
import { BlueprintMarks } from "../components/Blueprint";
import { ChartRenderer } from "../components/ChartRenderer";
import { ForecastPanel } from "../components/ForecastPanel";
import { PlanSheet } from "../components/PlanSheet";
import { askChartTitle, chartTypeLabel, planSummary } from "../derive";
import type { AskResponse, SchemaResponse } from "../types";
import { useVariant } from "../useVariant";

type View = "first" | "loading" | "answered" | "unsupported" | "forecast";

export function Ask({ schema }: { schema: SchemaResponse | null }) {
  const variant = useVariant();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResponse | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(value: string) {
    const trimmed = value.trim();
    if (trimmed.length < 3 || loading) return;

    setLoading(true);
    setNetworkError(null);
    setResult(null);
    try {
      setResult(await api.ask(trimmed));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        // A 422 means the model asked for something outside the supported
        // vocabulary - a real answer about the system's limits, so it gets
        // the same "outside this dataset" presentation as a 200 response
        // where the model declined to route at all, not a generic error.
        setResult({
          question: trimmed,
          answer: caught.message,
          tool: null,
          tool_input: null,
          plan: null,
          rows: null,
          chart: null,
          forecast: null,
          unsupported: true,
          supported_examples: schema?.example_questions ?? [],
        });
      } else if (caught instanceof ApiError && caught.status === 401) {
        // Session expiry: api/client.ts's global handler has already cleared
        // the token and is unmounting this whole page in favor of the login
        // screen. Rendering a red error box here for the instant before that
        // commit would be misleading - it isn't a real answer failure.
      } else {
        setNetworkError(caught instanceof ApiError ? caught.message : String(caught));
      }
    } finally {
      setLoading(false);
    }
  }

  const view: View = loading
    ? "loading"
    : result?.forecast
      ? "forecast"
      : result?.unsupported
        ? "unsupported"
        : result
          ? "answered"
          : "first";

  const examples = schema?.example_questions ?? [];
  const vocab = schema
    ? Array.from(
        new Set([
          ...schema.metrics.map((m) => m.label.toLowerCase()),
          ...schema.dimensions.map((d) => d.label.toLowerCase()),
        ]),
      )
    : [];

  const geom = GEOM[variant];
  const hasChart = view === "answered" && !!result?.chart && !!result.rows;
  const hasPlan = view === "answered" && !!result?.plan;
  const highlightFirst =
    hasChart && !!result?.plan?.sort && result.chart!.series.length === 1 &&
    result.plan.sort.startsWith(result.chart!.series[0].key);

  return (
    <>
      <section className="la-sec">
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about delays, carriers, regions, delivery times, or future demand…"
            aria-label="Ask a question about the logistics data"
            className="la-input"
            style={{ flex: 1, minWidth: 0 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit(question);
            }}
          />
          <button
            type="button"
            disabled={loading || question.trim().length < 3}
            onClick={() => void submit(question)}
            className="la-btn la-btn--primary"
            style={{ minHeight: "var(--ctl-lg)", padding: "0 22px", fontSize: 14.5, flex: "none" }}
          >
            {loading ? "Working…" : "Ask"}
          </button>
        </div>

        {schema && !schema.ai_enabled && (
          <div
            style={{
              marginTop: 9,
              border: "1px solid var(--warn-line)",
              background: "var(--warn-tint)",
              padding: "9px 11px",
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <span style={{ width: 5, height: 5, background: "var(--warn)", display: "block", flex: "none", marginTop: 6 }} />
            <p style={{ fontSize: "var(--t-note)", lineHeight: 1.5, color: "var(--warn-text)", maxWidth: "88ch" }}>
              No <code style={{ fontFamily: "var(--font-m)", fontSize: "var(--t-code)" }}>ANTHROPIC_API_KEY</code> is
              configured on the server, so questions cannot be answered. The dashboard tab works without one.
            </p>
          </div>
        )}

        <div style={{ marginTop: 11 }}>
          <div
            style={{
              fontFamily: "var(--font-m)",
              fontSize: "var(--t-micro)",
              fontWeight: 600,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              color: "var(--faint)",
              marginBottom: 7,
            }}
          >
            {view === "first" ? "Six questions to start from" : "Try another"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                className="la-chip"
                onClick={() => {
                  setQuestion(example);
                  void submit(example);
                }}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </section>

      {view === "first" && (
        <section className="la-sec" style={{ borderTop: "1px solid var(--line-2)", paddingTop: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 0 }}>
            <div style={{ paddingRight: 20 }}>
              <div className="la-kicker" style={{ fontSize: "var(--t-micro)", color: "var(--accent-text)" }}>
                What you get back
              </div>
              <p style={{ marginTop: 7, fontSize: "var(--t-note)", lineHeight: 1.55, color: "var(--muted)", textWrap: "pretty" }}>
                A written answer, the chart the query builder chose for the shape of the result, and the plan
                it executed — metrics, grouping, filters, time range, the generated SQL and the rows behind it.
              </p>
            </div>
            <div style={{ paddingRight: 20, borderLeft: "1px solid var(--line)", paddingLeft: 20 }}>
              <div className="la-kicker" style={{ fontSize: "var(--t-micro)", color: "var(--accent-text)" }}>
                What the model does
              </div>
              <p style={{ marginTop: 7, fontSize: "var(--t-note)", lineHeight: 1.55, color: "var(--muted)", textWrap: "pretty" }}>
                It fills validated parameters — nothing more. Every metric, dimension and filter it names is
                checked against the schema before anything runs, and the SQL is written by the query builder.
              </p>
            </div>
            <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 20 }}>
              <div className="la-kicker" style={{ fontSize: "var(--t-micro)", color: "var(--accent-text)" }}>
                Vocabulary
              </div>
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                {vocab.map((term) => (
                  <span key={term} className="la-pill">
                    {term}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {view === "loading" && (
        <section className="la-sec">
          <div style={{ borderTop: "1px solid var(--line-2)", paddingTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 5, height: 5, background: "var(--accent)", display: "block", animation: "la-pulse 1.4s ease-in-out infinite" }} />
              <span
                style={{
                  fontFamily: "var(--font-m)",
                  fontSize: "var(--t-micro)",
                  fontWeight: 600,
                  letterSpacing: "0.13em",
                  textTransform: "uppercase",
                  color: "var(--faint)",
                }}
              >
                Answer
              </span>
              <span className="la-meta" style={{ marginLeft: "auto" }}>
                Space reserved · 3 blocks
              </span>
            </div>
            <div style={{ minHeight: 104, paddingTop: 12, display: "flex", flexDirection: "column", gap: 9 }}>
              <span className="la-hatch" style={{ display: "block", height: 11, width: "96%", opacity: 0.75 }} />
              <span className="la-hatch" style={{ display: "block", height: 11, width: "99%", opacity: 0.75 }} />
              <span className="la-hatch" style={{ display: "block", height: 11, width: "62%", opacity: 0.75 }} />
            </div>
          </div>
          <div className="la-bp" style={{ marginTop: 16, border: "1px solid var(--line)", display: "flex", flexDirection: "column" }}>
            <BlueprintMarks />
            <div style={{ padding: "13px 14px 10px" }}>
              <div
                style={{
                  fontFamily: "var(--font-m)",
                  fontSize: "var(--t-micro)",
                  fontWeight: 600,
                  letterSpacing: "0.13em",
                  textTransform: "uppercase",
                  color: "var(--faint)",
                }}
              >
                Chart pending
              </div>
              <span className="la-hatch" style={{ display: "block", height: 15, width: 230, marginTop: 6, opacity: 0.75 }} />
            </div>
            <div style={{ padding: "0 14px 10px" }}>
              <div style={{ height: geom.line, border: "1px solid var(--line)" }} />
            </div>
            <div style={{ minHeight: 32, borderTop: "1px solid var(--line)" }} />
          </div>
          <div style={{ marginTop: 16, border: "1px solid var(--line)", minHeight: 34 }} />
        </section>
      )}

      {networkError && (
        <section className="la-sec">
          <div
            style={{
              border: "1px solid var(--bad-line)",
              background: "var(--bad-tint)",
              padding: "9px 11px",
              color: "var(--bad-text)",
              fontSize: "var(--t-note)",
            }}
          >
            {networkError}
          </div>
        </section>
      )}

      {result && (view === "answered" || view === "unsupported" || view === "forecast") && (
        <section className="la-sec">
          <AnswerBlock
            result={result}
            onExampleClick={(q) => {
              setQuestion(q);
              void submit(q);
            }}
          />
        </section>
      )}

      {hasChart && (
        <section className="la-sec" style={{ marginTop: 18 }}>
          <div className="la-bp la-card" style={{ display: "flex", flexDirection: "column" }}>
            <BlueprintMarks />
            <div style={{ padding: "13px 14px 10px" }}>
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
                {chartTypeLabel(result!.chart!)}
              </div>
              <h3 style={{ fontSize: "var(--t-h3)", marginTop: 4 }}>{askChartTitle(result!.plan!)}</h3>
              <p style={{ marginTop: 5, fontSize: "var(--t-sm)", lineHeight: 1.45, color: "var(--muted)", maxWidth: "66ch", textWrap: "pretty" }}>
                {result!.chart!.reason}
              </p>
            </div>
            <div style={{ padding: "0 14px 10px", overflow: "hidden" }}>
              <ChartRenderer
                spec={result!.chart!}
                rows={result!.rows!}
                variant={variant}
                height={300}
                maxBarSize={40}
                xAngle={-30}
                xAxisHeight={44}
                highlightFirst={highlightFirst}
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                minHeight: "var(--ctl)",
                padding: "0 14px",
                borderTop: "1px solid var(--line-2)",
                color: "var(--muted)",
              }}
            >
              <span style={{ fontFamily: "var(--font-m)", fontSize: "var(--t-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-text)" }}>
                Plan
              </span>
              <span style={{ fontFamily: "var(--font-m)", fontSize: "var(--t-mono)", color: "var(--faint)" }}>
                {planSummary(result!.plan!)}
              </span>
              <span className="la-cta">Full plan below</span>
            </div>
          </div>
        </section>
      )}

      {view === "forecast" && result?.forecast && (
        <section className="la-sec" style={{ marginTop: 18 }}>
          <ForecastPanel forecast={result.forecast} variant={variant} />
        </section>
      )}

      {hasPlan && (
        <section className="la-sec" style={{ marginTop: 18 }}>
          <div className="la-bp la-card" style={{ padding: "14px 16px 15px" }}>
            <BlueprintMarks />
            <PlanSheet plan={result!.plan!} rows={result!.rows} toolInput={result!.tool_input} openSubs="sql rows" />
          </div>
        </section>
      )}
    </>
  );
}
