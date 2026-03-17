import { describe, it, expect } from "vitest";
import { calculateRange, isPriceOutOfRange } from "../src/strategy.js";

describe("strategy", () => {
  it("calculates range around price", () => {
    const range = calculateRange(100, 1);
    expect(range.lower).toBeCloseTo(99);
    expect(range.upper).toBeCloseTo(101);
  });

  it("detects out of range", () => {
    const range = { lower: 99, upper: 101 };
    expect(isPriceOutOfRange(98.5, range)).toBe(true);
    expect(isPriceOutOfRange(100, range)).toBe(false);
    expect(isPriceOutOfRange(101.5, range)).toBe(true);
  });
});
