import { describe, it, expect } from "vitest";
import { computeBOSWavesDirection, parseOhlcvList } from "../src/trend.js";

function buildCandles(direction: "up" | "down", count = 120) {
  const candles = [];
  for (let i = 0; i < count; i += 1) {
    const step = direction === "up" ? 0.6 : 1.5;
    const base = direction === "up" ? 10 + i * step : 200 - i * step;
    const open = base + (direction === "up" ? -0.1 : 0.1);
    const close = base + (direction === "up" ? 0.2 : -0.2);
    const high = Math.max(open, close) + 0.5;
    const low = Math.min(open, close) - 0.5;
    candles.push({
      t: 1_700_000_000_000 + i * 60_000,
      open,
      high,
      low,
      close,
      volume: 1000
    });
  }
  return candles;
}

describe("trend", () => {
  it("detects up trend for rising candles", () => {
    const candles = buildCandles("up");
    const direction = computeBOSWavesDirection(candles);
    expect(direction).toBe("up");
  });

  it("detects down trend for falling candles", () => {
    const candles = buildCandles("down");
    const direction = computeBOSWavesDirection(candles);
    expect(direction).toBe("down");
  });

  it("parses ohlcv list in ohlc order", () => {
    const raw = [
      [1_700_000_000_000, 10, 12, 9, 11, 100]
    ];
    const parsed = parseOhlcvList(raw);
    expect(parsed[0].open).toBe(10);
    expect(parsed[0].high).toBe(12);
    expect(parsed[0].low).toBe(9);
    expect(parsed[0].close).toBe(11);
  });

  it("parses ohlcv list in oclh order", () => {
    const raw = [
      [1_700_000_000_000, 10, 11, 12, 9, 100]
    ];
    const parsed = parseOhlcvList(raw);
    expect(parsed[0].open).toBe(10);
    expect(parsed[0].high).toBe(12);
    expect(parsed[0].low).toBe(9);
    expect(parsed[0].close).toBe(11);
  });

  it("returns null when candles are insufficient", () => {
    const direction = computeBOSWavesDirection(buildCandles("up", 10));
    expect(direction).toBe(null);
  });
});
