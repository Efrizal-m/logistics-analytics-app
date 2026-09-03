import { useState } from "react";
import { api } from "./api/client";
import { Ask } from "./pages/Ask";
import { Dashboard } from "./pages/Dashboard";
import { useAsync } from "./useAsync";

type Tab = "dashboard" | "ask";

export function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const schema = useAsync(() => api.schema(), []);

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>Logistics Analytics</h1>
          <p>
            {schema.data
              ? `${schema.data.metrics.length} metrics over orders from ${schema.data.dataset_start} to ${schema.data.dataset_end}`
              : "Loading dataset…"}
          </p>
        </div>
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "dashboard"}
            onClick={() => setTab("dashboard")}
          >
            Dashboard
          </button>
          <button role="tab" aria-selected={tab === "ask"} onClick={() => setTab("ask")}>
            Ask a question
          </button>
        </div>
      </header>

      {schema.error && (
        <section>
          <div className="banner error">
            Could not reach the API: {schema.error}. Check that the backend is running and that
            VITE_API_BASE_URL points at it.
          </div>
        </section>
      )}

      {tab === "dashboard" ? <Dashboard /> : <Ask schema={schema.data} />}
    </div>
  );
}
