/* Logistics Analytics — token layer.
   Injected as one <style> so every consuming Design Component shares one source
   of truth. Everything a component draws with is a custom property here; the
   components themselves are styled inline. Charts reference --chart-* directly,
   so flipping data-theme is a pure CSS repaint with no React re-render.

   Derived from the Industry design system (steel #5980a6 accent, Barlow
   Condensed over Barlow, square corners, hairline objects). Two additions the
   system does not carry: a semantic amber/red pair and a 6-step categorical
   ramp, both generated in OKLCH on Industry's own perceptual lightness scale so
   they sit at the same visual weight as the steel. */
(function () {
  if (document.getElementById("la-tokens")) return;

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap";
  document.head.appendChild(link);

  var css = `
.la {
  --font-h: "Barlow Condensed", system-ui, sans-serif;
  --font-b: "Barlow", system-ui, sans-serif;
  --font-m: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;

  /* Industry's density scale (0.85x) */
  --s1: 3px; --s2: 7px; --s3: 10px; --s4: 14px; --s5: 17px; --s6: 20px; --s8: 27px; --s10: 34px;

  --r0: 0px;   /* objects are square — Industry */
  --r-sm: 2px; /* the only curve: data marks that need one */

  --bg: #f2f2f3;
  --raise: #e9e9ea;
  --text: #1d1f20;
  --muted: #5d5d60;
  --faint: #6e6f71;
  --line: rgba(29,31,32,.16);
  --line-2: rgba(29,31,32,.30);
  --hatch: rgba(29,31,32,.055);

  --accent: #5980a6;
  --accent-text: #416180;
  --accent-tint: #e3edf6;
  --accent-deep: #1d2d3d;
  --on-accent: #f2f2f3;

  --warn: oklch(0.575 0.095 72);
  --warn-text: oklch(0.425 0.085 66);
  --warn-tint: oklch(0.957 0.028 84);
  --warn-line: oklch(0.845 0.055 80);

  --bad: oklch(0.545 0.145 27);
  --bad-text: oklch(0.445 0.130 27);
  --bad-tint: oklch(0.955 0.022 30);
  --bad-line: oklch(0.855 0.055 28);

  --grid: rgba(29,31,32,.10);
  --axis: #6e6f71;

  /* Categorical ramp. Hue AND lightness both step, so the series stay separable
     under deuteranopia and in greyscale. Steel is series 1. */
  --chart-1: oklch(0.575 0.062 250);
  --chart-2: oklch(0.665 0.105 72);
  --chart-3: oklch(0.450 0.095 288);
  --chart-4: oklch(0.735 0.068 205);
  --chart-5: oklch(0.525 0.130 28);
  --chart-6: oklch(0.375 0.038 250);

  --shadow-sm: 0 1px 2px rgba(43,43,45,.14);
  --shadow-md: 0 3px 10px rgba(43,43,45,.16);
  --shadow-lg: 0 12px 32px rgba(43,43,45,.22);
}

.la[data-theme="dark"] {
  --bg: #191a1b;
  --raise: #212324;
  --text: #ececed;
  --muted: #a2a3a5;
  --faint: #86878a;
  --line: rgba(236,237,237,.18);
  --line-2: rgba(236,237,237,.34);
  --hatch: rgba(236,237,237,.05);

  --accent: #7ba3c9;
  --accent-text: #a8c6e2;
  --accent-tint: rgba(123,163,201,.15);
  --accent-deep: #cfe1f0;
  --on-accent: #12191f;

  --warn: oklch(0.755 0.100 76);
  --warn-text: oklch(0.855 0.080 80);
  --warn-tint: oklch(0.285 0.045 70);
  --warn-line: oklch(0.415 0.065 74);

  --bad: oklch(0.680 0.145 27);
  --bad-text: oklch(0.800 0.110 27);
  --bad-tint: oklch(0.285 0.058 27);
  --bad-line: oklch(0.420 0.085 27);

  --grid: rgba(236,237,237,.12);
  --axis: #86878a;

  --chart-1: oklch(0.680 0.080 250);
  --chart-2: oklch(0.785 0.110 76);
  --chart-3: oklch(0.605 0.115 288);
  --chart-4: oklch(0.845 0.070 205);
  --chart-5: oklch(0.665 0.135 28);
  --chart-6: oklch(0.500 0.042 250);

  --shadow-sm: 0 1px 2px rgba(0,0,0,.5);
  --shadow-md: 0 3px 10px rgba(0,0,0,.55);
  --shadow-lg: 0 12px 32px rgba(0,0,0,.6);
}

.la { background: var(--bg); color: var(--text); font-family: var(--font-b); }
.la *, .la *::before, .la *::after { box-sizing: border-box; }
.la :focus { outline: none; }
.la :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.la ::selection { background: color-mix(in srgb, var(--accent) 30%, transparent); }
.la a { color: var(--accent-text); text-underline-offset: 3px; }
.la a:hover { color: var(--accent); }
.la button { font: inherit; cursor: pointer; }
.la h1, .la h2, .la h3, .la h4 { margin: 0; font-family: var(--font-h); font-weight: 600; letter-spacing: -0.005em; line-height: 1.1; }
.la p { margin: 0; }
.la table { border-collapse: collapse; }

/* Helpers are unscoped so child Design Components can use them without
   redeclaring the token block (which would reset an inherited dark theme). */

/* Registration marks — Industry's blueprint frame. */
.la-bp { position: relative; }
.la-bp > i.c { position: absolute; width: 11px; height: 11px; color: var(--line-2); pointer-events: none; }
.la-bp > i.c::before, .la-bp > i.c::after { content: ""; position: absolute; background: currentColor; }
.la-bp > i.c::before { left: 5px; top: 0; width: 1px; height: 100%; }
.la-bp > i.c::after { top: 5px; left: 0; width: 100%; height: 1px; }
.la-bp > i.tl { top: -6px; left: -6px; }
.la-bp > i.tr { top: -6px; right: -6px; }
.la-bp > i.bl { bottom: -6px; left: -6px; }
.la-bp > i.br { bottom: -6px; right: -6px; }

/* KPI band: separators switch from vertical to horizontal on the band's own
   width, so the same markup serves 1600px and 360px. */
.la-kpiband { container-type: inline-size; }
@container (min-width: 400px) { .la-kpicell + .la-kpicell { border-left: 1px solid var(--line); } }

/* Hatched fill — pending and excluded regions, never a decorative texture. */
.la-hatch { background-image: repeating-linear-gradient(45deg, var(--line) 0 1px, transparent 1px 6px); }

/* Provenance strip: the one hover the audit surface needs. */
.la-strip:hover { background: var(--accent-tint); }
.la-strip:hover .la-cta { color: var(--accent-text); }
.la-chip:hover { border-color: var(--accent); color: var(--accent-text); }
.la-ibtn:hover { border-color: var(--accent); color: var(--accent-text); }
.la-rowh:hover { background: var(--hatch); }
.la-tab:hover:not([aria-selected="true"]) { background: var(--hatch); }

@keyframes la-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
@keyframes la-pulse { 0%,100% { opacity: .5; } 50% { opacity: .9; } }
`;

  var style = document.createElement("style");
  style.id = "la-tokens";
  style.textContent = css;
  document.head.appendChild(style);
})();
