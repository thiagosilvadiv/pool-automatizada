import { describe, it, expect } from "vitest";
import { isKaminoCloseAllowed } from "../src/kamino-close-policy.js";

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
