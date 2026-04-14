import { describe, it, expect } from "vitest";
import {
  computeKaminoPnlNoFeesUsd,
  isKaminoCloseAllowed,
  shouldUseKaminoAfterClose
} from "../src/kamino-close-policy.js";

describe("kamino close policy", () => {
  it("permits manual close regardless of debt", () => {
    expect(isKaminoCloseAllowed({
      mode: "manual",
      trigger: "manual",
      debtAmount: 42
    })).toBe(true);
  });

  it("permits automatic close only when target was validated", () => {
    expect(isKaminoCloseAllowed({
      mode: "target",
      trigger: "price-target",
      debtAmount: 42
    })).toBe(true);
  });

  it("blocks wait-funds auto close while debt is still active", () => {
    expect(isKaminoCloseAllowed({
      mode: "target",
      trigger: "wait-funds",
      debtAmount: 42
    })).toBe(false);
  });

  it("blocks token-change auto close while debt is still active", () => {
    expect(isKaminoCloseAllowed({
      mode: "token-change",
      trigger: "token-change",
      debtAmount: 42
    })).toBe(false);
  });

  it("permits debt-zero cleanup only when debt is already zero", () => {
    expect(isKaminoCloseAllowed({
      mode: "target",
      trigger: "debt-zero",
      debtAmount: 0
    })).toBe(true);
    expect(isKaminoCloseAllowed({
      mode: "target",
      trigger: "debt-zero",
      debtAmount: 0.01
    })).toBe(false);
  });
});

describe("kamino rebalance policy", () => {
  it("computes post-close pnl without fees using entry, exit, fees and tx fee", () => {
    expect(computeKaminoPnlNoFeesUsd({
      entryUsd: 152.67,
      exitUsd: 153.11,
      feesUsd: 0.29,
      txFeeUsd: 0.049001
    })).toBeCloseTo(0.100999, 6);
  });

  it("requires confirmed negative post-close pnl to use Kamino", () => {
    expect(shouldUseKaminoAfterClose(-0.01)).toBe(true);
    expect(shouldUseKaminoAfterClose(0)).toBe(false);
    expect(shouldUseKaminoAfterClose(0.10)).toBe(false);
    expect(shouldUseKaminoAfterClose(null)).toBe(false);
  });
});
