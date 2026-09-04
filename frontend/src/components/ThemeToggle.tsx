import type { Theme } from "../theme";

function HalfCircle() {
  return (
    <svg width={13} height={13} viewBox="0 0 13 13" aria-hidden="true" style={{ display: "block", flex: "none" }}>
      <circle cx={6.5} cy={6.5} r={5.75} fill="none" stroke="currentColor" strokeWidth={1.2} />
      <path d="M6.5 0.75 A5.75 5.75 0 0 1 6.5 12.25 Z" fill="currentColor" />
    </svg>
  );
}

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const word = theme === "dark" ? "Dark" : "Light";
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      type="button"
      onClick={onToggle}
      className="la-ibtn"
      aria-label={label}
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
      <HalfCircle />
      <span>{word}</span>
    </button>
  );
}
