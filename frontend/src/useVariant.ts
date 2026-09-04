import { useEffect, useState } from "react";

export type Variant = "desktop" | "mobile";

// Cross-reference: frontend/src/index.css's .la-page-inner media query uses
// the same 640px breakpoint. CSS can't read this constant, so keep them in
// sync by hand if either changes.
const QUERY = "(max-width: 640px)";

/**
 * The design measures each chart card's own width with a ResizeObserver,
 * because its canvas has no ResponsiveContainer. This app keeps
 * ResponsiveContainer for width; `variant` only decides geometry CSS can't
 * express - chart height, maxBarSize, axis font size, margins, and label
 * abbreviation - all of which track the viewport, not the card.
 */
export function useVariant(): Variant {
  const [variant, setVariant] = useState<Variant>(() =>
    typeof window !== "undefined" && window.matchMedia(QUERY).matches ? "mobile" : "desktop",
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setVariant(mql.matches ? "mobile" : "desktop");
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return variant;
}
