import { describe, it, expect } from "vitest";

import { selectRepayChunkWithQuote } from "../src/orca.js";

describe("selectRepayChunkWithQuote", () => {
  it("respects inverted price (small price) producing tiny chunk", () => {
    const res = selectRepayChunkWithQuote({
      debtRemaining: 5.73365985,
      capacityUi: 0.075,
      priceCollToDebt: 0.012, // wrong/low price
      quoteOutStableUi: null,
      minStable: 0.1
    });
    expect(res.chunk).toBeLessThan(0.1); // should reject as insufficient
    expect(res.reason?.toLowerCase()).toContain("capacidade");
  });

  it("uses correct price to cap chunk by capacity", () => {
    const res = selectRepayChunkWithQuote({
      debtRemaining: 10,
      capacityUi: 0.075,
      priceCollToDebt: 80, // 1 coll -> 80 stable
      quoteOutStableUi: null,
      minStable: 0.1
    });
    expect(res.chunk).toBeCloseTo(6, 3); // 0.075 * 80 = 6
  });

  it("prefers quote when provided and smaller than price-based", () => {
    const res = selectRepayChunkWithQuote({
      debtRemaining: 10,
      capacityUi: 1,
      priceCollToDebt: 100,
      quoteOutStableUi: 2, // quote says only 2 stable out
      minStable: 0.1
    });
    expect(res.chunk).toBeCloseTo(2);
  });

  it("rejects when below min stable", () => {
    const res = selectRepayChunkWithQuote({
      debtRemaining: 1,
      capacityUi: 0.001,
      priceCollToDebt: 1,
      quoteOutStableUi: 0.0005,
      minStable: 0.1
    });
    expect(res.chunk).toBe(0);
    expect(res.reason).toMatch(/capacidade/);
  });
});
