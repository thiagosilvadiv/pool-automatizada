import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { fileURLToPath } from "url";

import { Config } from "./config.js";
import { buildConnection, buildWallet, loadKeypair } from "./solana.js";
import { logger } from "./logger.js";
import { PoolManager } from "./pool-manager.js";
import { getTrendSeries } from "./trend.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startServer(config: Config): Promise<void> {
  const app = express();
  const port = Number(process.env.PORT ?? 3000);
  app.use(express.json());

  const uiUser = process.env.UI_USER ?? null;
  const uiPass = process.env.UI_PASS ?? process.env.UI_PASSWORD ?? null;
  const authEnabled = Boolean(uiUser && uiPass);

  if (authEnabled) {
    logger.info("UI auth enabled");
    app.use((req: Request, res: Response, next: NextFunction) => {
      const header = req.headers.authorization;
      if (!header || !header.startsWith("Basic ")) {
        res.setHeader("WWW-Authenticate", "Basic realm=\"Orca Liquidity Bot\"");
        res.status(401).send("Authentication required");
        return;
      }
      const encoded = header.slice("Basic ".length).trim();
      let decoded = "";
      try {
        decoded = Buffer.from(encoded, "base64").toString("utf8");
      } catch {
        res.status(401).send("Invalid credentials");
        return;
      }
      const sep = decoded.indexOf(":");
      const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const pass = sep >= 0 ? decoded.slice(sep + 1) : "";
      if (user === uiUser && pass === uiPass) {
        next();
        return;
      }
      res.setHeader("WWW-Authenticate", "Basic realm=\"Orca Liquidity Bot\"");
      res.status(401).send("Invalid credentials");
    });
  }

  const connection = buildConnection(config.rpcUrl);
  const keypair = loadKeypair();
  const wallet = buildWallet(keypair);

  logger.info({ wallet: wallet.publicKey.toBase58(), network: config.network }, "bot starting (UI mode)");

  const poolManager = new PoolManager(config, connection, wallet);
  await poolManager.init();
  poolManager.startAutoCloseEmptyAccounts();

  app.get("/api/status", (_req: Request, res: Response) => {
    const status = poolManager.getSelectedStatus();
    if (!status) {
      res.json({
        running: false,
        lastAction: "no-pool",
        lastError: null,
        lastPrice: null,
        hedgeActive: false,
        hedgeSymbol: null,
        hedgeNotionalUsd: null,
        hedgeLeverage: null,
        hedgeOpenedAt: null
      });
      return;
    }
    res.json(status);
  });

  app.post("/api/start", async (_req: Request, res: Response) => {
    try {
      await poolManager.startSelected();
      res.json({ ok: true, status: poolManager.getSelectedStatus() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/stop", (_req: Request, res: Response) => {
    try {
      poolManager.stopSelected();
      res.json({ ok: true, status: poolManager.getSelectedStatus() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/close-position", async (_req: Request, res: Response) => {
    try {
      await poolManager.closeSelected();
      res.json({ ok: true, status: poolManager.getSelectedStatus() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/sol-topup", async (_req: Request, res: Response) => {
    try {
      const result = await poolManager.topUpSolSelected();
      res.json({ ok: result.ok, reason: result.reason, status: poolManager.getSelectedStatus() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/close-empty-accounts", async (_req: Request, res: Response) => {
    try {
      const result = await poolManager.closeEmptyTokenAccounts();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/swap-wallet-to-sol", async (_req: Request, res: Response) => {
    try {
      const result = await poolManager.swapWalletToSolSelected();
      res.json(result);
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/swap-allowlist", (_req: Request, res: Response) => {
    res.json(poolManager.getSwapAllowlist());
  });

  app.put("/api/swap-allowlist", async (req: Request, res: Response) => {
    try {
      const raw = req.body?.mints;
      if (!Array.isArray(raw)) {
        res.status(400).json({ ok: false, error: "mints must be an array" });
        return;
      }
      const result = await poolManager.setSwapAllowlist(raw.map((item) => String(item)));
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/config", (_req: Request, res: Response) => {
    const selectedId = poolManager.getSelectedPoolId();
    const selected = poolManager.listPools().find((entry) => entry.id === selectedId) ?? null;
    const selectedStatus = poolManager.getSelectedStatus();
    res.json({
      network: config.network,
      whirlpoolAddress: selected?.whirlpoolAddress ?? null,
      poolName: selected?.name ?? null,
      selectedPoolId: selectedId,
      rangeWidthPct: config.rangeWidthPct,
      rangeExitBiasPct: config.rangeExitBiasPct,
      preferredExitToken: config.preferredExitToken,
      slippageBps: config.slippageBps,
      pollIntervalMs: config.pollIntervalMs,
      outOfRangeConfirmSec: config.outOfRangeConfirmSec,
      rebalanceCooldownSec: config.rebalanceCooldownSec,
      dryRun: config.dryRun,
      minSolBalance: config.minSolBalance,
      budgetUsd: config.budgetUsd,
      pythSolUsdFeedId: config.pythSolUsdFeedId,
      priceStaleMaxSec: config.priceStaleMaxSec,
      trendEnabled: config.trendEnabled,
      trendTimeframe: config.trendTimeframe,
      trendTargetUp: config.trendTargetUp,
      trendTargetDown: config.trendTargetDown,
      trendFallback: config.trendFallback,
      trendStaleSec: config.trendStaleSec,
      trendNetworkId: config.trendNetworkId,
      hedgeEnabled: config.hedgeEnabled,
      hedgePct: config.hedgePct,
      hedgeSymbol: config.hedgeSymbol,
      hedgeLeverage: config.hedgeLeverage,
      tokenAMint: selectedStatus?.tokenAMint ?? null,
      tokenBMint: selectedStatus?.tokenBMint ?? null,
      isTokenASol: selectedStatus?.isTokenASol ?? null,
      isTokenBSol: selectedStatus?.isTokenBSol ?? null
    });
  });

  app.get("/api/pools", async (_req: Request, res: Response) => {
    const pools = await poolManager.listSummaries();
    res.json({
      selectedPoolId: poolManager.getSelectedPoolId(),
      pools
    });
  });

  app.get("/api/trend-series/:id", async (req: Request, res: Response) => {
    try {
      const rawId = String(req.params.id ?? "").trim();
      const poolId = rawId === "selected" ? poolManager.getSelectedPoolId() : rawId;
      if (!poolId) {
        res.status(404).json({ error: "Pool not found" });
        return;
      }
      const config = poolManager.getPoolConfig(poolId);
      if (!config) {
        res.status(404).json({ error: "Pool not found" });
        return;
      }
      const force = String(req.query.force ?? "").toLowerCase();
      const bypassCache = force === "1" || force === "true" || force === "yes";
      const series = await getTrendSeries({
        networkId: config.trendNetworkId,
        poolAddress: config.whirlpoolAddress,
        timeframe: config.trendTimeframe,
        staleSec: config.trendStaleSec,
        cacheSec: config.trendCacheSec,
        bypassCache,
        limit: 240
      });
      res.json({ ok: true, poolId, series });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/pools", async (req: Request, res: Response) => {
    try {
      const { name, whirlpoolAddress, overrides } = req.body ?? {};
      const entry = await poolManager.addPool(
        String(name ?? ""),
        String(whirlpoolAddress ?? ""),
        overrides ?? undefined
      );
      res.json({ ok: true, entry });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/pools/:id/select", async (req: Request, res: Response) => {
    try {
      await poolManager.selectPool(req.params.id);
      res.json({ ok: true, selectedPoolId: poolManager.getSelectedPoolId() });
    } catch (err) {
      res.status(404).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/pools/:id/start", async (req: Request, res: Response) => {
    try {
      await poolManager.startPool(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/pools/:id/stop", (req: Request, res: Response) => {
    try {
      poolManager.stopPool(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/pools/:id/close", async (req: Request, res: Response) => {
    try {
      await poolManager.closePool(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete("/api/pools/:id", async (req: Request, res: Response) => {
    try {
      await poolManager.removePool(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch("/api/pools/:id", async (req: Request, res: Response) => {
    try {
      const { overrides } = req.body ?? {};
      if (!overrides || typeof overrides !== "object") {
        res.status(400).json({ ok: false, error: "overrides is required" });
        return;
      }
      const entry = await poolManager.updatePoolOverrides(req.params.id, overrides);
      res.json({ ok: true, entry });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/results", async (_req: Request, res: Response) => {
    res.json(await poolManager.listSummaries());
  });

  app.get("/api/history", (_req: Request, res: Response) => {
    res.json(poolManager.getSelectedHistory());
  });

  app.get("/api/history/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    if (!poolManager.hasPool(id)) {
      res.status(404).json({ ok: false, error: "Pool not found" });
      return;
    }
    res.json(poolManager.getHistory(id));
  });

  app.post("/api/history/delete", async (req: Request, res: Response) => {
    try {
      if (!poolManager.getSelectedPoolId()) {
        res.status(400).json({ ok: false, error: "No pool selected" });
        return;
      }
      const ids: string[] = Array.isArray(req.body?.ids)
        ? (req.body.ids as unknown[]).map((id) => String(id))
        : [];
      const filtered = ids.filter((id) => id.trim().length > 0);
      if (!filtered.length) {
        res.status(400).json({ ok: false, error: "ids is required" });
        return;
      }
      await poolManager.deleteSelectedHistoryEvents(filtered);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/history/clear", async (_req: Request, res: Response) => {
    await poolManager.clearSelectedHistory();
    res.json({ ok: true });
  });

  const publicDir = path.join(__dirname, "..", "public");
  app.use(express.static(publicDir));

  app.listen(port, () => {
    logger.info({ port }, "UI server started");
  });
}
