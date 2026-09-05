import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

const baseConfig = {
  rpcUrl: "http://localhost:8899",
  whirlpoolAddress: "So11111111111111111111111111111111111111112",
  rangeWidthPct: 1
};

const originalEnv = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

function loadWith(overrides: Record<string, unknown>) {
  process.env.CONFIG_JSON = JSON.stringify({ ...baseConfig, ...overrides });
  return loadConfig();
}

describe("config", () => {
  beforeEach(() => {
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
  });

  it("defaults idlePositionScanIntervalSec", () => {
    expect(loadWith({}).idlePositionScanIntervalSec).toBe(180);
  });

  it("accepts 0 to disable the idle position scan", () => {
    expect(loadWith({ idlePositionScanIntervalSec: 0 }).idlePositionScanIntervalSec).toBe(0);
  });

  it("rejects an idle position scan interval below 60s", () => {
    // Cada varredura lista os token accounts da carteira; abaixo disso vira
    // pressao desnecessaria no RPC.
    expect(() => loadWith({ idlePositionScanIntervalSec: 30 })).toThrow();
  });

  it("applies IDLE_POSITION_SCAN_INTERVAL_SEC env override", () => {
    process.env.IDLE_POSITION_SCAN_INTERVAL_SEC = "600";
    expect(loadWith({}).idlePositionScanIntervalSec).toBe(600);
  });

  it("accepts rangeExitBiasPct bounds", () => {
    expect(() => loadWith({ rangeExitBiasPct: 0 })).not.toThrow();
    expect(() => loadWith({ rangeExitBiasPct: 99.9 })).not.toThrow();
  });

  it("rejects invalid rangeExitBiasPct", () => {
    expect(() => loadWith({ rangeExitBiasPct: -1 })).toThrow();
    expect(() => loadWith({ rangeExitBiasPct: 100 })).toThrow();
  });

  it("rejects invalid preferredExitToken", () => {
    expect(() => loadWith({ preferredExitToken: "tokenC" })).toThrow();
  });

  it("accepts valid preferredExitDirection", () => {
    expect(() => loadWith({ preferredExitDirection: "down" })).not.toThrow();
    expect(() => loadWith({ preferredExitDirection: "up" })).not.toThrow();
  });

  it("rejects invalid preferredExitDirection", () => {
    expect(() => loadWith({ preferredExitDirection: "sideways" })).toThrow();
  });

  it("applies PREFERRED_EXIT_DIRECTION env override", () => {
    process.env.PREFERRED_EXIT_DIRECTION = "up";
    const config = loadWith({ preferredExitDirection: "down" });
    expect(config.preferredExitDirection).toBe("up");
  });

  it("rejects invalid PREFERRED_EXIT_DIRECTION env value", () => {
    process.env.PREFERRED_EXIT_DIRECTION = "invalid";
    expect(() => loadWith({})).toThrow();
  });

  it("accepts valid trendTimeframe", () => {
    expect(() => loadWith({ trendTimeframe: "1m" })).not.toThrow();
    expect(() => loadWith({ trendTimeframe: "1h" })).not.toThrow();
    expect(() => loadWith({ trendTimeframe: "15m" })).not.toThrow();
  });

  it("rejects invalid trendTimeframe", () => {
    expect(() => loadWith({ trendTimeframe: "2m" })).toThrow();
  });

  it("rejects invalid trendTargetUp", () => {
    expect(() => loadWith({ trendTargetUp: "invalid" })).toThrow();
  });

  it("rejects invalid trendTargetDown", () => {
    expect(() => loadWith({ trendTargetDown: "invalid" })).toThrow();
  });

  it("rejects invalid trendFallback", () => {
    expect(() => loadWith({ trendFallback: "invalid" })).toThrow();
  });

  it("rejects negative trendStaleSec", () => {
    expect(() => loadWith({ trendStaleSec: -1 })).toThrow();
  });

  it("accepts valid trendCacheSec", () => {
    expect(() => loadWith({ trendCacheSec: 0 })).not.toThrow();
    expect(() => loadWith({ trendCacheSec: 60 })).not.toThrow();
  });

  it("rejects invalid trendCacheSec", () => {
    expect(() => loadWith({ trendCacheSec: -1 })).toThrow();
  });

  it("accepts valid hedgePct", () => {
    expect(() => loadWith({ hedgePct: 0 })).not.toThrow();
    expect(() => loadWith({ hedgePct: 50 })).not.toThrow();
    expect(() => loadWith({ hedgePct: 100 })).not.toThrow();
  });

  it("rejects invalid hedgePct", () => {
    expect(() => loadWith({ hedgePct: -1 })).toThrow();
    expect(() => loadWith({ hedgePct: 101 })).toThrow();
  });

  it("rejects invalid hedgeLeverage", () => {
    expect(() => loadWith({ hedgeLeverage: 0 })).toThrow();
  });

  it("accepts valid hedgeMarginPct", () => {
    expect(() => loadWith({ hedgeMarginPct: 0 })).not.toThrow();
    expect(() => loadWith({ hedgeMarginPct: 25 })).not.toThrow();
    expect(() => loadWith({ hedgeMarginPct: 100 })).not.toThrow();
  });

  it("rejects invalid hedgeMarginPct", () => {
    expect(() => loadWith({ hedgeMarginPct: -1 })).toThrow();
    expect(() => loadWith({ hedgeMarginPct: 101 })).toThrow();
  });

  it("accepts openai model defaults", () => {
    expect(() => loadWith({})).not.toThrow();
  });

  it("uses down as default preferredExitDirection", () => {
    const config = loadWith({});
    expect(config.preferredExitDirection).toBe("down");
  });

  it("enables autoResume by default with expected defaults", () => {
    const config = loadWith({});
    expect(config.autoResumeEnabled).toBe(true);
    expect(config.autoResumeMaxAttempts).toBe(5);
    expect(config.autoResumeBaseDelayMs).toBe(5000);
  });

  it("uses 5 minutes as the default auto-add liquidity check interval", () => {
    const config = loadWith({});
    expect(config.autoAddLiquidityCheckIntervalSec).toBe(300);
  });

  it("uses zero as the default auto-add liquidity minimum usd", () => {
    const config = loadWith({});
    expect(config.autoAddLiquidityMinUsd).toBe(0);
  });

  it("rejects invalid autoResume settings", () => {
    expect(() => loadWith({ autoResumeMaxAttempts: 0 })).toThrow();
    expect(() => loadWith({ autoResumeBaseDelayMs: 50 })).toThrow();
  });

  it("rejects invalid auto-add liquidity check interval", () => {
    expect(() => loadWith({ autoAddLiquidityCheckIntervalSec: 30 })).toThrow();
  });

  it("rejects invalid auto-add liquidity minimum usd", () => {
    expect(() => loadWith({ autoAddLiquidityMinUsd: -0.01 })).toThrow();
  });

  it("rejects invalid openaiTimeoutMs", () => {
    expect(() => loadWith({ openaiTimeoutMs: 500 })).toThrow();
  });

  it("accepts valid kamino settings", () => {
    expect(() => loadWith({
      kaminoRebalanceEnabled: true,
      kaminoDepositPct: 50,
      kaminoBorrowAsset: "usdc",
      kaminoMaxLtv: 0.4,
      kaminoCloseRule: "avg-price",
      kaminoPriceBufferPct: 0.5,
      kaminoCollateralMode: "exit",
      kaminoAutoCloseOnTokenChange: true,
      kaminoRepayRetrySec: 10,
      kaminoRepayMaxAttempts: 2
    })).not.toThrow();
    expect(() => loadWith({ kaminoCollateralMode: "both" })).not.toThrow();
  });

  it("defaults kaminoAutoCloseOnTokenChange to false for safety", () => {
    const config = loadWith({});
    expect(config.kaminoAutoCloseOnTokenChange).toBe(false);
  });

  it("defaults Kamino scans to five minutes and includes free wallet balance on reopen", () => {
    const config = loadWith({});
    expect(config.kaminoScanIntervalSec).toBe(300);
    expect(config.kaminoUseWalletBalanceOnReopen).toBe(true);
  });

  it("allows disabling free wallet balance use through env", () => {
    process.env.KAMINO_USE_WALLET_BALANCE_ON_REOPEN = "false";
    const config = loadWith({});
    expect(config.kaminoUseWalletBalanceOnReopen).toBe(false);
  });

  it("allows explicit env override to re-enable legacy token-change close", () => {
    process.env.KAMINO_AUTO_CLOSE_ON_TOKEN_CHANGE = "true";
    const config = loadWith({});
    expect(config.kaminoAutoCloseOnTokenChange).toBe(true);
  });

  it("rejects invalid kamino settings", () => {
    expect(() => loadWith({ kaminoDepositPct: -1 })).toThrow();
    expect(() => loadWith({ kaminoDepositPct: 120 })).toThrow();
    expect(() => loadWith({ kaminoBorrowAsset: "brl" })).toThrow();
    expect(() => loadWith({ kaminoMaxLtv: 2 })).toThrow();
    expect(() => loadWith({ kaminoCloseRule: "later" })).toThrow();
    expect(() => loadWith({ kaminoPriceBufferPct: -0.1 })).toThrow();
    expect(() => loadWith({ kaminoCollateralMode: "maybe" })).toThrow();
    expect(() => loadWith({ kaminoRepayRetrySec: 0 })).toThrow();
    expect(() => loadWith({ kaminoRepayMaxAttempts: -1 })).toThrow();
  });
});
