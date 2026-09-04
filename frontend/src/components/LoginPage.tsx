import { useState } from "react";
import type { Session } from "../session";
import type { Theme } from "../theme";
import { BlueprintMarks } from "./Blueprint";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  session: Session;
  theme: Theme;
  onToggleTheme: () => void;
}

export function LoginPage({ session, theme, onToggleTheme }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (session.loggingIn || !username.trim() || !password) return;
    void session.login(username.trim(), password);
  };

  return (
    <div
      style={{
        // Not 100dvh: this sits inside .la-page-inner, which already carries
        // its own top/bottom padding, so a full-viewport height here would
        // overflow it by that amount. A generous but inexact minHeight
        // centers the card without fighting that padding across breakpoints.
        minHeight: "65vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 0" }}>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="la-bp la-card" style={{ width: "100%", maxWidth: 380, padding: "24px 26px 26px" }}>
          <BlueprintMarks />

          <h1 style={{ fontSize: "var(--t-h1)", letterSpacing: "0.02em", textTransform: "uppercase" }}>
            Logistics Analytics
          </h1>
          <p style={{ marginTop: 4, fontSize: "var(--t-note)", color: "var(--muted)" }}>
            Sign in to continue.
          </p>

          {session.expired && !session.loginError && (
            <div
              role="status"
              style={{
                marginTop: 14,
                border: "1px solid var(--warn-line)",
                background: "var(--warn-tint)",
                padding: "8px 10px",
                fontSize: "var(--t-note)",
                color: "var(--warn-text)",
              }}
            >
              Your session expired. Please sign in again.
            </div>
          )}

          <form onSubmit={submit} style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 13 }}>
            <div>
              <label className="la-label" htmlFor="la-login-username">
                Username
              </label>
              <input
                id="la-login-username"
                name="username"
                type="text"
                autoComplete="username"
                autoFocus
                required
                disabled={session.loggingIn}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="la-input"
                style={{ width: "100%" }}
                aria-invalid={!!session.loginError}
              />
            </div>
            <div>
              <label className="la-label" htmlFor="la-login-password">
                Password
              </label>
              <input
                id="la-login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={session.loggingIn}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="la-input"
                style={{ width: "100%" }}
                aria-invalid={!!session.loginError}
              />
            </div>

            {session.loginError && (
              <div
                role="alert"
                style={{
                  border: "1px solid var(--bad-line)",
                  background: "var(--bad-tint)",
                  padding: "8px 10px",
                  fontSize: "var(--t-note)",
                  color: "var(--bad-text)",
                }}
              >
                {session.loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={session.loggingIn || !username.trim() || !password}
              className="la-btn la-btn--primary"
              style={{ minHeight: "var(--ctl-lg)", fontSize: 14.5 }}
            >
              {session.loggingIn ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
