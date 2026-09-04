import { useState } from "react";
import { api } from "./api/client";
import { LoginPage } from "./components/LoginPage";
import { Masthead, type Tab } from "./components/Masthead";
import { Ask } from "./pages/Ask";
import { Dashboard } from "./pages/Dashboard";
import { useAsync } from "./useAsync";
import { type Session, useSession } from "./session";
import { type Theme, useTheme } from "./theme";

// Split out so its hooks - especially api.schema() below - only ever run
// once a token exists. Hooks can't be conditional, so this has to be a
// distinct component rather than a branch inside App's body: an inline
// `{token && <>...</>}` fragment would still evaluate useAsync in App every
// render, token or not.
function Authed({
  session,
  theme,
  onToggleTheme,
}: {
  session: Session;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const schema = useAsync(() => api.schema(), []);

  const subtitle = schema.data
    ? `${schema.data.metrics.length} metrics · orders ${schema.data.dataset_start} → ${schema.data.dataset_end}`
    : schema.loading
      ? "Loading dataset…"
      : "Dataset unavailable";

  return (
    <>
      <Masthead
        subtitle={subtitle}
        tab={tab}
        onTabChange={setTab}
        theme={theme}
        onToggleTheme={onToggleTheme}
        username={session.username}
        onLogout={session.logout}
      />
      {tab === "dashboard" ? <Dashboard schema={schema.data} /> : <Ask schema={schema.data} />}
    </>
  );
}

export function App() {
  const session = useSession();
  const { theme, toggle } = useTheme();

  return (
    <div className="la la-page">
      <div className="la-page-inner">
        {session.token ? (
          <Authed session={session} theme={theme} onToggleTheme={toggle} />
        ) : (
          <LoginPage session={session} theme={theme} onToggleTheme={toggle} />
        )}
      </div>
    </div>
  );
}
