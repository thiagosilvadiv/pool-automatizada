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

function createBot(status: BotStatus = createStatus()) {
  let currentStatus = status;
  return {
    tick: vi.fn(async () => currentStatus),
    rebalanceActivePosition: vi.fn(async () => currentStatus),
    getStatus: vi.fn(() => currentStatus),
    setStatus(next: Partial<BotStatus>) {
      currentStatus = { ...currentStatus, ...next };
    },
    drainHistoryActions: vi.fn(() => []),
    drainKaminoLogs: vi.fn(() => []),
    setPositionEntryUsd: vi.fn(),
    setKaminoState: vi.fn(),
    getKaminoState: vi.fn(() => null),
    resetPositionAnchorsOnResume: vi.fn(),
    setError: vi.fn(),
    setPoolMeta: vi.fn(),
    clearKaminoAutoCloseHold: vi.fn()
  } as any;
}

function createHistoryStore(payload: unknown = null) {
  return {
    load: vi.fn(async () => payload),
    save: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined)
  };
}

function createRunner(payload: unknown = null) {
  const bot = createBot();
  const historyStore = createHistoryStore(payload);
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
    poolId: "pool-1",
    poolName: "Pool 1"
  });
  return { bot, historyStore, runner };
}

describe("runner history hedge close", () => {
  it("keeps the runner active after a manual rebalance request", async () => {
    const { bot, runner } = createRunner();

    (runner as any).running = true;
    bot.setStatus({
      running: true,
      lastAction: "rebalanced",
      positionMint: "mint-1",
      eventPositionMint: "mint-0",
      eventPositionExitUsd: 95
    });

    const status = await runner.rebalancePositionNow();

    expect(bot.rebalanceActivePosition).toHaveBeenCalledTimes(1);
    expect((runner as any).running).toBe(true);
    expect(status.running).toBe(true);
  });

  it("prefers the explicit hedgeClose passed to recordEvent for close-position history", () => {
    const { runner } = createRunner();

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

  it("reuses the last trusted entry on close even when the current snapshot is reconstructed", () => {
    const { runner } = createRunner();

    (runner as any).recordEvent(createStatus({
      lastAction: "open-position",
      positionMint: "mint-1",
      positionEntryUsd: 100,
      positionEntrySource: "deposit"
    }));

    (runner as any).recordEvent(createStatus({
      lastAction: "close-position",
      eventPositionMint: "mint-1",
      eventPositionEntryUsd: 105,
      eventPositionEntrySource: "reconstructed",
      eventPositionExitUsd: 110
    }));

    const [closeEvent] = runner.getHistory();
    expect(closeEvent.action).toBe("close-position");
    expect(closeEvent.positionEntryUsd).toBe(100);
    expect(closeEvent.positionEntrySource).toBe("deposit");
    expect(closeEvent.positionPnlUsd).toBe(10);
  });

  it("backfills legacy close events from a trusted earlier entry in history", async () => {
    const { historyStore, runner } = createRunner({
      history: [
        {
          id: "open-1",
          timestamp: "2026-04-08T21:48:00.000Z",
          positionOpenedAt: "2026-04-08T21:48:00.000Z",
          positionClosedAt: null,
          actionType: "abertura",
          action: "open-position",
          trendDirection: null,
          price: 48.44,
          solUsdPrice: 100,
          budgetUsd: 50,
          budgetSol: 0.5,
          targetRange: null,
          positionRange: null,
          positionMint: "mint-legacy",
          tokenABalance: null,
          tokenBBalance: null,
          positionTokenA: null,
          positionTokenB: null,
          openTokenA: null,
          openTokenB: null,
          closeTokenA: null,
          closeTokenB: null,
          positionEntrySource: "deposit",
          positionEntryUsd: 79.53,
          positionFeesUsd: null,
          positionPnlUsd: null,
          positionExitUsd: null,
          txFeeLamports: null,
          txFeeUsd: null,
          portfolioValue: null,
          pnl: null,
          portfolioUsd: 80,
          pnlUsd: null,
          pnlDelta: null,
          pnlDeltaUsd: null,
          hedgeSymbol: null,
          hedgeNotionalUsd: null,
          hedgeLeverage: null,
          hedgeFeesUsd: null,
          hedgePnlUsd: null,
          hedgeDecision: null,
          hedgeDecisionReason: null,
          kaminoLoanPnlUsd: null,
          kaminoCollateralAvgPriceUsdc: null,
          kaminoCollateralTargetPriceUsdc: null,
          kaminoDebtUsd: null,
          kaminoCollateralUsd: null,
          kaminoCycleOpenedAt: null
        },
        {
          id: "close-1",
          timestamp: "2026-04-09T07:51:00.000Z",
          positionOpenedAt: "2026-04-08T21:48:00.000Z",
          positionClosedAt: "2026-04-09T07:51:00.000Z",
          actionType: "fechamento",
          action: "close-position",
          trendDirection: null,
          price: 48.52,
          solUsdPrice: 100,
          budgetUsd: 50,
          budgetSol: 0.5,
          targetRange: null,
          positionRange: null,
          positionMint: "mint-legacy",
          tokenABalance: null,
          tokenBBalance: null,
          positionTokenA: null,
          positionTokenB: null,
          openTokenA: null,
          openTokenB: null,
          closeTokenA: null,
          closeTokenB: null,
          positionEntrySource: "reconstructed",
          positionEntryUsd: null,
          positionFeesUsd: null,
          positionPnlUsd: null,
          positionExitUsd: 79.01,
          txFeeLamports: null,
          txFeeUsd: 0.02,
          portfolioValue: null,
          pnl: null,
          portfolioUsd: 79.01,
          pnlUsd: null,
          pnlDelta: null,
          pnlDeltaUsd: null,
          hedgeSymbol: null,
          hedgeNotionalUsd: null,
          hedgeLeverage: null,
          hedgeFeesUsd: null,
          hedgePnlUsd: null,
          hedgeDecision: null,
          hedgeDecisionReason: null,
          kaminoLoanPnlUsd: null,
          kaminoCollateralAvgPriceUsdc: null,
          kaminoCollateralTargetPriceUsdc: null,
          kaminoDebtUsd: null,
          kaminoCollateralUsd: null,
          kaminoCycleOpenedAt: null
        }
      ]
    });

    await (runner as any).loadHistoryIfNeeded();

    const [closeEvent] = runner.getHistory();
    expect(closeEvent.positionEntryUsd).toBe(79.53);
    expect(closeEvent.positionEntrySource).toBe("deposit");
    expect(closeEvent.positionPnlUsd).toBeCloseTo(-0.54, 6);
    expect(historyStore.save).toHaveBeenCalled();
  });

  it("keeps reconstructed close entry when there is no trusted deposit entry", async () => {
    const { runner } = createRunner({
      history: [
        {
          id: "resume-1",
          timestamp: "2026-04-08T21:48:00.000Z",
          positionOpenedAt: "2026-04-08T21:48:00.000Z",
          positionClosedAt: null,
          actionType: "monitorando",
          action: "resume-position",
          trendDirection: null,
          price: 48.44,
          solUsdPrice: 100,
          budgetUsd: 50,
          budgetSol: 0.5,
          targetRange: null,
          positionRange: null,
          positionMint: "mint-reconstructed",
          tokenABalance: null,
          tokenBBalance: null,
          positionTokenA: null,
          positionTokenB: null,
          openTokenA: null,
          openTokenB: null,
          closeTokenA: null,
          closeTokenB: null,
          positionEntrySource: "reconstructed",
          positionEntryUsd: 78.54,
          positionFeesUsd: null,
          positionPnlUsd: null,
          positionExitUsd: null,
          txFeeLamports: null,
          txFeeUsd: null,
          portfolioValue: null,
          pnl: null,
          portfolioUsd: 78.54,
          pnlUsd: null,
          pnlDelta: null,
          pnlDeltaUsd: null,
          hedgeSymbol: null,
          hedgeNotionalUsd: null,
          hedgeLeverage: null,
          hedgeFeesUsd: null,
          hedgePnlUsd: null,
          hedgeDecision: null,
          hedgeDecisionReason: null,
          kaminoLoanPnlUsd: null,
          kaminoCollateralAvgPriceUsdc: null,
          kaminoCollateralTargetPriceUsdc: null,
          kaminoDebtUsd: null,
          kaminoCollateralUsd: null,
          kaminoCycleOpenedAt: null
        },
        {
          id: "close-2",
          timestamp: "2026-04-09T07:51:00.000Z",
          positionOpenedAt: "2026-04-08T21:48:00.000Z",
          positionClosedAt: "2026-04-09T07:51:00.000Z",
          actionType: "fechamento",
          action: "close-position",
          trendDirection: null,
          price: 48.52,
          solUsdPrice: 100,
          budgetUsd: 50,
          budgetSol: 0.5,
          targetRange: null,
          positionRange: null,
          positionMint: "mint-reconstructed",
          tokenABalance: null,
          tokenBBalance: null,
          positionTokenA: null,
          positionTokenB: null,
          openTokenA: null,
          openTokenB: null,
          closeTokenA: null,
          closeTokenB: null,
          positionEntrySource: "reconstructed",
          positionEntryUsd: null,
          positionFeesUsd: null,
          positionPnlUsd: null,
          positionExitUsd: 79.01,
          txFeeLamports: null,
          txFeeUsd: 0.02,
          portfolioValue: null,
          pnl: null,
          portfolioUsd: 79.01,
          pnlUsd: null,
          pnlDelta: null,
          pnlDeltaUsd: null,
          hedgeSymbol: null,
          hedgeNotionalUsd: null,
          hedgeLeverage: null,
          hedgeFeesUsd: null,
          hedgePnlUsd: null,
          hedgeDecision: null,
          hedgeDecisionReason: null,
          kaminoLoanPnlUsd: null,
          kaminoCollateralAvgPriceUsdc: null,
          kaminoCollateralTargetPriceUsdc: null,
          kaminoDebtUsd: null,
          kaminoCollateralUsd: null,
          kaminoCycleOpenedAt: null
        }
      ]
    });

    await (runner as any).loadHistoryIfNeeded();

    const [closeEvent] = runner.getHistory();
    expect(closeEvent.positionEntryUsd).toBe(78.54);
    expect(closeEvent.positionEntrySource).toBe("reconstructed");
    expect(closeEvent.positionPnlUsd).toBeCloseTo(0.45, 6);
  });

  it("merges legacy kamino-close duplicates when only one row has the real exit", () => {
    const { runner } = createRunner();

    const genericClose = {
      id: "kamino-close-generic",
      timestamp: "2026-04-09T12:35:00.000Z",
      positionOpenedAt: "2026-04-09T11:22:00.000Z",
      positionClosedAt: "2026-04-09T12:35:00.000Z",
      actionType: "fechamento-emprestimo",
      action: "kamino-close",
      positionEntryUsd: 71.33,
      positionExitUsd: null,
      positionPnlUsd: -71.33,
      positionFeesUsd: 0.1,
      txFeeLamports: null,
      txFeeUsd: 0.015323,
      kaminoLoanPnlUsd: -71.33,
      kaminoDebtUsd: 0,
      kaminoCollateralUsd: 71.33,
      kaminoCycleOpenedAt: "2026-04-09T11:22:00.000Z"
    } as any;

    const detailedClose = {
      ...genericClose,
      id: "kamino-close-detailed",
      timestamp: "2026-04-09T12:35:30.000Z",
      positionEntryUsd: 24.04,
      positionExitUsd: 24.49,
      positionPnlUsd: 0.45,
      kaminoLoanPnlUsd: 0.45,
      kaminoCollateralUsd: 24.49
    } as any;

    const merged = (runner as any).mergeSparseKaminoCloseHistory([genericClose, detailedClose]);

    expect(merged.mutated).toBe(true);
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]?.positionEntryUsd).toBe(24.04);
    expect(merged.items[0]?.positionExitUsd).toBe(24.49);
    expect(merged.items[0]?.positionPnlUsd).toBe(0.45);
  });

  it("does not duplicate kamino-close when a detailed queued event already exists", async () => {
    const status = createStatus({
      lastAction: "kamino-close",
      kaminoCycleOpenedAt: "2026-04-09T11:22:00.000Z",
      kaminoCollateralUsd: 71.33,
      kaminoDebtUsd: 0,
      positionEntryUsd: 71.33,
      positionPnlUsd: -71.33
    });
    const { bot, runner } = createRunner();
    bot.setStatus(status);
    bot.drainHistoryActions.mockReturnValue([
      createStatus({
        lastAction: "kamino-repay",
        kaminoCycleOpenedAt: "2026-04-09T11:22:00.000Z"
      }),
      createStatus({
        lastAction: "kamino-withdraw",
        kaminoCycleOpenedAt: "2026-04-09T11:22:00.000Z"
      }),
      createStatus({
        lastAction: "kamino-close",
        kaminoCycleOpenedAt: "2026-04-09T11:22:00.000Z",
        kaminoCollateralUsd: 24.49,
        kaminoDebtUsd: 0,
        positionEntryUsd: 24.04,
        positionExitUsd: 24.49,
        positionPnlUsd: 0.45
      })
    ]);

    await (runner as any).tickOnce();

    const history = runner.getHistory();
    const closeEvents = history.filter((item) => item.action === "kamino-close");
    expect(closeEvents).toHaveLength(1);
    expect(closeEvents[0]?.positionEntryUsd).toBe(24.04);
    expect(closeEvents[0]?.positionExitUsd).toBe(24.49);
  });
});
