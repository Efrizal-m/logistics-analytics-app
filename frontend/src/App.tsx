import { useState } from "react";
import { api } from "./api/client";
import { Masthead, type Tab } from "./components/Masthead";
import { Ask } from "./pages/Ask";
import { Dashboard } from "./pages/Dashboard";
import { useAsync } from "./useAsync";
import { useTheme } from "./theme";

export function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const schema = useAsync(() => api.schema(), []);
  const { theme, toggle } = useTheme();

  const subtitle = schema.data
    ? `${schema.data.metrics.length} metrics · orders ${schema.data.dataset_start} → ${schema.data.dataset_end}`
    : schema.loading
      ? "Loading dataset…"
      : "Dataset unavailable";

  return (
    <div className="la la-page">
      <div className="la-page-inner">
        <Masthead subtitle={subtitle} tab={tab} onTabChange={setTab} theme={theme} onToggleTheme={toggle} />
        {tab === "dashboard" ? <Dashboard schema={schema.data} /> : <Ask schema={schema.data} />}
      </div>
    </div>
  );
}
