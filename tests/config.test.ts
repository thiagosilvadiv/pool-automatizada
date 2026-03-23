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
});
