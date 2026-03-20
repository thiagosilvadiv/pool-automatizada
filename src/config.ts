import fs from "fs";
import path from "path";

export type Config = {
  network: string;
  rpcUrl: string;
  whirlpoolAddress: string;
  rangeWidthPct: number;
  slippageBps: number;
  pollIntervalMs: number;
  outOfRangeConfirmSec: number;
  rebalanceCooldownSec: number;
  autoSolTopupEnabled: boolean;
  autoSolAllowAll: boolean;
  autoSolSwapMints: string[];
  autoSolMaxInputPct: number;
  autoSolSlippageBps: number;
  autoSolCooldownSec: number;
  autoSolTargetBufferPct: number;
  autoCloseEmptyAccountsEnabled: boolean;
  autoCloseEmptyAccountsIntervalSec: number;
  autoCloseEmptyAccountsOnLowSol: boolean;
  autoCloseEmptyAccountsLowSolCooldownSec: number;
  autoSwapToSolEnabled: boolean;
  autoSwapToSolMinOutSol: number;
  autoSwapToSolExcludeMints: string[];
  autoSwapFeesToUsdcEnabled: boolean;
  autoSwapFeesToUsdcTargetMint: string;
  jupiterApiKey: string | null;
  jupiterApiUrl: string;
  dryRun: boolean;
  minSolBalance: number;
  maxTokenA: number | null;
  maxTokenB: number | null;
  rebalanceSwapPct: number;
  positionMint: string | null;
  budgetUsd: number | null;
  pythSolUsdFeedId: string | null;
  priceStaleMaxSec: number | null;
};

function parseEnvNumber(value: string | undefined): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function parseEnvBool(value: string | undefined): boolean | undefined {
  if (value == null || value.trim() === "") return undefined;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseEnvList(value: string | undefined): string[] | undefined {
  if (value == null || value.trim() === "") return undefined;
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function readConfigFile(configPath: string): Partial<Config> {
  const resolved = path.resolve(process.cwd(), configPath);
  const raw = fs.readFileSync(resolved, "utf-8");
  return JSON.parse(raw) as Partial<Config>;
}

export function loadConfig(configPath?: string, options?: { allowMissingWhirlpool?: boolean }): Config {
  const envJson = process.env.CONFIG_JSON?.trim();
  const envPath = process.env.CONFIG_PATH?.trim();

  let data: Partial<Config> = {};
  if (envJson) {
    data = JSON.parse(envJson) as Partial<Config>;
  } else if (configPath) {
    data = readConfigFile(configPath);
  } else if (envPath) {
    data = readConfigFile(envPath);
  }

  const config: Config = {
    network: process.env.NETWORK ?? data.network ?? "mainnet-beta",
    rpcUrl: process.env.RPC_URL ?? data.rpcUrl ?? "",
    whirlpoolAddress: process.env.WHIRLPOOL_ADDRESS ?? data.whirlpoolAddress ?? "",
    rangeWidthPct: parseEnvNumber(process.env.RANGE_WIDTH_PCT) ?? Number(data.rangeWidthPct ?? 1),
    slippageBps: parseEnvNumber(process.env.SLIPPAGE_BPS) ?? Number(data.slippageBps ?? 50),
    pollIntervalMs: parseEnvNumber(process.env.POLL_INTERVAL_MS) ?? Number(data.pollIntervalMs ?? 30000),
    outOfRangeConfirmSec: parseEnvNumber(process.env.OUT_OF_RANGE_CONFIRM_SEC) ?? Number(data.outOfRangeConfirmSec ?? 0),
    rebalanceCooldownSec: parseEnvNumber(process.env.REBALANCE_COOLDOWN_SEC) ?? Number(data.rebalanceCooldownSec ?? 300),
    autoSolTopupEnabled: parseEnvBool(process.env.AUTO_SOL_TOPUP_ENABLED) ?? Boolean(data.autoSolTopupEnabled ?? false),
    autoSolAllowAll: parseEnvBool(process.env.AUTO_SOL_ALLOW_ALL) ?? Boolean(data.autoSolAllowAll ?? false),
    autoSolSwapMints: parseEnvList(process.env.AUTO_SOL_SWAP_MINTS)
      ?? (Array.isArray(data.autoSolSwapMints)
        ? data.autoSolSwapMints.map((item) => String(item))
        : (typeof data.autoSolSwapMints === "string" ? parseEnvList(data.autoSolSwapMints) : null))
      ?? [],
    autoSolMaxInputPct: parseEnvNumber(process.env.AUTO_SOL_MAX_INPUT_PCT) ?? Number(data.autoSolMaxInputPct ?? 0.5),
    autoSolSlippageBps: parseEnvNumber(process.env.AUTO_SOL_SLIPPAGE_BPS)
      ?? (data.autoSolSlippageBps == null ? undefined : Number(data.autoSolSlippageBps))
      ?? (parseEnvNumber(process.env.SLIPPAGE_BPS) ?? Number(data.slippageBps ?? 50)),
    autoSolCooldownSec: parseEnvNumber(process.env.AUTO_SOL_COOLDOWN_SEC) ?? Number(data.autoSolCooldownSec ?? 60),
    autoSolTargetBufferPct: parseEnvNumber(process.env.AUTO_SOL_TARGET_BUFFER_PCT)
      ?? (data.autoSolTargetBufferPct == null ? 0 : Number(data.autoSolTargetBufferPct)),
    autoCloseEmptyAccountsEnabled: parseEnvBool(process.env.AUTO_CLOSE_EMPTY_ACCOUNTS_ENABLED)
      ?? Boolean(data.autoCloseEmptyAccountsEnabled ?? false),
    autoCloseEmptyAccountsIntervalSec: parseEnvNumber(process.env.AUTO_CLOSE_EMPTY_ACCOUNTS_INTERVAL_SEC)
      ?? Number(data.autoCloseEmptyAccountsIntervalSec ?? 43200),
    autoCloseEmptyAccountsOnLowSol: parseEnvBool(process.env.AUTO_CLOSE_EMPTY_ACCOUNTS_ON_LOW_SOL)
      ?? Boolean(data.autoCloseEmptyAccountsOnLowSol ?? true),
    autoCloseEmptyAccountsLowSolCooldownSec: parseEnvNumber(process.env.AUTO_CLOSE_EMPTY_ACCOUNTS_LOW_SOL_COOLDOWN_SEC)
      ?? Number(data.autoCloseEmptyAccountsLowSolCooldownSec ?? 1800),
    autoSwapToSolEnabled: parseEnvBool(process.env.AUTO_SWAP_TO_SOL_ENABLED)
      ?? Boolean(data.autoSwapToSolEnabled ?? false),
    autoSwapToSolMinOutSol: parseEnvNumber(process.env.AUTO_SWAP_TO_SOL_MIN_OUT_SOL)
      ?? Number(data.autoSwapToSolMinOutSol ?? 0),
    autoSwapToSolExcludeMints: parseEnvList(process.env.AUTO_SWAP_TO_SOL_EXCLUDE_MINTS)
      ?? (Array.isArray((data as any).autoSwapToSolExcludeMints)
        ? (data as any).autoSwapToSolExcludeMints.map((item: any) => String(item))
        : (typeof (data as any).autoSwapToSolExcludeMints === "string"
          ? parseEnvList((data as any).autoSwapToSolExcludeMints)
          : null))
      ?? [],
    autoSwapFeesToUsdcEnabled: parseEnvBool(process.env.AUTO_SWAP_FEES_TO_USDC_ENABLED)
      ?? Boolean(data.autoSwapFeesToUsdcEnabled ?? false),
    autoSwapFeesToUsdcTargetMint: process.env.AUTO_SWAP_FEES_TO_USDC_TARGET_MINT
      ?? (data as any).autoSwapFeesToUsdcTargetMint
      ?? "",
    jupiterApiKey: process.env.JUPITER_API_KEY ?? data.jupiterApiKey ?? null,
    jupiterApiUrl: process.env.JUPITER_API_URL ?? data.jupiterApiUrl ?? "https://api.jup.ag",
    dryRun: parseEnvBool(process.env.DRY_RUN) ?? Boolean(data.dryRun ?? false),
    minSolBalance: parseEnvNumber(process.env.MIN_SOL_BALANCE) ?? Number(data.minSolBalance ?? 0.02),
    maxTokenA: parseEnvNumber(process.env.MAX_TOKEN_A) ?? data.maxTokenA ?? null,
    maxTokenB: parseEnvNumber(process.env.MAX_TOKEN_B) ?? data.maxTokenB ?? null,
    rebalanceSwapPct: parseEnvNumber(process.env.REBALANCE_SWAP_PCT) ?? Number(data.rebalanceSwapPct ?? 1.0),
    positionMint: process.env.POSITION_MINT ?? data.positionMint ?? null,
    budgetUsd: parseEnvNumber(process.env.BUDGET_USD) ?? (data.budgetUsd == null ? null : Number(data.budgetUsd)),
    pythSolUsdFeedId: process.env.PYTH_SOL_USD_FEED_ID ?? data.pythSolUsdFeedId ?? null,
    priceStaleMaxSec: parseEnvNumber(process.env.PRICE_STALE_MAX_SEC) ?? (data.priceStaleMaxSec == null ? 120 : Number(data.priceStaleMaxSec))
  };

  if (!configPath && !envJson && !envPath && !config.rpcUrl) {
    throw new Error("Missing config: provide --config, CONFIG_PATH, or CONFIG_JSON");
  }

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
  if (!Number.isFinite(config.rebalanceCooldownSec) || config.rebalanceCooldownSec < 0) {
    throw new Error("rebalanceCooldownSec must be >= 0");
  }
  if (!Number.isFinite(config.autoSolMaxInputPct) || config.autoSolMaxInputPct < 0 || config.autoSolMaxInputPct > 1) {
    throw new Error("autoSolMaxInputPct must be between 0 and 1");
  }
  if (!Number.isFinite(config.autoSolSlippageBps) || config.autoSolSlippageBps < 0) {
    throw new Error("autoSolSlippageBps must be >= 0");
  }
  if (!Number.isFinite(config.autoSolCooldownSec) || config.autoSolCooldownSec < 0) {
    throw new Error("autoSolCooldownSec must be >= 0");
  }
  if (!Number.isFinite(config.autoSolTargetBufferPct) || config.autoSolTargetBufferPct < 0 || config.autoSolTargetBufferPct > 1) {
    throw new Error("autoSolTargetBufferPct must be between 0 and 1");
  }
  if (!Number.isFinite(config.autoCloseEmptyAccountsIntervalSec) || config.autoCloseEmptyAccountsIntervalSec <= 0) {
    throw new Error("autoCloseEmptyAccountsIntervalSec must be > 0");
  }
  if (!Number.isFinite(config.autoCloseEmptyAccountsLowSolCooldownSec)
    || config.autoCloseEmptyAccountsLowSolCooldownSec <= 0) {
    throw new Error("autoCloseEmptyAccountsLowSolCooldownSec must be > 0");
  }
  if (!Number.isFinite(config.autoSwapToSolMinOutSol) || config.autoSwapToSolMinOutSol < 0) {
    throw new Error("autoSwapToSolMinOutSol must be >= 0");
  }
  if (!config.autoSwapFeesToUsdcTargetMint || !config.autoSwapFeesToUsdcTargetMint.trim()) {
    config.autoSwapFeesToUsdcTargetMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
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
