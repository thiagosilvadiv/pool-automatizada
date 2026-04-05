import { describe, expect, it, vi } from "vitest";
import { OrcaBot } from "../src/orca.js";

// Mock createKaminoClient to avoid RPC/network usage.
vi.mock("../src/kamino-client.js", () => {
  return {
    createKaminoClient: vi.fn(async (_ctx, market: string) => {
      const isBad = market === "bad";
      return {
        supportsCollateral: async (mint: string) => !isBad && mint !== "UNSUPPORTED",
        supportsBorrow: async (_mint: string) =>
          isBad ? { ok: false, reason: "unsupported" } : { ok: true },
        getPositionState: async () =>
          isBad
            ? null
            : {
                collateralMint: "SOL",
                collateralAmount: 1,
                debtMint: null,
                debtAmount: 0,
                ltv: null
              }
      };
    })
  };
});

describe("buildCompatibleKaminoClients", () => {
  it("filters out incompatible markets and keeps a compatible one", async () => {
    const bot = Object.create(OrcaBot.prototype) as any;
    bot.connection = {} as any;
    bot.wallet = {} as any;
    bot.config = { kaminoMarketAddress: null };
    bot.kaminoMarketCandidates = null;
    bot.queueKaminoLog = vi.fn();
    bot.pendingKaminoLogs = [];
    bot.kaminoState = { marketAddress: "bad" };
    bot.poolState = {
      tokenMintA: { toBase58: () => "SOL" },
      tokenMintB: { toBase58: () => "USDC" }
    };

    const result: Map<string, unknown> = await (bot as any).buildCompatibleKaminoClients();
    const markets = Array.from(result.keys());
    expect(markets).not.toContain("bad");
    expect(markets.length).toBeGreaterThan(0);
  });
});
