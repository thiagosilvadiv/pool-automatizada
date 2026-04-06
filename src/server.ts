import express, { Request, Response, NextFunction, type Express } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import fs from "fs/promises";

import { Config } from "./config.js";
import { buildConnection, buildWallet, loadKeypair } from "./solana.js";
import { logger } from "./logger.js";
import { PoolManager, type PoolSummary } from "./pool-manager.js";
import type { HistoryEvent } from "./runner.js";
import { createKaminoMarketsStore, type KaminoMarketEntry, type KaminoMarketsState } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORY_EDITABLE_FIELDS = new Set<keyof HistoryEvent>([
  "price",
  "positionEntryUsd",
  "positionFeesUsd",
  "txFeeUsd",
  "positionExitUsd",
  "positionPnlUsd"
]);

function isEditableHistoryField(field: string): field is keyof HistoryEvent {
  return HISTORY_EDITABLE_FIELDS.has(field as keyof HistoryEvent);
}

type PoolSummaryRouteService = Pick<PoolManager, "listSummaries" | "getSelectedPoolId" | "getAutoResumeStatus">;

export function registerPoolsSummaryRoute(app: Express, poolManager: PoolSummaryRouteService): void {
  app.get("/api/pools", async (_req: Request, res: Response) => {
    const timeoutPromise = new Promise<PoolSummary[]>((_, reject) =>
      setTimeout(() => reject(new Error("listSummaries timeout")), 5000)
    );
    let pools: PoolSummary[] = [];
    let error: string | null = null;
    try {
      pools = await Promise.race([poolManager.listSummaries(), timeoutPromise]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    res.json({
      selectedPoolId: poolManager.getSelectedPoolId(),
      autoResume: poolManager.getAutoResumeStatus(),
      pools,
      error: error ?? undefined
    });
  });
}


export async function startServer(config: Config): Promise<void> {
  const app = express();
  const port = Number(process.env.PORT ?? 3000);
  app.use(express.json());

  const clearLocalData = async (options: { clearPools?: boolean } = {}): Promise<void> => {
    const dataDir = path.join(__dirname, "..", "data");
    const targets = ["history.json"];
    if (options.clearPools) {
      targets.push("pools.json");
    }
    for (const file of targets) {
      try {
        await fs.rm(path.join(dataDir, file));
      } catch {}
    }
    try {
      const files = await fs.readdir(dataDir);
      await Promise.all(
        files
          .filter((f) => f.startsWith("history-") && f.endsWith(".json"))
          .map((f) => fs.rm(path.join(dataDir, f)))
      );
    } catch {}
  };

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

  const kaminoMarketsStore = await createKaminoMarketsStore();
  let kaminoMarketsState: KaminoMarketsState = (await kaminoMarketsStore.load()) ?? {
    markets: [],
    updatedAt: null
  };
  poolManager.setKaminoMarkets(kaminoMarketsState.markets);

  const saveKaminoMarketsState = async (next: KaminoMarketsState) => {
    kaminoMarketsState = next;
    await kaminoMarketsStore.save(kaminoMarketsState);
    poolManager.setKaminoMarkets(kaminoMarketsState.markets);
  };

  app.get("/api/status", (_req: Request, res: Response) => {
    const status = poolManager.getSelectedStatus();
    if (!status) {
      res.json({
        running: false,
        lastAction: "no-pool",
        lastError: null,
        lastPrice: null,
        effectiveExitToken: null,
        effectiveExitDirection: config.preferredExitDirection,
        effectiveExitSide: null,
        effectiveValueToken: null,
        kaminoActive: false,
        kaminoEnabled: Boolean(config.kaminoRebalanceEnabled),
        kaminoCollateralUsd: null,
        kaminoDebtUsd: null,
        kaminoLtv: null,
        kaminoAvgPriceUsdc: null,
        kaminoTargetPriceUsdc: null,
        kaminoCycleCount: 0,
        kaminoLastError: null,
        kaminoCollaterals: [],
        kaminoSimulated: Boolean(config.dryRun || process.env.KAMINO_NOOP === "true"),
        kaminoOwnerPoolId: null,
        kaminoOwnerPoolName: null,
        kaminoMarketAddress: null,
        kaminoHealth: {
          stuck: false,
          issues: [],
          consecutiveErrors: 0,
          lastProgressAt: null,
          recentErrors: []
        }
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

  app.post("/api/stop", async (_req: Request, res: Response) => {
    try {
      await poolManager.stopSelected();
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

  app.post("/api/kamino/close", async (_req: Request, res: Response) => {
    try {
      const result = await poolManager.closeKaminoCycleSelected();
      res.json({ ok: result.ok, reason: result.reason, status: poolManager.getSelectedStatus() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/kamino/reset", async (_req: Request, res: Response) => {
    try {
      await poolManager.resetSelectedKaminoCycle();
      res.json({ ok: true, status: poolManager.getSelectedStatus() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Desligar teste/hedge/bybit rotas herdadas
  app.post("/api/kamino/test", (_req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: "disabled" });
  });

  app.post("/api/bybit/order", (_req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: "disabled" });
  });

  // Manter rota kamino/test desabilitada acima
  /* app.post("/api/kamino/test", async (req: Request, res: Response) => {
    try {
      const mint = String(req.body?.collateralMint ?? "").trim();
      const amount = Number(req.body?.collateralAmount);
      const borrowUsdRaw = req.body?.borrowUsd;
      const borrowUsd = borrowUsdRaw == null ? undefined : Number(borrowUsdRaw);

      if (!mint) {
        res.status(400).json({ ok: false, error: "collateralMint is required" });
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({ ok: false, error: "collateralAmount must be > 0" });
        return;
      }
      if (borrowUsd !== undefined && (!Number.isFinite(borrowUsd) || borrowUsd < 0)) {
        res.status(400).json({ ok: false, error: "borrowUsd must be >= 0" });
        return;
      }

      const result = await poolManager.testKaminoSelected({
        collateralMint: mint,
        collateralAmount: amount,
        borrowUsd
      });
      res.json({
        ok: result.ok,
        reason: result.reason,
        depositSig: result.depositSig,
        borrowSig: result.borrowSig,
        status: poolManager.getSelectedStatus()
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }); */

  app.post("/api/reset", async (req: Request, res: Response) => {
    try {
      await poolManager.stopSelected();
      const clearPools = String(req.query?.clearPools ?? "").toLowerCase() === "true";
      await poolManager.resetSelectedKaminoCycle(clearPools);
      await clearLocalData({ clearPools });
      res.json({ ok: true, restarting: false });
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

  app.get("/api/kamino/markets", (_req: Request, res: Response) => {
    res.json(kaminoMarketsState);
  });

  app.get("/api/kamino/loans", (_req: Request, res: Response) => {
    res.json({ loans: poolManager.getKaminoLoans() });
  });

  app.get("/api/pools/:poolId/kamino/health", (req: Request, res: Response) => {
    try {
      const rawId = String(req.params.poolId ?? "").trim();
      const poolId = rawId === "selected" ? poolManager.getSelectedPoolId() : rawId;
      if (!poolId || !poolManager.hasPool(poolId)) {
        res.status(404).json({ error: "Pool not found" });
        return;
      }
      res.json(poolManager.getKaminoHealth(poolId));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/kamino/markets", async (req: Request, res: Response) => {
    try {
      const name = String(req.body?.name ?? "").trim();
      const address = String(req.body?.marketAddress ?? req.body?.address ?? "").trim();
      if (!name) {
        res.status(400).json({ ok: false, error: "name is required" });
        return;
      }
      if (!address) {
        res.status(400).json({ ok: false, error: "marketAddress is required" });
        return;
      }
      if (kaminoMarketsState.markets.some((entry) => entry.address === address)) {
        res.status(400).json({ ok: false, error: "marketAddress already exists" });
        return;
      }
      const now = new Date().toISOString();
      const entry: KaminoMarketEntry = {
        id: randomUUID(),
        name,
        address,
        createdAt: now,
        updatedAt: now
      };
      await saveKaminoMarketsState({
        markets: [...kaminoMarketsState.markets, entry],
        updatedAt: now
      });
      res.json({ ok: true, entry, markets: kaminoMarketsState.markets });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch("/api/kamino/markets/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id ?? "").trim();
      const entry = kaminoMarketsState.markets.find((item) => item.id === id);
      if (!entry) {
        res.status(404).json({ ok: false, error: "market not found" });
        return;
      }
      const nameRaw = req.body?.name;
      const addressRaw = req.body?.marketAddress ?? req.body?.address;
      if (nameRaw == null && addressRaw == null) {
        res.status(400).json({ ok: false, error: "name or marketAddress is required" });
        return;
      }
      const name = nameRaw != null ? String(nameRaw).trim() : entry.name;
      const address = addressRaw != null ? String(addressRaw).trim() : entry.address;
      if (!name) {
        res.status(400).json({ ok: false, error: "name is required" });
        return;
      }
      if (!address) {
        res.status(400).json({ ok: false, error: "marketAddress is required" });
        return;
      }
      if (kaminoMarketsState.markets.some((item) => item.address === address && item.id !== id)) {
        res.status(400).json({ ok: false, error: "marketAddress already exists" });
        return;
      }
      const now = new Date().toISOString();
      const updated: KaminoMarketEntry = { ...entry, name, address, updatedAt: now };
      const markets = kaminoMarketsState.markets.map((item) => item.id === id ? updated : item);
      await saveKaminoMarketsState({ markets, updatedAt: now });
      res.json({ ok: true, entry: updated, markets });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete("/api/kamino/markets/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id ?? "").trim();
      const next = kaminoMarketsState.markets.filter((item) => item.id !== id);
      if (next.length === kaminoMarketsState.markets.length) {
        res.status(404).json({ ok: false, error: "market not found" });
        return;
      }
      const now = new Date().toISOString();
      await saveKaminoMarketsState({ markets: next, updatedAt: now });
      res.json({ ok: true, markets: kaminoMarketsState.markets });
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
      preferredExitDirection: config.preferredExitDirection,
        slippageBps: config.slippageBps,
        pollIntervalMs: config.pollIntervalMs,
        rateLimitCooldownSec: config.rateLimitCooldownSec,
        outOfRangeConfirmSec: config.outOfRangeConfirmSec,
      rebalanceCooldownSec: config.rebalanceCooldownSec,
      dryRun: config.dryRun,
      minSolBalance: config.minSolBalance,
      budgetUsd: config.budgetUsd,
      pythSolUsdFeedId: config.pythSolUsdFeedId,
      priceStaleMaxSec: config.priceStaleMaxSec,
      autoAddLiquidityEnabled: config.autoAddLiquidityEnabled,
      kaminoRebalanceEnabled: config.kaminoRebalanceEnabled,
      kaminoDepositPct: config.kaminoDepositPct,
      kaminoBorrowAsset: config.kaminoBorrowAsset,
      kaminoMarketAddress: config.kaminoMarketAddress,
      kaminoMaxLtv: config.kaminoMaxLtv,
      kaminoCloseRule: config.kaminoCloseRule,
      kaminoPriceBufferPct: config.kaminoPriceBufferPct,
      kaminoMinCombinedPnlUsd: config.kaminoMinCombinedPnlUsd,
      kaminoCollateralMode: config.kaminoCollateralMode,
      kaminoAutoCloseOnTokenChange: config.kaminoAutoCloseOnTokenChange,
      kaminoConvertToCollateral: config.kaminoConvertToCollateral,
      kaminoAvgPriceBasis: config.kaminoAvgPriceBasis,
      kaminoAvgMode: config.kaminoAvgMode,
      tokenAMint: selectedStatus?.tokenAMint ?? null,
      tokenBMint: selectedStatus?.tokenBMint ?? null,
      isTokenASol: selectedStatus?.isTokenASol ?? null,
      isTokenBSol: selectedStatus?.isTokenBSol ?? null
    });
  });

  registerPoolsSummaryRoute(app, poolManager);

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

  app.post("/api/pools/:id/stop", async (req: Request, res: Response) => {
    try {
      await poolManager.stopPool(req.params.id);
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

  app.get("/api/kamino-logs", (_req: Request, res: Response) => {
    res.json(poolManager.getSelectedKaminoLogs());
  });

  app.post("/api/kamino-logs/clear", (_req: Request, res: Response) => {
    poolManager.clearSelectedKaminoLogs();
    res.json({ ok: true });
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

  app.post("/api/history/update", async (req: Request, res: Response) => {
    try {
      if (!poolManager.getSelectedPoolId()) {
        res.status(400).json({ ok: false, error: "No pool selected" });
        return;
      }
      const { id, field, value } = req.body ?? {};
      if (typeof id !== "string" || !id.trim()) {
        res.status(400).json({ ok: false, error: "id is required" });
        return;
      }
      if (typeof field !== "string" || !isEditableHistoryField(field)) {
        res.status(400).json({ ok: false, error: "field is not editable" });
        return;
      }
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) {
        res.status(400).json({ ok: false, error: "value must be a number" });
        return;
      }
      await poolManager.updateSelectedHistoryEvent(id, field, num);
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
  app.use(express.static(publicDir, {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".html") {
        res.setHeader("Content-Type", "text/html; charset=UTF-8");
      } else if (ext === ".js") {
        res.setHeader("Content-Type", "application/javascript; charset=UTF-8");
      } else if (ext === ".css") {
        res.setHeader("Content-Type", "text/css; charset=UTF-8");
      }
    }
  }));

  app.listen(port, () => {
    logger.info({ port }, "UI server started");
  });
}
