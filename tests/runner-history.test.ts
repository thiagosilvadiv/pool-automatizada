import { describe, expect, it, vi } from "vitest";
import type { BotStatus } from "../src/orca.js";
import { BotRunner } from "../src/runner.js";

function createStatus(overrides: Partial<BotStatus> = {}): BotStatus {
  return {
    running: false,
    lastAction: null,
    lastError: null,
    lastActionFeeLamports: null,
    lastPrice: 100,
    solUsdPrice: 150,
    budgetUsd: 100,
    budgetSol: 1,
    targetRange: null,
    positionRange: null,
    positionMint: null,
    solBalance: null,
    tokenABalance: null,
    tokenBBalance: null,
    positionTokenA: null,
    positionTokenB: null,
    portfolioValue: null,
    pnl: null,
    portfolioUsd: null,
    pnlUsd: null,
    positionValue: null,
    positionPnl: null,
    positionValueUsd: null,
    positionPnlUsd: null,
    positionEntryUsd: null,
    positionFeesUsd: null,
    positionExitUsd: null,
    eventPositionMint: null,
    eventPositionEntryUsd: null,
    eventPositionFeesUsd: null,
    eventPositionExitUsd: null,
    tokenAMint: null,
    tokenBMint: null,
    isTokenASol: null,
    isTokenBSol: null,
    lastOpenTokenA: null,
    lastOpenTokenB: null,
    lastCloseTokenA: null,
    lastCloseTokenB: null,
    trendDirection: null,
    trendTimeframe: null,
    trendUpdatedAt: null,
    trendPreferredExitToken: null,
    effectiveExitToken: null,
    effectiveExitDirection: "down",
    effectiveExitSide: null,
    effectiveValueToken: null,
    trendStale: null,
    ...overrides
  };
}

describe("runner history hedge close", () => {
  it("prefers the explicit hedgeClose passed to recordEvent for close-position history", () => {
    const bot = {
      getStatus: vi.fn(),
      setPositionEntryUsd: vi.fn(),
      setError: vi.fn()
    } as any;
    const historyStore = {
      load: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined)
    };
    const runner = new BotRunner(bot, {
      hedgeEnabled: true,
      bybitApiKey: null,
      bybitApiSecret: null,
      bybitBaseUrl: "https://api.bybit.com",
      bybitRecvWindow: 5000,
      hedgePct: 50,
      hedgeSymbol: "BTCUSDT",
      hedgeLeverage: 3,
      historyMaxEvents: 200,
      pollIntervalMs: 1000,
      autoAddLiquidityEnabled: false
    } as any, {
      historyStore,
      poolId: "pool-1"
    });

    const explicitHedgeClose = {
      symbol: "BTCUSDT",
      qty: 2,
      notionalUsd: 140,
      leverage: 3,
      feesUsd: 0.8,
      pnlUsd: 4.2,
      closedAt: "2026-04-01T12:00:10.000Z"
    };
    (runner as any).lastHedgeClose = {
      ...explicitHedgeClose,
      symbol: "OLD",
      pnlUsd: 1
    };

    (runner as any).recordEvent(createStatus({
      lastAction: "close-position",
      eventPositionMint: "mint-1",
      eventPositionEntryUsd: 100,
      eventPositionFeesUsd: 0.5,
      eventPositionExitUsd: 110
    }), {
      hedgeClose: explicitHedgeClose
    });

    const [event] = runner.getHistory();
    expect(event.action).toBe("close-position");
    expect(event.hedgeSymbol).toBe("BTCUSDT");
    expect(event.hedgeNotionalUsd).toBe(140);
    expect(event.hedgeLeverage).toBe(3);
    expect(event.hedgeFeesUsd).toBe(0.8);
    expect(event.hedgePnlUsd).toBe(4.2);
  });
});
