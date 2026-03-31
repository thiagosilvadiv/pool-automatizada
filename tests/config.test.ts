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

  it("accepts valid pnlTargetUsd", () => {
    expect(() => loadWith({ pnlTargetUsd: 0.5 })).not.toThrow();
    expect(() => loadWith({ pnlTargetUsd: 10 })).not.toThrow();
    expect(() => loadWith({ pnlTargetUsd: null })).not.toThrow();
  });

  it("rejects invalid pnlTargetUsd", () => {
    expect(() => loadWith({ pnlTargetUsd: 0 })).toThrow();
    expect(() => loadWith({ pnlTargetUsd: -1 })).toThrow();
  });

  it("accepts valid pnlTargetPct", () => {
    expect(() => loadWith({ pnlTargetPct: 0.1 })).not.toThrow();
    expect(() => loadWith({ pnlTargetPct: 50 })).not.toThrow();
    expect(() => loadWith({ pnlTargetPct: 100 })).not.toThrow();
    expect(() => loadWith({ pnlTargetPct: null })).not.toThrow();
  });

  it("rejects invalid pnlTargetPct", () => {
    expect(() => loadWith({ pnlTargetPct: 0 })).toThrow();
    expect(() => loadWith({ pnlTargetPct: -5 })).toThrow();
    expect(() => loadWith({ pnlTargetPct: 101 })).toThrow();
  });

  it("accepts openai model defaults", () => {
    expect(() => loadWith({})).not.toThrow();
  });

  it("enables autoResume by default with expected defaults", () => {
    const config = loadWith({});
    expect(config.autoResumeEnabled).toBe(true);
    expect(config.autoResumeMaxAttempts).toBe(5);
    expect(config.autoResumeBaseDelayMs).toBe(5000);
  });

  it("rejects invalid autoResume settings", () => {
    expect(() => loadWith({ autoResumeMaxAttempts: 0 })).toThrow();
    expect(() => loadWith({ autoResumeBaseDelayMs: 50 })).toThrow();
  });

  it("rejects invalid openaiTimeoutMs", () => {
    expect(() => loadWith({ openaiTimeoutMs: 500 })).toThrow();
  });
});
