import { describe, expect, it } from "vitest";
import { niceScale, niceScalePercent, withHeadroom } from "./scale";

describe("niceScale", () => {
  // Each case is a real data maximum from the design artboards, verified by
  // hand against chart-svg.js's hardcoded yMax/yTicks before this function
  // existed - if this ever regresses, the dashboard's axes will visibly
  // stop matching the design.
  it("reproduces the order-volume chart's domain (max 38 -> 0..40 by 10)", () => {
    expect(niceScale(38)).toEqual({ max: 40, ticks: [0, 10, 20, 30, 40] });
  });

  it("reproduces the delivery-outcomes chart's domain (max 29 -> 0..30 by 10)", () => {
    expect(niceScale(29)).toEqual({ max: 30, ticks: [0, 10, 20, 30] });
  });

  it("reproduces the carrier chart's domain (max 24 -> 0..25 by 5)", () => {
    expect(niceScale(24)).toEqual({ max: 25, ticks: [0, 5, 10, 15, 20, 25] });
  });

  it("reproduces the city chart's domain (max 38 -> 0..40 by 10, same ladder step as volume)", () => {
    expect(niceScale(38)).toEqual({ max: 40, ticks: [0, 10, 20, 30, 40] });
  });

  it("handles zero/negative input without dividing by zero", () => {
    const scale = niceScale(0);
    expect(scale.max).toBeGreaterThan(0);
    expect(scale.ticks[0]).toBe(0);
  });
});

describe("niceScalePercent", () => {
  it("nices on the 0-100 scale, then maps back to a 0-1 fraction", () => {
    // 0.24 -> nice on 24 -> 25, i.e. 0.25 as a fraction.
    const scale = niceScalePercent(0.24);
    expect(scale.max).toBeCloseTo(0.25);
    expect(scale.ticks).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.25]);
  });
});

describe("withHeadroom", () => {
  it("grows the domain max without adding or moving ticks", () => {
    const base = niceScale(38); // { max: 40, ticks: [0,10,20,30,40] }
    const withRoom = withHeadroom(base);
    expect(withRoom.max).toBeCloseTo(44); // matches the city chart's xMax: 44
    expect(withRoom.ticks).toEqual(base.ticks);
  });
});
