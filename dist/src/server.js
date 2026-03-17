import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { buildConnection, buildWallet, loadKeypair } from "./solana.js";
import { logger } from "./logger.js";
import { PoolManager } from "./pool-manager.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export async function startServer(config) {
    const app = express();
    const port = Number(process.env.PORT ?? 3000);
    app.use(express.json());
    const uiUser = process.env.UI_USER ?? null;
    const uiPass = process.env.UI_PASS ?? process.env.UI_PASSWORD ?? null;
    const authEnabled = Boolean(uiUser && uiPass);
    if (authEnabled) {
        logger.info("UI auth enabled");
        app.use((req, res, next) => {
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
            }
            catch {
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
    app.get("/api/status", (_req, res) => {
        const status = poolManager.getSelectedStatus();
        if (!status) {
            res.json({ running: false, lastAction: "no-pool", lastError: null, lastPrice: null });
            return;
        }
        res.json(status);
    });
    app.post("/api/start", async (_req, res) => {
        try {
            await poolManager.startSelected();
            res.json({ ok: true, status: poolManager.getSelectedStatus() });
        }
        catch (err) {
            res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.post("/api/stop", (_req, res) => {
        try {
            poolManager.stopSelected();
            res.json({ ok: true, status: poolManager.getSelectedStatus() });
        }
        catch (err) {
            res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.post("/api/close-position", async (_req, res) => {
        try {
            await poolManager.closeSelected();
            res.json({ ok: true, status: poolManager.getSelectedStatus() });
        }
        catch (err) {
            res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.get("/api/config", (_req, res) => {
        const selectedId = poolManager.getSelectedPoolId();
        const selected = poolManager.listPools().find((entry) => entry.id === selectedId) ?? null;
        res.json({
            network: config.network,
            whirlpoolAddress: selected?.whirlpoolAddress ?? null,
            poolName: selected?.name ?? null,
            selectedPoolId: selectedId,
            rangeWidthPct: config.rangeWidthPct,
            slippageBps: config.slippageBps,
            pollIntervalMs: config.pollIntervalMs,
            outOfRangeConfirmSec: config.outOfRangeConfirmSec,
            dryRun: config.dryRun,
            minSolBalance: config.minSolBalance,
            budgetUsd: config.budgetUsd,
            pythSolUsdFeedId: config.pythSolUsdFeedId,
            priceStaleMaxSec: config.priceStaleMaxSec
        });
    });
    app.get("/api/pools", (_req, res) => {
        res.json({
            selectedPoolId: poolManager.getSelectedPoolId(),
            pools: poolManager.listSummaries()
        });
    });
    app.post("/api/pools", async (req, res) => {
        try {
            const { name, whirlpoolAddress } = req.body ?? {};
            const entry = await poolManager.addPool(String(name ?? ""), String(whirlpoolAddress ?? ""));
            res.json({ ok: true, entry });
        }
        catch (err) {
            res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.post("/api/pools/:id/select", async (req, res) => {
        try {
            await poolManager.selectPool(req.params.id);
            res.json({ ok: true, selectedPoolId: poolManager.getSelectedPoolId() });
        }
        catch (err) {
            res.status(404).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.post("/api/pools/:id/start", async (req, res) => {
        try {
            await poolManager.startPool(req.params.id);
            res.json({ ok: true });
        }
        catch (err) {
            res.status(404).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.post("/api/pools/:id/stop", (req, res) => {
        try {
            poolManager.stopPool(req.params.id);
            res.json({ ok: true });
        }
        catch (err) {
            res.status(404).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.post("/api/pools/:id/close", async (req, res) => {
        try {
            await poolManager.closePool(req.params.id);
            res.json({ ok: true });
        }
        catch (err) {
            res.status(404).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.delete("/api/pools/:id", async (req, res) => {
        try {
            await poolManager.removePool(req.params.id);
            res.json({ ok: true });
        }
        catch (err) {
            res.status(404).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.get("/api/results", (_req, res) => {
        res.json(poolManager.listSummaries());
    });
    app.get("/api/history", (_req, res) => {
        res.json(poolManager.getSelectedHistory());
    });
    app.post("/api/history/clear", async (_req, res) => {
        await poolManager.clearSelectedHistory();
        res.json({ ok: true });
    });
    const publicDir = path.join(__dirname, "..", "public");
    app.use(express.static(publicDir));
    app.listen(port, () => {
        logger.info({ port }, "UI server started");
    });
}
