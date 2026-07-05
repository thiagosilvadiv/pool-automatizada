import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";

import { applyWithdrawBuffer, lamportsToUi, isBlockhashError } from "../src/kamino-utils.js";
import { computeRiskAwareRepayChunk } from "../src/kamino-math.js";

describe("kamino withdraw capacity helpers", () => {
  it("drops capacity to zero when at borrow limit", () => {
    const lamports = new Decimal(0);
    const ui = lamportsToUi(lamports, 6);
    const buffered = applyWithdrawBuffer(ui, 0.7);
    expect(ui).toBe(0);
    expect(buffered).toBe(0);
  });

  it("applies 70% buffer to withdraw capacity", () => {
    const lamports = new Decimal("1000000"); // 1.0 token with 6 decimals
    const ui = lamportsToUi(lamports, 6);
    const buffered = applyWithdrawBuffer(ui, 0.7);
    expect(ui).toBeCloseTo(1);
    expect(buffered).toBeCloseTo(0.7);
  });
});

describe("risk-aware chunk selection", () => {
  it("limits repay to capacity * price", () => {
    const result = computeRiskAwareRepayChunk({
      debtRemaining: 5,
      capacityUi: 1,
      priceCollToDebt: 2, // 1 coll covers 2 units debt
      minStable: 0.1
    });
    expect(result.chunk).toBeCloseTo(2);
  });

  it("fails fast when capacity is below minimum stable chunk", () => {
    const result = computeRiskAwareRepayChunk({
      debtRemaining: 1,
      capacityUi: 0.05,
      priceCollToDebt: 1,
      minStable: 0.1
    });
    expect(result.chunk).toBe(0);
    expect(result.reason).toMatch(/capacidade/i);
  });
});

describe("kamino blockhash detection", () => {
  it("detects -32002 messages", () => {
    expect(isBlockhashError(new Error("Transaction simulation failed: -32002"))).toBe(true);
    expect(isBlockhashError({ message: "blockhash not found" })).toBe(true);
    expect(isBlockhashError({ message: "other error" })).toBe(false);
  });
});
