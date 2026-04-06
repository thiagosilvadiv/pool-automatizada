import fs from "fs";
import path from "path";

import type { TrendFallback, TrendTarget, TrendTimeframe } from "./trend.js";

const MAX_SLIPPAGE_BPS = 10_000;

export type Config = {
  network: string;
  rpcUrl: string;
  whirlpoolAddress: string;
  rangeWidthPct: number;
  rangeExitBiasPct: number;
  rangeAnchor: "lower" | "middle" | "upper" | null;
  preferredExitToken: "tokenA" | "tokenB" | null;
  preferredExitDirection: "down" | "up";
  slippageBps: number;
  pollIntervalMs: number;
  rateLimitCooldownSec: number;
  historyMaxEvents: number;
  outOfRangeConfirmSec: number;
  rebalanceCooldownSec: number;
  autoSolTopupEnabled: boolean;
  autoSolAllowAll: boolean;
  autoSolSwapMints: string[];
  autoSolMaxInputPct: number;
  autoSolSlippageBps: number;
  autoSolCooldownSec: number;
  autoSolTargetBufferPct: number;
  kaminoScanIntervalSec: number;
  autoCloseEmptyAccountsEnabled: boolean;
  autoCloseEmptyAccountsIntervalSec: number;
  autoCloseEmptyAccountsOnLowSol: boolean;
  autoCloseEmptyAccountsLowSolCooldownSec: number;
  autoSwapToSolEnabled: boolean;
  autoSwapToSolMinOutSol: number;
  autoSwapToSolExcludeMints: string[];
  autoSwapFeesToUsdcEnabled: boolean;
  autoSwapFeesToUsdcTargetMint: string;
  autoSwapFeesToUsdcMinUsd: number;
  autoSwapFeesToUsdcDestWallet: string | null;
  autoAddLiquidityEnabled: boolean;
  kaminoRebalanceEnabled: boolean;
  kaminoDepositPct: number;
  kaminoBorrowAsset: "usdc" | "usdt" | "auto";
  kaminoMarketAddress: string | null;
  kaminoMaxLtv: number;
  kaminoCloseRule: "avg-price" | "breakeven" | "manual";
  kaminoPriceBufferPct: number;
  kaminoMinCombinedPnlUsd: number;
  kaminoCollateralMode: "exit" | "max-value" | "tokenA" | "tokenB" | "both";
  kaminoAutoCloseOnTokenChange: boolean;
  kaminoConvertToCollateral: boolean;
  kaminoAvgPriceBasis: "deposit" | "debt";
  kaminoAvgMode: "cumulative" | "reset";
  kaminoRepayRetrySec: number;
  kaminoRepayMaxAttempts: number;
  kaminoGracePeriodSec: number;
  autoResumeEnabled: boolean;
  autoResumeMaxAttempts: number;
  autoResumeBaseDelayMs: number;
  jupiterApiKey: string | null;
  jupiterApiUrl: string;
  jupiterExcludeDexes: string[];
  dryRun: boolean;
  minSolBalance: number;
  allowLowSolOperations: boolean;
  maxTokenA: number | null;
  maxTokenB: number | null;
  rebalanceSwapPct: number;
  positionMint: string | null;
  budgetUsd: number | null;
  pythSolUsdFeedId: string | null;
  priceStaleMaxSec: number | null;
  trendEnabled: boolean;
  evolutionApiUrl: string | null;
  evolutionApiKey: string | null;
  evolutionPhone: string | null;
  evolutionInstance: string | null;
  trendTimeframe: TrendTimeframe;
  trendTargetUp: TrendTarget;
  trendTargetDown: TrendTarget;
  trendFallback: TrendFallback;
  trendStaleSec: number;
  trendCacheSec: number | null;
  trendNetworkId: string;
  openaiApiKey: string | null;
  openaiDefaultModel: string;
  openaiRecommendedModels: string[];
  openaiAllowCustomModel: boolean;
  openaiTimeoutMs: number;
  bybitApiKey: string | null;
  bybitApiSecret: string | null;
  bybitBaseUrl: string;
  bybitRecvWindow: number;
  hedgeEnabled: boolean;
  hedgePct: number;
  hedgeSymbol: string;
  hedgeLeverage: number;
  hedgeMarginPct: number;
  hedgeEntryMode: HedgeEntryMode;
};

export type HedgeEntryMode =
  | "off"
  | "trend-down"
  | "trend-up"
  | "trend-any"
  | "force-down"
  | "force-up";

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

function parseEnvString(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeModelList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return Array.from(new Set(
      input
        .map((item) => String(item ?? "").trim())
        .filter((item) => item.length > 0)
    ));
  }
  if (typeof input === "string") {
    return Array.from(new Set(
      input
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    ));
  }
  return [];
}

function parseTrendTimeframe(value: unknown): TrendTimeframe | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "1m") return "1m";
  if (trimmed === "5m") return "5m";
  if (trimmed === "15m") return "15m";
  if (trimmed === "30m") return "30m";
  if (trimmed === "1h") return "1h";
  return undefined;
}

function parseTrendTarget(value: unknown): TrendTarget | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "sol") return "sol";
  if (trimmed === "other") return "other";
  if (trimmed === "tokena" || trimmed === "token_a") return "tokenA";
  if (trimmed === "tokenb" || trimmed === "token_b") return "tokenB";
  return undefined;
}

function parseTrendFallback(value: unknown): TrendFallback | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "manual") return "manual";
  if (trimmed === "neutral") return "neutral";
  if (trimmed === "last") return "last";
  return undefined;
}

function parseExitToken(value: unknown): "tokenA" | "tokenB" | null | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower === "tokena" || lower === "a" || lower === "token_a") return "tokenA";
  if (lower === "tokenb" || lower === "b" || lower === "token_b") return "tokenB";
  return undefined;
}

function parseExitDirection(value: unknown): "down" | "up" | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "down") return "down";
  if (trimmed === "up") return "up";
  return undefined;
}

function parseRangeAnchor(value: unknown): "lower" | "middle" | "upper" | null | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "lower" || trimmed === "low" || trimmed === "inferior") return "lower";
  if (trimmed === "middle" || trimmed === "mid" || trimmed === "center" || trimmed === "meio") return "middle";
  if (trimmed === "upper" || trimmed === "high" || trimmed === "superior") return "upper";
  return undefined;
}

function parseHedgeEntryMode(value: unknown): HedgeEntryMode | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "off") return "off";
  if (trimmed === "trend-down") return "trend-down";
  if (trimmed === "trend-up") return "trend-up";
  if (trimmed === "trend-any") return "trend-any";
  if (trimmed === "force-down") return "force-down";
  if (trimmed === "force-up") return "force-up";
  return undefined;
}

function parseKaminoBorrowAsset(value: unknown): "usdc" | "usdt" | "auto" | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "usdc") return "usdc";
  if (trimmed === "usdt") return "usdt";
  if (trimmed === "auto") return "auto";
  return undefined;
}

function parseKaminoCloseRule(value: unknown): "avg-price" | "breakeven" | "manual" | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "avg-price") return "avg-price";
  if (trimmed === "breakeven") return "breakeven";
  if (trimmed === "manual") return "manual";
  return undefined;
}

function parseKaminoCollateralMode(value: unknown): "exit" | "max-value" | "tokenA" | "tokenB" | "both" | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "exit") return "exit";
  if (trimmed === "max-value" || trimmed === "max_value" || trimmed === "maxvalue") return "max-value";
  if (trimmed === "both" || trimmed === "dual") return "both";
  if (trimmed === "tokena" || trimmed === "token_a") return "tokenA";
  if (trimmed === "tokenb" || trimmed === "token_b") return "tokenB";
  return undefined;
}

function parseKaminoAvgPriceBasis(value: unknown): "deposit" | "debt" | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "deposit") return "deposit";
  if (trimmed === "debt") return "debt";
  return undefined;
}

function parseKaminoAvgMode(value: unknown): "cumulative" | "reset" | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "cumulative") return "cumulative";
  if (trimmed === "reset") return "reset";
  return undefined;
}

function timeframeToSeconds(timeframe: TrendTimeframe): number {
  switch (timeframe) {
    case "1m":
      return 60;
    case "5m":
      return 300;
    case "30m":
      return 1800;
    case "1h":
      return 3600;
    default:
      return 60;
  }
}

function inferTrendNetworkId(network: string): string {
  const value = (network || "").trim().toLowerCase();
  if (value.includes("sol")) return "solana";
  if (value.includes("eth")) return "eth";
  if (value.includes("polygon")) return "polygon_pos";
  if (value.includes("bsc") || value.includes("binance")) return "bsc";
  if (value.includes("avax") || value.includes("avalanche")) return "avax";
  if (value.includes("arbitrum")) return "arbitrum";
  if (value.includes("optimism")) return "optimism";
  if (value.includes("base")) return "base";
  return "solana";
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

  const envExitTokenRaw = process.env.PREFERRED_EXIT_TOKEN ?? "";
  const envExitToken = parseExitToken(envExitTokenRaw);
  if (envExitTokenRaw && !envExitToken) {
    throw new Error("PREFERRED_EXIT_TOKEN must be tokenA or tokenB");
  }
  const dataExitTokenRaw = (data as any).preferredExitToken;
  const dataExitToken = parseExitToken(dataExitTokenRaw);
  if (dataExitTokenRaw != null && dataExitToken === undefined) {
    throw new Error("preferredExitToken must be tokenA or tokenB");
  }
  const envExitDirectionRaw = process.env.PREFERRED_EXIT_DIRECTION ?? "";
  const envExitDirection = parseExitDirection(envExitDirectionRaw);
  if (envExitDirectionRaw && !envExitDirection) {
    throw new Error("PREFERRED_EXIT_DIRECTION must be down or up");
  }
  const dataExitDirectionRaw = (data as any).preferredExitDirection;
  const dataExitDirection = parseExitDirection(dataExitDirectionRaw);
  if (dataExitDirectionRaw != null && dataExitDirection === undefined) {
    throw new Error("preferredExitDirection must be down or up");
  }
  const envRangeAnchorRaw = process.env.RANGE_ANCHOR ?? "";
  const envRangeAnchor = parseRangeAnchor(envRangeAnchorRaw);
  if (envRangeAnchorRaw && envRangeAnchor === undefined) {
    throw new Error("RANGE_ANCHOR must be lower, middle, or upper");
  }
  const dataRangeAnchorRaw = (data as any).rangeAnchor;
  const dataRangeAnchor = parseRangeAnchor(dataRangeAnchorRaw);
  if (dataRangeAnchorRaw != null && dataRangeAnchor === undefined) {
    throw new Error("rangeAnchor must be lower, middle, or upper");
  }

  const envKaminoBorrowAssetRaw = process.env.KAMINO_BORROW_ASSET ?? "";
  const envKaminoBorrowAsset = parseKaminoBorrowAsset(envKaminoBorrowAssetRaw);
  if (envKaminoBorrowAssetRaw && !envKaminoBorrowAsset) {
    throw new Error("KAMINO_BORROW_ASSET must be usdc, usdt, or auto");
  }
  const dataKaminoBorrowAssetRaw = (data as any).kaminoBorrowAsset;
  const dataKaminoBorrowAsset = parseKaminoBorrowAsset(dataKaminoBorrowAssetRaw);
  if (dataKaminoBorrowAssetRaw != null && dataKaminoBorrowAsset === undefined) {
    throw new Error("kaminoBorrowAsset must be usdc, usdt, or auto");
  }

  const envKaminoCloseRuleRaw = process.env.KAMINO_CLOSE_RULE ?? "";
  const envKaminoCloseRule = parseKaminoCloseRule(envKaminoCloseRuleRaw);
  if (envKaminoCloseRuleRaw && !envKaminoCloseRule) {
    throw new Error("KAMINO_CLOSE_RULE must be avg-price, breakeven, or manual");
  }
  const dataKaminoCloseRuleRaw = (data as any).kaminoCloseRule;
  const dataKaminoCloseRule = parseKaminoCloseRule(dataKaminoCloseRuleRaw);
  if (dataKaminoCloseRuleRaw != null && dataKaminoCloseRule === undefined) {
    throw new Error("kaminoCloseRule must be avg-price, breakeven, or manual");
  }

  const envKaminoCollateralModeRaw = process.env.KAMINO_COLLATERAL_MODE ?? "";
  const envKaminoCollateralMode = parseKaminoCollateralMode(envKaminoCollateralModeRaw);
  if (envKaminoCollateralModeRaw && !envKaminoCollateralMode) {
    throw new Error("KAMINO_COLLATERAL_MODE must be exit, max-value, tokenA, tokenB, or both");
  }
  const dataKaminoCollateralModeRaw = (data as any).kaminoCollateralMode;
  const dataKaminoCollateralMode = parseKaminoCollateralMode(dataKaminoCollateralModeRaw);
  if (dataKaminoCollateralModeRaw != null && dataKaminoCollateralMode === undefined) {
    throw new Error("kaminoCollateralMode must be exit, max-value, tokenA, tokenB, or both");
  }

  const envKaminoAvgPriceBasisRaw = process.env.KAMINO_AVG_PRICE_BASIS ?? "";
  const envKaminoAvgPriceBasis = parseKaminoAvgPriceBasis(envKaminoAvgPriceBasisRaw);
  if (envKaminoAvgPriceBasisRaw && !envKaminoAvgPriceBasis) {
    throw new Error("KAMINO_AVG_PRICE_BASIS must be deposit or debt");
  }
  const dataKaminoAvgPriceBasisRaw = (data as any).kaminoAvgPriceBasis;
  const dataKaminoAvgPriceBasis = parseKaminoAvgPriceBasis(dataKaminoAvgPriceBasisRaw);
  if (dataKaminoAvgPriceBasisRaw != null && dataKaminoAvgPriceBasis === undefined) {
    throw new Error("kaminoAvgPriceBasis must be deposit or debt");
  }

  const envKaminoAvgModeRaw = process.env.KAMINO_AVG_MODE ?? "";
  const envKaminoAvgMode = parseKaminoAvgMode(envKaminoAvgModeRaw);
  if (envKaminoAvgModeRaw && !envKaminoAvgMode) {
    throw new Error("KAMINO_AVG_MODE must be cumulative or reset");
  }
  const dataKaminoAvgModeRaw = (data as any).kaminoAvgMode;
  const dataKaminoAvgMode = parseKaminoAvgMode(dataKaminoAvgModeRaw);
  if (dataKaminoAvgModeRaw != null && dataKaminoAvgMode === undefined) {
    throw new Error("kaminoAvgMode must be cumulative or reset");
  }
  const envKaminoRepayRetrySec = parseEnvNumber(process.env.KAMINO_REPAY_RETRY_SEC);
  const envKaminoRepayMaxAttempts = parseEnvNumber(process.env.KAMINO_REPAY_MAX_ATTEMPTS);
  const envKaminoGracePeriodSec = parseEnvNumber(process.env.KAMINO_GRACE_PERIOD_SEC);

  const envTrendTimeframeRaw = process.env.TREND_TIMEFRAME ?? "";
  const envTrendTimeframe = parseTrendTimeframe(envTrendTimeframeRaw);
  if (envTrendTimeframeRaw && !envTrendTimeframe) {
    throw new Error("TREND_TIMEFRAME must be 1m, 5m, 15m, 30m, or 1h");
  }
  const dataTrendTimeframeRaw = (data as any).trendTimeframe;
  const dataTrendTimeframe = parseTrendTimeframe(dataTrendTimeframeRaw);
  if (dataTrendTimeframeRaw != null && dataTrendTimeframe === undefined) {
    throw new Error("trendTimeframe must be 1m, 5m, 15m, 30m, or 1h");
  }

  const envTrendTargetUpRaw = process.env.TREND_TARGET_UP ?? "";
  const envTrendTargetUp = parseTrendTarget(envTrendTargetUpRaw);
  if (envTrendTargetUpRaw && !envTrendTargetUp) {
    throw new Error("TREND_TARGET_UP must be sol, other, tokenA, or tokenB");
  }
  const dataTrendTargetUpRaw = (data as any).trendTargetUp;
  const dataTrendTargetUp = parseTrendTarget(dataTrendTargetUpRaw);
  if (dataTrendTargetUpRaw != null && dataTrendTargetUp === undefined) {
    throw new Error("trendTargetUp must be sol, other, tokenA, or tokenB");
  }

  const envTrendTargetDownRaw = process.env.TREND_TARGET_DOWN ?? "";
  const envTrendTargetDown = parseTrendTarget(envTrendTargetDownRaw);
  if (envTrendTargetDownRaw && !envTrendTargetDown) {
    throw new Error("TREND_TARGET_DOWN must be sol, other, tokenA, or tokenB");
  }
  const dataTrendTargetDownRaw = (data as any).trendTargetDown;
  const dataTrendTargetDown = parseTrendTarget(dataTrendTargetDownRaw);
  if (dataTrendTargetDownRaw != null && dataTrendTargetDown === undefined) {
    throw new Error("trendTargetDown must be sol, other, tokenA, or tokenB");
  }

  const envTrendFallbackRaw = process.env.TREND_FALLBACK ?? "";
  const envTrendFallback = parseTrendFallback(envTrendFallbackRaw);
  if (envTrendFallbackRaw && !envTrendFallback) {
    throw new Error("TREND_FALLBACK must be manual, neutral, or last");
  }
  const dataTrendFallbackRaw = (data as any).trendFallback;
  const dataTrendFallback = parseTrendFallback(dataTrendFallbackRaw);
  if (dataTrendFallbackRaw != null && dataTrendFallback === undefined) {
    throw new Error("trendFallback must be manual, neutral, or last");
  }

  const resolvedTrendTimeframe = envTrendTimeframe
    ?? dataTrendTimeframe
    ?? "1m";
  const defaultStaleSec = timeframeToSeconds(resolvedTrendTimeframe) * 3;
  const trendStaleSec = parseEnvNumber(process.env.TREND_STALE_SEC)
    ?? (data as any).trendStaleSec
    ?? defaultStaleSec;
  const trendCacheSec = parseEnvNumber(process.env.TREND_CACHE_SEC)
    ?? (data as any).trendCacheSec
    ?? null;

  const trendNetworkId = (process.env.TREND_NETWORK_ID ?? (data as any).trendNetworkId ?? "").trim()
    || inferTrendNetworkId(process.env.NETWORK ?? data.network ?? "mainnet-beta");
  const envHedgeEntryMode = parseHedgeEntryMode(process.env.HEDGE_ENTRY_MODE)
    ?? parseHedgeEntryMode((data as any).hedgeEntryMode);
  const dataOpenAiModels = normalizeModelList((data as any).openaiRecommendedModels);
  const envOpenAiModels = normalizeModelList(process.env.OPENAI_RECOMMENDED_MODELS);
  const defaultOpenAiModels = ["gpt-5.4-mini", "gpt-5.4", "gpt-4.1-mini"];
  const openAiRecommendedModels = envOpenAiModels.length
    ? envOpenAiModels
    : (dataOpenAiModels.length ? dataOpenAiModels : defaultOpenAiModels);
  const openAiDefaultRaw = (process.env.OPENAI_DEFAULT_MODEL ?? (data as any).openaiDefaultModel ?? "").trim();
  const openAiDefaultModel = openAiDefaultRaw || openAiRecommendedModels[0] || "gpt-5.4-mini";
  const openAiAllowCustomModel = parseEnvBool(process.env.OPENAI_ALLOW_CUSTOM_MODEL)
    ?? Boolean((data as any).openaiAllowCustomModel ?? true);
  const openAiTimeoutMs = parseEnvNumber(process.env.OPENAI_TIMEOUT_MS)
    ?? Number((data as any).openaiTimeoutMs ?? 30000);
  const autoResumeEnabled = parseEnvBool(process.env.AUTO_RESUME_ENABLED)
    ?? Boolean((data as any).autoResumeEnabled ?? true);
  const autoResumeMaxAttempts = parseEnvNumber(process.env.AUTO_RESUME_MAX_ATTEMPTS)
    ?? Number((data as any).autoResumeMaxAttempts ?? 5);
  const autoResumeBaseDelayMs = parseEnvNumber(process.env.AUTO_RESUME_BASE_DELAY_MS)
    ?? Number((data as any).autoResumeBaseDelayMs ?? 5000);
  const kaminoAutoCloseOnTokenChange = parseEnvBool(process.env.KAMINO_AUTO_CLOSE_ON_TOKEN_CHANGE)
    ?? Boolean((data as any).kaminoAutoCloseOnTokenChange ?? true);
  const kaminoConvertToCollateral = parseEnvBool(process.env.KAMINO_CONVERT_TO_COLLATERAL)
    ?? Boolean((data as any).kaminoConvertToCollateral ?? false);
  const envNetwork = parseEnvString(process.env.NETWORK);
  const envRpcUrl = parseEnvString(process.env.RPC_URL);
  const envWhirlpoolAddress = parseEnvString(process.env.WHIRLPOOL_ADDRESS);
  const envRateLimitCooldownSec = parseEnvNumber(process.env.RATE_LIMIT_COOLDOWN_SEC);
  const envAutoSwapFeesToUsdcTargetMint = parseEnvString(process.env.AUTO_SWAP_FEES_TO_USDC_TARGET_MINT);
  const envAutoSwapFeesToUsdcDestWallet = parseEnvString(process.env.AUTO_SWAP_FEES_TO_USDC_DEST_WALLET);
  const envJupiterApiKey = parseEnvString(process.env.JUPITER_API_KEY);
  const envJupiterApiUrl = parseEnvString(process.env.JUPITER_API_URL);
  const envKaminoScanIntervalSec = parseEnvNumber(process.env.KAMINO_SCAN_INTERVAL_SEC);
  const envKaminoMinCombinedPnlUsd = parseEnvNumber(process.env.KAMINO_MIN_COMBINED_PNL_USD);
  const envKaminoEnabled = parseEnvBool(process.env.KAMINO_ENABLED);
  const envKaminoRebalanceEnabled = parseEnvBool(process.env.KAMINO_REBALANCE_ENABLED);
  const envBybitApiKey = parseEnvString(process.env.BYBIT_API_KEY);
  const envBybitApiSecret = parseEnvString(process.env.BYBIT_API_SECRET);
  const envBybitBaseUrl = parseEnvString(process.env.BYBIT_BASE_URL);
  const envHedgeSymbol = parseEnvString(process.env.HEDGE_SYMBOL);
  const envEvolutionApiUrl = parseEnvString(process.env.EVOLUTION_API_URL);
  const envEvolutionApiKey = parseEnvString(process.env.EVOLUTION_API_KEY);
  const envEvolutionPhone = parseEnvString(process.env.EVOLUTION_PHONE);
  const envEvolutionInstance = parseEnvString(process.env.EVOLUTION_INSTANCE);
  const dataKaminoEnabledRaw = (data as any).kaminoEnabled;
  const dataKaminoEnabled = typeof dataKaminoEnabledRaw === "boolean"
    ? dataKaminoEnabledRaw
    : (typeof dataKaminoEnabledRaw === "string" ? parseEnvBool(dataKaminoEnabledRaw) : undefined);
  const dataKaminoRebalanceEnabledRaw = (data as any).kaminoRebalanceEnabled;
  const dataKaminoRebalanceEnabled = typeof dataKaminoRebalanceEnabledRaw === "boolean"
    ? dataKaminoRebalanceEnabledRaw
    : (typeof dataKaminoRebalanceEnabledRaw === "string" ? parseEnvBool(dataKaminoRebalanceEnabledRaw) : undefined);
  const kaminoEnabledFallback = envKaminoEnabled ?? dataKaminoEnabled ?? false;

  const config: Config = {
    network: envNetwork ?? data.network ?? "mainnet-beta",
    rpcUrl: envRpcUrl ?? data.rpcUrl ?? "",
    whirlpoolAddress: envWhirlpoolAddress ?? data.whirlpoolAddress ?? "",
    rangeWidthPct: parseEnvNumber(process.env.RANGE_WIDTH_PCT) ?? Number(data.rangeWidthPct ?? 1),
    rangeExitBiasPct: parseEnvNumber(process.env.RANGE_EXIT_BIAS_PCT)
      ?? (data.rangeExitBiasPct == null ? undefined : Number(data.rangeExitBiasPct))
      ?? 0,
    rangeAnchor: envRangeAnchor ?? dataRangeAnchor ?? null,
    preferredExitToken: envExitToken
      ?? dataExitToken
      ?? null,
    preferredExitDirection: envExitDirection
      ?? dataExitDirection
      ?? "down",
    slippageBps: parseEnvNumber(process.env.SLIPPAGE_BPS) ?? Number(data.slippageBps ?? 50),
    pollIntervalMs: parseEnvNumber(process.env.POLL_INTERVAL_MS) ?? Number(data.pollIntervalMs ?? 30000),
    rateLimitCooldownSec: envRateLimitCooldownSec ?? Number((data as any).rateLimitCooldownSec ?? 30),
    historyMaxEvents: parseEnvNumber(process.env.HISTORY_MAX_EVENTS) ?? Number((data as any).historyMaxEvents ?? 200),
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
    kaminoScanIntervalSec: envKaminoScanIntervalSec ?? Number((data as any).kaminoScanIntervalSec ?? 30),
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
    autoSwapFeesToUsdcTargetMint: envAutoSwapFeesToUsdcTargetMint
      ?? (data as any).autoSwapFeesToUsdcTargetMint
      ?? "",
    autoSwapFeesToUsdcMinUsd: parseEnvNumber(process.env.AUTO_SWAP_FEES_TO_USDC_MIN_USD)
      ?? Number((data as any).autoSwapFeesToUsdcMinUsd ?? 0.5),
    autoSwapFeesToUsdcDestWallet: envAutoSwapFeesToUsdcDestWallet
      ?? (data as any).autoSwapFeesToUsdcDestWallet
      ?? null,
    autoAddLiquidityEnabled: parseEnvBool(process.env.AUTO_ADD_LIQUIDITY_ENABLED)
      ?? Boolean((data as any).autoAddLiquidityEnabled ?? false),
    kaminoRebalanceEnabled: envKaminoRebalanceEnabled
      ?? dataKaminoRebalanceEnabled
      ?? (kaminoEnabledFallback ? true : false),
    kaminoDepositPct: parseEnvNumber(process.env.KAMINO_DEPOSIT_PCT)
      ?? Number((data as any).kaminoDepositPct ?? 100),
    kaminoBorrowAsset: envKaminoBorrowAsset
      ?? dataKaminoBorrowAsset
      ?? "usdc",
    kaminoMarketAddress: parseEnvString(process.env.KAMINO_MARKET)
      ?? (data as any).kaminoMarketAddress
      ?? null,
    kaminoMaxLtv: parseEnvNumber(process.env.KAMINO_MAX_LTV)
      ?? Number((data as any).kaminoMaxLtv ?? 0.4),
    kaminoCloseRule: envKaminoCloseRule
      ?? dataKaminoCloseRule
      ?? "avg-price",
    kaminoPriceBufferPct: parseEnvNumber(process.env.KAMINO_PRICE_BUFFER_PCT)
      ?? Number((data as any).kaminoPriceBufferPct ?? 0.5),
    kaminoMinCombinedPnlUsd: envKaminoMinCombinedPnlUsd
      ?? Number((data as any).kaminoMinCombinedPnlUsd ?? 0),
    kaminoCollateralMode: envKaminoCollateralMode
      ?? dataKaminoCollateralMode
      ?? "max-value",
    kaminoAutoCloseOnTokenChange,
    kaminoConvertToCollateral,
    kaminoAvgPriceBasis: envKaminoAvgPriceBasis
      ?? dataKaminoAvgPriceBasis
      ?? "deposit",
    kaminoAvgMode: envKaminoAvgMode
      ?? dataKaminoAvgMode
      ?? "cumulative",
    kaminoRepayRetrySec: envKaminoRepayRetrySec
      ?? Number((data as any).kaminoRepayRetrySec ?? 15),
    kaminoRepayMaxAttempts: envKaminoRepayMaxAttempts
      ?? Number((data as any).kaminoRepayMaxAttempts ?? 3),
    kaminoGracePeriodSec: envKaminoGracePeriodSec
      ?? Number((data as any).kaminoGracePeriodSec ?? 120),
    autoResumeEnabled,
    autoResumeMaxAttempts: Number(autoResumeMaxAttempts),
    autoResumeBaseDelayMs: Number(autoResumeBaseDelayMs),
    jupiterApiKey: envJupiterApiKey ?? data.jupiterApiKey ?? null,
    jupiterApiUrl: envJupiterApiUrl ?? data.jupiterApiUrl ?? "https://api.jup.ag",
    jupiterExcludeDexes: parseEnvList(process.env.JUPITER_EXCLUDE_DEXES)
      ?? (Array.isArray((data as any).jupiterExcludeDexes)
        ? (data as any).jupiterExcludeDexes.map((item: any) => String(item).trim()).filter((item: string) => item)
        : (typeof (data as any).jupiterExcludeDexes === "string"
          ? parseEnvList((data as any).jupiterExcludeDexes)
          : null))
      ?? [],
    dryRun: parseEnvBool(process.env.DRY_RUN) ?? Boolean(data.dryRun ?? false),
    minSolBalance: parseEnvNumber(process.env.MIN_SOL_BALANCE) ?? Number(data.minSolBalance ?? 0.02),
    allowLowSolOperations: parseEnvBool(process.env.ALLOW_LOW_SOL_OPERATIONS)
      ?? Boolean((data as any).allowLowSolOperations ?? false),
    maxTokenA: parseEnvNumber(process.env.MAX_TOKEN_A) ?? data.maxTokenA ?? null,
    maxTokenB: parseEnvNumber(process.env.MAX_TOKEN_B) ?? data.maxTokenB ?? null,
    rebalanceSwapPct: parseEnvNumber(process.env.REBALANCE_SWAP_PCT) ?? Number(data.rebalanceSwapPct ?? 1.0),
    positionMint: process.env.POSITION_MINT ?? data.positionMint ?? null,
    budgetUsd: parseEnvNumber(process.env.BUDGET_USD) ?? (data.budgetUsd == null ? null : Number(data.budgetUsd)),
    pythSolUsdFeedId: process.env.PYTH_SOL_USD_FEED_ID ?? data.pythSolUsdFeedId ?? null,
    priceStaleMaxSec: parseEnvNumber(process.env.PRICE_STALE_MAX_SEC) ?? (data.priceStaleMaxSec == null ? 120 : Number(data.priceStaleMaxSec)),
    trendEnabled: parseEnvBool(process.env.TREND_ENABLED) ?? Boolean((data as any).trendEnabled ?? false),
    evolutionApiUrl: envEvolutionApiUrl ?? (data as any).evolutionApiUrl ?? null,
    evolutionApiKey: envEvolutionApiKey ?? (data as any).evolutionApiKey ?? null,
    evolutionPhone: envEvolutionPhone ?? (data as any).evolutionPhone ?? null,
    evolutionInstance: envEvolutionInstance ?? (data as any).evolutionInstance ?? null,
    trendTimeframe: resolvedTrendTimeframe,
    trendTargetUp: envTrendTargetUp
      ?? dataTrendTargetUp
      ?? "sol",
    trendTargetDown: envTrendTargetDown
      ?? dataTrendTargetDown
      ?? "other",
    trendFallback: envTrendFallback
      ?? dataTrendFallback
      ?? "manual",
    trendStaleSec: Number(trendStaleSec),
    trendCacheSec: Number.isFinite(Number(trendCacheSec)) ? Number(trendCacheSec) : null,
    trendNetworkId,
    openaiApiKey: (process.env.OPENAI_API_KEY ?? (data as any).openaiApiKey ?? "").trim() || null,
    openaiDefaultModel: openAiDefaultModel,
    openaiRecommendedModels: openAiRecommendedModels,
    openaiAllowCustomModel: openAiAllowCustomModel,
    openaiTimeoutMs: Number(openAiTimeoutMs),
    bybitApiKey: envBybitApiKey ?? (data as any).bybitApiKey ?? null,
    bybitApiSecret: envBybitApiSecret ?? (data as any).bybitApiSecret ?? null,
    bybitBaseUrl: envBybitBaseUrl ?? (data as any).bybitBaseUrl ?? "https://api.bybit.com",
    bybitRecvWindow: parseEnvNumber(process.env.BYBIT_RECV_WINDOW)
      ?? (data as any).bybitRecvWindow
      ?? 5000,
    hedgeEnabled: parseEnvBool(process.env.HEDGE_ENABLED) ?? Boolean((data as any).hedgeEnabled ?? false),
    hedgePct: parseEnvNumber(process.env.HEDGE_PCT) ?? Number((data as any).hedgePct ?? 50),
    hedgeSymbol: (envHedgeSymbol ?? (data as any).hedgeSymbol ?? "").trim().toUpperCase(),
    hedgeLeverage: parseEnvNumber(process.env.HEDGE_LEVERAGE) ?? Number((data as any).hedgeLeverage ?? 1),
    hedgeMarginPct: parseEnvNumber(process.env.HEDGE_MARGIN_PCT) ?? Number((data as any).hedgeMarginPct ?? 0),
    hedgeEntryMode: envHedgeEntryMode ?? "off"
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
  if (!Number.isFinite(config.rangeExitBiasPct)
    || config.rangeExitBiasPct < 0
    || config.rangeExitBiasPct >= 100) {
    throw new Error("rangeExitBiasPct must be between 0 and 99.9");
  }
  if (
    config.rangeAnchor != null
    && config.rangeAnchor !== "lower"
    && config.rangeAnchor !== "middle"
    && config.rangeAnchor !== "upper"
  ) {
    throw new Error("rangeAnchor must be lower, middle, upper, or null");
  }
  if (config.preferredExitToken != null
    && config.preferredExitToken !== "tokenA"
    && config.preferredExitToken !== "tokenB") {
    throw new Error("preferredExitToken must be tokenA, tokenB, or null");
  }
  if (config.preferredExitDirection !== "down" && config.preferredExitDirection !== "up") {
    throw new Error("preferredExitDirection must be down or up");
  }
  if (!Number.isFinite(config.slippageBps) || config.slippageBps < 0 || config.slippageBps > MAX_SLIPPAGE_BPS) {
    throw new Error(`slippageBps must be between 0 and ${MAX_SLIPPAGE_BPS}`);
  }
  if (!Number.isFinite(config.pollIntervalMs) || config.pollIntervalMs < 1000) {
    throw new Error("pollIntervalMs must be >= 1000");
  }
  if (!Number.isFinite(config.rateLimitCooldownSec) || config.rateLimitCooldownSec < 0) {
    throw new Error("rateLimitCooldownSec must be >= 0");
  }
  if (!Number.isFinite(config.historyMaxEvents) || config.historyMaxEvents < 0) {
    throw new Error("historyMaxEvents must be >= 0");
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
  if (!Number.isFinite(config.autoSolSlippageBps)
    || config.autoSolSlippageBps < 0
    || config.autoSolSlippageBps > MAX_SLIPPAGE_BPS) {
    throw new Error(`autoSolSlippageBps must be between 0 and ${MAX_SLIPPAGE_BPS}`);
  }
  if (!Number.isFinite(config.autoSolCooldownSec) || config.autoSolCooldownSec < 0) {
    throw new Error("autoSolCooldownSec must be >= 0");
  }
  if (!Number.isFinite(config.autoSolTargetBufferPct) || config.autoSolTargetBufferPct < 0 || config.autoSolTargetBufferPct > 1) {
    throw new Error("autoSolTargetBufferPct must be between 0 and 1");
  }
  if (!Number.isFinite(config.kaminoScanIntervalSec) || config.kaminoScanIntervalSec < 5) {
    throw new Error("kaminoScanIntervalSec must be >= 5");
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
  if (!Number.isFinite(config.autoResumeMaxAttempts)
    || !Number.isInteger(config.autoResumeMaxAttempts)
    || config.autoResumeMaxAttempts < 1) {
    throw new Error("autoResumeMaxAttempts must be an integer >= 1");
  }
  if (!Number.isFinite(config.autoResumeBaseDelayMs) || config.autoResumeBaseDelayMs < 100) {
    throw new Error("autoResumeBaseDelayMs must be >= 100");
  }
  if (!config.autoSwapFeesToUsdcTargetMint || !config.autoSwapFeesToUsdcTargetMint.trim()) {
    config.autoSwapFeesToUsdcTargetMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  }
  // Valida endereço da carteira destino das fees, se fornecido
  if (config.autoSwapFeesToUsdcDestWallet) {
    const dest = config.autoSwapFeesToUsdcDestWallet.trim();
    // Validação básica: endereço Solana tem entre 32 e 44 chars base58
    if (dest.length < 32 || dest.length > 44) {
      throw new Error(
        "AUTO_SWAP_FEES_TO_USDC_DEST_WALLET: endereço Solana inválido (deve ter 32-44 caracteres)"
      );
    }
    config.autoSwapFeesToUsdcDestWallet = dest;
  }
  if (!Number.isFinite(config.autoSwapFeesToUsdcMinUsd) || config.autoSwapFeesToUsdcMinUsd < 0) {
    throw new Error("autoSwapFeesToUsdcMinUsd must be >= 0");
  }
  if (!Number.isFinite(config.kaminoDepositPct) || config.kaminoDepositPct < 0 || config.kaminoDepositPct > 100) {
    throw new Error("kaminoDepositPct must be between 0 and 100");
  }
  if (!parseKaminoBorrowAsset(config.kaminoBorrowAsset)) {
    throw new Error("kaminoBorrowAsset must be usdc, usdt, or auto");
  }
  if (config.kaminoMarketAddress != null && !String(config.kaminoMarketAddress).trim()) {
    throw new Error("kaminoMarketAddress must be a non-empty string");
  }
  if (!Number.isFinite(config.kaminoMaxLtv) || config.kaminoMaxLtv < 0 || config.kaminoMaxLtv > 1) {
    throw new Error("kaminoMaxLtv must be between 0 and 1");
  }
  if (!parseKaminoCloseRule(config.kaminoCloseRule)) {
    throw new Error("kaminoCloseRule must be avg-price, breakeven, or manual");
  }
  if (!Number.isFinite(config.kaminoPriceBufferPct) || config.kaminoPriceBufferPct < 0) {
    throw new Error("kaminoPriceBufferPct must be >= 0");
  }
  if (!Number.isFinite(config.kaminoMinCombinedPnlUsd)) {
    throw new Error("kaminoMinCombinedPnlUsd must be a number");
  }
  if (!parseKaminoCollateralMode(config.kaminoCollateralMode)) {
    throw new Error("kaminoCollateralMode must be exit, max-value, tokenA, tokenB, or both");
  }
  if (typeof config.kaminoAutoCloseOnTokenChange !== "boolean") {
    throw new Error("kaminoAutoCloseOnTokenChange must be boolean");
  }
  if (typeof config.kaminoConvertToCollateral !== "boolean") {
    throw new Error("kaminoConvertToCollateral must be boolean");
  }
  if (!parseKaminoAvgPriceBasis(config.kaminoAvgPriceBasis)) {
    throw new Error("kaminoAvgPriceBasis must be deposit or debt");
  }
  if (!parseKaminoAvgMode(config.kaminoAvgMode)) {
    throw new Error("kaminoAvgMode must be cumulative or reset");
  }
  if (!Number.isFinite(config.kaminoRepayRetrySec) || config.kaminoRepayRetrySec < 1) {
    throw new Error("kaminoRepayRetrySec must be >= 1");
  }
  if (!Number.isFinite(config.kaminoRepayMaxAttempts) || config.kaminoRepayMaxAttempts < 0) {
    throw new Error("kaminoRepayMaxAttempts must be >= 0");
  }
  if (!Number.isFinite(config.kaminoGracePeriodSec) || config.kaminoGracePeriodSec < 0) {
    throw new Error("kaminoGracePeriodSec must be >= 0");
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
  if (!Number.isFinite(config.trendStaleSec) || config.trendStaleSec < 0) {
    throw new Error("trendStaleSec must be >= 0");
  }
  if (config.trendCacheSec !== null && (!Number.isFinite(config.trendCacheSec) || config.trendCacheSec < 0)) {
    throw new Error("trendCacheSec must be >= 0 or null");
  }
  if (!config.trendTimeframe || !parseTrendTimeframe(config.trendTimeframe)) {
    throw new Error("trendTimeframe must be 1m, 5m, 30m, or 1h");
  }
  if (!config.trendTargetUp || !parseTrendTarget(config.trendTargetUp)) {
    throw new Error("trendTargetUp must be sol, other, tokenA, or tokenB");
  }
  if (!config.trendTargetDown || !parseTrendTarget(config.trendTargetDown)) {
    throw new Error("trendTargetDown must be sol, other, tokenA, or tokenB");
  }
  if (!config.trendFallback || !parseTrendFallback(config.trendFallback)) {
    throw new Error("trendFallback must be manual, neutral, or last");
  }
  if (config.trendEnabled && (!config.trendNetworkId || !config.trendNetworkId.trim())) {
    throw new Error("trendNetworkId is required when trendEnabled is true");
  }
  if (!config.openaiDefaultModel || !config.openaiDefaultModel.trim()) {
    throw new Error("openaiDefaultModel must be a non-empty string");
  }
  if (!Array.isArray(config.openaiRecommendedModels) || config.openaiRecommendedModels.length === 0) {
    throw new Error("openaiRecommendedModels must include at least one model");
  }
  config.openaiRecommendedModels = Array.from(
    new Set(
      config.openaiRecommendedModels
        .map((item) => String(item ?? "").trim())
        .filter((item) => item.length > 0)
    )
  );
  if (!config.openaiRecommendedModels.includes(config.openaiDefaultModel)) {
    config.openaiRecommendedModels.unshift(config.openaiDefaultModel);
  }
  if (!Number.isFinite(config.openaiTimeoutMs) || config.openaiTimeoutMs < 1_000) {
    throw new Error("openaiTimeoutMs must be >= 1000");
  }

  if (!Number.isFinite(config.bybitRecvWindow) || config.bybitRecvWindow <= 0) {
    throw new Error("bybitRecvWindow must be > 0");
  }
  if (!Number.isFinite(config.hedgePct) || config.hedgePct < 0 || config.hedgePct > 100) {
    throw new Error("hedgePct must be between 0 and 100");
  }
  if (!Number.isFinite(config.hedgeLeverage) || config.hedgeLeverage < 1) {
    throw new Error("hedgeLeverage must be >= 1");
  }
  if (!Number.isFinite(config.hedgeMarginPct) || config.hedgeMarginPct < 0 || config.hedgeMarginPct > 100) {
    throw new Error("hedgeMarginPct must be between 0 and 100");
  }
  if (!parseHedgeEntryMode(config.hedgeEntryMode)) {
    throw new Error("hedgeEntryMode must be off, trend-down, trend-up, trend-any, force-down, or force-up");
  }
  const hedgeNeedsTrend = ["trend-down", "trend-up", "trend-any"].includes(config.hedgeEntryMode);
  if (hedgeNeedsTrend && (!config.trendNetworkId || !config.trendNetworkId.trim())) {
    throw new Error("trendNetworkId is required when hedgeEntryMode uses trend");
  }
  if (config.hedgeEnabled) {
    if (!config.hedgeSymbol || !config.hedgeSymbol.trim()) {
      throw new Error("hedgeSymbol is required when hedgeEnabled is true");
    }
    if (!config.bybitApiKey || !config.bybitApiSecret) {
      throw new Error("BYBIT_API_KEY and BYBIT_API_SECRET are required when hedgeEnabled is true");
    }
    if (!config.bybitBaseUrl || !config.bybitBaseUrl.trim()) {
      throw new Error("bybitBaseUrl is required when hedgeEnabled is true");
    }
    if (config.hedgePct <= 0) {
      throw new Error("hedgePct must be > 0 when hedgeEnabled is true");
    }
  }


  return config;
}
