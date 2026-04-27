import { describe, expect, it, vi } from "vitest";

import { OrcaBot } from "../src/orca.js";

function createBot() {
  const bot = Object.create(OrcaBot.prototype) as any;
  bot.config = {
    kaminoIncludePoolLossInTarget: false,
    kaminoPriceBufferPct: 0.5
  };
  bot.lastStatus = {
    positionPnlUsd: null,
    kaminoCollaterals: []
  };
  bot.kaminoState = null;
  bot.kaminoMissingCount = 0;
  bot.kaminoMissingSince = null;
  bot.queueKaminoLog = vi.fn();
  bot.releaseKaminoLockIfOwned = vi.fn();
  bot.isKaminoAutoCloseSuppressed = vi.fn(() => false);
  bot.closeKaminoCycle = vi.fn();
  bot.getKaminoMarketAddress = vi.fn(() => "market-1");
  bot.tryPriceCollateral = vi.fn(async (_mint: string, amount: number) => amount * 100);
  bot.setKaminoState = function setKaminoState(state: any) {
    this.kaminoState = (OrcaBot.prototype as any).normalizeKaminoState.call(this, state);
  };
  return bot;
}

describe("kamino reconciliation", () => {
  it("normalizes collateral debtUsd from debtAmount when local debt changes", () => {
    const bot = createBot();

    const normalized = (OrcaBot.prototype as any).normalizeKaminoState.call(bot, {
      active: true,
      ownerPoolId: "pool-1",
      ownerPoolName: "Pool 1",
      marketAddress: "market-1",
      collateralMint: "SOL",
      collateralAmount: 1.213,
      collateralUsd: 121.3,
      debtMint: "USDC",
      debtAmount: 84.91,
      debtUsd: 77.34,
      avgPriceUsdc: 100,
      targetPriceUsdc: 100.5,
      collaterals: [{
        mint: "SOL",
        amount: 1.213,
        usd: 121.3,
        debtUsd: 77.34,
        avgPriceUsdc: 100,
        targetPriceUsdc: 100.5
      }],
      cycleCount: 1,
      updatedAt: new Date().toISOString()
    });

    expect(normalized.debtUsd).toBeCloseTo(84.91, 8);
    expect(normalized.collaterals[0].debtUsd).toBeCloseTo(84.91, 8);
  });

  it("reconciles upward when on-chain debt increases after a manual borrow", async () => {
    const bot = createBot();
    bot.kaminoState = {
      active: true,
      ownerPoolId: "pool-1",
      ownerPoolName: "Pool 1",
      marketAddress: "market-1",
      collateralMint: "SOL",
      collateralAmount: 1.213,
      collateralUsd: 121.3,
      debtMint: "USDC",
      debtAmount: 77.34,
      debtUsd: 77.34,
      avgPriceUsdc: 100,
      targetPriceUsdc: 100.5,
      collaterals: [{
        mint: "SOL",
        amount: 1.213,
        usd: 121.3,
        debtUsd: 77.34,
        avgPriceUsdc: 100,
        targetPriceUsdc: 100.5
      }],
      cycleCount: 1,
      updatedAt: new Date().toISOString()
    };
    bot.ensureKaminoClient = vi.fn(async () => ({
      invalidatePositionCache: vi.fn(),
      getPositionState: vi.fn(async () => ({
        collateralMint: "SOL",
        collateralAmount: 1.213,
        debtMint: "USDC",
        debtAmount: 84.91,
        ltv: 84.91 / 121.3,
        deposits: [{ mint: "SOL", amount: 1.213 }],
        borrows: [{ mint: "USDC", amount: 84.91 }]
      }))
    }));

    await (OrcaBot.prototype as any).reconcileKaminoState.call(bot);

    expect(bot.kaminoState.debtAmount).toBeCloseTo(84.91, 8);
    expect(bot.kaminoState.debtUsd).toBeCloseTo(84.91, 8);
    expect(bot.kaminoState.collaterals[0].debtUsd).toBeCloseTo(84.91, 8);
    expect(bot.queueKaminoLog).toHaveBeenCalledWith(
      "reconcile",
      "Estado Kamino reconciliado com on-chain.",
      "warn"
    );
  });
});
