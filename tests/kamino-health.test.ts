import { describe, expect, it } from "vitest";
import { KaminoHealthMonitor } from "../src/kamino-health.js";
import type { KaminoCycleState } from "../src/kamino-types.js";

function createActiveState(): KaminoCycleState {
  return {
    active: true,
    ownerPoolId: "pool-1",
    ownerPoolName: "Pool 1",
    marketAddress: "market-1",
    collateralMint: "mint-a",
    collateralAmount: 1,
    collateralUsd: 100,
    debtMint: "mint-usdc",
    debtAmount: 50,
    debtUsd: 50,
    avgPriceUsdc: 100,
    targetPriceUsdc: 101,
    collaterals: [],
    cycleCount: 1,
    updatedAt: new Date().toISOString()
  };
}

describe("kamino health monitor", () => {
  it("flags an active cycle as stuck after 30min without progress", () => {
    const monitor = new KaminoHealthMonitor();
    (monitor as any).lastProgressAt = Date.now() - (31 * 60 * 1000);

    expect(monitor.isStuck(createActiveState())).toBe(true);
  });

  it("does not flag a healthy active cycle as stuck while the pool is open", () => {
    const monitor = new KaminoHealthMonitor();
    (monitor as any).lastProgressAt = Date.now() - (31 * 60 * 1000);

    expect(monitor.isStuck(createActiveState(), { hasOpenPosition: true })).toBe(false);
    expect(monitor.diagnose(createActiveState(), { hasOpenPosition: true })).not.toContain(
      "CICLO_PRESO: Kamino ativo hÃ¡ mais de 30min sem progresso."
    );
  });
});
