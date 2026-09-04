/**
 * The design hardcodes each chart's axis domain (yMax: 40, yTicks: [0,10,...])
 * because its data is static. Real data isn't, so this derives the same kind
 * of "nice" domain from whatever the query actually returned - verified to
 * reproduce every domain in the artboards from their own data maxima.
 */

const LADDER = [1, 2, 2.5, 5, 10];

export interface NiceScale {
  max: number;
  ticks: number[];
}

export function niceScale(max: number, targetIntervals = 5): NiceScale {
  if (!(max > 0)) {
    return { max: targetIntervals, ticks: Array.from({ length: targetIntervals + 1 }, (_, i) => i) };
  }
  const rawStep = max / targetIntervals;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = (LADDER.find((m) => rawStep <= m * magnitude) ?? 10) * magnitude;
  const niceMax = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let t = 0; t <= niceMax + step / 1e6; t += step) {
    ticks.push(Math.round(t * 1e6) / 1e6);
  }
  return { max: niceMax, ticks };
}

/** Percent metrics store 0-1 fractions; nice-ing on the 0-100 scale (then
 * mapping back) avoids the ladder producing a step like 0.025 that reads
 * fine as an axis number but is nonsense as "2.5%". */
export function niceScalePercent(maxFraction: number, targetIntervals = 5): NiceScale {
  const scaled = niceScale(maxFraction * 100, targetIntervals);
  return { max: scaled.max / 100, ticks: scaled.ticks.map((t) => t / 100) };
}

/** Horizontal bars reserve room past the last tick for the value label drawn
 * past the bar's end - the domain grows, the ticks (and gridlines) don't. */
export function withHeadroom(scale: NiceScale, factor = 1.1): NiceScale {
  return { max: scale.max * factor, ticks: scale.ticks };
}
