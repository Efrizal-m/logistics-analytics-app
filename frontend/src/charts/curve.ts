import { curveCardinal } from "d3-shape";

/**
 * design/chart-svg.js's curvePath scales each Bezier control point by t/6
 * (line 13: `((p2[0]-p0[0])/6)*t`); d3's curveCardinal scales by
 * (1-tension)/6. So tension = 1 - t, not t itself - passing the design's
 * "0.85"/"0.8" literally would render an almost-straight polyline instead of
 * the intended curve.
 */
export const CARDINAL = curveCardinal.tension(1 - 0.85);
export const CARDINAL_SPARK = curveCardinal.tension(1 - 0.8);
