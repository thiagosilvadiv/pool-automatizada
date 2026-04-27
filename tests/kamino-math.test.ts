import { describe, expect, it } from "vitest";

import { computeKaminoTargetToleranceAmount } from "../src/kamino-math.js";

describe("kamino target tolerance", () => {
  it("uses operational tolerance when borrow minimum is the limiting factor", () => {
    const tolerance = computeKaminoTargetToleranceAmount({
      targetAmount: 1.44,
      unitUsd: 220
    });
    expect(tolerance).toBeCloseTo(0.01 / 220);
  });

  it("falls back to proportional epsilon when price is unavailable", () => {
    const tolerance = computeKaminoTargetToleranceAmount({
      targetAmount: 500,
      unitUsd: Number.NaN
    });
    expect(tolerance).toBeCloseTo(0.0005);
  });
});
