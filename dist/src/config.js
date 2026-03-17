import fs from "fs";
import path from "path";
export function loadConfig(configPath, options) {
    if (!configPath) {
        throw new Error("Missing --config path");
    }
    const resolved = path.resolve(process.cwd(), configPath);
    const raw = fs.readFileSync(resolved, "utf-8");
    const data = JSON.parse(raw);
    const config = {
        network: data.network ?? "mainnet-beta",
        rpcUrl: data.rpcUrl ?? process.env.RPC_URL ?? "",
        whirlpoolAddress: data.whirlpoolAddress ?? "",
        rangeWidthPct: Number(data.rangeWidthPct ?? 1),
        slippageBps: Number(data.slippageBps ?? 50),
        pollIntervalMs: Number(data.pollIntervalMs ?? 30000),
        outOfRangeConfirmSec: Number(data.outOfRangeConfirmSec ?? 0),
        dryRun: Boolean(data.dryRun ?? false),
        minSolBalance: Number(data.minSolBalance ?? 0.02),
        maxTokenA: data.maxTokenA ?? null,
        maxTokenB: data.maxTokenB ?? null,
        rebalanceSwapPct: Number(data.rebalanceSwapPct ?? 1.0),
        positionMint: data.positionMint ?? null,
        budgetUsd: data.budgetUsd == null ? null : Number(data.budgetUsd),
        pythSolUsdFeedId: data.pythSolUsdFeedId ?? null,
        priceStaleMaxSec: data.priceStaleMaxSec == null ? 120 : Number(data.priceStaleMaxSec)
    };
    if (!config.rpcUrl) {
        throw new Error("rpcUrl is required (config or RPC_URL env)");
    }
    if (!config.whirlpoolAddress && !options?.allowMissingWhirlpool) {
        throw new Error("whirlpoolAddress is required");
    }
    if (!Number.isFinite(config.rangeWidthPct) || config.rangeWidthPct <= 0) {
        throw new Error("rangeWidthPct must be > 0");
    }
    if (!Number.isFinite(config.slippageBps) || config.slippageBps < 0) {
        throw new Error("slippageBps must be >= 0");
    }
    if (!Number.isFinite(config.pollIntervalMs) || config.pollIntervalMs < 1000) {
        throw new Error("pollIntervalMs must be >= 1000");
    }
    if (!Number.isFinite(config.outOfRangeConfirmSec) || config.outOfRangeConfirmSec < 0) {
        throw new Error("outOfRangeConfirmSec must be >= 0");
    }
    if (!Number.isFinite(config.minSolBalance) || config.minSolBalance < 0) {
        throw new Error("minSolBalance must be >= 0");
    }
    if (!Number.isFinite(config.rebalanceSwapPct) || config.rebalanceSwapPct < 0 || config.rebalanceSwapPct > 1) {
        throw new Error("rebalanceSwapPct must be between 0 and 1");
    }
    if (config.budgetUsd !== null && (!Number.isFinite(Number(config.budgetUsd)) || Number(config.budgetUsd) <= 0)) {
        throw new Error("budgetUsd must be > 0 or null");
    }
    if (config.budgetUsd !== null && !config.pythSolUsdFeedId) {
        throw new Error("pythSolUsdFeedId is required when budgetUsd is set");
    }
    if (config.priceStaleMaxSec !== null && (!Number.isFinite(Number(config.priceStaleMaxSec)) || Number(config.priceStaleMaxSec) < 0)) {
        throw new Error("priceStaleMaxSec must be >= 0 or null");
    }
    return config;
}
