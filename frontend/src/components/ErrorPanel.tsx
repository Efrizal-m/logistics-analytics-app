import { useState } from "react";
import { BlueprintMarks } from "./Blueprint";

interface Props {
  /** Requests actually attempted, e.g. ["GET /api/kpis", "GET /api/charts x4"]. */
  endpoints: string[];
  failedAt: Date | null;
  kind: "network" | "http" | null;
  message: string;
  baseUrl: string;
  onRetry: () => void;
  /** true when only part of the page failed - the band/grid below still show
   * real or degraded content, not nothing. */
  partial: boolean;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{ fontFamily: "var(--font-m)", fontSize: 12, color: "var(--text)" }}>{children}</code>
  );
}

export function ErrorPanel({ endpoints, failedAt, kind, message, baseUrl, onRetry, partial }: Props) {
  const [copied, setCopied] = useState(false);
  const canCopy = typeof navigator !== "undefined" && !!navigator.clipboard;

  const copyDetails = () => {
    const details = [
      `Endpoints: ${endpoints.join(", ")}`,
      `Base URL: ${baseUrl}`,
      `Error: ${message}`,
      `Time: ${failedAt?.toISOString() ?? "unknown"}`,
      `User agent: ${navigator.userAgent}`,
    ].join("\n");
    navigator.clipboard.writeText(details).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="la-bp la-card" style={{ padding: "16px 18px 15px" }}>
      <BlueprintMarks />
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 6, height: 6, background: "var(--bad)", display: "block" }} />
        <span
          style={{
            fontFamily: "var(--font-m)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--bad-text)",
          }}
        >
          {kind === "network" ? "No connection to the API" : "The API returned an error"}
        </span>
      </div>

      <h2 style={{ fontSize: "var(--t-h2)", marginTop: 9 }}>
        {partial ? "Part of this page could not be loaded." : "Nothing on this page could be loaded."}
      </h2>

      <p style={{ marginTop: 6, fontSize: "var(--t-body)", lineHeight: 1.55, color: "var(--muted)", maxWidth: "74ch", textWrap: "pretty" }}>
        {kind === "network" ? (
          <>
            Every figure here is read from the API at <Code>VITE_API_BASE_URL</Code>. The request failed
            with <Code>{message}</Code>, which means the browser could not open a connection at all — so
            this is a setup or network problem, not a bad query.
          </>
        ) : (
          <>
            The API at <Code>VITE_API_BASE_URL</Code> responded, but with an error: <Code>{message}</Code>.
          </>
        )}
      </p>

      <div style={{ marginTop: 14, borderTop: "1px solid var(--line)" }}>
        <div
          style={{
            fontFamily: "var(--font-m)",
            fontSize: "var(--t-micro)",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--faint)",
            padding: "9px 0 5px",
          }}
        >
          What to check
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "20px 1fr", gap: "4px 10px", alignItems: "baseline" }}>
          <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--accent-text)" }}>01</span>
          <span style={{ fontSize: "var(--t-note)", color: "var(--text)" }}>
            The backend is running — <Code>uvicorn app.main:app --reload</Code>
          </span>
          <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--accent-text)" }}>02</span>
          <span style={{ fontSize: "var(--t-note)", color: "var(--text)" }}>
            <Code>VITE_API_BASE_URL</Code> points at it — currently <Code>{baseUrl}</Code>
          </span>
          <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--accent-text)" }}>03</span>
          <span style={{ fontSize: "var(--t-note)", color: "var(--text)" }}>
            The dev server was restarted after <Code>.env</Code> changed
          </span>
        </div>
      </div>

      <div
        style={{
          marginTop: 15,
          paddingTop: 13,
          borderTop: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <button type="button" className="la-btn la-btn--primary" onClick={onRetry}>
          Retry
        </button>
        {canCopy && (
          <button type="button" className="la-btn la-ibtn" onClick={copyDetails}>
            {copied ? "Copied" : "Copy error details"}
          </button>
        )}
        <span className="la-num" style={{ marginLeft: "auto", fontSize: 10, letterSpacing: "0.06em", color: "var(--faint)" }}>
          {endpoints.join(" · ")}
          {failedAt && ` · ${failedAt.toLocaleTimeString()}`}
        </span>
      </div>
    </div>
  );
}
