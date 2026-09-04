import { useState } from "react";
import { api, ApiError } from "../api/client";
import { ChartRenderer } from "../components/ChartRenderer";
import { ForecastPanel } from "../components/ForecastPanel";
import { QueryPlanPanel } from "../components/QueryPlanPanel";
import type { AskResponse, SchemaResponse } from "../types";

export function Ask({ schema }: { schema: SchemaResponse | null }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(value: string) {
    const trimmed = value.trim();
    if (trimmed.length < 3 || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.ask(trimmed));
    } catch (caught) {
      // A 422 means the model asked for something outside the supported
      // vocabulary. That is a real answer about the system's limits, so it is
      // shown as such rather than as a generic failure.
      setError(caught instanceof ApiError ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  const examples = schema?.example_questions ?? [];

  return (
    <>
      <section>
        <form
          className="ask-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(question);
          }}
        >
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about delays, carriers, regions, delivery times, or future demand…"
            aria-label="Ask a question about the logistics data"
          />
          <button type="submit" disabled={loading || question.trim().length < 3}>
            {loading ? "Working…" : "Ask"}
          </button>
        </form>

        {schema && !schema.ai_enabled && (
          <div className="banner warn" style={{ marginTop: 12 }}>
            No ANTHROPIC_API_KEY is configured on the server, so questions cannot be answered.
            The dashboard tab works without one.
          </div>
        )}

        <div className="examples">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setQuestion(example);
                void submit(example);
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <section>
          <div className="banner error">{error}</div>
        </section>
      )}

      {result && (
        <>
          <section>
            <div className={`card answer${result.unsupported ? " unsupported" : ""}`}>
              {result.answer}
            </div>
            {result.unsupported && result.supported_examples.length > 0 && (
              <div className="examples">
                {result.supported_examples.map((example) => (
                  <button key={example} type="button" onClick={() => void submit(example)}>
                    {example}
                  </button>
                ))}
              </div>
            )}
          </section>

          {result.chart && result.rows && result.chart.type !== "kpi" && (
            <section>
              <div className="card chart-card">
                <div className="chart-head">
                  <h3>{result.plan?.metrics.map((m) => m.label).join(", ")}</h3>
                  <div className="chart-why">{result.chart.reason}</div>
                </div>
                <ChartRenderer spec={result.chart} rows={result.rows} height={300} />
              </div>
            </section>
          )}

          {result.forecast && (
            <section>
              <ForecastPanel forecast={result.forecast} />
            </section>
          )}

          {result.plan && (
            <section>
              <QueryPlanPanel
                plan={result.plan}
                rows={result.rows}
                toolInput={result.tool_input}
              />
            </section>
          )}
        </>
      )}
    </>
  );
}
