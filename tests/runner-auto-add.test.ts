import { describe, expect, it, vi } from "vitest";
import type { BotStatus } from "../src/orca.js";
import { BotRunner } from "../src/runner.js";

function createStatus(overrides: Partial<BotStatus> = {}): BotStatus {
  return {
    running: true,
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
    kaminoActive: false,
    kaminoEnabled: false,
    kaminoCollateralUsd: null,
    kaminoDebtUsd: null,
    kaminoLtv: null,
    kaminoAvgPriceUsdc: null,
    kaminoTargetPriceUsdc: null,
    kaminoCycleCount: 0,
    kaminoCycleOpenedAt: null,
    kaminoLastError: null,
    kaminoCollaterals: [],
    kaminoSimulated: false,
    kaminoSimulatedAt: null,
    kaminoLastAction: null,
    kaminoLastActionAt: null,
    kaminoOwnerPoolId: null,
    kaminoOwnerPoolName: null,
    kaminoMarketAddress: null,
    kaminoHealth: null,
    positionEntrySource: null,
    eventPositionEntrySource: null,
    ...overrides
  };
}

function createRunner() {
  let status = createStatus({
    lastAction: "kamino-close",
    positionMint: "mint-1"
  });
  const bot = {
    closeKaminoCycleNow: vi.fn(async () => ({ ok: true, status })),
    addLiquidityFromWallet: vi.fn(async () => ({ ok: true })),
    getStatus: vi.fn(() => status),
    getKaminoState: vi.fn(() => null),
    drainHistoryActions: vi.fn(() => []),
    drainKaminoLogs: vi.fn(() => []),
    setError: vi.fn(),
    setPoolMeta: vi.fn(),
    resetKaminoCycle: vi.fn()
  } as any;
  const onAutoAddRequest = vi.fn();
  const historyStore = {
    load: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined)
  };
  const runner = new BotRunner(bot, {
    hedgeEnabled: false,
    bybitApiKey: null,
    bybitApiSecret: null,
    bybitBaseUrl: "https://api.bybit.com",
    bybitRecvWindow: 5000,
    hedgePct: 50,
    hedgeSymbol: "BTCUSDT",
    hedgeLeverage: 3,
    historyMaxEvents: 200,
    pollIntervalMs: 1000,
    autoAddLiquidityEnabled: true
  } as any, {
    historyStore,
    poolId: "pool-1",
    poolName: "Pool 1",
    onAutoAddRequest
  });
  return { runner, bot, onAutoAddRequest, setStatus: (next: Partial<BotStatus>) => { status = { ...status, ...next }; } };
}

describe("runner auto-add after kamino close", () => {
  it("requests a fresh auto-add after kamino-close", async () => {
    const { runner, onAutoAddRequest } = createRunner();
    (runner as any).autoAddRequestedByMint.add("mint-1");

    const result = await runner.closeKaminoCycleNow();

    expect(result.ok).toBe(true);
    expect(onAutoAddRequest).toHaveBeenCalledWith("pool-1");
    expect((runner as any).autoAddRequestedByMint.has("mint-1")).toBe(true);
  });

  it("enforces the minimum usd threshold on automatic add-liquidity calls", async () => {
    const { runner, bot } = createRunner();

    const result = await runner.autoAddLiquidity({});

    expect(result.ok).toBe(true);
    expect(bot.addLiquidityFromWallet).toHaveBeenCalledWith({ enforceMinUsd: true });
  });
});
