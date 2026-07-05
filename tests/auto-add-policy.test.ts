import { describe, expect, it } from "vitest";
import {
  getAutoAddMinUsdTolerance,
  isAutoAddBelowMinUsd,
  shouldBootstrapAutoAddFromWallet
} from "../src/auto-add-policy.js";

describe("auto-add min usd policy", () => {
  it("uses a small tolerance around the configured minimum", () => {
    expect(getAutoAddMinUsdTolerance(3)).toBeCloseTo(0.15, 8);
    expect(isAutoAddBelowMinUsd({ plannedAddUsd: 2.9, autoAddMinUsd: 3 })).toBe(false);
    expect(isAutoAddBelowMinUsd({ plannedAddUsd: 2.8, autoAddMinUsd: 3 })).toBe(true);
  });

  it("does not enforce the minimum when the planned USD value is unknown", () => {
    expect(isAutoAddBelowMinUsd({ plannedAddUsd: null, autoAddMinUsd: 3 })).toBe(false);
  });
});

describe("auto-add wallet bootstrap policy", () => {
  it("bootstraps when one side of the pool is missing", () => {
    expect(shouldBootstrapAutoAddFromWallet({
      balanceTokenA: 0.0329,
      balanceTokenB: 0,
      plannedAddUsd: 2.85,
      autoAddMinUsd: 3
    })).toBe(true);
  });

  it("bootstraps when the current add amount is materially below the configured minimum", () => {
    expect(shouldBootstrapAutoAddFromWallet({
      balanceTokenA: 0.04,
      balanceTokenB: 1.2,
      plannedAddUsd: 2.8,
      autoAddMinUsd: 3
    })).toBe(true);
  });

  it("does not bootstrap when the current add amount is only slightly below the configured minimum", () => {
    expect(shouldBootstrapAutoAddFromWallet({
      balanceTokenA: 0.04,
      balanceTokenB: 1.2,
      plannedAddUsd: 2.9,
      autoAddMinUsd: 3
    })).toBe(false);
  });

  it("does not bootstrap when both sides are available and the amount is already sufficient", () => {
    expect(shouldBootstrapAutoAddFromWallet({
      balanceTokenA: 0.05,
      balanceTokenB: 4.5,
      plannedAddUsd: 6.2,
      autoAddMinUsd: 3
    })).toBe(false);
  });
});
