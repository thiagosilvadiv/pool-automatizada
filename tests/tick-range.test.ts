import { describe, expect, it } from "vitest";

import { alignTickRangeToSpacing } from "../src/tick-range.js";

describe("alignTickRangeToSpacing", () => {
  it("uses floor for lower and ceil for upper on positive ticks", () => {
    const result = alignTickRangeToSpacing(1003, 1099, 64);
    expect(result.lowerTick).toBe(960);
    expect(result.upperTick).toBe(1152);
  });

  it("handles negative ticks without shifting the lower bound toward zero", () => {
    const result = alignTickRangeToSpacing(-123, -101, 64);
    expect(result.lowerTick).toBe(-128);
    expect(result.upperTick).toBe(-64);
  });

  it("ensures at least one tickSpacing width when both indexes map to same bucket", () => {
    const result = alignTickRangeToSpacing(1001, 1002, 64);
    expect(result.lowerTick).toBe(960);
    expect(result.upperTick).toBe(1024);
  });
});

