import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BybitClient } from "../src/bybit.js";

describe("bybit closed pnl window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("extends endTime beyond the close timestamp so delayed Bybit rows can be found", async () => {
    vi.setSystemTime(new Date("2026-04-01T12:00:20.000Z"));
    const now = Date.now();
    const client = new BybitClient({
      apiKey: "key",
      apiSecret: "secret",
      baseUrl: "https://api.bybit.com",
      recvWindow: 5000
    }) as any;
    const request = vi.fn().mockResolvedValue({ list: [] });
    client.request = request;

    await client.getClosedPnl("BTCUSDT", {
      openedAfterMs: 1_000,
      closeAtMs: 10_000
    });

    expect(request).toHaveBeenCalledWith(
      "GET",
      "/v5/position/closed-pnl",
      expect.objectContaining({
        category: "linear",
        symbol: "BTCUSDT",
        startTime: 1_000,
        endTime: now + 15_000
      })
    );
  });
});
