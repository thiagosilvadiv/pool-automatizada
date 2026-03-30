import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiStrategyService, StrategyModelError, computePoolMetrics, resolveModel } from "../src/ai-strategy.js";
import type { Config } from "../src/config.js";
import { loadConfig } from "../src/config.js";
import type { HistoryEvent } from "../src/runner.js";
import type { PoolManager } from "../src/pool-manager.js";

const originalEnv = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

function buildConfig(): Config {
  process.env.CONFIG_JSON = JSON.stringify({
    rpcUrl: "http://localhost:8899",
    whirlpoolAddress: "So11111111111111111111111111111111111111112",
    rangeWidthPct: 1
  });
  process.env.OPENAI_RECOMMENDED_MODELS = "gpt-5.4-mini,gpt-5.4";
  process.env.OPENAI_DEFAULT_MODEL = "gpt-5.4-mini";
  process.env.OPENAI_ALLOW_CUSTOM_MODEL = "true";
  process.env.OPENAI_TIMEOUT_MS = "20000";
  return loadConfig();
}

function createEvent(partial: Partial<HistoryEvent>): HistoryEvent {
  return {
    id: partial.id ?? "evt",
    timestamp: partial.timestamp ?? new Date().toISOString(),
    positionOpenedAt: partial.positionOpenedAt ?? null,
    positionClosedAt: partial.positionClosedAt ?? null,
    actionType: partial.actionType ?? null,
    action: partial.action ?? null,
    trendDirection: partial.trendDirection ?? null,
    price: partial.price ?? null,
    solUsdPrice: partial.solUsdPrice ?? null,
    budgetUsd: partial.budgetUsd ?? null,
    budgetSol: partial.budgetSol ?? null,
    targetRange: partial.targetRange ?? null,
    positionRange: partial.positionRange ?? null,
    positionMint: partial.positionMint ?? null,
    tokenABalance: partial.tokenABalance ?? null,
    tokenBBalance: partial.tokenBBalance ?? null,
    positionTokenA: partial.positionTokenA ?? null,
    positionTokenB: partial.positionTokenB ?? null,
    openTokenA: partial.openTokenA ?? null,
    openTokenB: partial.openTokenB ?? null,
    closeTokenA: partial.closeTokenA ?? null,
    closeTokenB: partial.closeTokenB ?? null,
    positionEntryUsd: partial.positionEntryUsd ?? null,
    positionFeesUsd: partial.positionFeesUsd ?? null,
    positionPnlUsd: partial.positionPnlUsd ?? null,
    positionExitUsd: partial.positionExitUsd ?? null,
    txFeeLamports: partial.txFeeLamports ?? null,
    txFeeUsd: partial.txFeeUsd ?? null,
    portfolioValue: partial.portfolioValue ?? null,
    pnl: partial.pnl ?? null,
    portfolioUsd: partial.portfolioUsd ?? null,
    pnlUsd: partial.pnlUsd ?? null,
    pnlDelta: partial.pnlDelta ?? null,
    pnlDeltaUsd: partial.pnlDeltaUsd ?? null,
    hedgeSymbol: partial.hedgeSymbol ?? null,
    hedgeNotionalUsd: partial.hedgeNotionalUsd ?? null,
    hedgeLeverage: partial.hedgeLeverage ?? null,
    hedgeFeesUsd: partial.hedgeFeesUsd ?? null,
    hedgePnlUsd: partial.hedgePnlUsd ?? null,
    hedgeDecision: partial.hedgeDecision ?? null,
    hedgeDecisionReason: partial.hedgeDecisionReason ?? null
  };
}

describe("ai-strategy", () => {
  beforeEach(() => {
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
  });

  it("validates model against allowlist when custom is disabled", () => {
    const settings = {
      defaultModel: "gpt-5.4-mini",
      recommendedModels: ["gpt-5.4-mini"],
      allowCustomModel: false
    };
    expect(() => resolveModel(settings, "custom-x")).toThrow(StrategyModelError);
  });

  it("accepts custom model when custom is enabled", () => {
    const settings = {
      defaultModel: "gpt-5.4-mini",
      recommendedModels: ["gpt-5.4-mini"],
      allowCustomModel: true
    };
    expect(resolveModel(settings, "custom-x")).toBe("custom-x");
  });

  it("computes deterministic metrics from close events", () => {
    const history: HistoryEvent[] = [
      createEvent({
        id: "1",
        timestamp: "2026-01-01T00:00:00.000Z",
        action: "close-position",
        price: 100,
        positionPnlUsd: 40,
        positionFeesUsd: 5,
        txFeeUsd: 1,
        hedgePnlUsd: 3,
        hedgeDecision: "opened"
      }),
      createEvent({
        id: "2",
        timestamp: "2026-01-02T00:00:00.000Z",
        action: "close-position",
        price: 105,
        positionPnlUsd: -20,
        positionFeesUsd: 5,
        txFeeUsd: 1,
        hedgePnlUsd: 2,
        hedgeDecision: "opened"
      })
    ];
    const metrics = computePoolMetrics(history);
    expect(metrics.closeEvents).toBe(2);
    expect(metrics.winRatePct).toBe(50);
    expect(metrics.realizedPnlUsd).toBe(20);
    expect(metrics.feesUsd).toBe(10);
    expect(metrics.hedgePnlUsd).toBe(5);
  });

  it("applies conservative guardrail to rangeWidthPct recommendation", async () => {
    const config = buildConfig();
    const history: HistoryEvent[] = [
      createEvent({
        id: "a",
        timestamp: "2026-02-01T00:00:00.000Z",
        action: "open-position",
        price: 100
      }),
      createEvent({
        id: "b",
        timestamp: "2026-02-01T12:00:00.000Z",
        action: "rebalanced",
        price: 109,
        positionPnlUsd: -5,
        positionFeesUsd: 2,
        txFeeUsd: 1
      }),
      createEvent({
        id: "c",
        timestamp: "2026-02-02T00:00:00.000Z",
        action: "rebalanced",
        price: 96,
        positionPnlUsd: -8,
        positionFeesUsd: 2,
        txFeeUsd: 1
      }),
      createEvent({
        id: "d",
        timestamp: "2026-02-02T12:00:00.000Z",
        action: "close-position",
        price: 111,
        positionPnlUsd: 12,
        positionFeesUsd: 2,
        txFeeUsd: 1
      })
    ];

    const poolManagerStub = {
      listSummaries: async () => [{
        id: "pool-1",
        name: "SOL/USDC",
        whirlpoolAddress: "So11111111111111111111111111111111111111112",
        createdAt: "2026-02-01T00:00:00.000Z",
        selected: true,
        running: false,
        lastAction: "no-action",
        lastError: null,
        lastPrice: 100,
        positionValueUsd: null,
        positionPnlUsd: null,
        positionValueSol: null,
        positionPnlSol: null,
        tokenAMint: null,
        tokenBMint: null,
        isTokenASol: null,
        isTokenBSol: null,
        trendDirection: null,
        trendUpdatedAt: null,
        trendTimeframe: null,
        trendEnabled: false,
        trendStale: false,
        overrides: null
      }],
      listPools: () => [{
        id: "pool-1",
        name: "SOL/USDC",
        whirlpoolAddress: "So11111111111111111111111111111111111111112",
        createdAt: "2026-02-01T00:00:00.000Z",
        overrides: {}
      }],
      getSelectedPoolId: () => "pool-1",
      getHistory: () => history,
      getHedgeLogs: () => [],
      getStatus: () => null,
      getPoolConfig: () => ({ ...config, rangeWidthPct: 1 })
    } as unknown as PoolManager;

    const service = new AiStrategyService(poolManagerStub, config);
    await service.init();
    const result = await service.runAnalysis({
      scope: "all",
      riskProfile: "defensivo",
      changeBounds: "conservative"
    });
    const rangeRec = result.recommendations.find((item) => item.parameter === "rangeWidthPct");
    expect(rangeRec).toBeTruthy();
    expect(Number(rangeRec?.suggestedValue)).toBeLessThanOrEqual(1.25);
  });
});
