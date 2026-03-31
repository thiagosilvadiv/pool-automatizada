import { describe, it, expect } from "vitest";
import { calculateRange, isPriceOutOfRange, resolveDirectionalExitPreference } from "../src/strategy.js";

function computePnL(price: number, lower: number, upper: number, valueToken: "tokenA" | "tokenB") {
  const s = Math.sqrt(price);
  const sa = Math.sqrt(lower);
  const sb = Math.sqrt(upper);
  const amount0 = (sb - s) / (s * sb);
  const amount1 = s - sa;
  const currentB = amount0 * price + amount1;
  const currentA = amount0 + amount1 / price;
  const upperB = sb - sa;
  const upperA = upperB / (sb * sb);
  const lowerA = (sb - sa) / (sa * sb);
  const lowerB = lowerA * sa * sa;
  const current = valueToken === "tokenA" ? currentA : currentB;
  const upperValue = valueToken === "tokenA" ? upperA : upperB;
  const lowerValue = valueToken === "tokenA" ? lowerA : lowerB;
  const pnlUp = upperValue - current;
  const pnlDown = current - lowerValue;
  return { pnlUp, pnlDown };
}

describe("strategy", () => {
  it("calculates range around price", () => {
    const range = calculateRange(100, 1);
    expect(range.lower).toBeCloseTo(99);
    expect(range.upper).toBeCloseTo(101);
  });

  it("keeps preferred side width and balances PnL when bias is 0", () => {
    const range = calculateRange(100, 1, { exitBiasPct: 0, exitSide: "upper", valueToken: "tokenB" });
    expect(range.upper).toBeCloseTo(101);
    const pnl = computePnL(100, range.lower, range.upper, "tokenB");
    expect(pnl.pnlDown / pnl.pnlUp).toBeCloseTo(1, 6);
  });

  it("reduces negative PnL magnitude with bias", () => {
    const range = calculateRange(100, 1, { exitBiasPct: 20, exitSide: "upper", valueToken: "tokenB" });
    const pnl = computePnL(100, range.lower, range.upper, "tokenB");
    expect(pnl.pnlDown / pnl.pnlUp).toBeCloseTo(0.8, 4);
  });

  it("keeps lower side width when exit side is lower", () => {
    const range = calculateRange(100, 1, { exitBiasPct: 0, exitSide: "lower", valueToken: "tokenA" });
    expect(range.lower).toBeCloseTo(99);
    const pnl = computePnL(100, range.lower, range.upper, "tokenA");
    expect(pnl.pnlDown / pnl.pnlUp).toBeCloseTo(1, 4);
  });

  it("uses directional fallback when lower-side target has no exact root", () => {
    const range = calculateRange(100, 40, { exitBiasPct: 95, exitSide: "lower" });
    expect(range.lower).toBeCloseTo(60);
    expect(range.upper).toBeGreaterThan(100);
    expect(range.upper).toBeLessThan(140);
  });

  it("supports explicit valueToken for every side", () => {
    const combos: Array<{ exitSide: "upper" | "lower"; valueToken: "tokenA" | "tokenB" }> = [
      { exitSide: "upper", valueToken: "tokenA" },
      { exitSide: "upper", valueToken: "tokenB" },
      { exitSide: "lower", valueToken: "tokenA" },
      { exitSide: "lower", valueToken: "tokenB" }
    ];

    combos.forEach(({ exitSide, valueToken }) => {
      const range = calculateRange(100, 1, { exitBiasPct: 20, exitSide, valueToken });
      if (exitSide === "upper") {
        expect(range.upper).toBeCloseTo(101);
        expect(range.lower).toBeLessThan(100);
      } else {
        expect(range.lower).toBeCloseTo(99);
        expect(range.upper).toBeGreaterThan(100);
      }
      const pnl = computePnL(100, range.lower, range.upper, valueToken);
      expect(pnl.pnlDown / pnl.pnlUp).toBeCloseTo(0.8, 3);
    });
  });

  it("keeps legacy semantics when valueToken is omitted", () => {
    const upper = calculateRange(100, 1, { exitBiasPct: 20, exitSide: "upper" });
    const upperPnl = computePnL(100, upper.lower, upper.upper, "tokenB");
    expect(upperPnl.pnlDown / upperPnl.pnlUp).toBeCloseTo(0.8, 4);

    const lower = calculateRange(100, 1, { exitBiasPct: 20, exitSide: "lower" });
    const lowerPnl = computePnL(100, lower.lower, lower.upper, "tokenA");
    expect(lowerPnl.pnlDown / lowerPnl.pnlUp).toBeCloseTo(0.8, 4);
  });

  it("maps token + direction into exit preference", () => {
    expect(resolveDirectionalExitPreference(null, "down")).toBeNull();
    expect(resolveDirectionalExitPreference("tokenA", "down")).toEqual({ exitSide: "lower", valueToken: "tokenA" });
    expect(resolveDirectionalExitPreference("tokenB", "down")).toEqual({ exitSide: "upper", valueToken: "tokenB" });
    expect(resolveDirectionalExitPreference("tokenA", "up")).toEqual({ exitSide: "upper", valueToken: "tokenA" });
    expect(resolveDirectionalExitPreference("tokenB", "up")).toEqual({ exitSide: "lower", valueToken: "tokenB" });
  });

  it("detects out of range", () => {
    const range = { lower: 99, upper: 101 };
    expect(isPriceOutOfRange(98.5, range)).toBe(true);
    expect(isPriceOutOfRange(100, range)).toBe(false);
    expect(isPriceOutOfRange(101.5, range)).toBe(true);
  });
});
