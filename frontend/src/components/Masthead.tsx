import type { Theme } from "../theme";
import { ThemeToggle } from "./ThemeToggle";

export type Tab = "dashboard" | "ask";

interface Props {
  subtitle: string;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  theme: Theme;
  onToggleTheme: () => void;
  username?: string | null;
  onLogout?: () => void;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "ask", label: "Ask a question" },
];

export function Masthead({ subtitle, tab, onTabChange, theme, onToggleTheme, username, onLogout }: Props) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 20,
        flexWrap: "wrap",
        paddingBottom: 11,
        borderBottom: "1px solid var(--line-2)",
      }}
    >
      <div>
        <h1 style={{ fontSize: "var(--t-h1)", letterSpacing: "0.02em", textTransform: "uppercase" }}>
          Logistics Analytics
        </h1>
        <p
          className="la-num"
          style={{
            marginTop: 3,
            fontSize: "var(--t-cap)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--faint)",
          }}
        >
          {subtitle}
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* A real tab pattern needs tabpanel/aria-controls this app doesn't
            have (two full-page views, not panels sharing one region), so
            this is a nav rather than an incomplete role="tablist". */}
        <nav aria-label="Sections" style={{ display: "inline-flex", border: "1px solid var(--line-2)" }}>
          {TABS.map((t, i) => (
            <button
              key={t.key}
              type="button"
              className="la-tab"
              aria-current={tab === t.key ? "page" : undefined}
              onClick={() => onTabChange(t.key)}
              style={{ borderLeft: i > 0 ? "1px solid var(--line-2)" : undefined }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="la-ibtn"
            aria-label={username ? `Sign out of ${username}` : "Sign out"}
            title={username ?? undefined}
            style={{
              minHeight: 32,
              height: 32,
              padding: "0 10px",
              fontFamily: "var(--font-m)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
