import { describe, expect, it } from "vitest";
import { shouldBootstrapAutoAddFromWallet } from "../src/auto-add-policy.js";

describe("auto-add wallet bootstrap policy", () => {
  it("bootstraps when one side of the pool is missing", () => {
    expect(shouldBootstrapAutoAddFromWallet({
      balanceTokenA: 0.0329,
      balanceTokenB: 0,
      plannedAddUsd: 2.85,
      autoAddMinUsd: 3
    })).toBe(true);
  });

  it("bootstraps when the current add amount is below the configured minimum", () => {
    expect(shouldBootstrapAutoAddFromWallet({
      balanceTokenA: 0.04,
      balanceTokenB: 1.2,
      plannedAddUsd: 2.9,
      autoAddMinUsd: 3
    })).toBe(true);
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
