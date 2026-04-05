import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount
} from "@solana/spl-token";
import DecimalJs from "decimal.js";
import * as whirlpoolsSdk from "@orca-so/whirlpools-sdk";
import * as commonSdk from "@orca-so/common-sdk";

import { Config } from "./config.js";
import { createKaminoClient } from "./kamino-client.js";
import type { KaminoClient } from "./kamino-client.js";
import { releaseKaminoLock, tryAcquireKaminoLock } from "./kamino-lock.js";
import { logger, stringifyError } from "./logger.js";
import { calculateRange, isPriceOutOfRange, resolveDirectionalExitPreference, Range } from "./strategy.js";
import { alignTickRangeToSpacing } from "./tick-range.js";
import { WalletLike } from "./solana.js";
import { getSolUsdPrice } from "./pyth.js";
import { getTrendSnapshot } from "./trend.js";
import type { TrendDirection, TrendTarget, TrendTimeframe } from "./trend.js";
import type { KaminoCollateralEntry, KaminoCycleState } from "./kamino-types.js";
import { KaminoHealthMonitor } from "./kamino-health.js";
import { notifyKaminoFundsNeeded } from "./evolution-notify.js";
import type { KaminoPositionState, KaminoWithdrawResult } from "./kamino-client.js";
import { BalanceCoordinator } from "./balance-coordinator.js";

const whirlpools = whirlpoolsSdk as any;
const common = commonSdk as any;
const Decimal: any = DecimalJs;
const MIN_ENTRY_BUDGET_FACTOR = 0.25;
const MAX_USD_SANITY = 1_000_000_000;
const DEFAULT_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const KAMINO_REPAY_CHUNK_FACTOR = 0.5;
const KAMINO_REPAY_MIN_STABLE = 0.1; // unidade do stable
const KAMINO_WITHDRAW_MIN = 0.000001;
const KAMINO_REBALANCE_RETRY_SEC = 10;
const DEFAULT_TX_SIZE_THRESHOLD = 1200;
const FORCE_SPLIT_SOL = true;
const JUPITER_DIRECT_ONLY = false;
const KAMINO_SWAP_SLIPPAGE_BPS = 100;
const DEFAULT_KAMINO_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";

export function computeRiskAwareRepayChunk(params: {
  debtRemaining: number;
  capacityUi: number;
  priceCollToDebt: number;
  minStable: number;
}): { chunk: number; reason?: string } {
  const { debtRemaining, capacityUi, priceCollToDebt, minStable } = params;
  if (!Number.isFinite(capacityUi) || capacityUi <= 0) {
    return { chunk: 0, reason: "capacidade de saque insuficiente" };
  }
  if (!Number.isFinite(priceCollToDebt) || priceCollToDebt <= 0) {
    return { chunk: 0, reason: "preco indisponivel para colateral" };
  }
  const capacityDebt = capacityUi * priceCollToDebt;
  const chunk = Math.min(debtRemaining, capacityDebt);
  if (chunk < minStable) {
    return { chunk: 0, reason: "capacidade de saque insuficiente" };
  }
  return { chunk };
}

export function selectRepayChunkWithQuote(params: {
  debtRemaining: number;
  capacityUi: number;
  priceCollToDebt: number;
  quoteOutStableUi: number | null;
  minStable: number;
  tolerance?: number; // multiplicador para checar se debt cabe na capacidade (p.ex. 1.05)
}): { chunk: number; reason?: string } {
  const { debtRemaining, capacityUi, priceCollToDebt, quoteOutStableUi, minStable } = params;
  const tolerance = Number.isFinite(params.tolerance) ? Math.max(1, Number(params.tolerance)) : 1.05;
  if (!Number.isFinite(capacityUi) || capacityUi <= 0) {
    return { chunk: 0, reason: "capacidade de saque insuficiente" };
  }
  const priceFromQuote =
    quoteOutStableUi != null && capacityUi > 0 ? quoteOutStableUi / capacityUi : null;
  const effectivePrice =
    priceFromQuote != null && priceFromQuote > 0
      ? priceFromQuote
      : Number.isFinite(priceCollToDebt) && priceCollToDebt > 0
        ? priceCollToDebt
        : 0;
  if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) {
    return { chunk: 0, reason: "preco/quote indisponivel para colateral" };
  }
  const maxByPrice = capacityUi * effectivePrice;
  const maxByQuote = quoteOutStableUi != null ? quoteOutStableUi : maxByPrice;
  let chunk = Math.min(debtRemaining, Math.max(0, maxByQuote));
  // Sanidade: se precisar de mais colateral que a capacidade tolerada, limite ao preço
  const collNeededForDebt =
    effectivePrice > 0 ? debtRemaining / effectivePrice : Number.POSITIVE_INFINITY;
  if (collNeededForDebt > capacityUi * tolerance) {
    chunk = Math.min(chunk, maxByPrice);
  }
  if (chunk < minStable) {
    return { chunk: 0, reason: "capacidade insuficiente (price/quote)" };
  }
  return { chunk };
}

export async function performSplitRepayWithCollateralHelper(params: {
  kamino: {
    withdraw(input: { mint: string; amount: number }): Promise<KaminoWithdrawResult>;
    repay(input: { mint: string; amount: number }): Promise<string>;
  };
  swapTokenToStable: (input: {
    inputMint: string;
    inputDecimals: number;
    amountUi: number;
    stableMint: string;
    stableDecimals: number;
    label?: string;
  }) => Promise<number | null>;
  collMint: string;
  collDecimals: number;
  debtMint: string;
  debtDecimals: number;
  repayUi: number;
  capacityUi: number;
  priceCollToDebt: number;
  minWithdraw: number;
  logger: (payload: any, msg: string, level?: "info" | "warn" | "error") => void;
  isRetryable: (msg: string) => boolean;
  onWithdrawSuccess?: (result: KaminoWithdrawResult) => void;
  onRepaySuccess?: (signature: string, amount: number, mint: string) => void;
}): Promise<{ performed: boolean; retryable?: boolean; error?: string; debtRemaining?: number }> {
  const {
    kamino,
    swapTokenToStable,
    collMint,
    collDecimals,
    debtMint,
    debtDecimals,
    repayUi,
    capacityUi,
    priceCollToDebt,
    minWithdraw,
    logger,
    isRetryable,
    onWithdrawSuccess,
    onRepaySuccess
  } = params;
  const runWithRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    let lastErr: any;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = stringifyError(err);
        if (isRetryable(msg) && attempt === 0) {
          // Blockhash expirado precisa de ~15s; rate-limit precisa de ~3s.
          const waitMs = msg.includes("-32002") ? 15000 : 3000;
          await sleep(waitMs);
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  };
  if (!Number.isFinite(priceCollToDebt) || priceCollToDebt <= 0) {
    const error = "preco do colateral indisponivel para split repay";
    return { performed: false, error };
  }
  let collNeeded = Math.max(minWithdraw, Math.min(capacityUi, repayUi / priceCollToDebt * 1.02));
  let withdrawAttempts = 0;
  const maxWithdrawAttempts = 3;
  while (withdrawAttempts < maxWithdrawAttempts) {
    if (collNeeded < minWithdraw || collNeeded > capacityUi + 1e-9) {
      const error = `capacidade insuficiente para split (need ${collNeeded.toFixed(8)}, cap ${capacityUi.toFixed(8)})`;
      return { performed: false, error };
    }
    try {
      const withdrawResult = await runWithRetry(() => kamino.withdraw({ mint: collMint, amount: collNeeded }));
      const actualAmount = Number(withdrawResult.actualAmount ?? collNeeded);
      logger(
        { sig: withdrawResult.signature, amount: actualAmount, mint: collMint },
        "split-repay withdraw",
        "info"
      );
      if (onWithdrawSuccess) {
        onWithdrawSuccess(withdrawResult);
      }
      collNeeded = actualAmount;
      break;
    } catch (err) {
      withdrawAttempts += 1;
      const message = stringifyError(err);
      const lower = message.toLowerCase();
      if (
        lower.includes("withdrawtoolarge") ||
        lower.includes("withdraw too large") ||
        lower.includes("6011") ||
        lower.includes("0x177b")
      ) {
        let maxWithdrawFromError: number | null = null;
        try {
          const decoded = decodeURIComponent(message);
          const matchMax = decoded.match(/max_withdraw_value[=\s:]+([0-9]+(?:\.[0-9]+)?)/i);
          if (matchMax) {
            const parsed = parseFloat(matchMax[1]);
            if (Number.isFinite(parsed) && parsed > 0) {
              maxWithdrawFromError = parsed;
            }
          }
        } catch {
          // ignore
        }
        if (maxWithdrawFromError != null) {
          const priceFactor = priceCollToDebt > 0 ? priceCollToDebt : 1;
          collNeeded = Math.max(minWithdraw, (maxWithdrawFromError * 0.85) / priceFactor);
        } else {
          collNeeded = Math.max(minWithdraw, collNeeded / 2);
        }
        if (withdrawAttempts >= maxWithdrawAttempts) {
          return { performed: false, error: message };
        }
        continue;
      }
      if (isRetryable(message)) {
        return { performed: false, retryable: true, error: message };
      }
      return { performed: false, error: message };
    }
  }
  let stableOut = 0;
  try {
    const swapped = await runWithRetry(() =>
      swapTokenToStable({
        inputMint: collMint,
        inputDecimals: collDecimals,
        amountUi: collNeeded,
        stableMint: debtMint,
        stableDecimals: debtDecimals,
        label: "split-repay-coll->stable"
      })
    );
    stableOut = swapped ?? 0;
    if (stableOut <= 0) {
      return { performed: false, error: "swap retornou valor zero" };
    }
    logger({ in: collNeeded, out: stableOut, collMint, debtMint }, "split-repay swap", "info");
  } catch (err) {
    const message = stringifyError(err);
    if (isRetryable(message)) {
      return { performed: false, retryable: true, error: message };
    }
    return { performed: false, error: message };
  }
  const repayAmount = Math.min(repayUi, stableOut);
  if (repayAmount <= 0) {
    return { performed: false, error: "valor de repay <= 0 apos swap" };
  }
  try {
    const repaySig = await runWithRetry(() => kamino.repay({ mint: debtMint, amount: repayAmount }));
    logger({ sig: repaySig, amount: repayAmount, mint: debtMint }, "split-repay repay", "info");
    if (onRepaySuccess) {
      onRepaySuccess(repaySig, repayAmount, debtMint);
    }
    const remaining = Math.max(0, repayUi - repayAmount);
    return { performed: true, debtRemaining: remaining };
  } catch (err) {
    const message = stringifyError(err);
    if (isRetryable(message)) {
      return { performed: false, retryable: true, error: message };
    }
    return { performed: false, error: message };
  }
}

export type BotContext = {
  connection: Connection;
  wallet: WalletLike;
  config: Config;
  onLowSol?: () => Promise<void>;
  poolId?: string | null;
  balanceCoordinator?: BalanceCoordinator | null;
  getKaminoMarketCandidates?: () => string[];
};

type PoolState = {
  pool: any;
  poolAddress: PublicKey;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  decimalsA: number;
  decimalsB: number;
  tickSpacing: number;
  isTokenASol: boolean;
  isTokenBSol: boolean;
};

export type KaminoHealthStatus = {
  stuck: boolean;
  issues: string[];
  consecutiveErrors: number;
  lastProgressAt: string | null;
  recentErrors: { type: string; count: number }[];
};

export type BotStatus = {
  running: boolean;
  lastAction: string | null;
  lastError: string | null;
  lastActionFeeLamports: number | null;
  lastPrice: number | null;
  solUsdPrice: number | null;
  budgetUsd: number | null;
  budgetSol: number | null;
  targetRange: Range | null;
  positionRange: Range | null;
  positionMint: string | null;
  solBalance: number | null;
  tokenABalance: number | null;
  tokenBBalance: number | null;
  positionTokenA: number | null;
  positionTokenB: number | null;
  portfolioValue: number | null;
  pnl: number | null;
  portfolioUsd: number | null;
  pnlUsd: number | null;
  positionValue: number | null;
  positionPnl: number | null;
  positionValueUsd: number | null;
  positionPnlUsd: number | null;
  positionEntryUsd: number | null;
  positionFeesUsd: number | null;
  positionExitUsd: number | null;
  eventPositionMint: string | null;
  eventPositionEntryUsd: number | null;
  eventPositionFeesUsd: number | null;
  eventPositionExitUsd: number | null;
  tokenAMint: string | null;
  tokenBMint: string | null;
  isTokenASol: boolean | null;
  isTokenBSol: boolean | null;
  lastOpenTokenA: number | null;
  lastOpenTokenB: number | null;
  lastCloseTokenA: number | null;
  lastCloseTokenB: number | null;
  trendDirection: TrendDirection | null;
  trendTimeframe: TrendTimeframe | null;
  trendUpdatedAt: string | null;
  trendPreferredExitToken: "tokenA" | "tokenB" | null;
  effectiveExitToken: "tokenA" | "tokenB" | null;
  effectiveExitDirection: "down" | "up";
  effectiveExitSide: "lower" | "upper" | null;
  effectiveValueToken: "tokenA" | "tokenB" | null;
  trendStale: boolean | null;
  kaminoActive: boolean;
  kaminoEnabled: boolean;
  kaminoCollateralUsd: number | null;
  kaminoDebtUsd: number | null;
  kaminoLtv: number | null;
  kaminoAvgPriceUsdc: number | null;
  kaminoTargetPriceUsdc: number | null;
  kaminoCycleCount: number;
  kaminoLastError: string | null;
  kaminoCollaterals: KaminoCollateralEntry[];
  kaminoSimulated: boolean;
  kaminoOwnerPoolId: string | null;
  kaminoOwnerPoolName: string | null;
  kaminoMarketAddress: string | null;
  kaminoHealth: KaminoHealthStatus | null;
};

export type KaminoLogItem = {
  level: "info" | "warn" | "error";
  action: string;
  message: string;
  marketAddress: string | null;
  timestamp?: string;
};

type SwapWalletToSolDetail = {
  mint: string;
  amountInRaw: string;
  amountInUi: number;
  decimals: number;
  status: "swapped" | "failed" | "skipped";
  reason?: string;
  error?: string;
  outLamports?: number;
  signature?: string | null;
};

type SwapWalletToSolResult = {
  swaps: number;
  failed: number;
  totalOutLamports: number;
  reason?: string;
  details: SwapWalletToSolDetail[];
};

export class OrcaBot {
  private static topupInFlight = false;
  private static lastTopupAt: number | null = null;
  private static jupiterQueue: Promise<void> = Promise.resolve();
  private static jupiterNextAllowedAt = 0;
  private static readonly jupiterMinIntervalMs = 1100;

  private connection: Connection;
  private wallet: WalletLike;
  private config: Config;
  private ctx: any;
  private client: any;
  private poolState: PoolState | null = null;
  private currentPosition: any | null = null;
  private currentPositionMint: string | null = null;
  private initialPortfolioValue: number | null = null;
  private initialPortfolioValueSol: number | null = null;
  private initialPositionValue: number | null = null;
  private initialPositionValueSol: number | null = null;
  private positionEntryUsd: number | null = null;
  private lastPositionValueUsdWithFees: number | null = null;
  private actionFeeLamports: number | null = null;
  private outOfRangeSince: number | null = null;
  private lastRebalanceAt: number | null = null;
  private missingPositionSince: number | null = null;
  private nullPnlNoFeesTicks: number = 0;
  private kaminoPoolOpenedAt: number | null = null;
  private onLowSol?: () => Promise<void>;
  private kaminoTooLargeSeen = false;
  private lastTrendPreferredExitToken: "tokenA" | "tokenB" | null = null;
  private swapAllowlist: Set<string> | null = null;
  private kaminoState: KaminoCycleState | null = null;
  private kaminoHealth: KaminoHealthMonitor = new KaminoHealthMonitor();
  private kaminoClient: KaminoClient | null = null;
  private kaminoClientMarket: string | null = null;
  private kaminoMarketCandidates: (() => string[]) | null = null;
  private poolId: string | null = null;
  private poolName: string | null = null;
  private balanceCoordinator: BalanceCoordinator | null = null;
  private pendingHistoryActions: BotStatus[] = [];
  private pendingKaminoLogs: KaminoLogItem[] = [];
  private stableMintCache = new Map<string, { mint: string; decimals: number }>();
  private lastStatus: BotStatus = {
    running: false,
    lastAction: null,
    lastError: null,
    lastActionFeeLamports: null,
    lastPrice: null,
    solUsdPrice: null,
    budgetUsd: null,
    budgetSol: null,
    targetRange: null,
    positionRange: null,
    positionMint: null,
    solBalance: null,
    tokenABalance: null,
    tokenBBalance: null,
    positionTokenA: null,
    positionTokenB: null,
    portfolioValue: null,
    pnl: null,
    portfolioUsd: null,
    pnlUsd: null,
    positionValue: null,
    positionPnl: null,
    positionValueUsd: null,
    positionPnlUsd: null,
    positionEntryUsd: null,
    positionFeesUsd: null,
    positionExitUsd: null,
    eventPositionMint: null,
    eventPositionEntryUsd: null,
    eventPositionFeesUsd: null,
    eventPositionExitUsd: null,
    tokenAMint: null,
    tokenBMint: null,
    isTokenASol: null,
    isTokenBSol: null,
    lastOpenTokenA: null,
    lastOpenTokenB: null,
    lastCloseTokenA: null,
    lastCloseTokenB: null,
    trendDirection: null,
    trendTimeframe: null,
    trendUpdatedAt: null,
    trendPreferredExitToken: null,
    effectiveExitToken: null,
    effectiveExitDirection: "down",
    effectiveExitSide: null,
    effectiveValueToken: null,
    trendStale: null,
  kaminoActive: false,
  kaminoEnabled: false,
  kaminoCollateralUsd: null,
  kaminoDebtUsd: null,
  kaminoLtv: null,
    kaminoAvgPriceUsdc: null,
    kaminoTargetPriceUsdc: null,
  kaminoCycleCount: 0,
  kaminoLastError: null,
  kaminoCollaterals: [],
  kaminoSimulated: false,
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
  };

  private constructor(ctx: any, client: any, botCtx: BotContext) {
    this.ctx = ctx;
    this.client = client;
    this.connection = botCtx.connection;
    this.wallet = botCtx.wallet;
    this.config = botCtx.config;
    this.onLowSol = botCtx.onLowSol;
    this.poolId = botCtx.poolId ?? null;
    this.balanceCoordinator = botCtx.balanceCoordinator ?? null;
    this.kaminoMarketCandidates = botCtx.getKaminoMarketCandidates ?? null;
  }

  private isRateLimitError(err: any): boolean {
    if (!err) return false;
    const message = String(err?.message ?? err?.context?.message ?? err).toLowerCase();
    const status = err?.context?.statusCode ?? err?.statusCode;
    const code = err?.context?.__code ?? err?.__code ?? err?.code;
    return status === 429
      || String(code) === "8100002"
      || message.includes("too many requests")
      || message.includes("429");
  }

  private isKaminoRetryableError(err: any): boolean {
    if (!err) return false;
    if (this.isRateLimitError(err)) return true;
    const message = String(err?.message ?? err).toLowerCase();
    // Verifica erro original embutido (quando sendAction encapsula 0x1 em retryable)
    const originalErr = (err as any)?.__originalErr ?? (err as any)?.cause;
    const originalMsg = originalErr ? String(originalErr?.message ?? originalErr).toLowerCase() : "";
    if (
      /custom program error: 0x1(?![0-9a-f])/i.test(message) ||
      message.includes("\"0x1\"") ||
      message.includes("insufficient funds") ||
      /custom program error: 0x1(?![0-9a-f])/i.test(originalMsg) ||
      originalMsg.includes("insufficient funds") ||
      originalMsg.includes("\"0x1\"")
    ) {
      return false;
    }
    if (
      message.includes("0x1553") ||
      message.includes("sqrtpriceoutofbounds") ||
      message.includes("sqrt price out of bounds")
    ) {
      return true;
    }
    return message.includes("-32002")
      || message.includes("-32602")
      || message.includes("invalid params")
      || message.includes("8100002") // rate limit from rpc-transport
      || message.includes("rpc response error")
      || message.includes("too many requests")
      || message.includes("429");
  }

  private isKaminoQuoteError(err: any): boolean {
    if (!err) return false;
    const message = String(err?.message ?? err).toLowerCase();
    if (message.includes("too large")) return false;
    return message.includes("invalid params")
      || message.includes("invalid parameters")
      || message.includes("quote failed")
      || message.includes("quote-failed");
  }

  private scheduleKaminoRepayRetry(
    state: KaminoCycleState,
    reason: string,
    mode: "manual" | "target" | "token-change"
  ): boolean {
    const retrySec = Math.max(1, Number(this.config.kaminoRepayRetrySec ?? 15));
    const maxAttempts = Math.max(0, Math.floor(Number(this.config.kaminoRepayMaxAttempts ?? 5)));
    const nextAttempts = Number(state.repayRetryAttempts ?? 0) + 1;
    if (maxAttempts === 0 || nextAttempts > maxAttempts) {
      this.setKaminoState({
        ...state,
        repayRetryUntil: null,
        repayRetryAttempts: nextAttempts,
        repayRetryReason: reason,
        lastError: reason
      });
      return false;
    }
    const retryAt = new Date(Date.now() + retrySec * 1000);
    const currentRetryAt = state.repayRetryUntil
      ? new Date(state.repayRetryUntil)
      : null;
    const effectiveRetryAt = currentRetryAt && currentRetryAt > retryAt
      ? currentRetryAt
      : retryAt;
    const maxRetryHours = 2;
    const maxRetryMs = maxRetryHours * 60 * 60 * 1000;
    if (effectiveRetryAt.getTime() - Date.now() > maxRetryMs) {
      logger.error("Ciclo Kamino preso: repay falhou por mais de 2 horas. Intervenção manual necessária.");
      this.queueKaminoLog(
        "stuck",
        "Ciclo Kamino preso. Repay falhou repetidamente. Verifique saldo e intervir manualmente.",
        "error"
      );
      return false;
    }
    const retryUntil = effectiveRetryAt.toISOString();
    const message = `${reason} (nova tentativa em ${retrySec}s)`;
    this.setKaminoState({
      ...state,
      repayRetryUntil: retryUntil,
      repayRetryAttempts: nextAttempts,
      repayRetryReason: reason,
      lastError: message
    });
    this.queueKaminoLog("repay-wait", message, "warn");
    if (mode === "target" || mode === "manual") {
      return true;
    }
    throw new Error(message);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private recordKaminoSuccess(
    type: "deposit" | "borrow" | "repay" | "withdraw" | "repay-with-collateral",
    mint: string,
    amount: number,
    signature: string
  ): void {
    if (!this.kaminoState) {
      return;
    }
    this.setKaminoState({
      ...this.kaminoState,
      lastSuccessfulOperation: {
        type,
        signature,
        timestamp: new Date().toISOString(),
        mint,
        amount
      }
    });
  }

  private recordWithdrawDust(dustAmount: number, mint: string): void {
    if (!this.kaminoState) {
      return;
    }
    const dust = Number(dustAmount ?? 0);
    if (!Number.isFinite(dust) || dust <= 0) {
      return;
    }
    const current = Number(this.kaminoState.reservedCollateralDust ?? 0);
    const next = (Number.isFinite(current) ? current : 0) + dust;
    this.setKaminoState({
      ...this.kaminoState,
      reservedCollateralDust: next
    });
    this.queueKaminoLog(
      "withdraw-dust",
      `Withdraw parcial registrou dust ${dust.toFixed(8)} ${mint} (total ${next.toFixed(8)}).`,
      "warn"
    );
  }

  private async kaminoCallWithRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastErr: any;
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const result = await fn();
        this.kaminoHealth.recordSuccess(label);
        return result;
      } catch (err) {
        this.kaminoHealth.recordError(err, label);
        const prevErr = lastErr;
        lastErr = err;
        if (this.isRateLimitError(err)) {
          // Correção Bug 3: aumentar jitter para evitar thundering herd após restart.
          // Múltiplos pools/operações fazendo retry ao mesmo tempo = mais 429s.
          const baseWait = 5000;
          const jitter = Math.random() * 3000; // até 3s de jitter aleatório
          const waitMs = Math.min(baseWait * Math.pow(2, attempt) + jitter, 30000);
          logger.warn({ err, attempt, label, waitMs }, "kamino call rate-limited; retrying");
          await this.sleep(waitMs);
          continue;
        }
        if (this.isKaminoRetryableError(err) && attempt < 2) {
          const prevMsg = String((prevErr as any)?.message ?? "").toLowerCase();
          const currMsg = String((err as any)?.message ?? "").toLowerCase();
          const origErr = (err as any)?.__originalErr ?? (err as any)?.cause;
          const origMsg = origErr ? String(origErr?.message ?? origErr).toLowerCase() : "";
          // Se o erro atual, anterior OU o erro original embutido indicam 0x1, não fazer retry.
          if (
            /\b0x1\b/.test(prevMsg) ||
            prevMsg.includes("insufficient funds") ||
            /\b0x1\b/.test(currMsg) ||
            currMsg.includes("insufficient funds") ||
            /custom program error: 0x1(?![0-9a-f])/i.test(currMsg) ||
            /\b0x1\b/.test(origMsg) ||
            origMsg.includes("insufficient funds") ||
            /custom program error: 0x1(?![0-9a-f])/i.test(origMsg)
          ) {
            throw err;
          }
          const msg = String((err as any)?.message ?? err);
          const waitMs = msg.includes("-32002") ? 15000 : 5000;
          logger.warn({ err, attempt, label, waitMs }, "kamino call retryable (blockhash/rpc); aguardando");
          await this.sleep(waitMs);
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new Error(`falha ao executar Kamino ${label}`);
  }

  private resolveTrendTarget(target: TrendTarget): "tokenA" | "tokenB" | null {
    if (target === "tokenA" || target === "tokenB") {
      return target;
    }
    if (!this.poolState) {
      return null;
    }
    if (target === "sol") {
      if (this.poolState.isTokenASol) return "tokenA";
      if (this.poolState.isTokenBSol) return "tokenB";
      return null;
    }
    if (target === "other") {
      if (this.poolState.isTokenASol) return "tokenB";
      if (this.poolState.isTokenBSol) return "tokenA";
      return null;
    }
    return null;
  }

  private resolveTrendFallback(manual: "tokenA" | "tokenB" | null): "tokenA" | "tokenB" | null {
    if (this.config.trendFallback === "neutral") {
      return null;
    }
    if (this.config.trendFallback === "last") {
      return this.lastTrendPreferredExitToken ?? manual;
    }
    return manual;
  }

  private resolvePreferredExitToken(trendDirection: TrendDirection | null, trendStale: boolean | null): "tokenA" | "tokenB" | null {
    const manual = this.config.preferredExitToken ?? null;
    if (!this.config.trendEnabled) {
      return manual;
    }
    if (!trendDirection || trendStale) {
      return this.resolveTrendFallback(manual);
    }
    const target = trendDirection === "up" ? this.config.trendTargetUp : this.config.trendTargetDown;
    const resolved = this.resolveTrendTarget(target);
    if (resolved) {
      this.lastTrendPreferredExitToken = resolved;
      return resolved;
    }
    return this.resolveTrendFallback(manual);
  }

  private async updateTrendStatus(): Promise<{ direction: TrendDirection | null; stale: boolean | null }> {
    this.lastStatus.trendDirection = null;
    this.lastStatus.trendTimeframe = null;
    this.lastStatus.trendUpdatedAt = null;
    this.lastStatus.trendStale = null;
    if (!this.config.trendEnabled) {
      return { direction: null, stale: null };
    }
    const snapshot = await getTrendSnapshot({
      networkId: this.config.trendNetworkId,
      poolAddress: this.config.whirlpoolAddress,
      timeframe: this.config.trendTimeframe,
      staleSec: this.config.trendStaleSec,
      cacheSec: this.config.trendCacheSec
    });
    this.lastStatus.trendDirection = snapshot?.direction ?? null;
    this.lastStatus.trendTimeframe = snapshot?.timeframe ?? this.config.trendTimeframe ?? null;
    this.lastStatus.trendUpdatedAt = snapshot?.updatedAt ?? null;
    this.lastStatus.trendStale = snapshot?.stale ?? false;
    return { direction: this.lastStatus.trendDirection, stale: this.lastStatus.trendStale };
  }

  static async create(botCtx: BotContext): Promise<OrcaBot> {
    const ctx = whirlpools.WhirlpoolContext.from(botCtx.connection, botCtx.wallet);
    const client = whirlpools.buildWhirlpoolClient(ctx);
    const bot = new OrcaBot(ctx, client, botCtx);
    await bot.refreshPoolState();
    await bot.loadExistingPosition();
    return bot;
  }

  async tick(): Promise<BotStatus> {
    this.lastStatus.running = true;
    this.lastStatus.eventPositionMint = null;
    this.lastStatus.eventPositionEntryUsd = null;
    this.lastStatus.eventPositionFeesUsd = null;
    this.lastStatus.eventPositionExitUsd = null;
    this.resetActionFee();
    await this.reconcileKaminoState();
    this.syncKaminoStatus();
    const health = this.lastStatus.kaminoHealth ?? this.getKaminoHealth();
    this.lastStatus.kaminoHealth = health;
    if (health.issues.length > 0) {
      logger.warn(
        { issues: health.issues, consecutiveErrors: health.consecutiveErrors },
        "Problemas detectados no Kamino health monitor"
      );
    }
    await this.refreshKaminoCollateralMetrics();
    await this.refreshPoolState();
    if (this.kaminoState?.repayRetryUntil) {
      const retryAt = Date.parse(this.kaminoState.repayRetryUntil);
      if (Number.isFinite(retryAt) && retryAt > Date.now()) {
        this.lastStatus.lastAction = "kamino-repay-wait";
        return this.getStatus();
      }
    }
    const trendSnapshot = await this.updateTrendStatus();
    const preferredExitToken = this.resolvePreferredExitToken(trendSnapshot.direction, trendSnapshot.stale);
    this.lastStatus.trendPreferredExitToken = preferredExitToken;
    const preferredExitDirection = this.config.preferredExitDirection === "up" ? "up" : "down";
    const exitPreference = resolveDirectionalExitPreference(preferredExitToken, preferredExitDirection, {
      invertPriceAxis: this.shouldInvertUserPriceAxis()
    });
    const exitSide = exitPreference?.exitSide;
    const valueToken = exitPreference?.valueToken;
    this.lastStatus.effectiveExitToken = preferredExitToken;
    this.lastStatus.effectiveExitDirection = preferredExitDirection;
    this.lastStatus.effectiveExitSide = exitSide ?? null;
    this.lastStatus.effectiveValueToken = valueToken ?? null;

    const solBalance = (await this.connection.getBalance(this.wallet.publicKey)) / LAMPORTS_PER_SOL;
    this.lastStatus.solBalance = solBalance;
    if (solBalance < this.config.minSolBalance) {
      const topupResult = await this.maybeTopUpSol("auto", solBalance);
      if (topupResult.performed) {
        const refreshed = (await this.connection.getBalance(this.wallet.publicKey)) / LAMPORTS_PER_SOL;
        this.lastStatus.solBalance = refreshed;
      }
      let finalSol = this.lastStatus.solBalance ?? solBalance;
      if (finalSol < this.config.minSolBalance) {
        if (this.onLowSol) {
          try {
            await this.onLowSol();
            const refreshed = (await this.connection.getBalance(this.wallet.publicKey)) / LAMPORTS_PER_SOL;
            this.lastStatus.solBalance = refreshed;
            finalSol = refreshed;
          } catch (err) {
            logger.warn({ err }, "low-sol auto-close failed");
          }
        }
      }
      if (finalSol < this.config.minSolBalance && !this.config.allowLowSolOperations) {
        logger.warn({ solBalance: finalSol, reason: topupResult.reason }, "SOL balance below minSolBalance; skipping");
        await this.loadExistingPosition();
        if (this.currentPosition) {
          const price = await this.getCurrentPrice();
          const range = calculateRange(price, this.config.rangeWidthPct, {
            exitBiasPct: this.config.rangeExitBiasPct,
            exitSide,
            valueToken
          });
          const executionRange = this.getExecutionRange(range, price);
          const solUsdPrice = await this.tryGetSolUsdPrice();
          this.lastStatus.lastPrice = price;
          this.lastStatus.targetRange = executionRange;
          this.lastStatus.solUsdPrice = solUsdPrice;
          this.lastStatus.budgetUsd = this.config.budgetUsd;
          this.lastStatus.budgetSol = solUsdPrice && this.config.budgetUsd
            ? this.config.budgetUsd / solUsdPrice
            : null;
          this.lastStatus.positionRange = await this.getPositionRange(this.currentPosition);
          this.lastStatus.positionMint = this.currentPositionMint;
          await this.updatePortfolioSnapshot(price, solUsdPrice);
          this.lastStatus.lastAction = "skip-low-sol-position";
          return this.getStatus();
        }
        this.lastStatus.lastAction = "skip-low-sol";
        this.lastStatus.positionRange = null;
        this.lastStatus.positionMint = this.currentPositionMint;
        return this.getStatus();
      }
      if (finalSol < this.config.minSolBalance && this.config.allowLowSolOperations) {
        logger.warn({ solBalance: finalSol, reason: topupResult.reason }, "SOL balance below minSolBalance; continuing by config");
      }
    }
    const price = await this.getCurrentPrice();
    const range = calculateRange(price, this.config.rangeWidthPct, {
      exitBiasPct: this.config.rangeExitBiasPct,
      exitSide,
      valueToken
    });
    const executionRange = this.getExecutionRange(range, price);
    this.lastStatus.lastPrice = price;
    this.lastStatus.targetRange = executionRange;
    const solUsdPrice = await this.tryGetSolUsdPrice();
    this.lastStatus.solUsdPrice = solUsdPrice;
    this.lastStatus.budgetUsd = this.config.budgetUsd;
    this.lastStatus.budgetSol = solUsdPrice && this.config.budgetUsd
      ? this.config.budgetUsd / solUsdPrice
      : null;
    await this.updatePortfolioSnapshot(price, solUsdPrice);

    if (this.kaminoState?.active && this.config.kaminoCloseRule !== "manual") {
      const closed = await this.maybeCloseKaminoCycle(price);
      if (closed) {
        this.lastStatus.positionRange = null;
        this.lastStatus.positionMint = this.currentPositionMint;
        return this.getStatus();
      }
    }

    if (!this.currentPosition) {
      await this.loadExistingPosition();
    }

    if (!this.currentPosition) {
      if (this.currentPositionMint) {
        const now = Date.now();
        if (this.missingPositionSince === null) {
          this.missingPositionSince = now;
        }
        const elapsedSec = (now - this.missingPositionSince) / 1000;
        if (elapsedSec < 60) {
          logger.info({ elapsedSec, positionMint: this.currentPositionMint }, "position mint not found yet; waiting");
          this.lastStatus.lastAction = "await-position";
          this.lastStatus.positionRange = null;
          this.lastStatus.positionMint = this.currentPositionMint;
          return this.getStatus();
        }
        this.currentPositionMint = null;
        this.missingPositionSince = null;
      }

      if (this.config.rebalanceCooldownSec > 0 && this.lastRebalanceAt != null) {
        const now = Date.now();
        const elapsedSec = (now - this.lastRebalanceAt) / 1000;
        if (elapsedSec < this.config.rebalanceCooldownSec) {
          const remainingSec = Math.max(0, this.config.rebalanceCooldownSec - elapsedSec);
          logger.info(
            { elapsedSec, remainingSec },
            "recent open/rebalance; waiting cooldown before opening new position"
          );
          this.lastStatus.lastAction = "cooldown-wait";
          this.lastStatus.positionRange = null;
          this.lastStatus.positionMint = this.currentPositionMint;
          return this.getStatus();
        }
      }

      let openOptions: { maxTokenA?: number; maxTokenB?: number } | undefined;
      if (this.kaminoState?.active) {
        const reservedA = Number(this.kaminoState.reservedTokenA ?? 0);
        const reservedB = Number(this.kaminoState.reservedTokenB ?? 0);
        if (reservedA <= 0 && reservedB <= 0) {
          // reserved=null/0: ciclo foi recuperado (recover) sem informação
          // de quanto foi emprestado. O borrow pode já existir on-chain.
          // Verifica se há saldo na wallet para abrir a pool diretamente.
          const walletBal = await this.getTokenBalances().catch(() => ({ tokenA: 0, tokenB: 0 }));
      if (walletBal.tokenA <= 0 && walletBal.tokenB <= 0) {
        const pendingDebtWallet = Number(this.kaminoState?.debtAmount ?? 0);
        if (pendingDebtWallet > 1e-8) {
          this.queueKaminoLog(
            "wait-funds",
            `Tentando quitar divida Kamino (${pendingDebtWallet.toFixed(4)}) via colateral depositado.`,
            "warn"
          );
          try {
            const closed = await this.closeKaminoCycle("target");
            if (closed) {
              this.lastStatus.lastAction = "kamino-close";
              this.lastStatus.positionRange = null;
              this.lastStatus.positionMint = this.currentPositionMint;
              return this.getStatus();
            }
          } catch (err) {
            this.queueKaminoLog(
              "wait-funds",
              `Falha ao fechar ciclo Kamino: ${err instanceof Error ? err.message : String(err)}. Aguardando proximo tick.`,
              "warn"
            );
          }
          this.lastStatus.lastAction = "kamino-wait-funds";
          this.lastStatus.positionRange = null;
          this.lastStatus.positionMint = this.currentPositionMint;
          return this.getStatus();
        }
        if (this.lastStatus.lastAction !== "kamino-wait-funds") {
          this.queueKaminoLog("wait-funds", "Aguardando saldo emprestado para reabrir a pool.", "warn");
        }
        this.lastStatus.lastAction = "kamino-wait-funds";
        this.lastStatus.positionRange = null;
        this.lastStatus.positionMint = this.currentPositionMint;
        return this.getStatus();
      }
        const pendingDebt = Number(this.kaminoState?.debtAmount ?? 0);
        if (pendingDebt > 1e-8) {
          this.queueKaminoLog(
            "wait-funds",
            `Tentando quitar divida Kamino (${pendingDebt.toFixed(4)}) para reabrir a pool.`,
            "warn"
          );
          try {
            const closed = await this.closeKaminoCycle("target");
            if (closed) {
              this.lastStatus.lastAction = "kamino-close";
              this.lastStatus.positionRange = null;
              this.lastStatus.positionMint = this.currentPositionMint;
              return this.getStatus();
            }
          } catch (err) {
            this.queueKaminoLog(
              "wait-funds",
              `Falha ao fechar ciclo Kamino: ${err instanceof Error ? err.message : String(err)}. Aguardando proximo tick.`,
              "warn"
            );
          }
          this.lastStatus.lastAction = "kamino-wait-funds";
          this.lastStatus.positionRange = null;
          this.lastStatus.positionMint = this.currentPositionMint;
          return this.getStatus();
        }
        // Há saldo na wallet — abre a pool com o que tem.
        // Não tenta forçar novo deposit+borrow para não criar loop
        // com o reconcileKaminoState que reativa o ciclo a cada tick.
          this.queueKaminoLog(
            "wait-funds",
            "Saldo disponivel na wallet; abrindo pool com saldo atual.",
            "warn"
          );
          // openOptions fica undefined → openPosition usa todo saldo disponível
        } else {
          const caps: { maxTokenA?: number; maxTokenB?: number } = {};
          if (reservedA > 0) caps.maxTokenA = reservedA;
          if (reservedB > 0) caps.maxTokenB = reservedB;
          openOptions = Object.keys(caps).length ? caps : undefined;
        }
      }

      logger.info({ price, range: executionRange }, "no active position found; opening new position");
      const result = await this.openPosition(executionRange, price, solUsdPrice, openOptions);
      this.lastStatus.lastAction = result;
      if (result === "open-position") {
        this.lastRebalanceAt = Date.now();
        if (this.kaminoState?.active) {
          this.kaminoPoolOpenedAt = Date.now();
        }
        if (this.config.autoSwapToSolEnabled) {
          try {
            await this.swapWalletToSol("auto");
          } catch (err) {
            logger.warn({ err }, "auto swap-to-sol failed after open");
          }
        }
        await this.updatePortfolioSnapshot(price, solUsdPrice);
      }
      this.lastStatus.positionMint = this.currentPositionMint;
      return this.getStatus();
    }

    const positionRange = await this.getPositionRange(this.currentPosition);
    if (!positionRange) {
      logger.warn("failed to read position range; reloading position");
      await this.loadExistingPosition();
      this.lastStatus.lastAction = "reload-position";
      this.lastStatus.positionRange = null;
      this.lastStatus.positionMint = this.currentPositionMint;
      return this.getStatus();
    }

    const outOfRange = isPriceOutOfRange(price, positionRange);
    const hasValidRange = Number.isFinite(positionRange.lower) && Number.isFinite(positionRange.upper);
    const hasValidPrice = Number.isFinite(price);
    if (!outOfRange) {
      logger.info({ price, positionRange }, "price within range; no action");
      if (hasValidRange && hasValidPrice) {
        this.outOfRangeSince = null;
      }
      this.lastStatus.lastAction = "no-action";
      this.lastStatus.positionRange = positionRange;
      this.lastStatus.positionMint = this.currentPositionMint;
      return this.getStatus();
    }

    if (this.config.outOfRangeConfirmSec > 0) {
      const now = Date.now();
      if (this.outOfRangeSince === null) {
        this.outOfRangeSince = now;
      }
      const elapsedSec = (now - this.outOfRangeSince) / 1000;
      if (elapsedSec < this.config.outOfRangeConfirmSec) {
        logger.info(
          { price, positionRange, elapsedSec, confirmSec: this.config.outOfRangeConfirmSec },
          "price out of range; waiting confirmation"
        );
        this.lastStatus.lastAction = "out-of-range-wait";
        this.lastStatus.positionRange = positionRange;
        this.lastStatus.positionMint = this.currentPositionMint;
        return this.getStatus();
      }
    }

    if (this.config.rebalanceCooldownSec > 0 && this.lastRebalanceAt != null) {
      const now = Date.now();
      const elapsedSec = (now - this.lastRebalanceAt) / 1000;
      if (elapsedSec < this.config.rebalanceCooldownSec) {
        const remainingSec = Math.max(0, this.config.rebalanceCooldownSec - elapsedSec);
        logger.info(
          { price, positionRange, elapsedSec, remainingSec },
          "cooldown active; waiting"
        );
        this.lastStatus.lastAction = "cooldown-wait";
        this.lastStatus.positionRange = positionRange;
        this.lastStatus.positionMint = this.currentPositionMint;
        return this.getStatus();
      }
    }

    const pnlNoFeesUsd = this.getPositionPnlNoFeesUsd();
    if (pnlNoFeesUsd == null) {
      this.nullPnlNoFeesTicks += 1;
      if (this.nullPnlNoFeesTicks >= 3) {
        logger.warn(
          { ticks: this.nullPnlNoFeesTicks },
          "PnL sem taxas indisponivel por varios ticks; recarregando posicao"
        );
        await this.loadExistingPosition();
        this.nullPnlNoFeesTicks = 0;
      }
    } else {
      this.nullPnlNoFeesTicks = 0;
    }
    // Não ativar Kamino para rebalanceamento logo após abertura da pool.
    const kaminoGraceSec = Number(this.config.kaminoGracePeriodSec ?? 120);
    const kaminoGraceActive = kaminoGraceSec > 0
      && this.kaminoPoolOpenedAt != null
      && (Date.now() - this.kaminoPoolOpenedAt) / 1000 < kaminoGraceSec;

    const shouldUseKamino = !kaminoGraceActive
      && this.config.kaminoRebalanceEnabled
      && pnlNoFeesUsd != null
      && pnlNoFeesUsd < 0;
    if (kaminoGraceActive) {
      logger.info(
        { elapsedSec: Math.floor((Date.now() - (this.kaminoPoolOpenedAt ?? Date.now())) / 1000), kaminoGraceSec },
        "Kamino ignorado: grace period ativo"
      );
    }
    if (this.config.kaminoRebalanceEnabled && !shouldUseKamino) {
      logger.info(
        { pnlNoFeesUsd },
        "Kamino ignorado: PnL sem taxas nao negativo ou indisponivel"
      );
    }
    let lockOk = true;
    if (shouldUseKamino) {
      const lock = this.canUseKaminoLock();
      lockOk = lock.ok;
      if (!lockOk) {
        this.setError(`Kamino ativo na pool ${lock.ownerName}`);
      }
    }
    if (shouldUseKamino && lockOk) {
      const result = await this.rebalanceWithKamino({
        price,
        solUsdPrice,
        executionRange,
        positionRange
      });
      this.lastStatus.lastAction = result;
      this.lastStatus.positionRange = null;
      this.lastStatus.positionMint = this.currentPositionMint;
      if (result !== "kamino-rebalanced" && !this.kaminoState?.active) {
        this.releaseKaminoLockIfOwned();
      }
      return this.getStatus();
    }

    logger.info({ price, positionRange }, "price out of range; rebalancing");
    this.outOfRangeSince = null;
    await this.updatePortfolioSnapshot(price, solUsdPrice);
    let preCloseBalancesRaw: { tokenA: number; tokenB: number } | null = null;
    try {
      preCloseBalancesRaw = await this.getTokenBalancesRaw();
    } catch {
      preCloseBalancesRaw = null;
    }
    this.captureCloseSnapshot();
    await this.closePosition(this.currentPosition);
    this.queueHistoryAction("close-position", { lastAction: "close-position" });
    this.currentPosition = null;
    this.currentPositionMint = null;
    this.missingPositionSince = null;
    await this.loadExistingPosition();
    if (this.currentPosition) {
      logger.error({ price, positionRange }, "position still open after rebalance close; aborting open");
      this.setError("Fechamento falhou: posicao ainda aberta");
      this.lastStatus.lastAction = "close-failed";
      this.lastStatus.positionRange = await this.getPositionRange(this.currentPosition);
      this.lastStatus.positionMint = this.currentPositionMint;
      return this.getStatus();
    }
    const result = await this.openPosition(executionRange, price, solUsdPrice);
    this.lastStatus.lastAction = result === "open-position" ? "rebalanced" : result;
    if (result === "open-position") {
      this.lastRebalanceAt = Date.now();
      if (this.kaminoState?.active) {
        this.kaminoPoolOpenedAt = Date.now();
      }
      if (this.config.autoSwapToSolEnabled) {
        try {
          await this.swapWalletToSol("auto");
        } catch (err) {
          logger.warn({ err }, "auto swap-to-sol failed after re-range");
        }
      }
      await this.updatePortfolioSnapshot(price, solUsdPrice);
    }
    this.lastStatus.positionRange = null;
    this.lastStatus.positionMint = this.currentPositionMint;
    return this.getStatus();
  }

  async closeActivePosition(): Promise<BotStatus> {
    this.lastStatus.running = true;
    this.lastStatus.eventPositionMint = null;
    this.lastStatus.eventPositionEntryUsd = null;
    this.lastStatus.eventPositionFeesUsd = null;
    this.lastStatus.eventPositionExitUsd = null;
    this.resetActionFee();
    await this.refreshPoolState();

    const price = await this.getCurrentPrice();
    const solUsdPrice = await this.tryGetSolUsdPrice();
    this.lastStatus.lastPrice = price;
    this.lastStatus.solUsdPrice = solUsdPrice;
    this.lastStatus.budgetUsd = this.config.budgetUsd;
    this.lastStatus.budgetSol = solUsdPrice && this.config.budgetUsd
      ? this.config.budgetUsd / solUsdPrice
      : null;

    if (!this.currentPosition) {
      await this.loadExistingPosition();
    }

    if (!this.currentPosition) {
      this.lastStatus.lastAction = "close-no-position";
      return this.getStatus();
    }

    await this.updatePortfolioSnapshot(price, solUsdPrice);
    this.captureCloseSnapshot();
    await this.closePosition(this.currentPosition);
    this.currentPosition = null;
    this.currentPositionMint = null;
    this.missingPositionSince = null;
    await this.loadExistingPosition();
    if (this.currentPosition) {
      logger.error("position still open after manual close; retry required");
      this.setError("Fechamento falhou: posicao ainda aberta");
      this.lastStatus.lastAction = "close-failed";
      this.lastStatus.positionRange = await this.getPositionRange(this.currentPosition);
      this.lastStatus.positionMint = this.currentPositionMint;
      return this.getStatus();
    }
    await this.updatePortfolioSnapshot(price, solUsdPrice);

    this.lastStatus.lastAction = "close-position";
    this.lastStatus.positionMint = null;
    this.lastStatus.positionRange = null;
    return this.getStatus();
  }

  setPoolMeta(meta: { id: string; name: string | null }): void {
    this.poolId = meta.id;
    this.poolName = meta.name ?? meta.id;
  }

  async closeKaminoCycleNow(): Promise<{ ok: boolean; reason?: string; status: BotStatus }> {
    this.lastStatus.running = true;
    this.resetActionFee();
    try {
      const closed = await this.closeKaminoCycle("manual");
      if (closed) {
        this.lastStatus.lastAction = "kamino-close";
        return { ok: true, status: this.getStatus() };
      }
      return { ok: false, reason: "Fechamento Kamino nao concluido", status: this.getStatus() };
    } catch (err) {
      this.kaminoHealth.recordError(err, "kamino-close");
      this.setError(err);
      return { ok: false, reason: err instanceof Error ? err.message : String(err), status: this.getStatus() };
    }
  }

  async testKaminoNow(input: {
    collateralMint: string;
    collateralAmount: number;
    borrowUsd?: number;
  }): Promise<{ ok: boolean; reason?: string; depositSig?: string; borrowSig?: string; status: BotStatus }> {
    this.lastStatus.running = true;
    this.resetActionFee();

    const mint = String(input.collateralMint ?? "").trim();
    const amount = Number(input.collateralAmount);
    const borrowUsd = input.borrowUsd != null ? Number(input.borrowUsd) : 0;

    if (!mint) {
      const message = "Mint do colateral e obrigatorio";
      this.setError(message);
      return { ok: false, reason: message, status: this.getStatus() };
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      const message = "Quantidade de colateral invalida";
      this.setError(message);
      return { ok: false, reason: message, status: this.getStatus() };
    }

    const solBalance = (await this.connection.getBalance(this.wallet.publicKey)) / LAMPORTS_PER_SOL;
    if (solBalance < this.config.minSolBalance) {
      const message = `Saldo de SOL abaixo do minimo (${this.config.minSolBalance}).`;
      this.setError(message);
      return { ok: false, reason: message, status: this.getStatus() };
    }

    if (this.isKaminoSimulated()) {
      const message = "Kamino esta em modo simulado (DRY_RUN ou KAMINO_NOOP).";
      this.setError(message);
      return { ok: false, reason: message, status: this.getStatus() };
    }

    const lock = this.canUseKaminoLock();
    if (!lock.ok) {
      const message = `Kamino ativo na pool ${lock.ownerName}`;
      this.setError(message);
      return { ok: false, reason: message, status: this.getStatus() };
    }

    try {
      const kamino = await this.ensureKaminoClient();
      const supported = await kamino.supportsCollateral(mint);
      if (!supported) {
        const message = `Token nao suportado como colateral no Kamino${this.getKaminoMarketHint()}`;
        this.setError(message);
        return { ok: false, reason: message, status: this.getStatus() };
      }

      let stable: { mint: string; decimals: number; label: string } | null = null;
      if (Number.isFinite(borrowUsd) && borrowUsd > 0) {
        const resolved = await this.resolveKaminoBorrowStable(kamino);
        if (!resolved.stable) {
          const message = `Borrow indisponivel: ${resolved.reason ?? "reserve nao encontrada"}${this.getKaminoMarketHint()}`;
          this.setError(message);
          return { ok: false, reason: message, status: this.getStatus() };
        }
        stable = resolved.stable;
      }

      await kamino.ensureObligation();
      let depositSig: string;
      try {
        depositSig = await kamino.depositCollateral({ mint, amount });
        this.kaminoHealth.recordSuccess("kamino-deposit");
        this.recordKaminoSuccess("deposit", mint, amount, depositSig);
      } catch (err) {
        this.kaminoHealth.recordError(err, "kamino-deposit");
        throw err;
      }
      this.queueHistoryAction("kamino-deposit", { lastAction: "kamino-deposit" });
      this.lastStatus.lastAction = "kamino-deposit";

      let borrowSig: string | undefined;
      if (Number.isFinite(borrowUsd) && borrowUsd > 0 && stable) {
        try {
          borrowSig = await kamino.borrow({ mint: stable.mint, amount: borrowUsd });
          this.kaminoHealth.recordSuccess("kamino-borrow");
          this.recordKaminoSuccess("borrow", stable.mint, borrowUsd, borrowSig);
          this.queueHistoryAction("kamino-borrow", { lastAction: "kamino-borrow" });
          this.lastStatus.lastAction = "kamino-borrow";
        } catch (err) {
          this.kaminoHealth.recordError(err, "kamino-borrow");
          this.setError(err);
          try {
            await kamino.withdraw({ mint, amount });
            this.queueHistoryAction("kamino-withdraw", { lastAction: "kamino-withdraw" });
          } catch (rollbackErr) {
            logger.warn({ err: rollbackErr }, "rollback kamino withdraw failed");
          }
          this.releaseKaminoLockIfOwned();
          return { ok: false, reason: this.lastStatus.lastError ?? "Falha ao emprestar no Kamino", status: this.getStatus() };
        }
      }

      const avgBasis = this.config.kaminoAvgPriceBasis ?? "deposit";
      const avgMode = this.config.kaminoAvgMode ?? "cumulative";
      const previous = this.kaminoState;
      const isNewCycle = !previous?.active || (previous?.collateralAmount ?? 0) === 0;
      const baseAmount = avgMode === "reset" || isNewCycle ? 0 : (previous?.collateralAmount ?? 0);
      const baseUsd = avgMode === "reset" || isNewCycle ? 0 : (previous?.collateralUsd ?? 0);
      const baseDebtUsd = avgMode === "reset" || isNewCycle ? 0 : (previous?.debtUsd ?? 0);
      const nextAmount = baseAmount + amount;
      // Calcula USD do depósito usando o preço USD real do token de colateral.
      // Para SOL (NATIVE_MINT), usa solUsdPrice (Pyth). Para outros tokens,
      // tenta obter o preço via Jupiter. Isso garante que avgPriceUsdc reflita
      // o preço USD verdadeiro do token depositado, não o preço do par da pool.
      let depositedUsd: number | null = null;
      try {
        const solUsdPriceForAvg = await this.tryGetSolUsdPrice();
        if (mint === NATIVE_MINT.toBase58() && solUsdPriceForAvg != null) {
          depositedUsd = solUsdPriceForAvg * amount;
        } else {
          const decimals = await this.getTokenDecimals(mint);
          let stableMintInfo: { mint: string; decimals: number; label: string } | null = null;
          try {
            stableMintInfo = await this.getStableMintInfo();
          } catch {
            stableMintInfo = null;
          }
          if (stableMintInfo) {
            const tokenPrice = await this.getTokenUsdPrice({
              mint,
              decimals,
              stableMint: stableMintInfo.mint,
              stableDecimals: stableMintInfo.decimals
            }).catch(() => null);
            if (tokenPrice != null) {
              depositedUsd = tokenPrice * amount;
            }
          }
        }
      } catch (err) {
        logger.warn({ err }, "falha ao obter preco USD do colateral para avgPriceUsdc; usando fallback");
      }
      // Fallbacks robustos para SOL: tenta novamente buscar preço; depois usa cache; evita usar borrowUsd.
      if (depositedUsd == null && mint === NATIVE_MINT.toBase58()) {
        for (let attempt = 0; attempt < 3 && depositedUsd == null; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          try {
            const retryPrice = await this.tryGetSolUsdPrice();
            if (retryPrice != null) {
              depositedUsd = retryPrice * amount;
            }
          } catch {
            // continua tentando
          }
        }
      }
      if (depositedUsd == null && mint === NATIVE_MINT.toBase58()) {
        const cachedSolPrice = this.lastStatus.solUsdPrice;
        if (cachedSolPrice != null && cachedSolPrice > 0) {
          depositedUsd = cachedSolPrice * amount;
          logger.warn({ cachedSolPrice, amount }, "avgPriceUsdc: usando solUsdPrice cacheado como fallback");
        }
      }
      // Fallback de último recurso: usar borrowUsd apenas para tokens não-SOL
      if (depositedUsd == null && borrowSig && borrowUsd > 0 && mint !== NATIVE_MINT.toBase58()) {
        depositedUsd = borrowUsd; // estimativa grosseira; será corrigida no próximo ciclo
      }
      const nextUsd = baseUsd + (depositedUsd ?? 0);
      const nextDebtUsd = baseDebtUsd + (borrowSig ? borrowUsd : 0);
      const avgNumerator = avgBasis === "debt" ? nextDebtUsd : nextUsd;
      const avgPriceUsdc = nextAmount > 0 && avgNumerator > 0 ? avgNumerator / nextAmount : null;
      // Sanidade: para SOL, preço médio precisa estar num range plausível
      if (mint === NATIVE_MINT.toBase58() && avgPriceUsdc != null) {
        if (avgPriceUsdc < 50 || avgPriceUsdc > 5000) {
          logger.error({ avgPriceUsdc, depositedUsd, amount, nextUsd }, "avgPriceUsdc fora do range esperado para SOL; abortando ciclo");
          throw new Error(`avgPriceUsdc inválido para SOL: ${avgPriceUsdc.toFixed(2)}`);
        }
      }
      const poolLossUsd = (() => {
        const pnl = this.lastStatus.positionPnlUsd ?? null;
        if (pnl != null && Number.isFinite(pnl) && pnl < 0) return Math.abs(pnl);
        return 0;
      })();
      const lossAdjPct = (avgPriceUsdc != null && nextUsd > 0 && poolLossUsd > 0)
        ? (poolLossUsd / nextUsd) * 100
        : 0;
      const targetPriceUsdc = avgPriceUsdc != null
        ? avgPriceUsdc * (1 + ((this.config.kaminoPriceBufferPct ?? 0) + lossAdjPct) / 100)
        : null;
      const nextState: KaminoCycleState = {
        active: true,
        ownerPoolId: this.poolId ?? previous?.ownerPoolId ?? null,
        ownerPoolName: this.poolName ?? previous?.ownerPoolName ?? null,
        marketAddress: this.getKaminoMarketAddress(),
      baselineTokenA: null,
      baselineTokenB: null,
      reservedTokenA: null,
      reservedTokenB: null,
      reservedCollateralDust: previous?.reservedCollateralDust ?? null,
      collateralMint: mint,
        collateralAmount: nextAmount,
        collateralUsd: nextUsd > 0 ? nextUsd : null,
        debtMint: stable?.mint ?? previous?.debtMint ?? null,
        debtAmount: nextDebtUsd,
        debtUsd: nextDebtUsd > 0 ? nextDebtUsd : null,
        avgPriceUsdc,
        targetPriceUsdc,
        collaterals: [{
          mint,
          amount: nextAmount,
          usd: nextUsd > 0 ? nextUsd : null,
          debtUsd: nextDebtUsd > 0 ? nextDebtUsd : null,
          avgPriceUsdc,
          targetPriceUsdc
        }],
        cycleCount: (previous?.cycleCount ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        lastError: null
      };
      this.setKaminoState(nextState);

      this.lastStatus.lastError = null;
      return { ok: true, depositSig, borrowSig, status: this.getStatus() };
    } catch (err) {
      this.kaminoHealth.recordError(err, "kamino-test");
      this.setError(err);
      if (!this.kaminoState?.active) {
        this.releaseKaminoLockIfOwned();
      }
      return { ok: false, reason: err instanceof Error ? err.message : String(err), status: this.getStatus() };
    }
  }

  async addLiquidityFromWallet(options: { share?: number; maxTokenA?: number; maxTokenB?: number }): Promise<{ ok: boolean; reason?: string }> {
    this.lastStatus.running = true;
    this.resetActionFee();
    await this.refreshPoolState();

    const share = options.share ?? 1;
    if ((options.maxTokenA == null && options.maxTokenB == null) && (!Number.isFinite(share) || share <= 0)) {
      const message = "parametros invalidos para adicionar liquidez";
      this.setError(message);
      this.lastStatus.lastAction = "add-liquidity-failed";
      return { ok: false, reason: message };
    }

    const effectiveShare = Number.isFinite(share) && share > 0 ? Math.min(share, 1) : 1;

    if (!this.currentPosition) {
      await this.loadExistingPosition();
    }

    if (!this.currentPosition) {
      const message = "nenhuma posicao aberta";
      this.setError(message);
      this.lastStatus.lastAction = "add-liquidity-failed";
      return { ok: false, reason: message };
    }

    const price = await this.getCurrentPrice();
    const solUsdPrice = await this.tryGetSolUsdPrice();
    this.lastStatus.lastPrice = price;
    this.lastStatus.solUsdPrice = solUsdPrice;
    this.lastStatus.budgetUsd = this.config.budgetUsd;
    this.lastStatus.budgetSol = solUsdPrice && this.config.budgetUsd
      ? this.config.budgetUsd / solUsdPrice
      : null;

    await this.updatePortfolioSnapshot(price, solUsdPrice);

    const positionData = this.currentPosition.getData?.() ?? this.currentPosition.getData;
    const lowerTick = positionData?.tickLowerIndex;
    const upperTick = positionData?.tickUpperIndex;
    if (lowerTick == null || upperTick == null) {
      const message = "nao foi possivel ler ticks da posicao";
      this.setError(message);
      this.lastStatus.lastAction = "add-liquidity-failed";
      return { ok: false, reason: message };
    }

    // Verificar se o preço atual está dentro do range da posição.
    // Se estiver fora do range, o AMM só aceita um dos tokens e o
    // quote falhará. Nesse caso, o auto-add deve ser ignorado —
    // o tick principal do bot vai detectar o out-of-range e rebalancear.
    {
      const poolState = this.poolState;
      if (!poolState) {
        const message = "poolState not initialized";
        this.setError(message);
        this.lastStatus.lastAction = "add-liquidity-failed";
        return { ok: false, reason: message };
      }
      const lowerPrice = whirlpools.PriceMath.tickIndexToPrice(
        lowerTick,
        poolState.decimalsA,
        poolState.decimalsB
      );
      const upperPrice = whirlpools.PriceMath.tickIndexToPrice(
        upperTick,
        poolState.decimalsA,
        poolState.decimalsB
      );
      const lowerNum = toNumber(lowerPrice);
      const upperNum = toNumber(upperPrice);
      if (price < lowerNum || price > upperNum) {
        const message = `auto-add ignorado: preco fora do range da posicao (preco=${price.toFixed(6)}, range=[${lowerNum.toFixed(6)}, ${upperNum.toFixed(6)}])`;
        logger.info({ price, lowerNum, upperNum }, message);
        // Não setar erro — isso não é um erro, é uma condição esperada.
        // Usar lastAction neutro para não poluir o histórico.
        this.lastStatus.lastAction = "no-action";
        return { ok: false, reason: message };
      }
    }

    let balances = await this.getTokenBalances();
    let usableA = options.maxTokenA != null ? Number(options.maxTokenA) : balances.tokenA * effectiveShare;
    let usableB = options.maxTokenB != null ? Number(options.maxTokenB) : balances.tokenB * effectiveShare;
    if (!Number.isFinite(usableA) || usableA < 0) {
      usableA = 0;
    }
    if (!Number.isFinite(usableB) || usableB < 0) {
      usableB = 0;
    }
    if (options.maxTokenA != null) {
      usableA = Math.min(usableA, balances.tokenA);
    }
    if (options.maxTokenB != null) {
      usableB = Math.min(usableB, balances.tokenB);
    }

    if (this.config.maxTokenA != null) {
      usableA = Math.min(usableA, this.config.maxTokenA);
    }
    if (this.config.maxTokenB != null) {
      usableB = Math.min(usableB, this.config.maxTokenB);
    }

    const valueCap = usableB + usableA * price;
    let valueCapUsd = Number.isFinite(valueCap) && valueCap > 0 ? valueCap : null;
    if (this.config.budgetUsd != null) {
      if (!this.poolState?.isTokenASol && !this.poolState?.isTokenBSol) {
        throw new Error("budgetUsd requires a SOL (wSOL) leg in the pool");
      }
      const solUsd = await this.tryGetSolUsdPrice();
      if (!solUsd) {
        throw new Error("SOL/USD price unavailable");
      }
      const budgetSol = this.config.budgetUsd / solUsd;
      const budgetTokenB = this.poolState.isTokenBSol ? budgetSol : budgetSol * price;
      valueCapUsd = valueCapUsd != null ? Math.min(valueCapUsd, budgetTokenB) : budgetTokenB;
    }
    const applyValueCap = (nextBalances: { tokenA: number; tokenB: number }) => {
      let capA = Number.isFinite(nextBalances.tokenA) && nextBalances.tokenA > 0 ? nextBalances.tokenA : 0;
      let capB = Number.isFinite(nextBalances.tokenB) && nextBalances.tokenB > 0 ? nextBalances.tokenB : 0;
      if (this.config.maxTokenA != null) {
        capA = Math.min(capA, this.config.maxTokenA);
      }
      if (this.config.maxTokenB != null) {
        capB = Math.min(capB, this.config.maxTokenB);
      }
      if (valueCapUsd != null) {
        const currentValue = capB + capA * price;
        if (currentValue > 0) {
          const factor = Math.min(1, valueCapUsd / currentValue);
          capA *= factor;
          capB *= factor;
        }
      }
      return { usableA: capA, usableB: capB };
    };

    ({ usableA, usableB } = applyValueCap(balances));

    if (usableA <= 0 && usableB <= 0) {
      const message = "saldo insuficiente para adicionar liquidez";
      this.setError(message);
      this.lastStatus.lastAction = "add-liquidity-failed";
      return { ok: false, reason: message };
    }

    const poolState = this.poolState;
    if (!poolState) {
      throw new Error("poolState not initialized");
    }
    const tokenExtensionCtx = await whirlpools.TokenExtensionUtil.buildTokenExtensionContext(
      this.ctx.fetcher,
      poolState.pool.getData(),
      whirlpools.IGNORE_CACHE
    );

    const { targetA, targetB } = await this.computeTargetFromBalances(
      price,
      lowerTick,
      upperTick,
      usableA,
      usableB,
      tokenExtensionCtx
    );

    if (targetA <= 0 && targetB <= 0) {
      const message = "nao foi possivel calcular alvo para adicionar liquidez";
      this.setError(message);
      this.lastStatus.lastAction = "add-liquidity-failed";
      return { ok: false, reason: message };
    }

    const slippage = common.Percentage.fromFraction(this.config.slippageBps, 10_000);
    const swapped = await this.rebalanceToTarget(usableA, usableB, targetA, targetB, price, slippage);
    if (swapped) {
      balances = await this.getTokenBalances();
    } else if (targetA > usableA * 1.05 || targetB > usableB * 1.05) {
      // Swap era necessário mas não ocorreu (bloqueado por allowlist,
      // rebalanceSwapPct=0, ou falha no swap).
      logger.warn(
        { usableA, usableB, targetA, targetB },
        "auto-add: swap nao executado mas era necessario para rebalancear tokens"
      );
    }
    ({ usableA, usableB } = applyValueCap(balances));

    if (usableA <= 0 && usableB <= 0) {
      const message = "saldo insuficiente apos swap";
      this.setError(message);
      this.lastStatus.lastAction = "add-liquidity-failed";
      return { ok: false, reason: message };
    }

    const quoteUsableA = Math.max(0, usableA * 0.98);
    const quoteUsableB = Math.max(0, usableB * 0.98);
    const buildQuote = (): any | null => {
      let quote = this.tryBuildQuote(
        poolState.pool,
        poolState.tokenMintA,
        new Decimal(quoteUsableA),
        lowerTick,
        upperTick,
        slippage,
        quoteUsableA,
        quoteUsableB,
        tokenExtensionCtx
      );
      if (!quote) {
        quote = this.tryBuildQuote(
          poolState.pool,
          poolState.tokenMintB,
          new Decimal(quoteUsableB),
          lowerTick,
          upperTick,
          slippage,
          quoteUsableA,
          quoteUsableB,
          tokenExtensionCtx
        );
      }
      return quote;
    };

    const quote = buildQuote();
    if (!quote) {
      const message = `nao foi possivel calcular quote para adicionar liquidez (A=${usableA.toFixed(6)}, B=${usableB.toFixed(6)})`;
      this.setError(message);
      this.lastStatus.lastAction = "add-liquidity-failed";
      return { ok: false, reason: message };
    }

    const { requiredA, requiredB } = extractQuoteAmounts(
      quote,
      poolState.decimalsA,
      poolState.decimalsB
    );
    this.lastStatus.lastOpenTokenA = requiredA;
    this.lastStatus.lastOpenTokenB = requiredB;

    try {
      await this.increasePositionLiquidity(this.currentPosition, quote);
    } catch (err) {
      const message = err instanceof Error ? err.message : "falha ao adicionar liquidez";
      this.setError(message);
      this.lastStatus.lastAction = "add-liquidity-failed";
      return { ok: false, reason: message };
    }

    // Acumula o valor USD adicionado ao positionEntryUsd antes de resetar os anchors.
    // Isso garante que o PnL no fechamento reflita o custo TOTAL depositado
    // na posição (abertura + todos os add-liquidity), não apenas o inicial.
    try {
      const solUsd = solUsdPrice ?? null;
      let addedUsd: number | null = null;
      if (solUsd != null && this.poolState) {
        if (this.poolState.isTokenBSol) {
          addedUsd = (requiredB + requiredA * price) * solUsd;
        } else if (this.poolState.isTokenASol) {
          addedUsd = (requiredA + requiredB / price) * solUsd;
        }
      }
      if (addedUsd != null && Number.isFinite(addedUsd) && addedUsd > 0) {
        const previousEntry = this.positionEntryUsd ?? this.lastStatus.positionEntryUsd ?? null;
        const accumulatedEntry = (previousEntry != null && Number.isFinite(previousEntry))
          ? previousEntry + addedUsd
          : addedUsd;
        // Reseta apenas os anchors de valor interno (para que positionPnl seja
        // calculado a partir do novo ponto), mas preserva o entry acumulado.
        this.initialPositionValue = null;
        this.initialPositionValueSol = null;
        this.lastPositionValueUsdWithFees = null;
        // Seta o entry acumulado antes de updatePortfolioSnapshot, que só
        // atribuirá positionEntryUsd se this.positionEntryUsd for null.
        // Como forçamos o valor acumulado aqui, ele será preservado.
        this.positionEntryUsd = accumulatedEntry;
        this.lastStatus.positionEntryUsd = accumulatedEntry;
        this.lastStatus.positionPnlUsd = null;
        logger.info(
          { previousEntry, addedUsd, accumulatedEntry },
          "add-liquidity: positionEntryUsd acumulado"
        );
      } else {
        // Sem preço USD disponível: comportamento anterior (reset completo).
        this.resetPositionAnchors();
      }
    } catch (anchorErr) {
      logger.warn({ err: anchorErr }, "falha ao acumular positionEntryUsd no add-liquidity; usando reset");
      this.resetPositionAnchors();
    }
    await this.updatePortfolioSnapshot(price, solUsdPrice);
    this.lastStatus.lastAction = "add-liquidity";
    this.lastStatus.positionMint = this.currentPositionMint;
    if (this.config.autoSwapToSolEnabled) {
      try {
        await this.swapWalletToSol("auto");
        await this.updatePortfolioSnapshot(price, solUsdPrice);
      } catch (err) {
        logger.warn({ err }, "auto swap-to-sol failed after add liquidity");
      }
    }
    return { ok: true };
  }

  async topUpSolNow(): Promise<{ ok: boolean; reason?: string }> {
    this.lastStatus.running = true;
    this.resetActionFee();
    await this.refreshPoolState();
    const solBalance = (await this.connection.getBalance(this.wallet.publicKey)) / LAMPORTS_PER_SOL;
    this.lastStatus.solBalance = solBalance;
    const result = await this.maybeTopUpSol("manual", solBalance);
    if (result.performed) {
      this.lastStatus.lastAction = "manual-sol-topup";
    }
    return { ok: result.performed, reason: result.reason };
  }

  async swapWalletToSolNow(): Promise<{ ok: boolean; reason?: string; swaps: number; failed: number; totalOutLamports: number; details: SwapWalletToSolDetail[] }> {
    this.lastStatus.running = true;
    this.resetActionFee();
    const result = await this.swapWalletToSol("manual");
    if (result.swaps > 0) {
      this.lastStatus.lastAction = "manual-swap-to-sol";
    }
    const ok = result.reason !== "missing-api-key" && !(result.swaps === 0 && result.failed > 0);
    return {
      ok,
      reason: result.reason,
      swaps: result.swaps,
      failed: result.failed,
      totalOutLamports: result.totalOutLamports,
      details: result.details
    };
  }

  private async refreshPoolState(): Promise<void> {
    const poolAddress = new PublicKey(this.config.whirlpoolAddress);
    const ignoreCache = (whirlpools as any).IGNORE_CACHE;
    try {
      await this.ctx?.fetcher?.getPool?.(poolAddress, ignoreCache);
      await this.ctx?.fetcher?.getPoolData?.(poolAddress, ignoreCache);
    } catch {
      // best-effort cache bypass; fallback to client.getPool below
    }
    const pool = await this.client.getPool(poolAddress, ignoreCache);
    if (typeof pool?.refreshData === "function") {
      try {
        await pool.refreshData();
      } catch {
        // ignore refresh errors and use current data
      }
    }
    const poolData = pool.getData();

    const tokenMintA = new PublicKey(poolData.tokenMintA);
    const tokenMintB = new PublicKey(poolData.tokenMintB);

    const [mintA, mintB] = await Promise.all([
      getMint(this.connection, tokenMintA),
      getMint(this.connection, tokenMintB)
    ]);

    this.poolState = {
      pool,
      poolAddress,
      tokenMintA,
      tokenMintB,
      decimalsA: mintA.decimals,
      decimalsB: mintB.decimals,
      tickSpacing: poolData.tickSpacing,
      isTokenASol: tokenMintA.equals(NATIVE_MINT),
      isTokenBSol: tokenMintB.equals(NATIVE_MINT)
    };

    this.lastStatus.tokenAMint = tokenMintA.toBase58();
    this.lastStatus.tokenBMint = tokenMintB.toBase58();
    this.lastStatus.isTokenASol = this.poolState.isTokenASol;
    this.lastStatus.isTokenBSol = this.poolState.isTokenBSol;
    this.updateBalanceReservations();
  }

  private async getCurrentPrice(): Promise<number> {
    if (!this.poolState) {
      throw new Error("poolState not initialized");
    }
    const poolData = this.poolState.pool.getData();
    const price = whirlpools.PriceMath.sqrtPriceX64ToPrice(
      poolData.sqrtPrice,
      this.poolState.decimalsA,
      this.poolState.decimalsB
    );
    return toNumber(price);
  }

  private shouldInvertUserPriceAxis(): boolean {
    return Boolean(this.poolState?.isTokenASol && !this.poolState?.isTokenBSol);
  }

  private async getPositionRange(position: any): Promise<Range | null> {
    if (!this.poolState) {
      return null;
    }
    const data = position.getData?.() ?? position.getData;
    if (!data) {
      return null;
    }

    const lowerPrice = whirlpools.PriceMath.tickIndexToPrice(
      data.tickLowerIndex,
      this.poolState.decimalsA,
      this.poolState.decimalsB
    );
    const upperPrice = whirlpools.PriceMath.tickIndexToPrice(
      data.tickUpperIndex,
      this.poolState.decimalsA,
      this.poolState.decimalsB
    );

    return { lower: toNumber(lowerPrice), upper: toNumber(upperPrice) };
  }

  private getExecutionRange(range: Range, referencePrice: number): Range {
    if (!this.poolState) {
      return range;
    }
    const { lowerTick, upperTick } = this.getTicksForRange(range, referencePrice);
    const lowerPrice = whirlpools.PriceMath.tickIndexToPrice(
      lowerTick,
      this.poolState.decimalsA,
      this.poolState.decimalsB
    );
    const upperPrice = whirlpools.PriceMath.tickIndexToPrice(
      upperTick,
      this.poolState.decimalsA,
      this.poolState.decimalsB
    );
    return { lower: toNumber(lowerPrice), upper: toNumber(upperPrice) };
  }

  private async loadExistingPosition(): Promise<void> {
    if (!this.poolState) {
      return;
    }

    const previousMint = this.currentPositionMint;
    let foundPosition: any | null = null;
    let foundMint: string | null = null;

    if (this.config.positionMint) {
      const position = await this.fetchPositionByMint(this.config.positionMint);
      if (position) {
        foundPosition = position;
        foundMint = this.config.positionMint;
      }
    }
    if (!foundPosition) {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        this.wallet.publicKey,
        { programId: TOKEN_PROGRAM_ID }
      );

      for (const acct of tokenAccounts.value) {
        const info = acct.account.data.parsed.info;
        const amount = Number(info.tokenAmount?.amount ?? 0);
        const decimals = Number(info.tokenAmount?.decimals ?? 0);
        if (amount === 0 || decimals !== 0) {
          continue;
        }

        const mint = info.mint as string;
        try {
          const position = await this.fetchPositionByMint(mint);
          if (position) {
            foundPosition = position;
            foundMint = mint;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (foundMint && foundMint !== previousMint) {
      this.resetPositionAnchors();
    }

    this.currentPosition = foundPosition;
    this.currentPositionMint = foundMint;
    this.missingPositionSince = foundPosition ? null : this.missingPositionSince;
    this.lastStatus.positionMint = this.currentPositionMint;
    if (this.currentPosition) {
      const range = await this.getPositionRange(this.currentPosition);
      this.lastStatus.positionRange = range ?? null;
    } else {
      this.lastStatus.positionRange = null;
    }
  }

  private async fetchPositionByMint(mint: string): Promise<any | null> {
    if (!this.poolState) {
      return null;
    }

    const programId = whirlpools.ORCA_WHIRLPOOL_PROGRAM_ID ?? whirlpools.WHIRLPOOL_PROGRAM_ID;
    const positionMint = new PublicKey(mint);
    const positionPda = whirlpools.PDAUtil.getPosition(programId, positionMint);
    const positionAddress = positionPda.publicKey ?? positionPda;
    const position = await this.client.getPosition(positionAddress);
    const data = position.getData?.() ?? position.getData;

    if (data?.whirlpool && new PublicKey(data.whirlpool).equals(this.poolState.poolAddress)) {
      if (data?.liquidity && typeof data.liquidity?.isZero === "function" && data.liquidity.isZero()) {
        return null;
      }
      logger.info({ positionMint: mint }, "found existing position for pool");
      return position;
    }

    return null;
  }

  private async openPosition(
    range: Range,
    price: number,
    solUsdPrice: number | null,
    options?: { maxTokenA?: number; maxTokenB?: number }
  ): Promise<string> {
    if (!this.poolState) {
      throw new Error("poolState not initialized");
    }

    const { lowerTick, upperTick } = this.getTicksForRange(range, price);
    const slippage = common.Percentage.fromFraction(this.config.slippageBps, 10_000);
    const applyLimits = (nextBalances: { tokenA: number; tokenB: number }) => {
      let tokenA = nextBalances.tokenA;
      let tokenB = nextBalances.tokenB;
      const maxTokenA = Number.isFinite(options?.maxTokenA ?? NaN) ? Number(options?.maxTokenA) : null;
      const maxTokenB = Number.isFinite(options?.maxTokenB ?? NaN) ? Number(options?.maxTokenB) : null;
      if (maxTokenA != null) {
        tokenA = Math.min(Math.max(0, tokenA), Math.max(0, maxTokenA));
      }
      if (maxTokenB != null) {
        tokenB = Math.min(Math.max(0, tokenB), Math.max(0, maxTokenB));
      }
      return { tokenA, tokenB };
    };
    let balances = applyLimits(await this.getTokenBalances());
    let tokenExtensionCtx = await whirlpools.TokenExtensionUtil.buildTokenExtensionContext(
      this.ctx.fetcher,
      this.poolState.pool.getData(),
      whirlpools.IGNORE_CACHE
    );

    const { targetA, targetB } = await this.computeTargetAmounts(
      price,
      lowerTick,
      upperTick,
      balances.tokenA,
      balances.tokenB,
      solUsdPrice,
      tokenExtensionCtx
    );

    if (targetA <= 0 && targetB <= 0) {
      logger.warn("insufficient token balances to open position");
      return "insufficient-balance";
    }

    const swapped = await this.rebalanceToTarget(balances.tokenA, balances.tokenB, targetA, targetB, price, slippage);
    if (swapped) {
      balances = applyLimits(await this.getTokenBalances());
      await this.refreshPoolState();
      if (!this.poolState) {
        throw new Error("poolState not initialized after refresh");
      }
      tokenExtensionCtx = await whirlpools.TokenExtensionUtil.buildTokenExtensionContext(
        this.ctx.fetcher,
        this.poolState.pool.getData(),
        whirlpools.IGNORE_CACHE
      );
    }

    let usableA = Math.min(balances.tokenA, targetA);
    let usableB = Math.min(balances.tokenB, targetB);

    if (this.config.maxTokenA != null) {
      usableA = Math.min(usableA, this.config.maxTokenA);
    }
    if (this.config.maxTokenB != null) {
      usableB = Math.min(usableB, this.config.maxTokenB);
    }

    const minA = this.poolState.decimalsA != null ? Math.pow(10, -this.poolState.decimalsA) : 0;
    const minB = this.poolState.decimalsB != null ? Math.pow(10, -this.poolState.decimalsB) : 0;

    if (usableA <= 0 && usableB <= 0) {
      this.logOpenPositionContext("insufficient-balance", {
        balances,
        targetA,
        targetB,
        usableA,
        usableB,
        maxTokenA: options?.maxTokenA ?? null,
        maxTokenB: options?.maxTokenB ?? null
      });
      return "insufficient-balance";
    }

    if (usableA < minA && usableB < minB) {
      this.logOpenPositionContext("amount-below-minimum", {
        balances,
        targetA,
        targetB,
        usableA,
        usableB,
        minA,
        minB,
        maxTokenA: options?.maxTokenA ?? null,
        maxTokenB: options?.maxTokenB ?? null
      });
      return "insufficient-balance";
    }

    const poolState = this.poolState;
    if (!poolState) {
      throw new Error("poolState not initialized");
    }

    const buildQuote = (): any | null => {
      let quote = this.tryBuildQuote(
        poolState.pool,
        poolState.tokenMintA,
        new Decimal(usableA),
        lowerTick,
        upperTick,
        slippage,
        usableA,
        usableB,
        tokenExtensionCtx
      );
      if (!quote) {
        quote = this.tryBuildQuote(
          poolState.pool,
          poolState.tokenMintB,
          new Decimal(usableB),
          lowerTick,
          upperTick,
          slippage,
          usableA,
          usableB,
          tokenExtensionCtx
        );
      }
      return quote;
    };

    let quote = buildQuote();
    if (!quote) {
      this.logOpenPositionContext("quote-failed", {
        balances,
        targetA,
        targetB,
        usableA,
        usableB,
        minA,
        minB,
        maxTokenA: options?.maxTokenA ?? null,
        maxTokenB: options?.maxTokenB ?? null
      });
      return "quote-failed";
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.lastStatus.lastCloseTokenA = null;
      this.lastStatus.lastCloseTokenB = null;
      const { requiredA, requiredB } = extractQuoteAmounts(
        quote,
        this.poolState.decimalsA,
        this.poolState.decimalsB
      );
      this.lastStatus.lastOpenTokenA = requiredA;
      this.lastStatus.lastOpenTokenB = requiredB;

      logger.info({ lowerTick, upperTick, attempt }, "opening new position");

      try {
        let openResult: any;
        if (typeof this.poolState.pool.getOpenPositionWithOptMetadataTx === "function") {
          openResult = await this.poolState.pool.getOpenPositionWithOptMetadataTx(
            lowerTick,
            upperTick,
            quote,
            this.wallet.publicKey,
            this.wallet.publicKey,
            TOKEN_PROGRAM_ID,
            false,
            undefined,
            true
          );
        } else {
          openResult = await this.poolState.pool.openPosition?.(lowerTick, upperTick, quote)
            ?? await this.poolState.pool.openPositionWithMetadata?.(lowerTick, upperTick, quote);
        }

        if (!openResult) {
          throw new Error("openPosition method not available on pool object; adjust src/orca.ts to your SDK version");
        }

        const tx = openResult.transaction ?? openResult.tx ?? openResult;
        const rawPositionMint = openResult.positionMint
          ?? openResult.positionMintAddress
          ?? openResult.positionMintKeypair?.publicKey;
        const positionMint = rawPositionMint
          ? typeof rawPositionMint === "string"
            ? rawPositionMint
            : rawPositionMint.toString()
          : null;
        const execution = await this.executeTx(tx, "open-position");
        const executed = execution.ok;

        if (executed && positionMint) {
          this.currentPositionMint = positionMint;
          this.missingPositionSince = Date.now();
          this.currentPosition = await this.fetchPositionByMint(this.currentPositionMint!);
          if (this.currentPosition) {
            this.missingPositionSince = null;
          }
          this.resetPositionAnchors();
        } else if (executed) {
          await this.loadExistingPosition();
        }
        return executed ? "open-position" : "dry-run-open";
      } catch (err) {
        if (isPriceSlippageError(err) && attempt < 2) {
          logger.warn({ attempt }, "price slippage out of bounds; re-quoting");
          await this.refreshPoolState();
          if (!this.poolState) {
            throw err;
          }
          tokenExtensionCtx = await whirlpools.TokenExtensionUtil.buildTokenExtensionContext(
            this.ctx.fetcher,
            this.poolState.pool.getData(),
            whirlpools.IGNORE_CACHE
          );
          quote = buildQuote();
          if (!quote) {
            logger.warn("unable to build liquidity quote with available balances after re-quote");
            return "quote-failed";
          }
          continue;
        }
        throw err;
      }
    }

    return "quote-failed";
  }

  private tryBuildQuote(
    pool: any,
    inputMint: PublicKey,
    amount: any,
    lowerTick: number,
    upperTick: number,
    slippage: any,
    usableA: number,
    usableB: number,
    tokenExtensionCtx: any
  ): any | null {
    if (!this.poolState || amount.lte(0)) {
      return null;
    }

    let currentAmount = amount;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (currentAmount.lte(0)) {
        return null;
      }
      try {
        const quote = whirlpools.increaseLiquidityQuoteByInputTokenUsingPriceDeviation(
          inputMint,
          currentAmount,
          lowerTick,
          upperTick,
          slippage,
          pool,
          tokenExtensionCtx
        );

        const { requiredA, requiredB } = extractQuoteAmounts(
          quote,
          this.poolState.decimalsA,
          this.poolState.decimalsB
        );

        if (requiredA <= usableA + 1e-9 && requiredB <= usableB + 1e-9) {
          return quote;
        }

        const scaleA = requiredA > 0 ? usableA / requiredA : 1;
        const scaleB = requiredB > 0 ? usableB / requiredB : 1;
        const scale = Math.min(scaleA, scaleB);

        if (!Number.isFinite(scale) || scale <= 0) {
          return null;
        }

        if (scale >= 0.999) {
          return null;
        }

        currentAmount = currentAmount.mul(scale * 0.98);
      } catch (err) {
        const message = stringifyError(err);
        logger.warn(
          { err: message, attempt, amount: currentAmount?.toString?.() ?? String(currentAmount), usableA, usableB },
          "failed to build liquidity quote"
        );
        if (
          message.toLowerCase().includes("tokenamount is zero")
          || message.toLowerCase().includes("provided tokenamount is zero")
        ) {
          if (this.config.kaminoRebalanceEnabled || this.kaminoState?.active) {
            this.queueKaminoLog(
              "quote-zero",
              `TokenAmount zero ao calcular quote (A=${usableA.toFixed(6)}, B=${usableB.toFixed(6)}).`,
              "warn"
            );
          }
        }
        return null;
      }
    }

    return null;
  }

  private async computeTargetAmounts(
    price: number,
    lowerTick: number,
    upperTick: number,
    walletA: number,
    walletB: number,
    solUsdPrice: number | null,
    tokenExtensionCtx: any
  ): Promise<{ targetA: number; targetB: number }> {
    if (!this.poolState) {
      return { targetA: 0, targetB: 0 };
    }

    const walletValue = walletB + walletA * price;
    if (walletValue <= 0) {
      return { targetA: 0, targetB: 0 };
    }

    let effectiveBudget = walletValue;
    if (this.config.budgetUsd != null) {
      if (!this.poolState.isTokenASol && !this.poolState.isTokenBSol) {
        throw new Error("budgetUsd requires a SOL (wSOL) leg in the pool");
      }
      const solUsd = solUsdPrice ?? await this.tryGetSolUsdPrice();
      if (!solUsd) {
        throw new Error("SOL/USD price unavailable");
      }
      const budgetSol = this.config.budgetUsd / solUsd;
      const budgetTokenB = this.poolState.isTokenBSol ? budgetSol : budgetSol * price;
      effectiveBudget = Math.min(walletValue, budgetTokenB);
    }

    const ratio = await this.getRangeRatio(lowerTick, upperTick, price, tokenExtensionCtx);
    const targetA = effectiveBudget / (price + ratio);
    const targetB = ratio * targetA;
    return { targetA, targetB };
  }

  private async computeTargetFromBalances(
    price: number,
    lowerTick: number,
    upperTick: number,
    walletA: number,
    walletB: number,
    tokenExtensionCtx: any
  ): Promise<{ targetA: number; targetB: number }> {
    if (!this.poolState) {
      return { targetA: 0, targetB: 0 };
    }
    const walletValue = walletB + walletA * price;
    if (walletValue <= 0) {
      return { targetA: 0, targetB: 0 };
    }
    const ratio = await this.getRangeRatio(lowerTick, upperTick, price, tokenExtensionCtx);
    const targetA = walletValue / (price + ratio);
    const targetB = ratio * targetA;
    return { targetA, targetB };
  }

  private async getRangeRatio(
    lowerTick: number,
    upperTick: number,
    price: number,
    tokenExtensionCtx: any
  ): Promise<number> {
    if (!this.poolState) {
      return price;
    }
    try {
      const slippage = common.Percentage.fromFraction(0, 10_000);
      const quote = whirlpools.increaseLiquidityQuoteByInputTokenUsingPriceDeviation(
        this.poolState.tokenMintA,
        new Decimal(1),
        lowerTick,
        upperTick,
        slippage,
        this.poolState.pool,
        tokenExtensionCtx
      );
      const { requiredA, requiredB } = extractQuoteAmounts(
        quote,
        this.poolState.decimalsA,
        this.poolState.decimalsB
      );
      if (requiredA > 0 && requiredB >= 0) {
        return requiredB / requiredA;
      }
    } catch (err) {
      logger.warn({ err }, "failed to compute ratio from liquidity quote");
    }
    return price;
  }

  private async rebalanceToTarget(
    walletA: number,
    walletB: number,
    targetA: number,
    targetB: number,
    price: number,
    slippage: any
  ): Promise<boolean> {
    if (!this.poolState) {
      return false;
    }
    const factor = Math.max(0, Math.min(1, this.config.rebalanceSwapPct ?? 1));
    if (factor <= 0) {
      return false;
    }

    const deltaA = targetA - walletA;
    const deltaB = targetB - walletB;

    if (deltaA > 0 && walletB > targetB) {
      const neededB = deltaA * price;
      const availableB = walletB - targetB;
      const amountIn = Math.min(neededB, availableB) * factor;
      if (amountIn > 0) {
        return this.swap(this.poolState.tokenMintB, amountIn, slippage);
      }
    }

    if (deltaB > 0 && walletA > targetA) {
      const neededA = deltaB / price;
      const availableA = walletA - targetA;
      const amountIn = Math.min(neededA, availableA) * factor;
      if (amountIn > 0) {
        return this.swap(this.poolState.tokenMintA, amountIn, slippage);
      }
    }

    // Fallback: if missing a side, allow a partial swap even without "surplus"
    if (deltaA > 0 && walletB > 0) {
      const neededB = deltaA * price;
      const amountIn = Math.min(neededB, walletB) * factor;
      if (amountIn > 0) {
        return this.swap(this.poolState.tokenMintB, amountIn, slippage);
      }
    }

    if (deltaB > 0 && walletA > 0) {
      const neededA = deltaB / price;
      const amountIn = Math.min(neededA, walletA) * factor;
      if (amountIn > 0) {
        return this.swap(this.poolState.tokenMintA, amountIn, slippage);
      }
    }

    return false;
  }

  private async swap(inputMint: PublicKey, amountIn: number, slippage: any): Promise<boolean> {
    if (!this.poolState) {
      return false;
    }
    if (amountIn <= 0) {
      return false;
    }
    if (this.isSwapAllowlistActive() && !this.isSwapAllowed(inputMint.toBase58())) {
      this.setError("Swap bloqueado: token nao permitido na allowlist");
      return false;
    }

    logger.info({ inputMint: inputMint.toBase58(), amountIn }, "attempting rebalance swap");

    const decimals = inputMint.equals(this.poolState.tokenMintA)
      ? this.poolState.decimalsA
      : this.poolState.decimalsB;
    const amountBN = common.DecimalUtil.toBN(new Decimal(amountIn), decimals);
    const programId = this.ctx.program?.programId
      ?? whirlpools.ORCA_WHIRLPOOL_PROGRAM_ID
      ?? whirlpools.WHIRLPOOL_PROGRAM_ID;

    if (!programId) {
      throw new Error("Whirlpool programId not available");
    }

    const swapQuote = await whirlpools.swapQuoteByInputToken?.(
      this.poolState.pool,
      inputMint,
      amountBN,
      slippage,
      programId,
      this.ctx.fetcher,
      whirlpools.IGNORE_CACHE
    );

    if (!swapQuote) {
      throw new Error("swapQuoteByInputToken not available; update src/orca.ts for your SDK version");
    }

    const swapResult = await this.poolState.pool.swap?.(swapQuote);
    if (!swapResult) {
      throw new Error("pool.swap not available; update src/orca.ts for your SDK version");
    }

    const tx = swapResult.transaction ?? swapResult.tx ?? swapResult;
    const execution = await this.executeTx(tx, "swap");
    return execution.ok || this.config.dryRun;
  }

  private async increasePositionLiquidity(position: any, quote: any): Promise<void> {
    let increaseResult: any = null;
    if (typeof position.increaseLiquidity === "function") {
      increaseResult = await position.increaseLiquidity(quote);
    } else if (typeof position.increaseLiquidityWithMetadata === "function") {
      increaseResult = await position.increaseLiquidityWithMetadata(quote);
    }

    if (!increaseResult) {
      throw new Error("increaseLiquidity not available on SDK objects; update src/orca.ts to your SDK version");
    }

    const txList = Array.isArray(increaseResult) ? increaseResult : [increaseResult];
    for (const item of txList) {
      const tx = item.transaction ?? item.tx ?? item;
      await this.executeTx(tx, "add-liquidity");
    }
  }

  private async closePosition(position: any): Promise<void> {
    logger.info("closing position and collecting fees");

    let feeA = 0;
    let feeB = 0;
    const targetMint = (this.config.autoSwapFeesToUsdcTargetMint || "").trim();
    let preSwapBalance: bigint = 0n;
    if (this.config.autoSwapFeesToUsdcEnabled && this.config.autoSwapFeesToUsdcDestWallet && targetMint) {
      preSwapBalance = await this.readTargetMintBalance(targetMint);
    }
    try {
      const amounts = await this.getPositionTokenAmounts(position);
      this.lastStatus.lastCloseTokenA = amounts.tokenA;
      this.lastStatus.lastCloseTokenB = amounts.tokenB;
      this.lastStatus.lastOpenTokenA = null;
      this.lastStatus.lastOpenTokenB = null;
      feeA = amounts.feeA;
      feeB = amounts.feeB;
    } catch (err) {
      logger.warn({ err }, "failed to estimate close amounts");
    }

    const slippage = common.Percentage.fromFraction(this.config.slippageBps, 10_000);

    let closeResult: any = null;
    if (typeof position.closePosition === "function" || typeof position.closePositionWithMetadata === "function") {
      closeResult = await position.closePosition?.()
        ?? await position.closePositionWithMetadata?.();
    } else if (this.poolState?.pool?.closePosition) {
      const positionAddress = position.getAddress?.() ?? position.getAddress ?? position.address;
      if (!positionAddress) {
        throw new Error("position address not available for closePosition");
      }
      closeResult = await this.poolState.pool.closePosition(
        positionAddress,
        slippage,
        this.wallet.publicKey,
        this.wallet.publicKey,
        this.wallet.publicKey,
        true
      );
    } else if (this.poolState?.pool?.getClosePositionIx) {
      const positionAddress = position.getAddress?.() ?? position.getAddress ?? position.address;
      if (!positionAddress) {
        throw new Error("position address not available for closePosition");
      }
      closeResult = await this.poolState.pool.getClosePositionIx(
        positionAddress,
        slippage,
        this.wallet.publicKey,
        this.wallet.publicKey,
        this.wallet.publicKey,
        true
      );
    }

    if (!closeResult) {
      throw new Error("closePosition not available on SDK objects; update src/orca.ts to your SDK version");
    }

    const txList = Array.isArray(closeResult) ? closeResult : [closeResult];
    for (const item of txList) {
      const tx = item.transaction ?? item.tx ?? item;
      await this.executeTx(tx, "close-position");
    }

    if (this.config.autoSwapFeesToUsdcEnabled) {
      try {
        await this.maybeSwapFeesToUsdc(feeA, feeB);
      } catch (err) {
        logger.warn({ err }, "swap-fees-to-usdc failed");
      }
      // Após o swap, transferir stablecoin para carteira destino se configurada
      if (this.config.autoSwapFeesToUsdcDestWallet) {
        try {
          await this.maybeTransferFeesToDestWallet(preSwapBalance);
        } catch (err) {
          logger.warn({ err }, "transfer-fees-to-dest-wallet failed");
        }
      }
    }

    this.resetPositionAnchors();
  }

  private captureCloseSnapshot(): void {
    if (!this.currentPosition || !this.currentPositionMint) {
      return;
    }
    this.lastStatus.eventPositionMint = this.currentPositionMint;
    this.lastStatus.eventPositionEntryUsd = this.lastStatus.positionEntryUsd ?? this.positionEntryUsd;
    this.lastStatus.eventPositionFeesUsd = this.lastStatus.positionFeesUsd ?? null;
    this.lastStatus.eventPositionExitUsd = this.lastPositionValueUsdWithFees
      ?? this.lastStatus.positionValueUsd
      ?? null;
  }

  private getPositionPnlNoFeesUsd(): number | null {
    const entryUsd = this.lastStatus.positionEntryUsd ?? null;
    const valueUsd = this.lastStatus.positionValueUsd ?? null;
    if (entryUsd != null && valueUsd != null) {
      return valueUsd - entryUsd;
    }
    const pnlUsd = this.lastStatus.positionPnlUsd ?? null;
    const feesUsd = this.lastStatus.positionFeesUsd ?? null;
    if (pnlUsd != null && feesUsd != null) {
      return pnlUsd - feesUsd;
    }
    return null;
  }

  getStatus(): BotStatus {
    return {
      ...this.lastStatus,
      kaminoCollaterals: Array.isArray(this.lastStatus.kaminoCollaterals)
        ? this.lastStatus.kaminoCollaterals.map((item) => ({ ...item }))
        : []
    };
  }

  getKaminoHealth(): KaminoHealthStatus {
    const issues = this.kaminoHealth.diagnose(this.kaminoState);
    const recent = this.kaminoHealth.getRecentErrors();
    const counts = new Map<string, number>();
    for (const item of recent) {
      if (!item?.type) continue;
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    }
    const recentErrors = Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
    const lastProgressAtMs = this.kaminoHealth.getLastProgressAt();
    const lastProgressAt = Number.isFinite(lastProgressAtMs)
      ? new Date(lastProgressAtMs).toISOString()
      : null;
    return {
      stuck: this.kaminoHealth.isStuck(this.kaminoState),
      issues,
      consecutiveErrors: this.kaminoHealth.getConsecutiveErrors(),
      lastProgressAt,
      recentErrors
    };
  }

  getKaminoState(): KaminoCycleState | null {
    if (!this.kaminoState) {
      return null;
    }
    return {
      ...this.kaminoState,
      collaterals: Array.isArray(this.kaminoState.collaterals)
        ? this.kaminoState.collaterals.map((item) => ({ ...item }))
        : []
    };
  }

  setKaminoState(state: KaminoCycleState | null): void {
    if (state?.active && this.poolId && !state.ownerPoolId) {
      state = {
        ...state,
        ownerPoolId: this.poolId,
        ownerPoolName: this.poolName ?? this.poolId,
        marketAddress: state.marketAddress ?? this.getKaminoMarketAddress()
      };
    }
    if (state?.active) {
      state = { ...state, lastSeenAt: new Date().toISOString() };
    }
    const normalized = this.normalizeKaminoState(state);
    if (normalized?.active && this.poolId) {
      const poolName = this.poolName ?? this.poolId;
      const lock = tryAcquireKaminoLock({
        poolId: this.poolId,
        poolName,
        marketAddress: normalized.marketAddress ?? this.getKaminoMarketAddress()
      });
      if (!lock.ok) {
        const owner = lock.owner?.poolName ?? lock.owner?.poolId ?? "outra pool";
        normalized.lastError = `Kamino ativo na pool ${owner}`;
      }
    }
    this.kaminoState = normalized;
    // Correção Bug 4: se restaurando estado Kamino ativo mas sem timestamp
    // de abertura, usar o momento atual (conservador — inicia grace period
    // do zero para evitar fechamentos imediatos logo após restart).
    if (this.kaminoState?.active && this.kaminoPoolOpenedAt == null) {
      this.kaminoPoolOpenedAt = Date.now();
      logger.info(
        { collateralMint: this.kaminoState.collateralMint, cycleCount: this.kaminoState.cycleCount },
        "kaminoPoolOpenedAt inicializado no resume (estado ativo restaurado)"
      );
    }
    this.syncKaminoStatus();
    this.updateBalanceReservations();
  }

  resetKaminoCycle(): void {
    this.kaminoState = null;
    this.syncKaminoStatus();
    this.updateBalanceReservations();
    this.releaseKaminoLockIfOwned();
    this.queueKaminoLog("reset", "Ciclo Kamino resetado localmente.", "info");
  }

  private updateBalanceReservations(): void {
    if (!this.balanceCoordinator || !this.poolId || !this.poolState) {
      return;
    }
    let state = this.kaminoState;
    if (!state?.active) {
      this.balanceCoordinator.clearPool(this.poolId);
      return;
    }
    const reservedA = Number(state.reservedTokenA ?? 0);
    const reservedB = Number(state.reservedTokenB ?? 0);
    if ((!Number.isFinite(reservedA) || reservedA <= 0) && (!Number.isFinite(reservedB) || reservedB <= 0)) {
      this.balanceCoordinator.clearPool(this.poolId);
      return;
    }
    const entries = [];
    if (Number.isFinite(reservedA) && reservedA > 0) {
      entries.push({ mint: this.poolState.tokenMintA.toBase58(), amount: reservedA });
    }
    if (Number.isFinite(reservedB) && reservedB > 0) {
      entries.push({ mint: this.poolState.tokenMintB.toBase58(), amount: reservedB });
    }
    this.balanceCoordinator.setPoolReservations(this.poolId, entries);
  }

  private normalizeKaminoState(state: KaminoCycleState | null): KaminoCycleState | null {
    if (!state) {
      return null;
    }
    const collaterals: KaminoCollateralEntry[] = Array.isArray(state.collaterals)
      ? state.collaterals.map((item) => ({
        mint: String(item.mint ?? ""),
        amount: Number(item.amount ?? 0),
        usd: item.usd == null ? null : Number(item.usd),
        debtUsd: item.debtUsd == null ? null : Number(item.debtUsd),
        avgPriceUsdc: item.avgPriceUsdc == null ? null : Number(item.avgPriceUsdc),
        targetPriceUsdc: item.targetPriceUsdc == null ? null : Number(item.targetPriceUsdc),
        currentPriceUsdc: item.currentPriceUsdc == null ? null : Number(item.currentPriceUsdc),
        gapToTargetPct: item.gapToTargetPct == null ? null : Number(item.gapToTargetPct),
        currentUsd: item.currentUsd == null ? null : Number(item.currentUsd),
        pnlUsd: item.pnlUsd == null ? null : Number(item.pnlUsd)
      })).filter((item) => item.mint && Number.isFinite(item.amount))
      : [];
    if (collaterals.length === 0 && state.collateralMint) {
      collaterals.push({
        mint: state.collateralMint,
        amount: Number(state.collateralAmount ?? 0),
        usd: state.collateralUsd ?? null,
        debtUsd: state.debtUsd ?? null,
        avgPriceUsdc: state.avgPriceUsdc ?? null,
        targetPriceUsdc: state.targetPriceUsdc ?? null
      });
    }
    const collateralUsd = collaterals.length
      ? collaterals.reduce((sum, item) => sum + (Number(item.usd ?? 0) || 0), 0)
      : (state.collateralUsd ?? null);
    const debtUsd = collaterals.length
      ? collaterals.reduce((sum, item) => sum + (Number(item.debtUsd ?? 0) || 0), 0)
      : (state.debtUsd ?? null);
    const single = collaterals.length === 1 ? collaterals[0] : null;
    const reservedTokenA = Number.isFinite(Number(state.reservedTokenA ?? NaN))
      ? Number(state.reservedTokenA)
      : null;
    const reservedTokenB = Number.isFinite(Number(state.reservedTokenB ?? NaN))
      ? Number(state.reservedTokenB)
      : null;
    const reservedCollateralDust = Number.isFinite(Number(state.reservedCollateralDust ?? NaN))
      ? Number(state.reservedCollateralDust)
      : null;
    const baselineTokenA = Number.isFinite(Number(state.baselineTokenA ?? NaN))
      ? Number(state.baselineTokenA)
      : null;
    const baselineTokenB = Number.isFinite(Number(state.baselineTokenB ?? NaN))
      ? Number(state.baselineTokenB)
      : null;
    return {
      ...state,
      ownerPoolId: state.ownerPoolId ?? null,
      ownerPoolName: state.ownerPoolName ?? null,
      marketAddress: state.marketAddress ?? null,
      lastSeenAt: state.lastSeenAt ?? null,
      repayRetryUntil: state.repayRetryUntil ?? null,
      repayRetryAttempts: Number.isFinite(Number(state.repayRetryAttempts ?? NaN))
        ? Number(state.repayRetryAttempts)
        : null,
      repayRetryReason: state.repayRetryReason ?? null,
      baselineTokenA,
      baselineTokenB,
      reservedTokenA,
      reservedTokenB,
      reservedCollateralDust,
      collateralMint: single ? single.mint : state.collateralMint ?? null,
      collateralAmount: single ? Number(single.amount ?? 0) : Number(state.collateralAmount ?? 0),
      collateralUsd: typeof collateralUsd === "number" && Number.isFinite(collateralUsd) && collateralUsd > 0
        ? collateralUsd
        : (state.collateralUsd ?? null),
      debtUsd: typeof debtUsd === "number" && Number.isFinite(debtUsd) && debtUsd > 0
        ? debtUsd
        : (state.debtUsd ?? null),
      avgPriceUsdc: single ? single.avgPriceUsdc : state.avgPriceUsdc ?? null,
      targetPriceUsdc: single ? single.targetPriceUsdc : state.targetPriceUsdc ?? null,
      collaterals
    };
  }

  queueHistoryAction(action: string, overrides?: Partial<BotStatus>): void {
    const base: BotStatus = {
      ...this.lastStatus,
      kaminoCollaterals: Array.isArray(this.lastStatus.kaminoCollaterals)
        ? this.lastStatus.kaminoCollaterals.map((item) => ({ ...item }))
        : []
    };
    const snapshot: BotStatus = {
      ...base,
      ...overrides,
      lastAction: action
    };
    this.pendingHistoryActions.push(snapshot);
  }

  private async ensureAtaIfMissing(mint: string): Promise<void> {
    try {
      const ata = getAssociatedTokenAddressSync(new PublicKey(mint), this.wallet.publicKey);
      const info = await this.connection.getAccountInfo(ata);
      if (!info) {
        const ix = createAssociatedTokenAccountInstruction(
          this.wallet.publicKey,
          ata,
          this.wallet.publicKey,
          new PublicKey(mint)
        );
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("finalized");
        const tx = new Transaction().add(ix);
        tx.feePayer = this.wallet.publicKey;
        tx.recentBlockhash = blockhash;
        const signed = (await this.wallet.signTransaction(tx)) as Transaction;
        const sig = await this.connection.sendRawTransaction(signed.serialize());
        await this.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        this.queueKaminoLog("ata-created", `ATA criada para ${mint}`, "info");
      }
    } catch (err) {
      logger.warn({ err, mint }, "falha ao checar ATA");
    }
  }

  queueKaminoLog(action: string, message: string, level: "info" | "warn" | "error" = "info"): void {
    const entry: KaminoLogItem = {
      action,
      message,
      level,
      marketAddress: this.kaminoState?.marketAddress ?? this.getKaminoMarketAddress(),
      timestamp: new Date().toISOString()
    };
    this.pendingKaminoLogs.push(entry);
  }

  drainKaminoLogs(): KaminoLogItem[] {
    if (this.pendingKaminoLogs.length === 0) {
      return [];
    }
    const logs = this.pendingKaminoLogs;
    this.pendingKaminoLogs = [];
    return logs;
  }

  private logOpenPositionContext(reason: string, context: Record<string, any>): void {
    const payload = { reason, ...context };
    logger.warn(payload, "open-position diagnostics");
    if (this.config.kaminoRebalanceEnabled || this.kaminoState?.active) {
      const summary = [
        `${reason}`,
        `A=${Number(context.usableA ?? 0).toFixed(6)}`,
        `B=${Number(context.usableB ?? 0).toFixed(6)}`,
        `tA=${Number(context.targetA ?? 0).toFixed(6)}`,
        `tB=${Number(context.targetB ?? 0).toFixed(6)}`
      ].join(" ");
      this.queueKaminoLog("open-context", summary, "warn");
    }
  }

  drainHistoryActions(): BotStatus[] {
    const items = [...this.pendingHistoryActions];
    this.pendingHistoryActions = [];
    return items;
  }

  async getWalletBalances(): Promise<{ tokenA: number; tokenB: number }> {
    if (!this.poolState) {
      await this.refreshPoolState();
    }
    return this.getTokenBalances();
  }

   setPositionEntryUsd(value: number | null): void {
     this.positionEntryUsd = value;
     this.lastStatus.positionEntryUsd = value;
   }

   // Correção Bug 2: método público para resetar apenas os anchors de valor
   // sem apagar o positionEntryUsd restaurado do histórico.
   // Chamado pelo runner após restaurar entry no auto-resume.
   resetPositionAnchorsOnResume(): void {
     this.initialPositionValue = null;
     this.initialPositionValueSol = null;
     this.lastPositionValueUsdWithFees = null;
     this.lastStatus.positionPnlUsd = null;
     // NÃO zera positionEntryUsd — ele foi restaurado intencionalmente
   }

   setError(err: unknown): void {
    this.lastStatus.lastError = stringifyError(err);
  }

  private syncKaminoStatus(): void {
    const state = this.kaminoState;
    this.lastStatus.kaminoActive = Boolean(state?.active);
    this.lastStatus.kaminoEnabled = Boolean(this.config.kaminoRebalanceEnabled);
    this.lastStatus.kaminoOwnerPoolId = state?.ownerPoolId ?? null;
    this.lastStatus.kaminoOwnerPoolName = state?.ownerPoolName ?? null;
    this.lastStatus.kaminoMarketAddress = state?.marketAddress ?? null;
    // Mescla os campos calculados (currentUsd, currentPriceUsdc, etc.)
    // do lastStatus existente para não perdê-los quando setKaminoState
    // é chamado após refreshKaminoCollateralMetrics().
    const existingByMint = new Map<string, KaminoCollateralEntry>(
      (Array.isArray(this.lastStatus.kaminoCollaterals)
        ? this.lastStatus.kaminoCollaterals
        : []
      ).filter((e) => Boolean(e?.mint)).map((e) => [e.mint, e])
    );
    const collaterals = Array.isArray(state?.collaterals)
      ? state.collaterals.map((item) => {
        const existing = item?.mint ? existingByMint.get(item.mint) : undefined;
        return {
          ...item,
          currentUsd: existing?.currentUsd ?? (item as any).currentUsd ?? null,
          currentPriceUsdc: existing?.currentPriceUsdc ?? (item as any).currentPriceUsdc ?? null,
          gapToTargetPct: existing?.gapToTargetPct ?? (item as any).gapToTargetPct ?? null,
          pnlUsd: existing?.pnlUsd ?? (item as any).pnlUsd ?? null
        };
      })
      : [];
    const collateralUsd = collaterals.length
      ? collaterals.reduce((sum, item) => sum + (Number(item.usd ?? item.currentUsd ?? 0) || 0), 0)
      : (state?.collateralUsd ?? null);
    const debtUsd = collaterals.length
      ? collaterals.reduce((sum, item) => sum + (Number(item.debtUsd ?? 0) || 0), 0)
      : (state?.debtUsd ?? null);
    this.lastStatus.kaminoCollaterals = collaterals;
    this.lastStatus.kaminoCollateralUsd = Number.isFinite(collateralUsd) ? collateralUsd : null;
    this.lastStatus.kaminoDebtUsd = Number.isFinite(debtUsd) ? debtUsd : null;
    if (collateralUsd != null && collateralUsd > 0 && debtUsd != null) {
      this.lastStatus.kaminoLtv = debtUsd / collateralUsd;
    } else {
      this.lastStatus.kaminoLtv = null;
    }
    if (collaterals.length === 1) {
      this.lastStatus.kaminoAvgPriceUsdc = collaterals[0].avgPriceUsdc ?? null;
      this.lastStatus.kaminoTargetPriceUsdc = collaterals[0].targetPriceUsdc ?? null;
    } else {
      this.lastStatus.kaminoAvgPriceUsdc = null;
      this.lastStatus.kaminoTargetPriceUsdc = null;
    }
    this.lastStatus.kaminoCycleCount = state?.cycleCount ?? 0;
    const stateError = state?.lastError ?? null;
    const fallbackError = (!stateError && this.lastStatus.lastError && /kamino/i.test(this.lastStatus.lastError))
      ? this.lastStatus.lastError
      : null;
    this.lastStatus.kaminoLastError = stateError ?? fallbackError;
    this.lastStatus.kaminoSimulated = this.isKaminoSimulated();
    this.lastStatus.kaminoHealth = this.getKaminoHealth();
  }

  private async refreshKaminoCollateralMetrics(): Promise<void> {
    const state = this.kaminoState;
    if (!state?.active) {
      return;
    }
    const collaterals = Array.isArray(state.collaterals) ? state.collaterals : [];
    if (!collaterals.length) {
      return;
    }
    let stable: { mint: string; decimals: number; label: string } | null = null;
    try {
      const debtMint = state.debtMint ?? null;
      if (debtMint) {
        stable = await this.getStableMintInfoByMint(debtMint, this.getStableLabelForMint(debtMint));
      } else {
        stable = await this.getStableMintInfo();
      }
    } catch (err) {
      logger.warn({ err }, "falha ao resolver stable para Kamino");
    }
    const nextCollaterals: KaminoCollateralEntry[] = [];
    for (const entry of collaterals) {
      let currentPriceUsdc: number | null = null;
      let gapToTargetPct: number | null = null;
      let currentUsd: number | null = null;
      let pnlUsd: number | null = null;
      if (stable && this.config.jupiterApiKey) {
        try {
          const decimals = await this.getTokenDecimals(entry.mint);
          currentPriceUsdc = await this.getTokenUsdPrice({
            mint: entry.mint,
            decimals,
            stableMint: stable.mint,
            stableDecimals: stable.decimals
          });
          if (entry.mint === NATIVE_MINT.toBase58() && currentPriceUsdc != null) {
            const pythSolPrice = this.lastStatus.solUsdPrice;
            if (pythSolPrice != null && pythSolPrice > 0) {
              const deviation = Math.abs(currentPriceUsdc - pythSolPrice) / pythSolPrice;
              if (deviation > 0.20) {
                logger.warn(
                  { currentPriceUsdc, pythSolPrice, deviation },
                  "currentPriceUsdc para SOL desviou >20% do Pyth; usando preço Pyth"
                );
                currentPriceUsdc = pythSolPrice;
              }
            }
          }
          const target = entry.targetPriceUsdc ?? null;
          if (currentPriceUsdc != null && target != null && target > 0) {
            const rawGap = (target - currentPriceUsdc) / target;
            gapToTargetPct = rawGap > 0 ? rawGap : 0;
          }
          if (currentPriceUsdc != null && Number.isFinite(entry.amount)) {
            currentUsd = currentPriceUsdc * entry.amount;
            if (entry.usd != null && Number.isFinite(entry.usd)) {
              pnlUsd = currentUsd - entry.usd;
            }
          }
        } catch (err) {
          logger.warn({ err, mint: entry.mint }, "falha ao calcular preco atual Kamino");
        }
      }
      nextCollaterals.push({
        ...entry,
        currentPriceUsdc,
        gapToTargetPct,
        currentUsd,
        pnlUsd
      });
    }
    this.lastStatus.kaminoCollaterals = nextCollaterals;
  }

  private getConfiguredKaminoMarketAddress(): string | null {
    return this.config.kaminoMarketAddress
      ?? process.env.KAMINO_MARKET
      ?? process.env.KAMINO_MAIN_MARKET
      ?? DEFAULT_KAMINO_MARKET;
  }

  private getKaminoMarketAddress(): string | null {
    return this.kaminoState?.marketAddress ?? this.getConfiguredKaminoMarketAddress();
  }

  private getPoolTokenMints(): string[] {
    const mints: string[] = [];
    const add = (value: any) => {
      if (!value) return;
      const str = typeof value === "string" ? value : value?.toBase58?.();
      if (str && String(str).trim()) {
        mints.push(String(str).trim());
      }
    };
    add(this.poolState?.tokenMintA);
    add(this.poolState?.tokenMintB);
    return mints;
  }

  private getDebtMintForCompatibility(): string | null {
    if (this.kaminoState?.debtMint) {
      return this.kaminoState.debtMint;
    }
    try {
      const resolved = this.resolveKaminoBorrowMint();
      return resolved?.mint ?? null;
    } catch {
      return null;
    }
  }

  private gatherKaminoMarketSeeds(): string[] {
    const candidates = new Set<string>();
    const add = (value: string | null | undefined) => {
      if (!value) return;
      const trimmed = String(value).trim();
      if (!trimmed) return;
      candidates.add(trimmed);
    };
    add(this.kaminoState?.marketAddress ?? null);
    if (this.kaminoMarketCandidates) {
      for (const entry of this.kaminoMarketCandidates()) {
        add(entry);
      }
    }
    add(this.getConfiguredKaminoMarketAddress());
    add(DEFAULT_KAMINO_MARKET);
    return Array.from(candidates.values());
  }

  private async isMarketCompatible(
    client: KaminoClient,
    tokenMints: string[],
    debtMint: string | null
  ): Promise<{ ok: boolean; reason?: string }> {
    try {
      for (const mint of tokenMints) {
        const supported = await client.supportsCollateral(mint);
        if (!supported) {
          return { ok: false, reason: `Token ${mint} nao suportado` };
        }
      }
      if (debtMint) {
        const borrow = await client.supportsBorrow(debtMint);
        if (!borrow.ok) {
          return { ok: false, reason: borrow.reason ?? "Borrow indisponivel" };
        }
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: stringifyError(err) };
    }
  }

  private async buildCompatibleKaminoClients(): Promise<Map<string, KaminoClient>> {
    const seeds = this.gatherKaminoMarketSeeds();
    const tokenMints = this.getPoolTokenMints();
    const debtMint = this.getDebtMintForCompatibility();
    const result = new Map<string, KaminoClient>();

    for (const market of seeds) {
      try {
        const client = await createKaminoClient(
          {
            connection: this.connection,
            wallet: this.wallet,
            config: this.config
          },
          market
        );
        const compatibility = await this.isMarketCompatible(client, tokenMints, debtMint);
        if (compatibility.ok) {
          result.set(market, client);
        } else {
          this.queueKaminoLog(
            "market-fallback",
            `Market ${market} ignorado: ${compatibility.reason ?? "incompatível"}`,
            "warn"
          );
        }
      } catch (err) {
        logger.warn({ err, market }, "falha ao avaliar market Kamino");
      }
    }

    if (!result.size && !result.has(DEFAULT_KAMINO_MARKET)) {
      try {
        const client = await createKaminoClient(
          {
            connection: this.connection,
            wallet: this.wallet,
            config: this.config
          },
          DEFAULT_KAMINO_MARKET
        );
        result.set(DEFAULT_KAMINO_MARKET, client);
      } catch (err) {
        logger.warn({ err }, "falha ao criar fallback Kamino client");
      }
    }

    return result;
  }

  private async resolveKaminoPositionWithFallback(): Promise<{
    kamino: KaminoClient;
    position: KaminoPositionState | null;
    marketAddress: string | null;
  }> {
    const candidates = await this.buildCompatibleKaminoClients();
    let chosenClient: KaminoClient | null = null;
    let chosenMarket: string | null = null;
    let chosenPosition: KaminoPositionState | null = null;
    let firstCompatible: { market: string; client: KaminoClient } | null = null;

    for (const [market, client] of candidates.entries()) {
      if (!firstCompatible) {
        firstCompatible = { market, client };
      }
      const position = await client.getPositionState();
      const hasDebt = (position?.debtAmount ?? 0) > 0;
      const hasCollateral = (position?.collateralAmount ?? 0) > 0
        || (Array.isArray(position?.deposits) && position!.deposits!.length > 0);
      if (position && (hasDebt || hasCollateral)) {
        chosenClient = client;
        chosenMarket = market;
        chosenPosition = position;
        break;
      }
    }

    if (!chosenClient && firstCompatible) {
      chosenClient = firstCompatible.client;
      chosenMarket = firstCompatible.market;
    }

    if (!chosenClient) {
      const fallback = await this.ensureKaminoClient(DEFAULT_KAMINO_MARKET);
      return { kamino: fallback, position: null, marketAddress: DEFAULT_KAMINO_MARKET };
    }

    const previousMarket = this.kaminoState?.marketAddress ?? this.kaminoClientMarket ?? null;
    if (previousMarket && previousMarket !== chosenMarket) {
      const tokens = this.getPoolTokenMints();
      this.queueKaminoLog(
        "market-fallback",
        `Market Kamino ajustado de ${previousMarket} para ${chosenMarket}. Tokens: ${tokens.join(",")}`,
        "warn"
      );
    }
    this.kaminoClient = chosenClient;
    this.kaminoClientMarket = chosenMarket;
    if (this.kaminoState) {
      this.setKaminoState({ ...this.kaminoState, marketAddress: chosenMarket });
    }
    return { kamino: chosenClient, position: chosenPosition, marketAddress: chosenMarket };
  }

  private canUseKaminoLock(): { ok: boolean; ownerName?: string } {
    if (!this.poolId) {
      return { ok: true };
    }
    const poolName = this.poolName ?? this.poolId;
    const lock = tryAcquireKaminoLock({
      poolId: this.poolId,
      poolName,
      marketAddress: this.getKaminoMarketAddress()
    });
    if (lock.ok) {
      return { ok: true };
    }
    return { ok: false, ownerName: lock.owner?.poolName ?? lock.owner?.poolId ?? "outra pool" };
  }

  private releaseKaminoLockIfOwned(): void {
    if (this.poolId) {
      const market = this.kaminoState?.marketAddress ?? this.getKaminoMarketAddress();
      releaseKaminoLock(this.poolId, market);
    }
  }

  private isKaminoOwner(state: KaminoCycleState | null): boolean {
    if (!state?.ownerPoolId || !this.poolId) {
      return true;
    }
    return state.ownerPoolId === this.poolId;
  }

  private async reconcileKaminoState(): Promise<void> {
    if (this.isKaminoSimulated()) {
      return;
    }
    try {
      const kamino = await this.ensureKaminoClient();
      // FORÇAR leitura fresca — reconciliação precisa de dados atuais
      kamino.invalidatePositionCache?.();
      const position = await kamino.getPositionState();
      const hasDebt = (position?.debtAmount ?? 0) > 0;
      const hasCollateral = (position?.collateralAmount ?? 0) > 0;
    if (!position || (!hasDebt && !hasCollateral)) {
      if (this.kaminoState?.active) {
        // Posição sumiu on-chain após fechamento — desativa o ciclo localmente
        // em vez de manter active=true com estado inconsistente.
        const wasJustClosed =
          !this.kaminoState.collateralAmount ||
          Number(this.kaminoState.collateralAmount) <= 0;
        if (wasJustClosed) {
          this.setKaminoState({
            ...this.kaminoState,
            active: false,
            reservedTokenA: null,
            reservedTokenB: null,
            reservedCollateralDust: null,
            lastError: null,
            updatedAt: new Date().toISOString()
          });
          this.kaminoPoolOpenedAt = null;
          this.releaseKaminoLockIfOwned();
          this.queueKaminoLog(
            "not-found",
            "Posicao Kamino nao encontrada no market; ciclo desativado.",
            "warn"
          );
        } else {
          this.setKaminoState({
            ...this.kaminoState,
            lastError: "Posicao Kamino nao encontrada no market; mantendo ciclo salvo."
          });
          this.queueKaminoLog(
            "not-found",
            "Posicao Kamino nao encontrada no market; mantendo ciclo salvo.",
            "warn"
          );
        }
      }
      return;
    }

      const deposits = Array.isArray(position.deposits) ? position.deposits : [];
      const borrows = Array.isArray(position.borrows) ? position.borrows : [];
      // Preserva campos históricos do estado anterior ao reconciliar colaterais on-chain.
      // Nulls são usados apenas quando não há ciclo ativo ou sem histórico anterior.
      const existingCollaterals = Array.isArray(this.kaminoState?.collaterals)
        ? this.kaminoState!.collaterals
        : [];
      const recoveredCollaterals: KaminoCollateralEntry[] = deposits.length
        ? deposits.map((item) => {
          const prev = existingCollaterals.find((e) => e.mint === item.mint);
          return {
            mint: item.mint ?? "",
            amount: item.amount ?? 0,
            usd: prev?.usd ?? null,
            debtUsd: prev?.debtUsd ?? null,
            avgPriceUsdc: prev?.avgPriceUsdc ?? null,
            targetPriceUsdc: prev?.targetPriceUsdc ?? null
          };
        })
        : (position?.collateralMint && (position.collateralAmount ?? 0) > 0
          ? [{
            mint: position.collateralMint,
            amount: position.collateralAmount ?? 0,
            usd: existingCollaterals[0]?.usd ?? null,
            debtUsd: existingCollaterals[0]?.debtUsd ?? null,
            avgPriceUsdc: existingCollaterals[0]?.avgPriceUsdc ?? null,
            targetPriceUsdc: existingCollaterals[0]?.targetPriceUsdc ?? null
          }]
          : []);

      if (this.kaminoState?.active) {
        const recordedDebt = Number(this.kaminoState.debtAmount ?? 0);
        const recordedCollateral = Number(this.kaminoState.collateralAmount ?? 0);
        const onChainDebt = Number(position.debtAmount ?? 0);
        const onChainCollateral = Number(position.collateralAmount ?? 0);
        const epsilon = 1e-8;
        const reservedDust = Number(this.kaminoState.reservedCollateralDust ?? 0);
        const dustAmount = Number.isFinite(reservedDust) ? reservedDust : 0;

        if (onChainDebt <= epsilon) {
          if (onChainCollateral > epsilon || dustAmount > epsilon) {
            const dustTotal = onChainCollateral > epsilon ? onChainCollateral : dustAmount;
            let reconciledUsd: number | null = null;
            try {
              const mint = position.collateralMint ?? this.kaminoState.collateralMint ?? null;
              if (mint) {
                reconciledUsd = await this.tryPriceCollateral(mint, dustTotal);
              }
            } catch {
              reconciledUsd = null;
            }
            this.queueKaminoLog(
              "debt-zero",
              `Divida zerada com colateral residual (${dustTotal.toFixed(8)}); iniciando saque automatico.`,
              "warn"
            );
            this.setKaminoState({
              ...this.kaminoState,
              collateralMint: position.collateralMint ?? this.kaminoState.collateralMint ?? null,
              collateralAmount: onChainCollateral > epsilon ? onChainCollateral : dustTotal,
              collateralUsd: reconciledUsd ?? this.kaminoState.collateralUsd ?? null,
              avgPriceUsdc: reconciledUsd != null && dustTotal > 0
                ? reconciledUsd / dustTotal
                : this.kaminoState.avgPriceUsdc ?? null,
              debtMint: position.debtMint ?? this.kaminoState.debtMint ?? null,
              debtAmount: 0,
              reservedCollateralDust: dustTotal,
              collaterals: recoveredCollaterals,
              updatedAt: new Date().toISOString()
            });
            const retryAt = this.kaminoState?.repayRetryUntil
              ? Date.parse(this.kaminoState.repayRetryUntil)
              : 0;
            if (Number.isFinite(retryAt) && retryAt > Date.now()) {
              // Ainda em espera de retry — não chamar closeKaminoCycle agora
              return;
            }
            try {
              await this.closeKaminoCycle("target");
            } catch (closeErr) {
              this.kaminoHealth.recordError(closeErr, "kamino-close");
              this.queueKaminoLog(
                "debt-zero-close-failed",
                `Falha ao sacar colateral residual: ${closeErr instanceof Error ? closeErr.message : String(closeErr)}. Sera tentado no proximo tick.`,
                "error"
              );
              const updated: KaminoCycleState = {
                ...this.kaminoState,
                active: false,
                collateralMint: position.collateralMint ?? this.kaminoState.collateralMint ?? null,
                collateralAmount: onChainCollateral > epsilon ? onChainCollateral : dustTotal,
                debtMint: position.debtMint ?? this.kaminoState.debtMint ?? null,
                debtAmount: 0,
                reservedCollateralDust: dustTotal,
                collaterals: recoveredCollaterals,
                lastError: `Colateral residual nao sacado: ${closeErr instanceof Error ? closeErr.message : String(closeErr)}`,
                updatedAt: new Date().toISOString()
              };
              this.setKaminoState(updated);
              this.kaminoPoolOpenedAt = null;
              this.releaseKaminoLockIfOwned();
            }
            return;
          }
          const updated: KaminoCycleState = {
            ...this.kaminoState,
            active: false,
            collateralMint: position.collateralMint ?? this.kaminoState.collateralMint ?? null,
            collateralAmount: onChainCollateral,
            collateralUsd: this.kaminoState.collateralUsd ?? null,
            avgPriceUsdc: this.kaminoState.avgPriceUsdc ?? null,
            debtMint: position.debtMint ?? this.kaminoState.debtMint ?? null,
            debtAmount: 0,
            reservedCollateralDust: null,
            collaterals: recoveredCollaterals,
            lastError: "Divida Kamino zerada; ciclo pausado localmente.",
            updatedAt: new Date().toISOString()
          };
          this.setKaminoState(updated);
          this.kaminoPoolOpenedAt = null;
          this.releaseKaminoLockIfOwned();
          this.queueKaminoLog("debt-zero", "Divida Kamino zerada; ciclo pausado localmente.", "warn");
          return;
        }

        if (onChainDebt + epsilon < recordedDebt || onChainCollateral + epsilon < recordedCollateral) {
          let reconciledUsd: number | null = null;
          try {
            const mint = position.collateralMint ?? this.kaminoState.collateralMint ?? null;
            if (mint) {
              reconciledUsd = await this.tryPriceCollateral(mint, onChainCollateral);
            }
          } catch {
            reconciledUsd = null;
          }
          const updated: KaminoCycleState = {
            ...this.kaminoState,
            collateralMint: position.collateralMint ?? this.kaminoState.collateralMint ?? null,
            collateralAmount: onChainCollateral,
            collateralUsd: reconciledUsd ?? this.kaminoState.collateralUsd ?? null,
            avgPriceUsdc: reconciledUsd != null && onChainCollateral > 0
              ? reconciledUsd / onChainCollateral
              : this.kaminoState.avgPriceUsdc ?? null,
            debtMint: position.debtMint ?? this.kaminoState.debtMint ?? null,
            debtAmount: onChainDebt,
            collaterals: recoveredCollaterals,
            updatedAt: new Date().toISOString(),
            lastError: null
          };
          this.setKaminoState(updated);
          this.queueKaminoLog("reconcile", "Estado Kamino reconciliado com on-chain.", "warn");
        }
      }

  if (!this.kaminoState?.active) {
    const previous = this.kaminoState;
    // Só reconstrói o ciclo se realmente há dívida ou colateral on-chain.
    // Sem dívida E sem colateral = ciclo foi fechado, não há nada a recuperar.
    const onChainDebt = Number(position?.debtAmount ?? 0);
    const onChainCollateral = Number(position?.collateralAmount ?? 0);
    const epsilon = 1e-8;
    if (onChainDebt <= epsilon && onChainCollateral <= epsilon) {
      // Nada on-chain — não reconstruir o ciclo.
      return;
    }
    const ownerPoolId = this.poolId ?? previous?.ownerPoolId ?? null;
    const ownerPoolName = this.poolName ?? previous?.ownerPoolName ?? null;
    let reconstructedUsd: number | null = null;
    let reconstructedAvg: number | null = null;
    try {
      const mint = position?.collateralMint ?? null;
      const amount = Number(position?.collateralAmount ?? 0);
      if (mint && amount > 0) {
        reconstructedUsd = await this.tryPriceCollateral(mint, amount);
        if (reconstructedUsd != null) {
          reconstructedAvg = reconstructedUsd / amount;
        }
      }
    } catch {
      reconstructedUsd = null;
      reconstructedAvg = null;
    }
    const nextState: KaminoCycleState = {
      active: true,
      ownerPoolId,
      ownerPoolName,
      marketAddress: this.getKaminoMarketAddress(),
      baselineTokenA: null,
      baselineTokenB: null,
      reservedTokenA: null,
      reservedTokenB: null,
      reservedCollateralDust: previous?.reservedCollateralDust ?? null,
      collateralMint: position?.collateralMint ?? null,
      collateralAmount: position?.collateralAmount ?? 0,
      collateralUsd: reconstructedUsd,
      debtMint: position?.debtMint ?? null,
      debtAmount: position?.debtAmount ?? 0,
      debtUsd: null,
      avgPriceUsdc: reconstructedAvg,
      targetPriceUsdc: null,
      collaterals: recoveredCollaterals,
      cycleCount: Math.max(previous?.cycleCount ?? 0, 1),
      updatedAt: new Date().toISOString(),
      lastError: "Ciclo Kamino recuperado do market (sem historico)."
    };
    this.kaminoState = this.normalizeKaminoState(nextState);
    this.queueKaminoLog(
      "recover",
      "Emprestimo Kamino recuperado do market; ciclo reconstruido automaticamente.",
      "warn"
    );
    if (
      Number(nextState.debtAmount ?? 0) <= epsilon &&
      Number(nextState.collateralAmount ?? 0) > epsilon
    ) {
      this.queueKaminoLog(
        "recover-withdraw",
        "Ciclo recuperado sem divida; sacando colateral residual imediatamente.",
        "warn"
      );
      const retryAtRecover = this.kaminoState?.repayRetryUntil
        ? Date.parse(this.kaminoState.repayRetryUntil)
        : 0;
      if (Number.isFinite(retryAtRecover) && retryAtRecover > Date.now()) {
        return;
      }
      try {
        await this.closeKaminoCycle("target");
      } catch (err) {
        this.kaminoHealth.recordError(err, "kamino-recover-withdraw");
        this.queueKaminoLog(
          "recover-withdraw-failed",
          `Falha ao sacar colateral no recover: ${err instanceof Error ? err.message : String(err)}`,
          "error"
        );
      }
    }
  }
    } catch (err) {
      const reconcileMsg = String((err as any)?.message ?? err).toLowerCase();
      if (
        reconcileMsg.includes("obligationborrowsempty") ||
        reconcileMsg.includes("obligation borrows are empty") ||
        reconcileMsg.includes("obligation has no borrows") ||
        reconcileMsg.includes("0x1785") ||
        reconcileMsg.includes("6021")
      ) {
        if (this.kaminoState?.active) {
          this.setKaminoState({
            ...this.kaminoState,
            debtAmount: 0,
            lastError: "Dívida zerada on-chain detectada via erro de repay.",
            updatedAt: new Date().toISOString()
          });
          this.queueKaminoLog(
            "debt-zero",
            "ObligationBorrowsEmpty detectado; dívida zerada localmente.",
            "warn"
          );
        }
        return;
      }
      this.kaminoHealth.recordError(err, "kamino-reconcile");
      logger.warn({ err }, "falha ao reconciliar estado Kamino");
    }
  }

  setSwapAllowlist(mints: string[]): void {
    const normalized = Array.isArray(mints)
      ? mints.map((mint) => String(mint).trim()).filter((mint) => mint.length > 0)
      : [];
    this.swapAllowlist = normalized.length ? new Set(normalized) : null;
  }

  updateConfig(config: Config): void {
    const previousMarket = this.config.kaminoMarketAddress
      ?? process.env.KAMINO_MARKET
      ?? null;
    const nextMarket = config.kaminoMarketAddress
      ?? process.env.KAMINO_MARKET
      ?? null;
    this.config = config;
    if (previousMarket !== nextMarket) {
      this.kaminoClient = null;
      this.kaminoClientMarket = null;
    }
    this.outOfRangeSince = null;
  }

  private async ensureKaminoClient(marketAddressOverride?: string | null): Promise<KaminoClient> {
    const override = typeof marketAddressOverride === "string" && marketAddressOverride.trim()
      ? marketAddressOverride.trim()
      : (this.kaminoState?.marketAddress ?? null);
    const desiredMarket = (override ?? this.getConfiguredKaminoMarketAddress())?.trim() ?? null;
    const currentMarket = this.kaminoClientMarket?.trim() ?? null;
    if (!this.kaminoClient || (desiredMarket && currentMarket !== desiredMarket)) {
      this.kaminoClient = await createKaminoClient(
        {
          connection: this.connection,
          wallet: this.wallet,
          config: this.config
        },
        desiredMarket
      );
      this.kaminoClientMarket = desiredMarket ?? null;
    }
    return this.kaminoClient;
  }

  private isKaminoSimulated(): boolean {
    return Boolean(this.config.dryRun || process.env.KAMINO_NOOP === "true");
  }

  private getKaminoMarketHint(): string {
    const market = this.getKaminoMarketAddress() ?? "";
    return market ? ` (market ${market})` : "";
  }

  private resolveKaminoBorrowMint(): { mint: string; label: string } {
    const usdcMint = (this.config.autoSwapFeesToUsdcTargetMint || DEFAULT_USDC_MINT).trim() || DEFAULT_USDC_MINT;
    const usdtMint = String(process.env.KAMINO_USDT_MINT ?? "").trim();
    const asset = this.config.kaminoBorrowAsset ?? "usdc";
    const poolMintA = this.poolState?.tokenMintA?.toBase58?.() ?? "";
    const poolMintB = this.poolState?.tokenMintB?.toBase58?.() ?? "";
    const poolHasUsdc = Boolean(usdcMint && (poolMintA === usdcMint || poolMintB === usdcMint));
    const poolHasUsdt = Boolean(usdtMint && (poolMintA === usdtMint || poolMintB === usdtMint));

    if (asset === "auto") {
      if (poolHasUsdc) return { mint: usdcMint, label: "USDC" };
      if (poolHasUsdt) return { mint: usdtMint, label: "USDT" };
      return { mint: usdcMint, label: "USDC" };
    }
    if (asset === "usdt") {
      if (!usdtMint) {
        throw new Error("KAMINO_USDT_MINT requerido quando kaminoBorrowAsset=usdt");
      }
      return { mint: usdtMint, label: "USDT" };
    }
    return { mint: usdcMint, label: "USDC" };
  }

  private resolveKaminoBorrowCandidates(): { mint: string; label: string }[] {
    const usdcMint = (this.config.autoSwapFeesToUsdcTargetMint || DEFAULT_USDC_MINT).trim() || DEFAULT_USDC_MINT;
    const usdtMint = String(process.env.KAMINO_USDT_MINT ?? "").trim();
    const asset = this.config.kaminoBorrowAsset ?? "usdc";
    if (asset === "usdt") {
      if (!usdtMint) {
        throw new Error("KAMINO_USDT_MINT requerido quando kaminoBorrowAsset=usdt");
      }
      return [{ mint: usdtMint, label: "USDT" }];
    }
    if (asset === "usdc") {
      return [{ mint: usdcMint, label: "USDC" }];
    }
    const candidates: { mint: string; label: string }[] = [];
    if (usdcMint) candidates.push({ mint: usdcMint, label: "USDC" });
    if (usdtMint) candidates.push({ mint: usdtMint, label: "USDT" });
    return candidates;
  }

  private async resolveKaminoBorrowStable(
    kamino: KaminoClient
  ): Promise<{ stable: { mint: string; decimals: number; label: string } | null; reason?: string }> {
    const candidates = this.resolveKaminoBorrowCandidates();
    if (!candidates.length) {
      return { stable: null, reason: "Nenhum stable configurado para borrow" };
    }
    let lastReason: string | undefined;
    for (const candidate of candidates) {
      const support = await kamino.supportsBorrow(candidate.mint);
      if (support.ok) {
        const stable = await this.getStableMintInfoByMint(candidate.mint, candidate.label);
        return { stable };
      }
      lastReason = support.reason ?? `Borrow indisponivel em ${candidate.label}`;
    }
    return { stable: null, reason: lastReason };
  }

  private async getStableMintInfo(): Promise<{ mint: string; decimals: number; label: string }> {
    const resolved = this.resolveKaminoBorrowMint();
    return this.getStableMintInfoByMint(resolved.mint, resolved.label);
  }

  private getStableLabelForMint(mint: string): string {
    const usdcMint = (this.config.autoSwapFeesToUsdcTargetMint || DEFAULT_USDC_MINT).trim() || DEFAULT_USDC_MINT;
    const usdtMint = String(process.env.KAMINO_USDT_MINT ?? "").trim();
    if (mint === usdcMint) return "USDC";
    if (mint === usdtMint) return "USDT";
    return "Stable";
  }

  private async getStableMintInfoByMint(
    mint: string,
    label: string
  ): Promise<{ mint: string; decimals: number; label: string }> {
    const cached = this.stableMintCache.get(mint);
    if (cached) {
      return { mint: cached.mint, decimals: cached.decimals, label };
    }
    let decimals = 6;
    try {
      const mintInfo = await getMint(this.connection, new PublicKey(mint));
      decimals = Number(mintInfo.decimals ?? decimals);
    } catch (err) {
      logger.warn({ err, mint }, "falha ao buscar decimais do stable");
    }
    const entry = { mint, decimals };
    this.stableMintCache.set(mint, entry);
    return { ...entry, label };
  }

  private async getTokenUsdValue(input: {
    mint: string;
    amountUi: number;
    decimals: number;
    stableMint: string;
    stableDecimals: number;
  }): Promise<number | null> {
    if (!this.config.jupiterApiKey) {
      throw new Error("Jupiter API key ausente");
    }
    const amountRaw = toRawAmount(input.amountUi, input.decimals);
    if (!isValidU64(amountRaw)) {
      return null;
    }
    const quote = await this.fetchJupiterQuoteExactInDetailed(
      input.mint,
      input.stableMint,
      amountRaw.toString(),
      this.config.slippageBps ?? 50
    );
    if (!quote.quote) {
      return null;
    }
    const outAmount = parseU64(quote.quote.outAmount ?? "0");
    if (!outAmount) {
      return null;
    }
    const outNumber = toSafeNumber(outAmount);
    if (outNumber == null) {
      return null;
    }
    return outNumber / Math.pow(10, input.stableDecimals);
  }

  private async getTokenUsdPrice(input: {
    mint: string;
    decimals: number;
    stableMint: string;
    stableDecimals: number;
  }): Promise<number | null> {
    return this.getTokenUsdValue({ ...input, amountUi: 1 });
  }

  private async tryPriceCollateral(mint: string, amountUi: number): Promise<number | null> {
    if (!Number.isFinite(amountUi) || amountUi <= 0) return null;
    try {
      if (mint === NATIVE_MINT.toBase58()) {
        const solPrice = await this.tryGetSolUsdPrice();
        return solPrice != null ? solPrice * amountUi : null;
      }
      const decimals = await this.getTokenDecimals(mint);
      const stable = await this.getStableMintInfo();
      const price = await this.getTokenUsdPrice({
        mint,
        decimals,
        stableMint: stable.mint,
        stableDecimals: stable.decimals
      });
      return price != null ? price * amountUi : null;
    } catch {
      return null;
    }
  }

  private async estimateStableOutForCollateral(input: {
    collMint: string;
    collDecimals: number;
    stableMint: string;
    stableDecimals: number;
    collAmountUi: number;
  }): Promise<number | null> {
    if (!this.config.jupiterApiKey) return null;
    if (!Number.isFinite(input.collAmountUi) || input.collAmountUi <= 0) return null;
    const amountRaw = toRawAmount(input.collAmountUi, input.collDecimals);
    if (!isValidU64(amountRaw)) return null;
    try {
      const quote = await this.fetchJupiterQuoteExactInDetailed(
        input.collMint,
        input.stableMint,
        amountRaw.toString(),
        this.config.slippageBps ?? 50
      );
      const outAmount = parseU64(quote?.quote?.outAmount ?? "0");
      if (!outAmount) return null;
      const outNumber = toSafeNumber(outAmount);
      if (outNumber == null) return null;
      return outNumber / Math.pow(10, input.stableDecimals);
    } catch (err) {
      logger.warn({ err }, "quote Jupiter falhou para estimateStableOutForCollateral");
      return null;
    }
  }

  private async swapStableToToken(input: {
    stableMint: string;
    stableDecimals: number;
    outputMint: string;
    outputDecimals: number;
    amountStableRaw: bigint;
    label?: string;
  }): Promise<number | null> {
    if (this.isSwapAllowlistActive() && !this.isSwapAllowed(input.outputMint)) {
      throw new Error("Swap bloqueado: token nao permitido na allowlist");
    }
    if (!this.config.jupiterApiKey) {
      throw new Error("Jupiter API key ausente");
    }
    if (!isValidU64(input.amountStableRaw)) {
      throw new Error("amountStable fora do range");
    }
    const baseSlippage = this.config.slippageBps ?? 50;
    const labelLower = (input.label ?? "").toLowerCase();
    const effectiveSlippage = (labelLower.includes("repay") || labelLower.includes("kamino"))
      ? Math.max(baseSlippage, KAMINO_SWAP_SLIPPAGE_BPS)
      : baseSlippage;
    let lastError: string | null = null;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const quote = await this.fetchJupiterQuoteExactInDetailed(
        input.stableMint,
        input.outputMint,
        input.amountStableRaw.toString(),
        effectiveSlippage
      );
      if (!quote.quote) {
        lastError = `Sem rota Jupiter para ${input.label ?? "swap"}`;
        break;
      }
      const result = await this.executeJupiterSwapDetailed(quote.quote);
      if (result.sig) {
        const outAmount = parseU64(quote.quote.outAmount ?? "0");
        if (!outAmount) {
          return null;
        }
        const outNumber = toSafeNumber(outAmount);
        if (outNumber == null) {
          return null;
        }
        return outNumber / Math.pow(10, input.outputDecimals);
      }
      lastError = result.error ?? "Falha na swap Jupiter";
      const lower = lastError.toLowerCase();
      const isJupiterRetryable =
        this.isKaminoRetryableError(lastError) ||
        lower.includes("0x1771") ||
        lower.includes("0x1553") ||
        lower.includes("sqrtprice") ||
        lower.includes("sqrt_price") ||
        lower.includes("price out of bounds") ||
        lower.includes("priceoutofbounds") ||
        lower.includes("simulation failed");
      if (attempt < maxAttempts && isJupiterRetryable) {
        logger.warn({ attempt, err: lastError }, "swap jupiter retry after transient/slippage/price-bounds error");
        await this.sleep(KAMINO_REBALANCE_RETRY_SEC * 1000);
        continue;
      }
      break;
    }
    throw new Error(lastError ?? "Falha na swap Jupiter");
  }

  private async swapTokenToStable(input: {
    inputMint: string;
    inputDecimals: number;
    amountUi: number;
    stableMint: string;
    stableDecimals: number;
    label?: string;
  }): Promise<number | null> {
    if (this.isSwapAllowlistActive() && !this.isSwapAllowed(input.inputMint)) {
      throw new Error("Swap bloqueado: token nao permitido na allowlist");
    }
    if (!this.config.jupiterApiKey) {
      throw new Error("Jupiter API key ausente");
    }
    const amountRaw = toRawAmount(input.amountUi, input.inputDecimals);
    if (!isValidU64(amountRaw)) {
      throw new Error("amountIn fora do range");
    }
    const baseSlippage = this.config.slippageBps ?? 50;
    const labelLower = (input.label ?? "").toLowerCase();
    const effectiveSlippage = (labelLower.includes("repay") || labelLower.includes("kamino"))
      ? Math.max(baseSlippage, KAMINO_SWAP_SLIPPAGE_BPS)
      : baseSlippage;
    let lastError: string | null = null;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const quote = await this.fetchJupiterQuoteExactInDetailed(
        input.inputMint,
        input.stableMint,
        amountRaw.toString(),
        effectiveSlippage
      );
      if (!quote.quote) {
        lastError = `Sem rota Jupiter para ${input.label ?? "swap"}`;
        break;
      }
      const result = await this.executeJupiterSwapDetailed(quote.quote);
      if (result.sig) {
        const outAmount = parseU64(quote.quote.outAmount ?? "0");
        if (!outAmount) {
          return null;
        }
        const outNumber = toSafeNumber(outAmount);
        if (outNumber == null) {
          return null;
        }
        return outNumber / Math.pow(10, input.stableDecimals);
      }
      lastError = result.error ?? "Falha na swap Jupiter";
      const lower = lastError.toLowerCase();
      const isJupiterRetryable =
        this.isKaminoRetryableError(lastError) ||
        lower.includes("0x1771") ||
        lower.includes("0x1553") ||
        lower.includes("sqrtprice") ||
        lower.includes("sqrt_price") ||
        lower.includes("price out of bounds") ||
        lower.includes("priceoutofbounds") ||
        lower.includes("simulation failed");
      if (attempt < maxAttempts && isJupiterRetryable) {
        logger.warn({ attempt, err: lastError }, "swap jupiter retry after transient/slippage/price-bounds error");
        await this.sleep(KAMINO_REBALANCE_RETRY_SEC * 1000);
        continue;
      }
      break;
    }
    throw new Error(lastError ?? "Falha na swap Jupiter");
  }

  private async pickExitTokenByUsd(input: {
    tokenAAmount: number;
    tokenBAmount: number;
    solUsdPrice: number | null;
  }): Promise<{ side: "tokenA" | "tokenB"; mint: string; amount: number; usdValue: number; decimals: number } | null> {
    if (!this.poolState) {
      return null;
    }
    let stable: { mint: string; decimals: number; label: string };
    try {
      stable = await this.getStableMintInfo();
    } catch (err) {
      this.setError(err);
      return null;
    }
    const tokenAMint = this.poolState.tokenMintA.toBase58();
    const tokenBMint = this.poolState.tokenMintB.toBase58();
    const tokenADecimals = this.poolState.decimalsA;
    const tokenBDecimals = this.poolState.decimalsB;
    let usdA: number | null = null;
    let usdB: number | null = null;
    if (input.tokenAAmount > 0) {
      if (this.poolState.isTokenASol && input.solUsdPrice) {
        usdA = input.tokenAAmount * input.solUsdPrice;
      } else if (!this.isSwapAllowlistActive() || this.isSwapAllowed(tokenAMint)) {
        usdA = await this.getTokenUsdValue({
          mint: tokenAMint,
          amountUi: input.tokenAAmount,
          decimals: tokenADecimals,
          stableMint: stable.mint,
          stableDecimals: stable.decimals
        });
      }
    }
    if (input.tokenBAmount > 0) {
      if (this.poolState.isTokenBSol && input.solUsdPrice) {
        usdB = input.tokenBAmount * input.solUsdPrice;
      } else if (!this.isSwapAllowlistActive() || this.isSwapAllowed(tokenBMint)) {
        usdB = await this.getTokenUsdValue({
          mint: tokenBMint,
          amountUi: input.tokenBAmount,
          decimals: tokenBDecimals,
          stableMint: stable.mint,
          stableDecimals: stable.decimals
        });
      }
    }
    if (usdA == null && usdB == null) {
      return null;
    }
    if (usdB == null || (usdA != null && usdA >= usdB)) {
      return { side: "tokenA", mint: tokenAMint, amount: input.tokenAAmount, usdValue: usdA ?? 0, decimals: tokenADecimals };
    }
    return { side: "tokenB", mint: tokenBMint, amount: input.tokenBAmount, usdValue: usdB ?? 0, decimals: tokenBDecimals };
  }

  private async buildExitTokenBySide(input: {
    side: "tokenA" | "tokenB";
    tokenAAmount: number;
    tokenBAmount: number;
    solUsdPrice: number | null;
  }): Promise<{ side: "tokenA" | "tokenB"; mint: string; amount: number; usdValue: number; decimals: number } | null> {
    if (!this.poolState) {
      return null;
    }
    let stable: { mint: string; decimals: number; label: string };
    try {
      stable = await this.getStableMintInfo();
    } catch (err) {
      this.setError(err);
      return null;
    }
    const tokenAMint = this.poolState.tokenMintA.toBase58();
    const tokenBMint = this.poolState.tokenMintB.toBase58();
    const tokenADecimals = this.poolState.decimalsA;
    const tokenBDecimals = this.poolState.decimalsB;
    const amount = input.side === "tokenA" ? input.tokenAAmount : input.tokenBAmount;
    if (amount <= 0) {
      return null;
    }
    let usdValue: number | null = null;
    if (input.side === "tokenA") {
      if (this.poolState.isTokenASol && input.solUsdPrice) {
        usdValue = amount * input.solUsdPrice;
      } else if (!this.isSwapAllowlistActive() || this.isSwapAllowed(tokenAMint)) {
        usdValue = await this.getTokenUsdValue({
          mint: tokenAMint,
          amountUi: amount,
          decimals: tokenADecimals,
          stableMint: stable.mint,
          stableDecimals: stable.decimals
        });
      }
      if (usdValue == null) return null;
      return { side: "tokenA", mint: tokenAMint, amount, usdValue, decimals: tokenADecimals };
    }
    if (this.poolState.isTokenBSol && input.solUsdPrice) {
      usdValue = amount * input.solUsdPrice;
    } else if (!this.isSwapAllowlistActive() || this.isSwapAllowed(tokenBMint)) {
      usdValue = await this.getTokenUsdValue({
        mint: tokenBMint,
        amountUi: amount,
        decimals: tokenBDecimals,
        stableMint: stable.mint,
        stableDecimals: stable.decimals
      });
    }
    if (usdValue == null) return null;
    return { side: "tokenB", mint: tokenBMint, amount, usdValue, decimals: tokenBDecimals };
  }

  private async resolveKaminoCollateralToken(input: {
    tokenAAmount: number;
    tokenBAmount: number;
    solUsdPrice: number | null;
    price: number;
    positionRange: Range;
  }): Promise<{ side: "tokenA" | "tokenB"; mint: string; amount: number; usdValue: number; decimals: number } | null> {
    const mode = this.config.kaminoCollateralMode ?? "max-value";
    if (mode === "both") {
      return this.pickExitTokenByUsd({
        tokenAAmount: input.tokenAAmount,
        tokenBAmount: input.tokenBAmount,
        solUsdPrice: input.solUsdPrice
      });
    }
    if (mode === "tokenA" || mode === "tokenB") {
      const forced = await this.buildExitTokenBySide({
        side: mode,
        tokenAAmount: input.tokenAAmount,
        tokenBAmount: input.tokenBAmount,
        solUsdPrice: input.solUsdPrice
      });
      if (forced) {
        return forced;
      }
      return this.pickExitTokenByUsd({
        tokenAAmount: input.tokenAAmount,
        tokenBAmount: input.tokenBAmount,
        solUsdPrice: input.solUsdPrice
      });
    }
    if (mode === "exit") {
      let side: "tokenA" | "tokenB" | null = null;
      if (Number.isFinite(input.price) && input.positionRange) {
        if (input.price <= input.positionRange.lower) {
          side = "tokenA";
        } else if (input.price >= input.positionRange.upper) {
          side = "tokenB";
        }
      }
      if (side) {
        const forced = await this.buildExitTokenBySide({
          side,
          tokenAAmount: input.tokenAAmount,
          tokenBAmount: input.tokenBAmount,
          solUsdPrice: input.solUsdPrice
        });
        if (forced) {
          return forced;
        }
      }
    }
    return this.pickExitTokenByUsd({
      tokenAAmount: input.tokenAAmount,
      tokenBAmount: input.tokenBAmount,
      solUsdPrice: input.solUsdPrice
    });
  }

  private async resolveKaminoCollateralTokens(input: {
    tokenAAmount: number;
    tokenBAmount: number;
    solUsdPrice: number | null;
    price: number;
    positionRange: Range;
  }): Promise<{ side: "tokenA" | "tokenB"; mint: string; amount: number; usdValue: number; decimals: number }[] | null> {
    const mode = this.config.kaminoCollateralMode ?? "max-value";
    if (mode !== "both") {
      const token = await this.resolveKaminoCollateralToken(input);
      return token ? [token] : null;
    }
    const selections: { side: "tokenA" | "tokenB"; mint: string; amount: number; usdValue: number; decimals: number }[] = [];
    const tokenA = await this.buildExitTokenBySide({
      side: "tokenA",
      tokenAAmount: input.tokenAAmount,
      tokenBAmount: input.tokenBAmount,
      solUsdPrice: input.solUsdPrice
    });
    if (tokenA && tokenA.amount > 0) {
      selections.push(tokenA);
    }
    const tokenB = await this.buildExitTokenBySide({
      side: "tokenB",
      tokenAAmount: input.tokenAAmount,
      tokenBAmount: input.tokenBAmount,
      solUsdPrice: input.solUsdPrice
    });
    if (tokenB && tokenB.amount > 0) {
      selections.push(tokenB);
    }
    return selections.length ? selections : null;
  }

  private async maybeCloseKaminoCycle(currentPrice: number): Promise<boolean> {
    const state = this.kaminoState;
    if (!state || !state.active) {
      return false;
    }
    if (!this.isKaminoOwner(state)) {
      const owner = state.ownerPoolName ?? state.ownerPoolId ?? "outra pool";
      this.setKaminoState({ ...state, lastError: `Kamino pertence a pool ${owner}` });
      return false;
    }
    const rule = this.config.kaminoCloseRule ?? "avg-price";
    const collaterals = Array.isArray(state.collaterals) ? state.collaterals : [];

    // Se a dívida já foi zerada mas ainda há colateral depositado,
    // fechar imediatamente sem aguardar o preço-alvo.
    // Isso ocorre quando o ciclo é reconstruído após debt-zero:
    // o colateral existe on-chain mas não há mais dívida a pagar.
    const epsilon = 1e-8;
    const currentDebt = Number(state.debtAmount ?? 0);
    if (currentDebt <= epsilon && collaterals.length > 0) {
      this.queueKaminoLog(
        "close-debt-zero",
        "Divida zerada com colateral residual; sacando colateral automaticamente (independe do kaminoCloseRule).",
        "warn"
      );
      const closed = await this.closeKaminoCycle("target");
      if (closed) {
        this.lastStatus.lastAction = "kamino-close";
      }
      return closed;
    }
    // Grace period: não fechar ciclo Kamino logo após a pool ter sido aberta.
    // Garante que o bot não entre em loop de abertura/fechamento imediato.
    const kaminoGraceSec = Number(this.config.kaminoGracePeriodSec ?? 120);
    if (kaminoGraceSec > 0 && this.kaminoPoolOpenedAt != null) {
      const elapsedSec = (Date.now() - this.kaminoPoolOpenedAt) / 1000;
      if (elapsedSec < kaminoGraceSec) {
        logger.info(
          { elapsedSec, kaminoGraceSec },
          "Kamino grace period ativo; fechamento automatico bloqueado"
        );
        return false;
      }
    }
    // Bloqueio "manual" so se aplica a fechamentos por criterio de preco.
    if (rule === "manual") {
      return false;
    }
    if (!collaterals.length) {
      return false;
    }
    try {
      const stable = await this.getStableMintInfo();
      const poolPnlNoFeesUsd = this.getPositionPnlNoFeesUsd();
      const hasPosition = Boolean(this.currentPosition);
      if (hasPosition && poolPnlNoFeesUsd == null) {
        this.setKaminoState({ ...state, lastError: "PnL da pool indisponivel; aguardando." });
        return false;
      }
      // ── Avaliação individual por colateral ────────────────────────────────
      // Calcula quais colaterais atingiram o target e quais ainda não atingiram.
      type EntryEval = {
        entry: KaminoCollateralEntry;
        priceUsd: number;
        target: number;
        ready: boolean;
      };
      const evaluated: EntryEval[] = [];
      for (const entry of collaterals) {
        const target = rule === "breakeven"
          ? entry.avgPriceUsdc
          : (entry.targetPriceUsdc ?? null);
        if (!target || target <= 0) {
          // Colateral sem target definido: nunca fecha sozinho, aguarda.
          evaluated.push({ entry, priceUsd: 0, target: 0, ready: false });
          continue;
        }
        const decimals = await this.getTokenDecimals(entry.mint);
        const priceUsd = await this.getTokenUsdPrice({
          mint: entry.mint,
          decimals,
          stableMint: stable.mint,
          stableDecimals: stable.decimals
        });
        if (priceUsd == null) {
          evaluated.push({ entry, priceUsd: 0, target, ready: false });
          continue;
        }
        // SALVAGUARDA: detecta avgPriceUsdc calculado incorretamente.
        // Se o alvo for menor que 60% do preço atual e o ciclo foi iniciado há
        // menos de 5 minutos, provavelmente o avgPriceUsdc está errado.
        // Bloqueia o fechamento e força recálculo no próximo tick.
        const cycleAge = state?.updatedAt
          ? (Date.now() - Date.parse(state.updatedAt)) / 1000
          : Infinity;
        if (target > 0 && priceUsd > 0 && target < priceUsd * 0.6 && cycleAge < 300) {
          this.queueKaminoLog(
            "close-blocked-sanity",
            `Fechamento bloqueado: alvo (${target.toFixed(6)}) é menor que 60% do preço atual ` +
            `(${priceUsd.toFixed(6)}). Possível erro no cálculo de avgPriceUsdc. ` +
            `Ciclo tem ${cycleAge.toFixed(0)}s; aguardando recálculo.`,
            "warn"
          );
          evaluated.push({ entry, priceUsd, target: 0, ready: false });
          continue;
        }
        evaluated.push({ entry, priceUsd, target, ready: priceUsd >= target });
      }

      const readyEntries = evaluated.filter((e) => e.ready);
      const pendingEntries = evaluated.filter((e) => !e.ready);
      const allReady = pendingEntries.length === 0 && readyEntries.length > 0;

      // ── Nenhum colateral atingiu o target → nada a fazer ─────────────────
      if (readyEntries.length === 0) {
        return false;
      }

      // ── TODOS atingiram → fecha o ciclo inteiro (caminho original) ────────
      if (allReady) {
        const currentCollateralUsd = readyEntries.reduce(
          (sum, e) => sum + e.priceUsd * (e.entry.amount ?? 0), 0
        );
        const debtUsd = evaluated.reduce(
          (sum, e) => sum + (e.entry.debtUsd ?? 0), 0
        ) || (state.debtUsd ?? 0);
        const minPnl = Number(this.config.kaminoMinCombinedPnlUsd ?? 0);

        if (!hasPosition) {
          // Verificar se realmente não há pool aberta — pode ser atraso de carregamento
          if (this.currentPositionMint && !this.currentPosition) {
            this.queueKaminoLog(
              "close-wait-position",
              "Fechamento Kamino aguardando carregamento da posição da pool.",
              "warn"
            );
            return false;
          }
        }

        if (hasPosition) {
          const kaminoNetUsd = currentCollateralUsd - debtUsd;
          if (Number.isFinite(kaminoNetUsd) && poolPnlNoFeesUsd != null) {
            const combinedNetUsd = kaminoNetUsd + poolPnlNoFeesUsd;
            if (combinedNetUsd < minPnl) {
              this.setKaminoState({
                ...state,
                lastError: `Fechamento Kamino bloqueado: PnL combinado (${combinedNetUsd.toFixed(2)} USD) abaixo do minimo (${minPnl.toFixed(2)} USD)`
              });
              this.queueKaminoLog(
                "close-blocked",
                `Fechamento Kamino bloqueado: PnL combinado (${combinedNetUsd.toFixed(2)} USD) abaixo do minimo (${minPnl.toFixed(2)} USD)`,
                "warn"
              );
              logger.warn(
                {
                  kaminoNetUsd,
                  poolPnlNoFeesUsd,
                  combinedNetUsd,
                  kaminoCollateralUsd: currentCollateralUsd,
                  debtUsd,
                  targetPrice: readyEntries[0]?.target,
                  currentPrice: readyEntries[0]?.priceUsd
                },
                "Fechamento Kamino bloqueado por PnL combinado abaixo do minimo"
              );
              return false;
            }
          }
        }
        logger.info(
          { rule, collaterals: collaterals.map((item) => item.mint) },
          "kamino target atingido (todos); fechando ciclo completo"
        );
        const closed = await this.closeKaminoCycle("target");
        if (closed) {
          this.lastStatus.lastAction = "kamino-close";
          return true;
        }
        return false;
      }

      // ── PARCIAL: apenas alguns colaterais atingiram o target ──────────────
      // Não fecha colateral parcial se a pool ainda está aberta com posição ativa,
      // pois o closeKaminoCycle fecha a posição antes de repagar.
      // Fechamento parcial só é seguro quando não há posição aberta.
      if (hasPosition) {
        // Há posição aberta e nem todos atingiram: aguarda todos para fechar junto.
        return false;
      }

      // Sem posição aberta → pode fechar cada colateral que atingiu o target.
      let anyPartialClosed = false;
      for (const ev of readyEntries) {
        logger.info(
          { rule, mint: ev.entry.mint, priceUsd: ev.priceUsd, target: ev.target },
          "kamino partial close: colateral atingiu target"
        );
        const partialClosed = await this.closeKaminoCollateralPartial(ev.entry.mint);
        if (partialClosed) {
          anyPartialClosed = true;
          this.lastStatus.lastAction = "kamino-partial-close";
        }
      }
      return anyPartialClosed;
    } catch (err) {
      logger.warn({ err }, "falha ao avaliar fechamento kamino");
      this.setKaminoState({ ...state, lastError: stringifyError(err) });
    }
    return false;
  }

  private async tryRepayWithCollateral(input: {
    kamino: KaminoClient;
    collaterals: KaminoCollateralEntry[];
    debtMint: string;
    debtAmount: number;
    onChainDeposits: Map<string, number>;
  }): Promise<{
    performed: boolean;
    debtAmount: number;
    onChainDeposits: Map<string, number>;
    retryable?: boolean;
    error?: string;
  }> {
    if (!input.collaterals.length || input.debtAmount <= 0) {
      return { performed: false, debtAmount: input.debtAmount, onChainDeposits: input.onChainDeposits };
    }
    if (!this.config.jupiterApiKey) {
      this.queueKaminoLog("repay-with-collateral", "Jupiter API key ausente para repay com colateral.", "warn");
      return { performed: false, debtAmount: input.debtAmount, onChainDeposits: input.onChainDeposits };
    }
    const candidates = input.collaterals
      .map((entry) => ({
        mint: entry.mint,
        amount: Math.max(0, input.onChainDeposits.get(entry.mint) ?? 0),
        usd: Number(entry.usd ?? 0)
      }))
      .filter((entry) => entry.mint && entry.amount > 0 && entry.mint !== input.debtMint);
    if (!candidates.length) {
      return { performed: false, debtAmount: input.debtAmount, onChainDeposits: input.onChainDeposits };
    }
    const epsilon = 1e-8;
    let lastQuoteError: string | null = null;
    let onChainDeposits = new Map(input.onChainDeposits);
    let debtRemaining = input.debtAmount;
    let performed = false;
    let lastFailure: string | null = null;
    const capacityBuffer = 0.95;
    let maxChunkOverride: number | null = null;
    let chunkReductions = 0;
    const maxChunkReductions = 20;

    const refreshPosition = async (): Promise<void> => {
      try {
        const position = await input.kamino.getPositionState();
        if (!position) return;
        const nextDeposits = new Map<string, number>();
        for (const entry of position.deposits ?? []) {
          if (entry?.mint) {
            nextDeposits.set(entry.mint, Math.max(0, Number(entry.amount ?? 0)));
          }
        }
        onChainDeposits = nextDeposits;
        debtRemaining = Math.max(0, Number(position.debtAmount ?? debtRemaining));
      } catch (err) {
        this.kaminoHealth.recordError(err, "kamino-refresh-position");
        logger.warn({ err }, "falha ao atualizar posicao Kamino apos repay com colateral");
      }
    };

    while (debtRemaining > epsilon) {
      const sorted = [...candidates].sort((a, b) => {
        const usdDiff = (b.usd ?? 0) - (a.usd ?? 0);
        if (Math.abs(usdDiff) > 0) return usdDiff;
        return b.amount - a.amount;
      });

      let usedCandidate = false;
      for (const candidate of sorted) {
        if (!candidate?.mint) continue;
        const available = onChainDeposits.get(candidate.mint) ?? candidate.amount;
        if (available <= epsilon) continue;
        if (this.isSwapAllowlistActive() && !this.isSwapAllowed(candidate.mint)) {
          this.queueKaminoLog(
            "repay-with-collateral",
            `Token ${candidate.mint} nao permitido para swap; ignorando colateral.`,
            "warn"
          );
          continue;
        }
        try {
          await this.ensureAtaIfMissing(candidate.mint);
          await this.ensureAtaIfMissing(input.debtMint);
          const collDecimals = await this.getTokenDecimals(candidate.mint);
          const debtDecimals = await this.getTokenDecimals(input.debtMint);
          const capacity = await input.kamino.getWithdrawCapacity({
            collateralMint: candidate.mint,
            debtMint: input.debtMint,
            repayAmountUi: debtRemaining,
            bufferPct: capacityBuffer
          });
          const priceCollToDebt = await this.getTokenUsdPrice({
            mint: candidate.mint,
            decimals: collDecimals,
            stableMint: input.debtMint,
            stableDecimals: debtDecimals
          });
          const isSolColl = candidate.mint === NATIVE_MINT.toBase58();
          const quoteOutStableUi = await this.estimateStableOutForCollateral({
            collMint: candidate.mint,
            collDecimals,
            stableMint: input.debtMint,
            stableDecimals: debtDecimals,
            collAmountUi: capacity.capacityUi
          });
          const chunkChoice = selectRepayChunkWithQuote({
            debtRemaining,
            capacityUi: capacity.capacityUi,
            priceCollToDebt: priceCollToDebt ?? 0,
            quoteOutStableUi,
            minStable: KAMINO_REPAY_MIN_STABLE
          });
          let repayAmount = chunkChoice.chunk;
          if (maxChunkOverride != null) {
            repayAmount = Math.min(repayAmount, maxChunkOverride);
          }
          const effectivePrice = Math.max(0, priceCollToDebt ?? 0);
          // Não forçar split para wSOL: o SDK Kamino suporta wSOL como colateral
          // no repayWithCollateral nativo (uma tx atômica). O split (withdraw→swap→repay)
          // usa 3 txs separadas, cada uma sujeita a falha de blockhash.
          // Só vai para split se: já viu "tx too large" antes, ou se o quote
          // indica slippage/rota ruim (quoteOut < 50% do preço esperado).
          const preferSplit =
            this.kaminoTooLargeSeen ||
            (quoteOutStableUi != null &&
              capacity.capacityUi > 0 &&
              effectivePrice > 0 &&
              quoteOutStableUi / capacity.capacityUi < effectivePrice * 0.5); // heuristic: rotas com muito slippage/hops
          if (chunkChoice.chunk <= epsilon) {
            const reason = chunkChoice.reason ?? "capacidade de saque insuficiente";
            lastFailure = reason;
            this.queueKaminoLog(
              "repay-with-collateral-capacity",
              `${reason}; capacityUi=${capacity.capacityUi.toFixed(8)} price=${priceCollToDebt ?? "?"} quote=${quoteOutStableUi ?? "?"}`,
              "warn"
            );
            continue;
          }
          if (repayAmount <= epsilon) {
            continue;
          }
          if (preferSplit) {
            const splitResult = await performSplitRepayWithCollateralHelper({
              kamino: input.kamino,
              swapTokenToStable: (args) => this.swapTokenToStable({ ...args, label: "split-repay-coll->stable" }),
              collMint: candidate.mint,
              collDecimals,
              debtMint: input.debtMint,
              debtDecimals,
              repayUi: repayAmount,
              capacityUi: capacity.capacityUi,
              priceCollToDebt: effectivePrice,
              minWithdraw: KAMINO_WITHDRAW_MIN,
              logger: (payload, msg, level = "info") =>
                this.queueKaminoLog("repay-with-collateral", `${msg} ${JSON.stringify(payload)}`, level as any),
              isRetryable: (msg) => this.isKaminoRetryableError(msg),
              onWithdrawSuccess: (result) => {
                this.kaminoHealth.recordSuccess("kamino-withdraw");
                this.recordKaminoSuccess("withdraw", candidate.mint, result.actualAmount, result.signature);
                if (result.dustAmount > 0) {
                  this.recordWithdrawDust(result.dustAmount, candidate.mint);
                }
              },
              onRepaySuccess: (signature, amount, mint) => {
                this.kaminoHealth.recordSuccess("kamino-repay");
                this.recordKaminoSuccess("repay", mint, amount, signature);
              }
            });
            if (splitResult.performed) {
              performed = true;
              usedCandidate = true;
              debtRemaining = splitResult.debtRemaining ?? Math.max(0, debtRemaining - repayAmount);
              if (maxChunkOverride != null) {
                maxChunkOverride = Math.min(debtRemaining, maxChunkOverride * 2);
              }
              await refreshPosition();
              if (maxChunkOverride != null) {
                maxChunkOverride = Math.min(debtRemaining, maxChunkOverride);
              }
              break;
            }
            if (splitResult.retryable) {
              await refreshPosition();
              this.queueKaminoLog(
                "repay-with-collateral-refresh",
                `Retryable split-repay; debt agora ${debtRemaining.toFixed(8)}, deposits ${onChainDeposits.size}`,
                "info"
              );
              return {
                performed,
                debtAmount: debtRemaining,
                onChainDeposits,
                retryable: true,
                error: splitResult.error
              };
            }
            lastFailure = splitResult.error ?? "Split repay falhou";
            this.queueKaminoLog("repay-with-collateral-failed", `${lastFailure} (mode: split)`, "warn");
            continue;
          }
          this.queueKaminoLog(
            "repay-with-collateral",
            `Tentando repay de ${repayAmount.toFixed(8)} com colateral ${candidate.mint} (cap ${capacity.capacityUi.toFixed(8)}, price ${priceCollToDebt ?? "?"}, quote ${quoteOutStableUi ?? "?"}, debtRemaining ${debtRemaining.toFixed(8)}).`,
            "info"
          );
          const repaySig = await input.kamino.repayWithCollateral({
            collateralMint: candidate.mint,
            debtMint: input.debtMint,
            repayAmount,
            slippageBps: this.config.slippageBps
          });
          this.kaminoHealth.recordSuccess("kamino-repay-with-collateral");
          this.recordKaminoSuccess("repay-with-collateral", input.debtMint, repayAmount, repaySig);
          this.queueHistoryAction("kamino-repay");
          this.queueKaminoLog(
            "repay-with-collateral",
            "Repay com colateral concluido; recarregando posicao.",
            "info"
          );
          performed = true;
          lastQuoteError = null;
          usedCandidate = true;
          if (maxChunkOverride != null) {
            maxChunkOverride = Math.min(debtRemaining, maxChunkOverride * 2);
          }
          await refreshPosition();
          if (maxChunkOverride != null) {
            maxChunkOverride = Math.min(debtRemaining, maxChunkOverride);
          }
          break;
        } catch (err) {
          this.kaminoHealth.recordError(err, "kamino-repay-with-collateral");
          const message = stringifyError(err);
          lastFailure = message;
          const lower = message.toLowerCase();
          if (lower.includes("0x1553") || lower.includes("sqrtprice")) {
            this.queueKaminoLog(
              "sqrt-price-bounds",
              `Erro de preco fora dos limites (0x1553) durante swap; nova tentativa com quote atualizada. Detalhe: ${message}`,
              "warn"
            );
          }
          if (
            lower.includes("too large") ||
            lower.includes("versionedtransaction too large") ||
            lower.includes("invalid params") ||
            lower.includes("-32602") ||
            lower.includes("error #-32602") ||
            lower.includes("withdrawtoolarge") ||
            lower.includes("withdraw too large") ||
            lower.includes("6011") ||
            lower.includes("0x177b")
          ) {
            this.kaminoTooLargeSeen = true;
            chunkReductions += 1;
            let kaminoMaxWithdrawUsd: number | null = null;
            try {
              const decoded = decodeURIComponent(message);
              const match = decoded.match(/max_withdraw_value[=\s:]+([0-9]+(?:\.[0-9]+)?)/i);
              if (match) {
                const parsed = parseFloat(match[1]);
                if (Number.isFinite(parsed) && parsed > 0) {
                  kaminoMaxWithdrawUsd = parsed;
                }
              }
            } catch {
              // ignorar falha no decode
            }
            const adjusted: number = (() => {
              if (kaminoMaxWithdrawUsd != null) {
                const safeUsd = kaminoMaxWithdrawUsd * 0.85;
                return Math.max(KAMINO_REPAY_MIN_STABLE, safeUsd);
              }
              return maxChunkOverride != null
                ? Math.max(KAMINO_REPAY_MIN_STABLE, maxChunkOverride * 0.5)
                : Math.max(KAMINO_REPAY_MIN_STABLE, debtRemaining / 12);
            })();
            this.queueKaminoLog(
              "repay-with-collateral",
              `Transacao recusada por tamanho; ajustando chunk max para ${adjusted.toFixed(8)}. Detalhe: ${message}`,
              "warn"
            );
            usedCandidate = true;
            if (chunkReductions <= maxChunkReductions) {
              maxChunkOverride = adjusted;
            }
            break;
          }
          if (this.isKaminoRetryableError(message)) {
            this.queueKaminoLog("repay-with-collateral-failed", message, "warn");
            await refreshPosition();
            this.queueKaminoLog(
              "repay-with-collateral-refresh",
              `Retryable erro apos falha de repay; debt agora ${debtRemaining.toFixed(8)}, deposits ${onChainDeposits.size}`,
              "info"
            );
            return {
              performed: performed,
              debtAmount: debtRemaining,
              onChainDeposits,
              retryable: true,
              error: message
            };
          }
          if (this.isKaminoQuoteError(message)) {
            lastQuoteError = message;
            this.queueKaminoLog(
              "repay-with-collateral-failed",
              `Quote falhou para ${candidate.mint}: ${message}`,
              "warn"
            );
            continue;
          }
          this.queueKaminoLog("repay-with-collateral-failed", message, "error");
          return {
            performed,
            debtAmount: debtRemaining,
            onChainDeposits,
            error: message
          };
        }
      }

      if (!usedCandidate) {
        if (debtRemaining > epsilon && !lastFailure) {
          lastFailure = "Nenhum colateral disponivel para repay (todos filtrados ou sem saldo)";
        }
        break;
      }
    }

    if (lastQuoteError) {
      return {
        performed,
        debtAmount: debtRemaining,
        onChainDeposits,
        error: lastQuoteError,
        retryable: true
      };
    }

    if (!performed && debtRemaining > epsilon && lastFailure) {
      return {
        performed,
        debtAmount: debtRemaining,
        onChainDeposits,
        error: lastFailure,
        retryable: this.isKaminoRetryableError(lastFailure)
      };
    }

    return { performed, debtAmount: debtRemaining, onChainDeposits };
  }

  private async closeKaminoCycle(mode: "manual" | "target" | "token-change"): Promise<boolean> {
    let state = this.kaminoState;
    if (!state || !state.active) {
      this.setError("Nenhum ciclo Kamino ativo");
      return false;
    }
    let reservedDust = Number(state.reservedCollateralDust ?? 0);
    if (!Number.isFinite(reservedDust)) {
      reservedDust = 0;
    }
    // Reset camflag to try repayWithCollateral before falling to split.
    this.kaminoTooLargeSeen = false;
    if (!this.isKaminoOwner(state)) {
      const owner = state.ownerPoolName ?? state.ownerPoolId ?? "outra pool";
      throw new Error(`Kamino pertence a pool ${owner}`);
    }
    this.lastStatus.running = true;
    this.resetActionFee();

    if (mode === "target" && state.repayRetryUntil) {
      const retryAt = Date.parse(state.repayRetryUntil);
      if (Number.isFinite(retryAt) && retryAt > Date.now()) {
        return false;
      }
    }

    const resolved = await this.resolveKaminoPositionWithFallback();
    const kamino = resolved.kamino;
    let position = resolved.position;
    if (!position) {
      const hasLocalDebt = (state.debtAmount ?? 0) > 0 && Boolean(state.debtMint);
      const hasLocalCollateral = (state.collateralAmount ?? 0) > 0 && Boolean(state.collateralMint);
      if (hasLocalDebt || hasLocalCollateral) {
        this.queueKaminoLog(
          "not-found",
          "Posicao on-chain indisponivel (rate limit?); usando estado local para fechar.",
          "warn"
        );
        position = {
          collateralMint: state.collateralMint ?? null,
          collateralAmount: state.collateralAmount ?? null,
          debtMint: state.debtMint ?? null,
          debtAmount: state.debtAmount ?? null,
          ltv: null,
          deposits: Array.isArray(state.collaterals) && state.collaterals.length
            ? state.collaterals.map((c) => ({ mint: c.mint, amount: c.amount ?? 0 }))
            : (state.collateralMint
              ? [{ mint: state.collateralMint, amount: state.collateralAmount ?? 0 }]
              : []),
          borrows: state.debtMint
            ? [{ mint: state.debtMint, amount: state.debtAmount ?? 0 }]
            : []
        };
      } else {
        const message = "Posicao Kamino nao encontrada no market; aguardando proxima leitura.";
        this.setKaminoState({ ...state, lastError: message });
        this.queueKaminoLog("not-found", message, "warn");
        this.lastStatus.lastAction = "kamino-repay-wait";
        return false;
      }
    }
    const previousMarket = state.marketAddress ?? this.getConfiguredKaminoMarketAddress();
    if (resolved.marketAddress && previousMarket && resolved.marketAddress !== previousMarket) {
      if (this.poolId) {
        releaseKaminoLock(this.poolId, previousMarket);
      }
      const updated = { ...state, marketAddress: resolved.marketAddress, lastError: null };
      this.setKaminoState(updated);
      this.queueKaminoLog("market-fallback", `Market Kamino ajustado para ${resolved.marketAddress}.`, "warn");
      state = this.kaminoState ?? updated;
    }

    let collaterals = Array.isArray(state.collaterals) && state.collaterals.length
      ? state.collaterals
      : (state.collateralMint
        ? [{
          mint: state.collateralMint,
          amount: state.collateralAmount ?? 0,
          usd: state.collateralUsd ?? null,
          debtUsd: state.debtUsd ?? null,
          avgPriceUsdc: state.avgPriceUsdc ?? null,
          targetPriceUsdc: state.targetPriceUsdc ?? null
        }]
        : []);

    let onChainDeposits = new Map<string, number>();
    (position.deposits ?? []).forEach((item) => {
      if (!item?.mint) return;
      const current = onChainDeposits.get(item.mint) ?? 0;
      onChainDeposits.set(item.mint, current + (Number(item.amount) || 0));
    });
    const onChainBorrows = new Map<string, number>();
    (position.borrows ?? []).forEach((item) => {
      if (!item?.mint) return;
      const current = onChainBorrows.get(item.mint) ?? 0;
      onChainBorrows.set(item.mint, current + (Number(item.amount) || 0));
    });

    let debtMint = state.debtMint ?? position.debtMint ?? null;
    let recordedDebtAmount = Number(state.debtAmount ?? 0);
    const onChainDebtAmount = debtMint ? (onChainBorrows.get(debtMint) ?? 0) : 0;
    const borrowMints = Array.from(onChainBorrows.keys()).filter((mint) => mint && mint !== debtMint);

    const mismatchReasons: string[] = [];
    const epsilon = 1e-8;
    const collateralTolerance = (expected: number) => Math.max(epsilon, Math.abs(expected) * 1e-6);
    if (collaterals.length === 0 && onChainDeposits.size > 0) {
      mismatchReasons.push("colateral on-chain nao registrado");
    }
    for (const entry of collaterals) {
      if (!entry.mint) continue;
      const onChainAmount = onChainDeposits.get(entry.mint) ?? 0;
      if (Math.abs(onChainAmount - (entry.amount ?? 0)) > collateralTolerance(entry.amount ?? 0)) {
        mismatchReasons.push(`colateral ${entry.mint} diferente do registrado`);
        break;
      }
    }
    if (onChainDebtAmount + epsilon < recordedDebtAmount) {
      // Debt decreased on-chain (likely tx confirmed despite RPC error) -> sync quietly.
      this.queueKaminoLog(
        "reconcile-info",
        `Divida on-chain (${onChainDebtAmount}) menor que registrada (${recordedDebtAmount}); atualizando estado local.`,
        "info"
      );
      recordedDebtAmount = onChainDebtAmount;
      state = {
        ...state,
        debtAmount: onChainDebtAmount,
        collaterals
      };
      this.setKaminoState(state);
    } else if (onChainDebtAmount - epsilon > recordedDebtAmount) {
      mismatchReasons.push("divida on-chain diferente do registrado");
    }
    if ((recordedDebtAmount <= 0 || !debtMint) && onChainBorrows.size > 0) {
      mismatchReasons.push("divida on-chain nao registrada");
    }
    if (borrowMints.length > 0) {
      mismatchReasons.push("dividas em outros ativos detectadas");
    }
    if (mismatchReasons.length > 0) {
      const canReconcile = borrowMints.length === 0;
      if (canReconcile) {
        const reconciledCollaterals = Array.from(onChainDeposits.entries()).map(([mint, amount]) => {
          const prev = Array.isArray(state?.collaterals)
            ? state.collaterals.find((c) => c.mint === mint)
            : null;
          return {
            mint,
            amount,
            usd: null,
            debtUsd: null,
            avgPriceUsdc: prev?.avgPriceUsdc ?? null,
            targetPriceUsdc: prev?.targetPriceUsdc ?? null
          };
        });
        const updated: KaminoCycleState = {
          ...state,
          collateralMint: position.collateralMint ?? state.collateralMint ?? null,
          collateralAmount: Number(position.collateralAmount ?? 0),
          debtMint: position.debtMint ?? state.debtMint ?? null,
          debtAmount: Number(position.debtAmount ?? 0),
          collaterals: reconciledCollaterals,
          updatedAt: new Date().toISOString(),
          lastError: null
        };
        this.setKaminoState(updated);
        this.queueKaminoLog(
          "reconcile",
          `Estado Kamino reconciliado no fechamento (${mismatchReasons.join("; ")}).`,
          "warn"
        );
        state = this.kaminoState ?? updated;
        collaterals = reconciledCollaterals;
        debtMint = updated.debtMint ?? debtMint;
        recordedDebtAmount = Number(updated.debtAmount ?? recordedDebtAmount);
      } else {
        const message = `Mismatch Kamino on-chain: ${mismatchReasons.join("; ")}`;
        this.setKaminoState({ ...state, lastError: message });
        this.queueKaminoLog("mismatch", message, mode === "manual" ? "warn" : "error");
        if (mode !== "manual") {
          return false;
        }
      }
    }

    await this.refreshPoolState();
    if (this.currentPosition) {
      this.captureCloseSnapshot();
      await this.closePosition(this.currentPosition);
      this.queueHistoryAction("close-position", { lastAction: "close-position" });
      this.currentPosition = null;
      this.currentPositionMint = null;
      this.missingPositionSince = null;
    }
    await this.loadExistingPosition();
    if (this.currentPosition) {
      throw new Error("Fechamento falhou: posicao ainda aberta");
    }

    const stable = debtMint
      ? await this.getStableMintInfoByMint(debtMint, this.getStableLabelForMint(debtMint))
      : await this.getStableMintInfo();

    // Se a dívida on-chain ficou maior que a registrada (juros), usar valor on-chain.
    if (onChainDebtAmount > recordedDebtAmount * 1.001) {
      logger.warn(
        {
          recordedDebtAmount,
          freshDebt: onChainDebtAmount,
          interest: onChainDebtAmount - recordedDebtAmount
        },
        "Divida on-chain maior que registrada (juros acumulados); usando valor on-chain"
      );
      recordedDebtAmount = onChainDebtAmount;
      state = { ...state, debtAmount: recordedDebtAmount };
      this.setKaminoState(state);
    }

    const preOpState = await kamino.getPositionState().catch(() => null);
    logger.info(
      {
        operation: "repay-start",
        mint: stable.mint,
        amount: recordedDebtAmount,
        preOpCollateral: preOpState?.collateralAmount,
        preOpDebt: preOpState?.debtAmount,
        preOpLtv: preOpState?.ltv
      },
      "iniciando repay Kamino"
    );

    let debtAmount = Math.min(recordedDebtAmount, onChainDebtAmount);
    const repayBufferPct = Math.max(0, Number(this.config.kaminoPriceBufferPct ?? 0.5));
    if (debtAmount > 0) {
      this.queueKaminoLog(
        "repay-start",
        `Iniciando quitacao da divida ${debtAmount.toFixed(8)} ${stable.mint} antes de qualquer saque.`,
        "info"
      );

      const estimateConvertibleUsd = async (): Promise<number> => {
        let total = 0;
        for (const entry of collaterals) {
          const amount = Math.max(0, onChainDeposits.get(entry.mint) ?? 0);
          if (amount <= 0) continue;
          if (entry.mint === stable.mint) {
            total += amount;
            continue;
          }
          if (!this.config.jupiterApiKey) continue;
          const decimals = await this.getTokenDecimals(entry.mint);
          const priceUsd = await this.getTokenUsdPrice({
            mint: entry.mint,
            decimals,
            stableMint: stable.mint,
            stableDecimals: stable.decimals
          });
          if (priceUsd != null) {
            total += priceUsd * amount;
          }
        }
        return total;
      };

      let stableBalance = await this.getWalletTokenBalance(stable.mint);
      const repayTarget = debtAmount * (1 + repayBufferPct / 100);
      const convertibleUsd = await estimateConvertibleUsd();
      if (stableBalance + convertibleUsd + epsilon < repayTarget) {
        const missing = repayTarget - (stableBalance + convertibleUsd);
        const message = `Colateral insuficiente para quitar a divida (faltam ${missing.toFixed(8)}).`;
        this.setKaminoState({ ...state, lastError: message });
        this.queueKaminoLog("repay-insufficient", message, "error");
        if (this.config.evolutionApiUrl && this.config.evolutionPhone) {
          const walletAddr = this.wallet?.publicKey?.toBase58?.() ?? "desconhecida";
          const debtSymbol = stable.mint.startsWith("Es9v") ? "USDT" : "USDC";
          const convertibleAmount = Math.max(0, stableBalance + convertibleUsd);
          notifyKaminoFundsNeeded({
            apiUrl: this.config.evolutionApiUrl,
            apiKey: this.config.evolutionApiKey,
            instance: this.config.evolutionInstance,
            phone: this.config.evolutionPhone,
            walletAddress: walletAddr,
            debtAmount: debtAmount,
            debtMint: stable.mint,
            debtSymbol,
            botCanPayUsd: convertibleAmount,
            minAmountNeeded: Math.max(0.01, (debtAmount - convertibleAmount) * 1.02)
          }).catch(() => {});
        }
        if (this.scheduleKaminoRepayRetry(state, message, mode) && mode === "target") {
          return false;
        }
        if (mode === "target") {
          return false;
        }
        throw new Error(message);
      }

      // Usa SOL livre da wallet para gerar stable antes de tentar colateral.
      if (stableBalance + epsilon < debtAmount) {
        try {
          const solMint = NATIVE_MINT.toBase58();
          const solDecimals = 9;
          const minSolReserve = Math.max(0, Number(this.config.minSolBalance ?? 0));
          let solBalance = 0;
          try {
            const lamports = await this.connection.getBalance(this.wallet.publicKey);
            solBalance = lamports / 1e9;
          } catch {
            solBalance = await this.getWalletTokenBalance(solMint);
          }
          const maxSolIterations = 6;
          let solAttempts = 0;
          const solPrice = await this.getTokenUsdPrice({
            mint: solMint,
            decimals: solDecimals,
            stableMint: stable.mint,
            stableDecimals: stable.decimals
          });
          while (
            solAttempts < maxSolIterations &&
            solBalance - minSolReserve > 0.005 &&
            stableBalance + epsilon < debtAmount
          ) {
            solAttempts += 1;
            const shortfall = Math.max(0, debtAmount - stableBalance);
            const neededSol = solPrice && solPrice > 0 ? (shortfall * 1.05) / solPrice : 0.02;
            const maxSpendable = Math.max(0, solBalance - minSolReserve);
            const solChunk = Math.min(maxSpendable, Math.max(0.005, Math.min(0.1, neededSol)));
            if (solChunk <= 0) break;
            this.queueKaminoLog(
              "repay-sol",
              `Convertendo ${solChunk.toFixed(8)} SOL para ${stable.mint} (tentativa ${solAttempts}).`,
              "info"
            );
            const swapped = await this.swapTokenToStable({
              inputMint: solMint,
              inputDecimals: solDecimals,
              amountUi: solChunk,
              stableMint: stable.mint,
              stableDecimals: stable.decimals,
              label: "wallet-sol->stable-repay"
            });
            stableBalance = swapped != null
              ? stableBalance + swapped
              : await this.getWalletTokenBalance(stable.mint);
            try {
              const lamports = await this.connection.getBalance(this.wallet.publicKey);
              solBalance = lamports / 1e9;
            } catch {
              solBalance = await this.getWalletTokenBalance(solMint);
            }
          }
        } catch (err) {
          logger.warn({ err }, "falha ao converter SOL livre para stable no fechamento");
        }
      }

      // Usa stable da wallet primeiro (sem limite fixo de 5) antes do colateral.
      if (stableBalance > epsilon && debtAmount > epsilon) {
        const repayChunk = Math.min(stableBalance, repayTarget);
        if (repayChunk > epsilon) {
          try {
            const repaySig = await this.kaminoCallWithRetry(
              () => kamino.repay({ mint: stable.mint, amount: repayChunk }),
              "kamino-repay-wallet"
            );
            this.recordKaminoSuccess("repay", stable.mint, repayChunk, repaySig);
            this.queueHistoryAction("kamino-repay");
            debtAmount = Math.max(0, debtAmount - repayChunk);
            stableBalance = await this.getWalletTokenBalance(stable.mint);
          } catch (repayWalletErr) {
            const repayWalletMsg = String((repayWalletErr as any)?.message ?? repayWalletErr).toLowerCase();
            if (
              repayWalletMsg.includes("obligationborrowsempty") ||
              repayWalletMsg.includes("obligation borrows are empty") ||
              repayWalletMsg.includes("obligation has no borrows") ||
              repayWalletMsg.includes("0x1785") ||
              repayWalletMsg.includes("6021")
            ) {
              this.queueKaminoLog(
                "repay-wallet",
                "Dívida já quitada on-chain (ObligationBorrowsEmpty); zerando estado local.",
                "warn"
              );
              debtAmount = 0;
              stableBalance = await this.getWalletTokenBalance(stable.mint);
            } else if (
              /\b0x1\b/.test(repayWalletMsg) ||
              /custom program error: 0x1(?![0-9a-f])/i.test(repayWalletMsg) ||
              repayWalletMsg.includes("insufficient funds")
            ) {
              stableBalance = await this.getWalletTokenBalance(stable.mint);
              this.queueKaminoLog(
                "repay-wallet",
                `Saldo insuficiente para repay (0x1); saldo real: ${stableBalance.toFixed(8)}`,
                "warn"
              );
              // Saldo insuficiente é um estado terminal neste ciclo.
              // Registrar e retornar false para que o chamador agende um retry
              // apenas após rebalanceamento de saldo externo.
              this.setKaminoState({
                ...state,
                lastError: `Saldo insuficiente para repay: wallet tem ${stableBalance.toFixed(8)} ${stable.mint}`
              });
              return false;
            } else {
              throw repayWalletErr;
            }
          }
        }
      }

      if (stableBalance + epsilon < debtAmount) {
        const repayAttempt = await this.tryRepayWithCollateral({
          kamino,
          collaterals,
          debtMint: stable.mint,
          debtAmount,
          onChainDeposits
        });
        const repayErrLower = (repayAttempt.error ?? "").toLowerCase();
        const repayIsInsufficientFunds =
          /\b0x1\b/.test(repayErrLower) ||
          /custom program error: 0x1(?![0-9a-f])/i.test(repayErrLower) ||
          repayErrLower.includes("insufficient funds");
        if (repayAttempt.retryable && repayAttempt.error && !repayIsInsufficientFunds) {
          const wait = this.scheduleKaminoRepayRetry(state, repayAttempt.error, mode);
          if (wait) {
            return false;
          }
        }
        if (repayAttempt.error && !repayAttempt.retryable) {
          const msgLower = repayAttempt.error.toLowerCase();
          if (this.isKaminoQuoteError(repayAttempt.error) || msgLower.includes("jupiter")) {
            logger.warn(
              { err: repayAttempt.error },
              "repayWithCollateral falhou por rota Jupiter; tentando repay simples"
            );
            const walletBalance = await this.getWalletTokenBalance(stable.mint);
            if (walletBalance >= debtAmount * 0.01) {
              const repayAmount = Math.min(walletBalance, debtAmount);
              const repaySig = await this.kaminoCallWithRetry(
                () => kamino.repay({ mint: stable.mint, amount: repayAmount }),
                "repay-simple-fallback"
              );
              this.recordKaminoSuccess("repay", stable.mint, repayAmount, repaySig);
              this.queueHistoryAction("kamino-repay");
              this.queueKaminoLog(
                "repay-wallet",
                `Repay simples concluido (fallback Jupiter) ${repayAmount.toFixed(8)} ${stable.mint}`,
                "info"
              );
              debtAmount = Math.max(0, debtAmount - repayAmount);
              stableBalance = await this.getWalletTokenBalance(stable.mint);
            } else {
              throw new Error(repayAttempt.error);
            }
          }
          // Se for tx muito grande, seguimos para fallback manual (withdraw+swap) em vez de abortar.
          if (
            !msgLower.includes("too large") &&
            !msgLower.includes("-32602") &&
            !msgLower.includes("error #-32602")
          ) {
            const message = `Repay com colateral falhou: ${repayAttempt.error}`;
            this.setKaminoState({ ...state, lastError: message });
            this.queueKaminoLog("repay-with-collateral-failed", message, "error");
            throw new Error(message);
          }
          this.queueKaminoLog(
            "repay-with-collateral-failed",
            `Repay com colateral muito grande; tentando fallback manual. Detalhe: ${repayAttempt.error}`,
            "warn"
          );
        }
        if (repayAttempt.performed) {
          debtAmount = repayAttempt.debtAmount;
          onChainDeposits = repayAttempt.onChainDeposits;
          stableBalance = await this.getWalletTokenBalance(stable.mint);
        }
        const latestDust = Number(this.kaminoState?.reservedCollateralDust ?? NaN);
        if (Number.isFinite(latestDust) && latestDust > reservedDust) {
          reservedDust = latestDust;
        }
      }

      if (debtAmount > epsilon && stableBalance + epsilon < debtAmount) {
        const shortfall = debtAmount - stableBalance;
        const candidates = collaterals
          .map((entry) => ({
            mint: entry.mint,
            amount: Math.max(0, onChainDeposits.get(entry.mint) ?? 0),
            usd: entry.usd ?? null
          }))
          .filter((c) => c.mint && c.amount > 0 && c.mint !== stable.mint);
        if (candidates.length > 0) {
          candidates.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || b.amount - a.amount);
          const pick = candidates[0];
          try {
            const decimals = await this.getTokenDecimals(pick.mint);
            const priceUsd = await this.getTokenUsdPrice({
              mint: pick.mint,
              decimals,
              stableMint: stable.mint,
              stableDecimals: stable.decimals
            });
            const required = priceUsd && priceUsd > 0 ? shortfall / priceUsd * 1.05 : shortfall;
            let withdrawAmount = Math.min(pick.amount, required);
            let attempts = 0;
            const maxAttempts = 3;
            while (withdrawAmount > KAMINO_WITHDRAW_MIN && attempts < maxAttempts && debtAmount > epsilon) {
              attempts += 1;
              try {
                const capacity = await kamino.getWithdrawCapacity({
                  collateralMint: pick.mint,
                  debtMint: stable.mint,
                  repayAmountUi: debtAmount,
                  bufferPct: 0.95
                });
                const quoteOutStable = await this.estimateStableOutForCollateral({
                  collMint: pick.mint,
                  collDecimals: decimals,
                  stableMint: stable.mint,
                  stableDecimals: stable.decimals,
                  collAmountUi: withdrawAmount
                });
                withdrawAmount = Math.min(
                  withdrawAmount,
                  capacity.capacityUi,
                  priceUsd && priceUsd > 0 ? shortfall / priceUsd * 1.05 : withdrawAmount
                );
                if (
                  withdrawAmount <= KAMINO_WITHDRAW_MIN ||
                  capacity.capacityUi <= KAMINO_WITHDRAW_MIN ||
                  (quoteOutStable != null && quoteOutStable < KAMINO_WITHDRAW_MIN)
                ) {
                  const msg = `Capacidade de saque insuficiente (cap ${capacity.capacityUi.toFixed(8)}, quote ${quoteOutStable ?? "?"})`;
                  this.setKaminoState({ ...state, lastError: msg });
                  this.queueKaminoLog("repay-fallback-capacity", msg, "warn");
                  break;
                }
                this.queueKaminoLog(
                  "repay-fallback",
                  `Sacando ${withdrawAmount.toFixed(8)} de ${pick.mint} para quitar divida (tentativa ${attempts}).`,
                  "warn"
                );
        const withdrawResult = await this.kaminoCallWithRetry(
          () => kamino.withdraw({ mint: pick.mint, amount: withdrawAmount }),
          "kamino-withdraw"
        );
        this.recordKaminoSuccess("withdraw", pick.mint, withdrawResult.actualAmount, withdrawResult.signature);
        if (withdrawResult.dustAmount > 0) {
          reservedDust += withdrawResult.dustAmount;
          this.recordWithdrawDust(withdrawResult.dustAmount, pick.mint);
        }
        const actualWithdraw = Number(withdrawResult.actualAmount ?? withdrawAmount);
        onChainDeposits.set(pick.mint, Math.max(0, (onChainDeposits.get(pick.mint) ?? pick.amount) - actualWithdraw));
        const swappedOut = await this.swapTokenToStable({
          inputMint: pick.mint,
          inputDecimals: decimals,
          amountUi: actualWithdraw,
          stableMint: stable.mint,
          stableDecimals: stable.decimals,
          label: "kamino-fallback-collateral->stable"
        });
        stableBalance = swappedOut != null
          ? stableBalance + swappedOut
          : await this.getWalletTokenBalance(stable.mint);
        if (stableBalance > epsilon && debtAmount > epsilon) {
          const repayNow = Math.min(stableBalance, debtAmount * (1 + repayBufferPct / 100));
          if (repayNow > epsilon) {
            try {
              const repaySig = await this.kaminoCallWithRetry(
                () => kamino.repay({ mint: stable.mint, amount: repayNow }),
                "kamino-repay-fallback"
              );
              this.recordKaminoSuccess("repay", stable.mint, repayNow, repaySig);
              this.queueHistoryAction("kamino-repay");
              debtAmount = Math.max(0, debtAmount - repayNow);
              stableBalance = await this.getWalletTokenBalance(stable.mint);
            } catch (repayErr) {
              logger.warn({ err: repayErr }, "repay intermediário no fallback falhou; continuando");
            }
          }
        }
        if (debtAmount <= epsilon) break;
        const remainingShortfall = Math.max(0, debtAmount - stableBalance);
        if (remainingShortfall <= epsilon) break;
        const newNeeded = priceUsd && priceUsd > 0
          ? remainingShortfall / priceUsd * 1.05
          : remainingShortfall;
        const currentOnChain = Math.max(0, onChainDeposits.get(pick.mint) ?? 0);
        withdrawAmount = Math.min(currentOnChain, newNeeded);
              } catch (err) {
                const msg = stringifyError(err);
                const msgLower = msg.toLowerCase();
                if (msgLower.includes("0x1553") || msgLower.includes("sqrtprice")) {
                  this.queueKaminoLog(
                    "sqrt-price-bounds",
                    `Erro de preco fora dos limites (0x1553) durante swap; nova tentativa com quote atualizada. Detalhe: ${msg}`,
                    "warn"
                  );
                }
                if (this.isKaminoRetryableError(msg)) {
                  // Erro retryable no fallback manual: agendar retry do ciclo inteiro
                  // em vez de apenas reduzir o chunk. O blockhash expirado não é
                  // resolvido reduzindo o chunk — precisa de uma nova tx com novo blockhash.
                  const wait = this.scheduleKaminoRepayRetry(state, msg, mode);
                  if (wait) return false;
                  // Tentativas esgotadas: sair do loop sem reduzir chunk.
                  break;
                }
                withdrawAmount *= KAMINO_REPAY_CHUNK_FACTOR;
                this.queueKaminoLog(
                  "repay-fallback",
                  `Saque reduziu para ${withdrawAmount.toFixed(8)} por erro: ${msg}`,
                  "warn"
                );
              }
            }
          } catch (err) {
            const message = `Fallback repay falhou: ${stringifyError(err)}`;
            this.setKaminoState({ ...state, lastError: message });
            this.queueKaminoLog("repay-fallback-failed", message, "error");
            throw new Error(message);
          }
        }
      }

      if (debtAmount > epsilon && stableBalance + epsilon < debtAmount) {
        const message = `Colateral insuficiente para quitar a divida (restante ${debtAmount.toFixed(8)}).`;
        this.setKaminoState({ ...state, lastError: message });
        this.queueKaminoLog("repay-insufficient", message, "error");
        if (this.config.evolutionApiUrl && this.config.evolutionPhone) {
          const walletAddr = this.wallet?.publicKey?.toBase58?.() ?? "desconhecida";
          const debtSymbol = stable.mint.startsWith("Es9v") ? "USDT" : "USDC";
          const coverage = Math.max(0, stableBalance);
          notifyKaminoFundsNeeded({
            apiUrl: this.config.evolutionApiUrl,
            apiKey: this.config.evolutionApiKey,
            instance: this.config.evolutionInstance,
            phone: this.config.evolutionPhone,
            walletAddress: walletAddr,
            debtAmount: debtAmount,
            debtMint: stable.mint,
            debtSymbol,
            botCanPayUsd: coverage,
            minAmountNeeded: Math.max(0.01, (debtAmount - coverage) * 1.02)
          }).catch(() => {});
        }
        throw new Error(message);
      }

      if (debtAmount > epsilon) {
        try {
          const repayAmount = Math.min(stableBalance, debtAmount * (1 + repayBufferPct / 100));
          if (repayAmount + epsilon < debtAmount) {
            const message = `Saldo stable insuficiente para repay (tem ${stableBalance.toFixed(8)}, precisa ${debtAmount.toFixed(8)}).`;
            this.setKaminoState({ ...state, lastError: message });
            this.queueKaminoLog("repay-insufficient", message, "error");
            if (this.config.evolutionApiUrl && this.config.evolutionPhone) {
              const walletAddr = this.wallet?.publicKey?.toBase58?.() ?? "desconhecida";
              const debtSymbol = stable.mint.startsWith("Es9v") ? "USDT" : "USDC";
              const coverage = Math.max(0, stableBalance);
              notifyKaminoFundsNeeded({
                apiUrl: this.config.evolutionApiUrl,
                apiKey: this.config.evolutionApiKey,
                instance: this.config.evolutionInstance,
                phone: this.config.evolutionPhone,
                walletAddress: walletAddr,
                debtAmount: debtAmount,
                debtMint: stable.mint,
                debtSymbol,
                botCanPayUsd: coverage,
                minAmountNeeded: Math.max(0.01, (debtAmount - coverage) * 1.02)
              }).catch(() => {});
            }
            throw new Error(message);
          }
          const repaySig = await this.kaminoCallWithRetry(
            () => kamino.repay({ mint: stable.mint, amount: repayAmount }),
            "kamino-repay"
          );
          this.recordKaminoSuccess("repay", stable.mint, repayAmount, repaySig);
          this.queueHistoryAction("kamino-repay");
          debtAmount = Math.max(0, debtAmount - repayAmount);
          stableBalance = await this.getWalletTokenBalance(stable.mint);
        } catch (err) {
          const message = stringifyError(err);
          const msgLower = message.toLowerCase();
          if (
            msgLower.includes("obligationborrowsempty") ||
            msgLower.includes("obligation borrows are empty") ||
            msgLower.includes("obligation has no borrows") ||
            msgLower.includes("0x1785") ||
            msgLower.includes("6021")
          ) {
            this.queueKaminoLog(
              "repay-wallet",
              "Dívida já quitada on-chain (ObligationBorrowsEmpty); zerando estado local.",
              "warn"
            );
            debtAmount = 0;
            stableBalance = await this.getWalletTokenBalance(stable.mint);
          } else if (this.isKaminoRetryableError(message)) {
            const wait = this.scheduleKaminoRepayRetry(state, message, mode);
            if (wait) {
              return false;
            }
          } else {
            this.queueKaminoLog("repay-failed", message, "error");
            throw err;
          }
        }
      }
    }

    if (debtAmount > epsilon) {
      const message = `Divida remanescente (${debtAmount.toFixed(8)}); saque bloqueado.`;
      this.setKaminoState({ ...state, lastError: message });
      this.queueKaminoLog("withdraw-blocked", message, "error");
      throw new Error(message);
    }

    const withdrawTargets = collaterals.length > 0
      ? collaterals.map((entry) => {
        const onChainAmount = onChainDeposits.get(entry.mint) ?? 0;
        return { ...entry, amount: Math.min(entry.amount ?? 0, onChainAmount) };
      })
      : Array.from(onChainDeposits.entries()).map(([mint, amount]) => ({
        mint,
        amount,
        usd: null,
        debtUsd: null,
        avgPriceUsdc: null,
        targetPriceUsdc: null
      }));

    for (const entry of withdrawTargets) {
      if (entry.mint && entry.amount > 0) {
        try {
          const withdrawResult = await this.kaminoCallWithRetry(
            () => kamino.withdraw({ mint: entry.mint, amount: entry.amount }),
            "kamino-withdraw"
          );
          this.recordKaminoSuccess("withdraw", entry.mint, withdrawResult.actualAmount, withdrawResult.signature);
          if (withdrawResult.dustAmount > 0) {
            reservedDust += withdrawResult.dustAmount;
            this.recordWithdrawDust(withdrawResult.dustAmount, entry.mint);
          }
          this.queueHistoryAction("kamino-withdraw");
        } catch (err) {
          const message = stringifyError(err);
          const msgLower = message.toLowerCase();

          // 0x1784 = ObligationDepositsEmpty (6020): a obrigação já está vazia.
          // Isso ocorre quando um withdraw anterior (ex: retry após blockhash error
          // ou saque parcial do 0x17cc) já esvaziou os depósitos.
          // Tratar como sucesso silencioso — não há nada a sacar, o fechamento pode continuar.
          if (
            msgLower.includes("0x1784") ||
            msgLower.includes("obligationdepositsempty") ||
            msgLower.includes("obligation deposits are empty") ||
            msgLower.includes("has no deposits") ||
            msgLower.includes("6020")
          ) {
            this.queueKaminoLog(
              "withdraw-already-empty",
              `Withdraw ignorado: obrigacao ja sem depositos (${message}); prosseguindo com fechamento.`,
              "warn"
            );
            continue;
          }
          // 0x1776 = InvalidAccountInput: market stale apos repay que zerou divida.
          if (
            msgLower.includes("0x1776") ||
            msgLower.includes("invalidaccountinput") ||
            msgLower.includes("invalid account input") ||
            msgLower.includes("6006") ||
            msgLower.includes("expected_remaining_accounts")
          ) {
            this.queueKaminoLog(
              "withdraw-stale-market",
              `Withdraw falhou com market stale (${message}); market sera recarregado na proxima tentativa.`,
              "warn"
            );
            const wait = this.scheduleKaminoRepayRetry(state, message, mode);
            if (wait) {
              return false;
            }
          }
          if (this.isKaminoRetryableError(message)) {
            const wait = this.scheduleKaminoRepayRetry(state, message, mode);
            if (wait) {
              return false;
            }
          }
          this.queueKaminoLog("withdraw-failed", message, "error");
          throw err;
        }
      }
    }

    let kaminoNetUsd: number | null = null;
    try {
      let collateralUsd = 0;
      let priced = false;
      for (const entry of withdrawTargets) {
        if (!entry.mint || entry.amount <= 0) continue;
        if (entry.mint === stable.mint) {
          collateralUsd += entry.amount;
          priced = true;
          continue;
        }
        if (!this.config.jupiterApiKey) {
          continue;
        }
        const decimals = await this.getTokenDecimals(entry.mint);
        const priceUsd = await this.getTokenUsdPrice({
          mint: entry.mint,
          decimals,
          stableMint: stable.mint,
          stableDecimals: stable.decimals
        });
        if (priceUsd != null) {
          collateralUsd += priceUsd * entry.amount;
          priced = true;
        }
      }
      if (priced) {
        kaminoNetUsd = collateralUsd - debtAmount;
      }
    } catch (err) {
      logger.warn({ err }, "falha ao calcular pnl Kamino no fechamento");
    }
    if (kaminoNetUsd == null) {
      const fallbackCollateralUsd = Number(state.collateralUsd ?? NaN);
      const fallbackDebtUsd = Number(state.debtUsd ?? NaN);
      if (Number.isFinite(fallbackCollateralUsd) && Number.isFinite(fallbackDebtUsd)) {
        kaminoNetUsd = fallbackCollateralUsd - fallbackDebtUsd;
      }
    }
    const nextState: KaminoCycleState = {
      active: false,
      ownerPoolId: state.ownerPoolId ?? this.poolId ?? null,
      ownerPoolName: state.ownerPoolName ?? this.poolName ?? null,
      marketAddress: state.marketAddress ?? this.getKaminoMarketAddress(),
      repayRetryUntil: null,
      repayRetryAttempts: 0,
      repayRetryReason: null,
      baselineTokenA: null,
      baselineTokenB: null,
      reservedTokenA: null,
      reservedTokenB: null,
      reservedCollateralDust: reservedDust > epsilon ? reservedDust : null,
      collateralMint: null,
      collateralAmount: 0,
      collateralUsd: null,
      debtMint: null,
      debtAmount: 0,
      debtUsd: null,
      avgPriceUsdc: null,
      targetPriceUsdc: null,
      collaterals: [],
      cycleCount: state.cycleCount ?? 0,
      updatedAt: new Date().toISOString(),
      lastError: null
    };
    // Preservar valores de colateral/divida para histórico antes de limpar o estado.
    const closingDebtUsd = debtAmount > 0 ? debtAmount : (state.debtUsd ?? null);
    const closingCollateralUsd = (kaminoNetUsd != null && closingDebtUsd != null)
      ? kaminoNetUsd + closingDebtUsd
      : (Number.isFinite(Number(state.collateralUsd)) ? Number(state.collateralUsd) : null);
    const closingAvgPriceUsdc = Number.isFinite(Number(state.avgPriceUsdc))
      ? Number(state.avgPriceUsdc)
      : (this.lastStatus.kaminoAvgPriceUsdc ?? null);
    const closingTargetPriceUsdc = Number.isFinite(Number(state.targetPriceUsdc))
      ? Number(state.targetPriceUsdc)
      : (this.lastStatus.kaminoTargetPriceUsdc ?? null);

    this.setKaminoState(nextState);
    this.kaminoPoolOpenedAt = null;
    // Soma o PnL da pool encerrada ao kaminoNetUsd para refletir o
    // resultado real do ciclo (perda da pool + recuperação via Kamino).
    const poolExitUsd = this.lastStatus.eventPositionExitUsd ?? null;
    const poolEntryUsd = this.lastStatus.eventPositionEntryUsd ?? null;
    const poolPnlUsd = (poolExitUsd != null && poolEntryUsd != null)
      ? poolExitUsd - poolEntryUsd
      : null;
    const combinedPnlUsd = (kaminoNetUsd != null && poolPnlUsd != null)
      ? kaminoNetUsd + poolPnlUsd
      : (kaminoNetUsd ?? poolPnlUsd);
    this.queueHistoryAction("kamino-close", {
      lastAction: "kamino-close",
      positionPnlUsd: combinedPnlUsd,
      positionFeesUsd: 0,
      lastActionFeeLamports: null,
      kaminoCollateralUsd: closingCollateralUsd,
      kaminoDebtUsd: closingDebtUsd,
      kaminoAvgPriceUsdc: closingAvgPriceUsdc,
      kaminoTargetPriceUsdc: closingTargetPriceUsdc
    });
    this.releaseKaminoLockIfOwned();
    this.queueKaminoLog("close", "Ciclo Kamino fechado (repay + withdraw).", "info");
    logger.info({ mode }, "kamino cycle closed");
    return true;
  }

  /**
   * Fecha apenas UM colateral específico do ciclo Kamino.
   *
   * Fluxo:
   * 1. Calcula quanto da dívida total corresponde a este colateral (proporcional ao debtUsd).
   * 2. Obtém USDT da wallet para pagar (ou usa repayWithCollateral se wallet insuficiente).
   * 3. Chama kamino.repay() com o valor proporcional.
   * 4. Chama kamino.withdraw() para sacar apenas este token.
   * 5. Atualiza o kaminoState removendo este colateral do array e reduzindo debtAmount.
   * 6. Se não houver mais colaterais, define active: false.
   *
   * Pré-condição: não deve ser chamado com posição de pool aberta.
   */
  private async closeKaminoCollateralPartial(mintToClose: string): Promise<boolean> {
    const state = this.kaminoState;
    if (!state || !state.active) {
      logger.warn({ mintToClose }, "closeKaminoCollateralPartial: sem ciclo ativo");
      return false;
    }
    let reservedDust = Number(state.reservedCollateralDust ?? 0);
    if (!Number.isFinite(reservedDust)) {
      reservedDust = 0;
    }

    const collaterals = Array.isArray(state.collaterals) ? [...state.collaterals] : [];
    const entryIndex = collaterals.findIndex((c) => c.mint === mintToClose);
    if (entryIndex === -1) {
      logger.warn({ mintToClose }, "closeKaminoCollateralPartial: colateral nao encontrado no estado");
      return false;
    }
    const entry = collaterals[entryIndex];
    const epsilon = 1e-8;

    // ── 1. Calcular proporção da dívida atribuída a este colateral ────────
    const totalDebtUsdRecorded = collaterals.reduce(
      (sum, c) => sum + (c.debtUsd ?? 0), 0
    );
    // Se não há debtUsd por colateral, distribuir proporcionalmente pelo valor USD.
    let debtProportion: number;
    if (totalDebtUsdRecorded > epsilon) {
      debtProportion = (entry.debtUsd ?? 0) / totalDebtUsdRecorded;
    } else {
      // Fallback: proporção pelo valor USD depositado
      const totalUsd = collaterals.reduce((sum, c) => sum + (c.usd ?? 0), 0);
      debtProportion = totalUsd > epsilon ? (entry.usd ?? 0) / totalUsd : 1 / collaterals.length;
    }
    debtProportion = Math.min(1, Math.max(0, debtProportion));

    // ── 2. Resolver quanto de dívida on-chain corresponde a este colateral ─
    const resolved = await this.resolveKaminoPositionWithFallback();
    const kamino = resolved.kamino;
    const position = resolved.position;

    const onChainBorrows = new Map<string, number>();
    (position?.borrows ?? []).forEach((item) => {
      if (!item?.mint) return;
      onChainBorrows.set(item.mint, (onChainBorrows.get(item.mint) ?? 0) + Number(item.amount ?? 0));
    });
    const onChainDeposits = new Map<string, number>();
    (position?.deposits ?? []).forEach((item) => {
      if (!item?.mint) return;
      onChainDeposits.set(item.mint, (onChainDeposits.get(item.mint) ?? 0) + Number(item.amount ?? 0));
    });

    const debtMint = state.debtMint ?? position?.debtMint ?? null;
    if (!debtMint) {
      logger.warn({ mintToClose }, "closeKaminoCollateralPartial: debtMint nao encontrado");
      return false;
    }

    const totalOnChainDebt = onChainBorrows.get(debtMint) ?? Number(state.debtAmount ?? 0);
    const repayAmount = totalOnChainDebt * debtProportion;

    this.queueKaminoLog(
      "partial-close-start",
      `Iniciando fechamento parcial: ${mintToClose} | proporcao divida: ${(debtProportion * 100).toFixed(2)}% | repay: ${repayAmount.toFixed(8)} ${debtMint}`,
      "info"
    );

    // ── 3. Quitar a parte proporcional da dívida ──────────────────────────
    if (repayAmount > epsilon) {
      const stable = await this.getStableMintInfoByMint(debtMint, this.getStableLabelForMint(debtMint));
      let stableBalance = await this.getWalletTokenBalance(stable.mint);

      // 3a. Tentar pagar com saldo da wallet primeiro
      if (stableBalance >= repayAmount - epsilon) {
        try {
          const repaySig = await this.kaminoCallWithRetry(
            () => kamino.repay({ mint: stable.mint, amount: repayAmount }),
            "kamino-partial-repay"
          );
          this.recordKaminoSuccess("repay", stable.mint, repayAmount, repaySig);
          this.queueHistoryAction("kamino-repay");
          this.queueKaminoLog(
            "partial-repay-done",
            `Repay parcial concluido: ${repayAmount.toFixed(8)} ${stable.mint}`,
            "info"
          );
        } catch (repayErr) {
          const msg = stringifyError(repayErr);
          this.queueKaminoLog("partial-repay-failed", `Repay parcial falhou: ${msg}`, "error");
          this.setKaminoState({ ...state, lastError: `Repay parcial falhou: ${msg}` });
          return false;
        }
      } else {
        // 3b. Saldo insuficiente na wallet — tentar repayWithCollateral do próprio token
        this.queueKaminoLog(
          "partial-repay-coll",
          `Saldo wallet insuficiente (${stableBalance.toFixed(8)}); tentando repay com colateral ${mintToClose}.`,
          "warn"
        );
        const onChainCollAmount = onChainDeposits.get(mintToClose) ?? (entry.amount ?? 0);
        if (onChainCollAmount <= epsilon) {
          this.queueKaminoLog("partial-repay-failed", "Colateral on-chain zerado; abortando fechamento parcial.", "error");
          this.setKaminoState({ ...state, lastError: "Colateral on-chain zerado para fechamento parcial" });
          return false;
        }
        try {
          const repaySig = await this.kaminoCallWithRetry(
            () => kamino.repayWithCollateral({
              collateralMint: mintToClose,
              debtMint: stable.mint,
              repayAmount,
              slippageBps: this.config.slippageBps ?? 50
            }),
            "kamino-partial-repay-coll"
          );
          this.recordKaminoSuccess("repay-with-collateral", stable.mint, repayAmount, repaySig);
          this.queueHistoryAction("kamino-repay");
          this.queueKaminoLog(
            "partial-repay-done",
            `Repay parcial com colateral concluido: ${repayAmount.toFixed(8)} ${stable.mint}`,
            "info"
          );
        } catch (repayErr) {
          const msg = stringifyError(repayErr);
          this.queueKaminoLog("partial-repay-failed", `Repay parcial com colateral falhou: ${msg}`, "error");
          this.setKaminoState({ ...state, lastError: `Repay parcial com colateral falhou: ${msg}` });
          return false;
        }
      }
    }

    // ── 4. Sacar apenas este colateral ────────────────────────────────────
    const withdrawAmount = Math.min(
      entry.amount ?? 0,
      onChainDeposits.get(mintToClose) ?? (entry.amount ?? 0)
    );
    if (withdrawAmount > epsilon) {
      try {
        const withdrawResult = await this.kaminoCallWithRetry(
          () => kamino.withdraw({ mint: mintToClose, amount: withdrawAmount }),
          "kamino-partial-withdraw"
        );
        this.recordKaminoSuccess("withdraw", mintToClose, withdrawResult.actualAmount, withdrawResult.signature);
        if (withdrawResult.dustAmount > 0) {
          reservedDust += withdrawResult.dustAmount;
          this.recordWithdrawDust(withdrawResult.dustAmount, mintToClose);
        }
        this.queueHistoryAction("kamino-withdraw");
        this.queueKaminoLog(
          "partial-withdraw-done",
          `Saque parcial concluido: ${withdrawAmount.toFixed(8)} ${mintToClose}`,
          "info"
        );
      } catch (withdrawErr) {
        const msg = stringifyError(withdrawErr);
        const msgLower = msg.toLowerCase();
        // Obrigação já vazia on-chain (outro retry ou tx anterior confirmada) → ok
        if (
          msgLower.includes("0x1784") ||
          msgLower.includes("obligationdepositsempty") ||
          msgLower.includes("has no deposits") ||
          msgLower.includes("6020")
        ) {
          this.queueKaminoLog("partial-withdraw-done", "Withdraw parcial ignorado: obrigacao ja vazia.", "warn");
        } else {
          this.queueKaminoLog("partial-withdraw-failed", `Saque parcial falhou: ${msg}`, "error");
          this.setKaminoState({ ...state, lastError: `Saque parcial falhou: ${msg}` });
          return false;
        }
      }
    }

    // ── 5. Atualizar o estado removendo este colateral ────────────────────
    const remainingCollaterals = collaterals.filter((_, idx) => idx !== entryIndex);
    const remainingDebtAmount = Math.max(0, Number(state.debtAmount ?? 0) - repayAmount);
    const remainingDebtUsd = Math.max(0,
      remainingCollaterals.reduce((sum, c) => sum + (c.debtUsd ?? 0), 0)
    );
    const remainingCollateralUsd = remainingCollaterals.reduce(
      (sum, c) => sum + (c.usd ?? 0), 0
    );
    const single = remainingCollaterals.length === 1 ? remainingCollaterals[0] : null;

    // ── 6. Definir active: false se não houver mais colaterais ────────────
    const stillActive = remainingCollaterals.length > 0;

    const nextState: KaminoCycleState = {
      ...state,
      active: stillActive,
      reservedCollateralDust: reservedDust > epsilon ? reservedDust : null,
      collateralMint: single ? single.mint : (stillActive ? (state.collateralMint ?? null) : null),
      collateralAmount: single ? (single.amount ?? 0) : (stillActive ? state.collateralAmount : 0),
      collateralUsd: remainingCollateralUsd > 0 ? remainingCollateralUsd : null,
      debtAmount: remainingDebtAmount,
      debtUsd: remainingDebtUsd > 0 ? remainingDebtUsd : null,
      avgPriceUsdc: single ? single.avgPriceUsdc : null,
      targetPriceUsdc: single ? single.targetPriceUsdc : null,
      collaterals: remainingCollaterals,
      repayRetryUntil: null,
      repayRetryAttempts: 0,
      repayRetryReason: null,
      updatedAt: new Date().toISOString(),
      lastError: null
    };
    this.setKaminoState(nextState);

    if (!stillActive) {
      this.kaminoPoolOpenedAt = null;
      this.releaseKaminoLockIfOwned();
      this.queueKaminoLog(
        "partial-close-done",
        `Ultimo colateral fechado (${mintToClose}); ciclo Kamino encerrado.`,
        "info"
      );
    } else {
      this.queueKaminoLog(
        "partial-close-done",
        `Colateral ${mintToClose} fechado. Ciclo continua com ${remainingCollaterals.length} colateral(is) restante(s).`,
        "info"
      );
    }

    logger.info(
      { mintToClose, remainingCollaterals: remainingCollaterals.map((c) => c.mint), stillActive },
      "kamino partial close concluido"
    );
    return true;
  }

  private async rebalanceWithKamino(input: {
    price: number;
    solUsdPrice: number | null;
    executionRange: Range;
    positionRange: Range;
  }): Promise<string> {
    if (!this.currentPosition || !this.poolState) {
      return "close-no-position";
    }
    if (!this.config.jupiterApiKey) {
      this.setError("Jupiter API key ausente");
      return "kamino-rebalance-failed";
    }
    const kamino = await this.ensureKaminoClient();
    const borrowStableResult = await this.resolveKaminoBorrowStable(kamino);
    if (!borrowStableResult.stable) {
      this.setError(`Borrow indisponivel: ${borrowStableResult.reason ?? "reserve nao encontrada"}${this.getKaminoMarketHint()}`);
      this.queueKaminoLog("borrow-unavailable", this.lastStatus.lastError ?? "Borrow indisponivel", "error");
      return "kamino-rebalance-failed";
    }
    const stable = borrowStableResult.stable;
    let deposited = false;
    this.outOfRangeSince = null;

    let preCloseBalancesRaw: { tokenA: number; tokenB: number } | null = null;
    try {
      preCloseBalancesRaw = await this.getTokenBalancesRaw();
    } catch {
      preCloseBalancesRaw = null;
    }
    this.captureCloseSnapshot();
    await this.closePosition(this.currentPosition);
    this.queueHistoryAction("close-position", { lastAction: "close-position" });
    this.currentPosition = null;
    this.currentPositionMint = null;
    this.missingPositionSince = null;
    await this.loadExistingPosition();
    if (this.currentPosition) {
      this.setError("Fechamento falhou: posicao ainda aberta");
      return "close-failed";
    }

    const resolveTokens = async (balancesInput: { tokenA: number; tokenB: number }) => {
      return this.resolveKaminoCollateralTokens({
        tokenAAmount: balancesInput.tokenA,
        tokenBAmount: balancesInput.tokenB,
        solUsdPrice: input.solUsdPrice,
        price: input.price,
        positionRange: input.positionRange
      });
    };

    let baselineBalances = await this.getTokenBalancesRaw();
    let exitBalancesRaw = {
      tokenA: Math.max(0, baselineBalances.tokenA - (preCloseBalancesRaw?.tokenA ?? 0)),
      tokenB: Math.max(0, baselineBalances.tokenB - (preCloseBalancesRaw?.tokenB ?? 0))
    };
    let balances = this.applyBalanceCoordinator(exitBalancesRaw);
    const collateralMode = this.config.kaminoCollateralMode ?? "max-value";
    if (this.config.kaminoConvertToCollateral && (collateralMode === "tokenA" || collateralMode === "tokenB")) {
      const tokenAMint = this.poolState.tokenMintA.toBase58();
      const tokenBMint = this.poolState.tokenMintB.toBase58();
      const targetMint = collateralMode === "tokenA" ? tokenAMint : tokenBMint;
      const sourceMint = collateralMode === "tokenA" ? tokenBMint : tokenAMint;
      const sourceDecimals = collateralMode === "tokenA" ? this.poolState.decimalsB : this.poolState.decimalsA;
      const sourceAmount = collateralMode === "tokenA" ? balances.tokenB : balances.tokenA;
      if (sourceAmount > 0) {
        if (this.isSwapAllowlistActive() && !this.isSwapAllowed(sourceMint)) {
          this.setError("Token de origem nao permitido para swap em colateral fixo");
          return "kamino-rebalance-failed";
        }
        const amountRaw = toRawAmount(sourceAmount, sourceDecimals);
        if (!isValidU64(amountRaw)) {
          this.setError("Quantidade de swap fora do range para colateral fixo");
          return "kamino-rebalance-failed";
        }
        const quote = await this.fetchJupiterQuoteExactInDetailed(
          sourceMint,
          targetMint,
          amountRaw.toString(),
          this.config.slippageBps ?? 50
        );
        if (!quote.quote) {
          this.setError(`Sem rota Jupiter para converter colateral${quote.error ? ": " + quote.error : ""}`);
          return "kamino-rebalance-failed";
        }
        const swapResult = await this.executeJupiterSwapDetailed(quote.quote);
        if (!swapResult.sig) {
          this.setError(swapResult.error ?? "Falha na swap Jupiter");
          return "kamino-rebalance-failed";
        }
        baselineBalances = await this.getTokenBalancesRaw();
        exitBalancesRaw = {
          tokenA: Math.max(0, baselineBalances.tokenA - (preCloseBalancesRaw?.tokenA ?? 0)),
          tokenB: Math.max(0, baselineBalances.tokenB - (preCloseBalancesRaw?.tokenB ?? 0))
        };
        balances = this.applyBalanceCoordinator(exitBalancesRaw);
      }
    }
    let exitTokens: Awaited<ReturnType<typeof resolveTokens>>;
    try {
      exitTokens = await resolveTokens(balances);
    } catch (err) {
      this.setError(err);
      if (this.kaminoState?.active) {
        this.setKaminoState({
          ...this.kaminoState,
          lastError: this.lastStatus.lastError ?? this.kaminoState.lastError ?? null,
          updatedAt: new Date().toISOString()
        });
      }
      return "kamino-rebalance-failed";
    }
    if (!exitTokens || exitTokens.length === 0) {
      this.setError("Nao foi possivel determinar token de saida para Kamino");
      return "kamino-rebalance-failed";
    }
    const isDual = (this.config.kaminoCollateralMode ?? "max-value") === "both";
    if (!isDual && this.kaminoState?.active) {
      const existing = Array.isArray(this.kaminoState.collaterals) && this.kaminoState.collaterals.length
        ? this.kaminoState.collaterals.map((item) => item.mint)
        : (this.kaminoState.collateralMint ? [this.kaminoState.collateralMint] : []);
      const nextMint = exitTokens[0]?.mint;
      if (nextMint && existing.length > 0 && !existing.includes(nextMint)) {
        if (this.config.kaminoAutoCloseOnTokenChange) {
          try {
            const closed = await this.closeKaminoCycle("token-change");
            if (!closed) {
              this.setError("Fechamento do ciclo Kamino pendente");
              return "kamino-rebalance-failed";
            }
          } catch (err) {
            this.setError(err);
            return "kamino-rebalance-failed";
          }
          if (this.kaminoState?.active) {
            this.setError("Falha ao fechar ciclo Kamino anterior");
            return "kamino-rebalance-failed";
          }
          const refreshedBalances = await this.getTokenBalances();
          exitTokens = await resolveTokens(refreshedBalances);
          if (!exitTokens || exitTokens.length === 0) {
            this.setError("Nao foi possivel determinar token de saida apos fechar ciclo Kamino");
            return "kamino-rebalance-failed";
          }
        } else {
          this.setError("Token de colateral mudou; feche o ciclo Kamino antes de continuar");
          return "kamino-rebalance-failed";
        }
      }
    }

    const depositPct = Math.max(0, Math.min(100, Number(this.config.kaminoDepositPct ?? 100)));
    const deposits = exitTokens.map((token) => {
      const amount = token.amount * (depositPct / 100);
      const usdValue = token.usdValue ?? null;
      const depositUsd = usdValue != null ? usdValue * (depositPct / 100) : null;
      return { ...token, depositAmount: amount, depositUsd };
    }).filter((item) => item.depositAmount > 0);
    if (!deposits.length) {
      this.setError("Saldo insuficiente para depositar no Kamino");
      return "kamino-rebalance-failed";
    }

    // Deposito Kamino usa apenas o saldo que saiu da pool (delta do fechamento).

    for (const entry of deposits) {
      if (entry.depositUsd == null || !Number.isFinite(entry.depositUsd)) {
        this.setError("Nao foi possivel precificar o colateral para Kamino");
        return "kamino-rebalance-failed";
      }
      const supported = await kamino.supportsCollateral(entry.mint);
      if (!supported) {
        this.setError("Token de saida nao suportado como colateral no Kamino" + this.getKaminoMarketHint());
        return "kamino-rebalance-failed";
      }
    }

    const depositedEntries: { mint: string; amount: number }[] = [];
    try {
      await kamino.ensureObligation();
      for (const entry of deposits) {
        const preOpState = await kamino.getPositionState().catch(() => null);
        logger.info(
          {
            operation: "deposit-start",
            mint: entry.mint,
            amount: entry.depositAmount,
            preOpCollateral: preOpState?.collateralAmount,
            preOpDebt: preOpState?.debtAmount,
            preOpLtv: preOpState?.ltv
          },
          "iniciando deposito Kamino"
        );
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
          attempts += 1;
          try {
            const sig = await kamino.depositCollateral({ mint: entry.mint, amount: entry.depositAmount });
            this.kaminoHealth.recordSuccess("kamino-deposit");
            depositedEntries.push({ mint: entry.mint, amount: entry.depositAmount });
            this.queueHistoryAction("kamino-deposit");
            this.recordKaminoSuccess("deposit", entry.mint, entry.depositAmount, sig);
            break;
          } catch (err) {
            this.kaminoHealth.recordError(err, "kamino-deposit");
            const message = stringifyError(err);
            if (this.isKaminoRetryableError(message) && attempts < maxAttempts) {
              this.queueKaminoLog(
                "rebalance-wait",
                `Deposit rate-limited; nova tentativa em ${KAMINO_REBALANCE_RETRY_SEC}s.`,
                "warn"
              );
              await this.sleep(KAMINO_REBALANCE_RETRY_SEC * 1000);
              continue;
            }
            throw err;
          }
        }
      }
      deposited = depositedEntries.length > 0;
    } catch (err) {
      this.setError(err);
      for (const entry of depositedEntries) {
        try {
          await kamino.withdraw({ mint: entry.mint, amount: entry.amount });
        } catch (withdrawErr) {
          logger.warn({ err: withdrawErr }, "rollback kamino withdraw failed");
        }
      }
      return "kamino-rebalance-failed";
    }

    // Marca ciclo como ativo logo após o deposit para evitar que o
    // scanKaminoLoans sobrescreva o estado durante o retry do borrow.
    // Este estado parcial (sem debtAmount/avgPriceUsdc) será substituído
    // pelo estado completo após o borrow completar.
    if (depositedEntries.length > 0 && !this.kaminoState?.active) {
      const partialCollaterals = depositedEntries.map((entry) => ({
        mint: entry.mint,
        amount: entry.amount,
        usd: null,
        debtUsd: null,
        avgPriceUsdc: null,
        targetPriceUsdc: null
      }));
      const single = partialCollaterals.length === 1 ? partialCollaterals[0] : null;
      this.setKaminoState({
        active: true,
        ownerPoolId: this.poolId ?? null,
        ownerPoolName: this.poolName ?? null,
        marketAddress: this.getKaminoMarketAddress(),
        baselineTokenA: null,
        baselineTokenB: null,
        reservedTokenA: null,
        reservedTokenB: null,
        collateralMint: single ? single.mint : null,
        collateralAmount: single ? single.amount : 0,
        collateralUsd: null,
        debtMint: null,
        debtAmount: 0,
        debtUsd: null,
        avgPriceUsdc: null,
        targetPriceUsdc: null,
        collaterals: partialCollaterals,
        cycleCount: (this.kaminoState?.cycleCount ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        lastError: "Deposit realizado; aguardando borrow."
      });
    }

    const totalDepositUsd = deposits.reduce((sum, entry) => sum + (entry.depositUsd ?? 0), 0);
    const maxBorrowUsd = totalDepositUsd * Math.max(0, Math.min(1, this.config.kaminoMaxLtv ?? 0));
    const desiredBorrowUsd = this.config.budgetUsd != null
      ? Math.min(maxBorrowUsd, this.config.budgetUsd)
      : maxBorrowUsd;
    const borrowUsd = Math.max(0, desiredBorrowUsd);
    if (borrowUsd <= 0) {
      this.setError("Borrow USD insuficiente para reabrir a pool");
      if (deposited) {
        for (const entry of depositedEntries) {
          try {
            await kamino.withdraw({ mint: entry.mint, amount: entry.amount });
            this.queueHistoryAction("kamino-withdraw");
          } catch (withdrawErr) {
            logger.warn({ err: withdrawErr }, "rollback kamino withdraw failed");
          }
        }
      }
      return "kamino-rebalance-failed";
    }
    try {
      const preOpState = await kamino.getPositionState().catch(() => null);
      logger.info(
        {
          operation: "borrow-start",
          mint: stable.mint,
          amount: borrowUsd,
          preOpCollateral: preOpState?.collateralAmount,
          preOpDebt: preOpState?.debtAmount,
          preOpLtv: preOpState?.ltv
        },
        "iniciando borrow Kamino"
      );
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        attempts += 1;
        try {
          const sig = await kamino.borrow({ mint: stable.mint, amount: borrowUsd });
          this.kaminoHealth.recordSuccess("kamino-borrow");
          this.recordKaminoSuccess("borrow", stable.mint, borrowUsd, sig);
          break;
        } catch (err) {
          this.kaminoHealth.recordError(err, "kamino-borrow");
          const message = stringifyError(err);
          if (this.isKaminoRetryableError(message) && attempts < maxAttempts) {
            this.queueKaminoLog(
              "rebalance-wait",
              `Borrow rate-limited; nova tentativa em ${KAMINO_REBALANCE_RETRY_SEC}s.`,
              "warn"
            );
            await this.sleep(KAMINO_REBALANCE_RETRY_SEC * 1000);
            continue;
          }
          throw err;
        }
      }
      const previous = this.kaminoState;
      const existingCollaterals = Array.isArray(previous?.collaterals) && previous.collaterals.length
        ? previous.collaterals.map((item) => ({ ...item }))
        : (previous?.collateralMint
          ? [{
            mint: previous.collateralMint,
            amount: previous.collateralAmount ?? 0,
            usd: previous.collateralUsd ?? null,
            debtUsd: previous.debtUsd ?? null,
            avgPriceUsdc: previous.avgPriceUsdc ?? null,
            targetPriceUsdc: previous.targetPriceUsdc ?? null
          }]
          : []);
      const nextMap = new Map<string, KaminoCollateralEntry>();
      for (const entry of existingCollaterals) {
        if (entry.mint) {
          nextMap.set(entry.mint, { ...entry });
        }
      }
      const avgBasis = this.config.kaminoAvgPriceBasis ?? "deposit";
      const avgMode = this.config.kaminoAvgMode ?? "cumulative";
      const poolLossUsd = (() => {
        const pnl = this.lastStatus.positionPnlUsd ?? null;
        if (pnl != null && Number.isFinite(pnl) && pnl < 0) return Math.abs(pnl);
        return 0;
      })();
      const depositsForAvg: Array<typeof deposits[number] & { safeDepositUsd: number | null }> = [];
      let totalDepositUsdForAvg = 0;
      for (const entry of deposits) {
        // CORREÇÃO: garantir depositUsd correto para SOL
        let safeDepositUsd = entry.depositUsd ?? null;
        if ((safeDepositUsd == null || safeDepositUsd <= 0) && entry.mint === NATIVE_MINT.toBase58()) {
          const solPrice = await this.tryGetSolUsdPrice();
          if (solPrice != null) {
            safeDepositUsd = solPrice * entry.depositAmount;
          }
        }
        if (safeDepositUsd != null && Number.isFinite(safeDepositUsd) && safeDepositUsd > 0) {
          totalDepositUsdForAvg += safeDepositUsd;
        }
        depositsForAvg.push({ ...entry, safeDepositUsd });
      }
      for (const entry of depositsForAvg) {
        const share = totalDepositUsdForAvg > 0 ? (entry.safeDepositUsd ?? 0) / totalDepositUsdForAvg : 0;
        const debtUsd = borrowUsd * share;
        const prev = nextMap.get(entry.mint) ?? {
          mint: entry.mint,
          amount: 0,
          usd: null,
          debtUsd: null,
          avgPriceUsdc: null,
          targetPriceUsdc: null
        };
        const baseAmount = avgMode === "reset" ? 0 : (prev.amount ?? 0);
        const baseUsd = avgMode === "reset" ? 0 : (prev.usd ?? 0);
        const baseDebtUsd = avgMode === "reset" ? 0 : (prev.debtUsd ?? 0);
        const nextAmount = baseAmount + entry.depositAmount;
        const nextUsd = baseUsd + (entry.safeDepositUsd ?? 0);
        const nextDebtUsd = baseDebtUsd + debtUsd;
        const avgNumerator = avgBasis === "debt" ? nextDebtUsd : nextUsd;
        const avgPriceUsdc = nextAmount > 0 ? avgNumerator / nextAmount : null;
        if (!avgPriceUsdc || !Number.isFinite(avgPriceUsdc) || avgPriceUsdc <= 0) {
          logger.error({ avgPriceUsdc }, "avgPriceUsdc invalido; abortando deposito Kamino");
          this.setError("avgPriceUsdc inválido — impossível calcular target de fechamento");
          return "kamino-rebalance-failed";
        }
        const poolLossUsdForEntry = poolLossUsd * share;
        const lossAdjPct = (avgPriceUsdc != null && nextUsd > 0 && poolLossUsdForEntry > 0)
          ? (poolLossUsdForEntry / nextUsd) * 100
          : 0;
        const targetPriceUsdc = avgPriceUsdc != null
          ? avgPriceUsdc * (1 + ((this.config.kaminoPriceBufferPct ?? 0) + lossAdjPct) / 100)
          : null;
        nextMap.set(entry.mint, {
          mint: entry.mint,
          amount: nextAmount,
          usd: nextUsd > 0 ? nextUsd : null,
          debtUsd: nextDebtUsd > 0 ? nextDebtUsd : null,
          avgPriceUsdc,
          targetPriceUsdc
        });
      }
      const nextCollaterals = Array.from(nextMap.values());
      const totalCollateralUsd = nextCollaterals.reduce((sum, item) => sum + (item.usd ?? 0), 0);
      const totalDebtUsd = nextCollaterals.reduce((sum, item) => sum + (item.debtUsd ?? 0), 0);
      const single = nextCollaterals.length === 1 ? nextCollaterals[0] : null;
      const nextDebtAmount = (previous?.debtAmount ?? 0) + borrowUsd;
      const nextState: KaminoCycleState = {
        active: true,
        ownerPoolId: this.poolId ?? previous?.ownerPoolId ?? null,
        ownerPoolName: this.poolName ?? previous?.ownerPoolName ?? null,
        marketAddress: this.getKaminoMarketAddress(),
        baselineTokenA: baselineBalances.tokenA,
        baselineTokenB: baselineBalances.tokenB,
        reservedTokenA: previous?.reservedTokenA ?? null,
        reservedTokenB: previous?.reservedTokenB ?? null,
        reservedCollateralDust: previous?.reservedCollateralDust ?? null,
        collateralMint: single ? single.mint : null,
        collateralAmount: single ? single.amount : 0,
        collateralUsd: totalCollateralUsd > 0 ? totalCollateralUsd : null,
        debtMint: stable.mint,
        debtAmount: nextDebtAmount,
        debtUsd: totalDebtUsd > 0 ? totalDebtUsd : null,
        avgPriceUsdc: single ? single.avgPriceUsdc : null,
        targetPriceUsdc: single ? single.targetPriceUsdc : null,
        collaterals: nextCollaterals,
        cycleCount: (previous?.cycleCount ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        lastError: null
      };
      this.setKaminoState(nextState);
      this.queueHistoryAction("kamino-borrow");
    } catch (err) {
      this.setError(err);
      this.queueKaminoLog("rebalance-failed", stringifyError(err), "error");
      if (deposited) {
        for (const entry of depositedEntries) {
          try {
            await kamino.withdraw({ mint: entry.mint, amount: entry.amount });
            this.queueHistoryAction("kamino-withdraw");
          } catch (withdrawErr) {
            logger.warn({ err: withdrawErr }, "rollback kamino withdraw failed");
          }
        }
      }
      return "kamino-rebalance-failed";
    }

    let shareA = 0.5;
    try {
      const ticks = this.getTicksForRange(input.executionRange, input.price);
    const tokenExtensionCtx = await whirlpools.TokenExtensionUtil.buildTokenExtensionContext(
      this.ctx.fetcher,
      this.poolState.pool.getData(),
      whirlpools.IGNORE_CACHE
    );
      const ratio = await this.getRangeRatio(
        ticks.lowerTick,
        ticks.upperTick,
        input.price,
        tokenExtensionCtx
      );
      if (input.price + ratio > 0) {
        shareA = input.price / (input.price + ratio);
      }
    } catch (err) {
      logger.warn({ err }, "falha ao calcular ratio para swap kamino");
      shareA = 0.5;
    }
    const shareB = 1 - shareA;
    const totalStableRaw = toRawAmount(borrowUsd, stable.decimals);
    let stableForA = BigInt(0);
    let stableForB = BigInt(0);
    if (isValidU64(totalStableRaw) && totalStableRaw > 0n) {
      if (totalStableRaw <= BigInt(Number.MAX_SAFE_INTEGER)) {
        stableForA = BigInt(Math.floor(Number(totalStableRaw) * shareA));
      } else {
        const scale = BigInt(Math.floor(shareA * 1_000_000));
        stableForA = (totalStableRaw * scale) / 1_000_000n;
      }
      stableForB = totalStableRaw - stableForA;
    }

    const tokenAMint = this.poolState.tokenMintA.toBase58();
    const tokenBMint = this.poolState.tokenMintB.toBase58();
    try {
      const skipSwapA = tokenAMint === stable.mint;
      const skipSwapB = tokenBMint === stable.mint;
      if (!skipSwapA && stableForA > 0n && (!this.isSwapAllowlistActive() || this.isSwapAllowed(tokenAMint))) {
        await this.swapStableToToken({
          stableMint: stable.mint,
          stableDecimals: stable.decimals,
          outputMint: tokenAMint,
          outputDecimals: this.poolState.decimalsA,
          amountStableRaw: stableForA,
          label: "stable->tokenA"
        });
      }
      if (!skipSwapB && stableForB > 0n && (!this.isSwapAllowlistActive() || this.isSwapAllowed(tokenBMint))) {
        await this.swapStableToToken({
          stableMint: stable.mint,
          stableDecimals: stable.decimals,
          outputMint: tokenBMint,
          outputDecimals: this.poolState.decimalsB,
          amountStableRaw: stableForB,
          label: "stable->tokenB"
        });
      }
    } catch (err) {
      this.setError(err);
      return "kamino-rebalance-failed";
    }

    const postSwapBalances = await this.getTokenBalancesRaw();
    let reservedTokenA = Math.max(0, postSwapBalances.tokenA - baselineBalances.tokenA);
    let reservedTokenB = Math.max(0, postSwapBalances.tokenB - baselineBalances.tokenB);
    if (this.kaminoState?.active) {
      this.setKaminoState({
        ...this.kaminoState,
        baselineTokenA: baselineBalances.tokenA,
        baselineTokenB: baselineBalances.tokenB,
        reservedTokenA,
        reservedTokenB,
        updatedAt: new Date().toISOString()
      });
    }
    if (reservedTokenA <= 0 && reservedTokenB <= 0) {
      // Tenta usar saldo livre da wallet antes de desistir
      const walletBalances = await this.getTokenBalances();
      const hasWallet = walletBalances.tokenA > 0 || walletBalances.tokenB > 0;
      if (!hasWallet) {
        this.setError("Saldo emprestado insuficiente para reabrir a pool");
        this.queueKaminoLog("wait-funds", "Aguardando saldo emprestado para reabrir a pool.", "warn");
        this.lastStatus.lastAction = "kamino-wait-funds";
        return "kamino-wait-funds";
      }
      const pendingDebt2 = Number(this.kaminoState?.debtAmount ?? 0);
      if (pendingDebt2 > 1e-8) {
        this.queueKaminoLog(
          "wait-funds",
          `Divida pendente (${pendingDebt2.toFixed(4)}); aguardando quitacao.`,
          "warn"
        );
        this.lastStatus.lastAction = "kamino-wait-funds";
        this.lastStatus.positionRange = null;
        this.lastStatus.positionMint = this.currentPositionMint;
        return "kamino-wait-funds";
      }
      reservedTokenA = walletBalances.tokenA;
      reservedTokenB = walletBalances.tokenB;
      this.queueKaminoLog("wait-funds", "Usando saldo da wallet para reabrir a pool (sem empréstimo).", "warn");
    }

    let maxTokenA = reservedTokenA;
    let maxTokenB = reservedTokenB;
    if (this.config.budgetUsd != null && (reservedTokenA > 0 || reservedTokenB > 0)) {
      try {
        if (this.poolState.isTokenASol || this.poolState.isTokenBSol) {
          const solUsd = input.solUsdPrice ?? await this.tryGetSolUsdPrice();
          if (solUsd) {
            const budgetSol = this.config.budgetUsd / solUsd;
            const budgetTokenB = this.poolState.isTokenBSol ? budgetSol : budgetSol * input.price;
            const reservedValueB = reservedTokenB + reservedTokenA * input.price;
            if (budgetTokenB > reservedValueB) {
              const available = await this.getTokenBalances();
              const extraA = Math.max(0, available.tokenA - reservedTokenA);
              const extraB = Math.max(0, available.tokenB - reservedTokenB);
              const extraValueB = extraB + extraA * input.price;
              if (extraValueB > 0) {
                const missing = budgetTokenB - reservedValueB;
                const factor = Math.min(1, missing / extraValueB);
                maxTokenA = reservedTokenA + extraA * factor;
                maxTokenB = reservedTokenB + extraB * factor;
              }
            }
          }
        }
      } catch (err) {
        logger.warn({ err }, "falha ao calcular top-up de budget para reabertura Kamino");
      }
    }

    let openResult: string = "open-position-failed";
    let openError: string | null = null;
    try {
      openResult = await this.openPosition(input.executionRange, input.price, input.solUsdPrice, {
        maxTokenA,
        maxTokenB
      });
    } catch (err) {
      this.setError(err);
      openError = stringifyError(err);
    }
    if (openResult === "open-position") {
      this.lastRebalanceAt = Date.now();
      this.queueHistoryAction("kamino-reopen");
      this.kaminoPoolOpenedAt = Date.now();
      if (this.config.autoSwapToSolEnabled) {
        try {
          await this.swapWalletToSol("auto");
        } catch (err) {
          logger.warn({ err }, "auto swap-to-sol failed after kamino re-range");
        }
      }
      const postOpenBalances = await this.getTokenBalancesRaw();
      const remainingA = Math.max(0, postOpenBalances.tokenA - baselineBalances.tokenA);
      const remainingB = Math.max(0, postOpenBalances.tokenB - baselineBalances.tokenB);
      if (this.kaminoState?.active) {
        this.setKaminoState({
          ...this.kaminoState,
          reservedTokenA: remainingA,
          reservedTokenB: remainingB,
          updatedAt: new Date().toISOString()
        });
      }
      await this.updatePortfolioSnapshot(input.price, input.solUsdPrice);
    } else {
      if (openResult === "insufficient-balance") {
        this.queueKaminoLog("wait-funds", "Saldo emprestado insuficiente para reabrir a pool.", "warn");
        this.lastStatus.lastAction = "kamino-wait-funds";
        return "kamino-wait-funds";
      }
      if (!openError) {
        this.setError(`Falha ao reabrir a pool (${openResult})`);
      }
    }

    if (openResult !== "open-position" && this.kaminoState?.active) {
      this.setKaminoState({
        ...this.kaminoState,
        lastError: this.lastStatus.lastError ?? this.kaminoState.lastError ?? null,
        updatedAt: new Date().toISOString()
      });
    }

    return openResult === "open-position" ? "kamino-rebalanced" : "kamino-rebalance-failed";
  }

  private async getWalletTokenBalance(mint: string): Promise<number> {
    const tokens = await this.getWalletTokens();
    const match = tokens.find((token) => token.mint === mint);
    return match?.uiAmount ?? 0;
  }

  private async getTokenDecimals(mint: string): Promise<number> {
    if (this.poolState) {
      const tokenA = this.poolState.tokenMintA.toBase58();
      const tokenB = this.poolState.tokenMintB.toBase58();
      if (mint === tokenA) return this.poolState.decimalsA;
      if (mint === tokenB) return this.poolState.decimalsB;
    }
    try {
      const info = await getMint(this.connection, new PublicKey(mint));
      return Number(info.decimals ?? 6);
    } catch {
      return 6;
    }
  }

  private async waitForJupiterSlot(): Promise<() => void> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = OrcaBot.jupiterQueue;
    OrcaBot.jupiterQueue = previous.then(() => gate);
    await previous;

    const delay = Math.max(0, OrcaBot.jupiterNextAllowedAt - Date.now());
    if (delay > 0) {
      await sleep(delay);
    }
    OrcaBot.jupiterNextAllowedAt = Date.now() + OrcaBot.jupiterMinIntervalMs;
    return () => release();
  }

  private async jupiterRequest(
    url: string,
    init: RequestInit,
    options?: { retries?: number }
  ): Promise<{ res: Response; text: string }> {
    const retries = Math.max(0, options?.retries ?? 0);
    let attempt = 0;
    while (true) {
      const release = await this.waitForJupiterSlot();
      try {
        const res = await fetch(url, init);
        const text = await res.text().catch(() => "");
        if ([429, 502, 503, 504].includes(res.status)) {
          if (attempt < retries) {
            const retryAfter = res.headers.get("retry-after");
            let delay = 800 * Math.pow(2, attempt);
            if (retryAfter) {
              const parsed = Number(retryAfter);
              if (Number.isFinite(parsed) && parsed > 0) {
                delay = parsed * 1000;
              }
            }
            attempt += 1;
            await sleep(delay);
            continue;
          }
        }
        return { res, text };
      } catch (err) {
        if (attempt < retries) {
          const delay = 800 * Math.pow(2, attempt);
          attempt += 1;
          await sleep(delay);
          continue;
        }
        throw err;
      } finally {
        release();
      }
    }
  }

  private isSwapAllowed(mint: string): boolean {
    if (!this.swapAllowlist || this.swapAllowlist.size === 0) {
      return true;
    }
    return this.swapAllowlist.has(mint);
  }

  private isSwapAllowlistActive(): boolean {
    return Boolean(this.swapAllowlist && this.swapAllowlist.size > 0);
  }

  private async tryGetSolUsdPrice(): Promise<number | null> {
    if (!this.config.pythSolUsdFeedId) {
      return null;
    }
    try {
      const price = await getSolUsdPrice(
        this.connection,
        this.config.pythSolUsdFeedId,
        this.config.priceStaleMaxSec ?? null,
        30000
      );
      return price.price;
    } catch (err) {
      logger.warn({ err }, "failed to fetch SOL/USD from Pyth");
      if (this.config.budgetUsd != null) {
        throw err;
      }
      return null;
    }
  }

  private async getTokenBalancesRaw(): Promise<{ tokenA: number; tokenB: number }> {
    if (!this.poolState) {
      throw new Error("poolState not initialized");
    }

    const ataA = getAssociatedTokenAddressSync(this.poolState.tokenMintA, this.wallet.publicKey);
    const ataB = getAssociatedTokenAddressSync(this.poolState.tokenMintB, this.wallet.publicKey);

    const [balA, balB] = await Promise.all([
      this.connection.getTokenAccountBalance(ataA).catch(() => null),
      this.connection.getTokenAccountBalance(ataB).catch(() => null)
    ]);

    let tokenA = balA?.value?.uiAmount ?? 0;
    let tokenB = balB?.value?.uiAmount ?? 0;

    if (this.poolState.isTokenASol || this.poolState.isTokenBSol) {
      const nativeSol = (await this.connection.getBalance(this.wallet.publicKey)) / LAMPORTS_PER_SOL;
      const availableSol = Math.max(0, nativeSol - this.config.minSolBalance);
      if (this.poolState.isTokenASol) {
        tokenA += availableSol;
      }
      if (this.poolState.isTokenBSol) {
        tokenB += availableSol;
      }
    }

    return { tokenA, tokenB };
  }

  private applyBalanceCoordinator(balances: { tokenA: number; tokenB: number }): { tokenA: number; tokenB: number } {
    if (!this.balanceCoordinator || !this.poolId || !this.poolState) {
      return balances;
    }
    const mintA = this.poolState.tokenMintA.toBase58();
    const mintB = this.poolState.tokenMintB.toBase58();
    const tokenA = this.balanceCoordinator.getAvailableBalance(this.poolId, mintA, balances.tokenA);
    const tokenB = this.balanceCoordinator.getAvailableBalance(this.poolId, mintB, balances.tokenB);
    return { tokenA, tokenB };
  }

  private async getTokenBalances(): Promise<{ tokenA: number; tokenB: number }> {
    const raw = await this.getTokenBalancesRaw();
    return this.applyBalanceCoordinator(raw);
  }

  private async getWalletTokens(): Promise<Array<{ mint: string; rawAmount: string; rawAmountBigint: bigint; uiAmount: number; decimals: number }>> {
    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
      this.wallet.publicKey,
      { programId: TOKEN_PROGRAM_ID }
    );
    return tokenAccounts.value.map((acct) => {
      const info = acct.account.data.parsed.info;
      const amountStr = String(info.tokenAmount?.amount ?? "0");
      let amount = 0n;
      try {
        amount = BigInt(amountStr);
      } catch {
        amount = 0n;
      }
      const decimals = Number(info.tokenAmount?.decimals ?? 0);
      const uiAmount = Number(info.tokenAmount?.uiAmount ?? 0);
      return { mint: String(info.mint), rawAmount: amountStr, rawAmountBigint: amount, uiAmount, decimals };
    }).filter((item) => item.rawAmountBigint > 0n);
  }

  private async maybeTopUpSol(reason: "auto" | "manual", solBalance: number): Promise<{ performed: boolean; reason?: string }> {
    if (reason === "auto" && !this.config.autoSolTopupEnabled) {
      return { performed: false, reason: "disabled" };
    }
    if (!this.config.jupiterApiKey) {
      return { performed: false, reason: "missing-api-key" };
    }
    if (solBalance >= this.config.minSolBalance) {
      return { performed: false, reason: "sol-ok" };
    }

    const now = Date.now();
    if (OrcaBot.topupInFlight) {
      return { performed: false, reason: "in-flight" };
    }
    if (this.config.autoSolCooldownSec > 0 && OrcaBot.lastTopupAt != null) {
      const elapsedSec = (now - OrcaBot.lastTopupAt) / 1000;
      if (elapsedSec < this.config.autoSolCooldownSec) {
        logger.info({ elapsedSec, cooldownSec: this.config.autoSolCooldownSec }, "sol topup cooldown active");
        return { performed: false, reason: "cooldown" };
      }
    }

    const targetSol = this.config.minSolBalance * (1 + this.config.autoSolTargetBufferPct);
    const neededLamports = Math.ceil((targetSol - solBalance) * LAMPORTS_PER_SOL);
    if (!Number.isFinite(neededLamports) || neededLamports <= 0) {
      return { performed: false, reason: "sol-ok" };
    }

    const kaminoDebtMint = (this.kaminoState?.active && (this.kaminoState?.debtAmount ?? 0) > 0)
      ? (this.kaminoState?.debtMint ?? null)
      : null;

    OrcaBot.topupInFlight = true;
    try {
      const allTokens = await this.getWalletTokens();
      const whitelist = new Set(this.config.autoSolSwapMints.map((mint) => mint.trim()).filter((mint) => mint));
      const baseTokens = allTokens.filter((token) => {
        if (token.mint === NATIVE_MINT.toBase58()) {
          return false;
        }
        if (token.decimals === 0) {
          return false;
        }
        if (kaminoDebtMint && token.mint === kaminoDebtMint) {
          return false;
        }
        return true;
      });

      const allowlisted = this.isSwapAllowlistActive()
        ? baseTokens.filter((token) => this.isSwapAllowed(token.mint))
        : baseTokens;

      const candidates = allowlisted.filter((token) => {
        if (this.config.autoSolAllowAll) {
          return true;
        }
        return whitelist.has(token.mint);
      }).sort((a, b) => {
        if (a.rawAmountBigint === b.rawAmountBigint) return 0;
        return a.rawAmountBigint > b.rawAmountBigint ? -1 : 1;
      });

      if (!candidates.length) {
        const reason = this.isSwapAllowlistActive() && allowlisted.length === 0 ? "not-allowed" : "whitelist-empty";
        logger.warn({ reason }, "sol topup skipped: no eligible tokens");
        return { performed: false, reason };
      }

      let remainingLamports = BigInt(neededLamports);
      let swaps = 0;

      for (const token of candidates) {
        if (remainingLamports <= 0n) {
          break;
        }
        const maxInput = applyPctToBigInt(token.rawAmountBigint, this.config.autoSolMaxInputPct);
        if (maxInput <= 0n) {
          continue;
        }
        let quote = await this.fetchJupiterQuoteExactIn(
          token.mint,
          NATIVE_MINT.toBase58(),
          maxInput.toString(),
          this.config.autoSolSlippageBps
        );
        if (!quote) {
          continue;
        }
        let outAmount = BigInt(quote.outAmount ?? 0);
        if (outAmount <= 0n) {
          continue;
        }

        if (outAmount > remainingLamports) {
          const adjustedIn = scaleInputAmount(maxInput, outAmount, remainingLamports);
          if (adjustedIn < maxInput) {
            const adjustedQuote = await this.fetchJupiterQuoteExactIn(
              token.mint,
              NATIVE_MINT.toBase58(),
              adjustedIn.toString(),
              this.config.autoSolSlippageBps
            );
            if (adjustedQuote && BigInt(adjustedQuote.outAmount ?? 0) > 0n) {
              quote = adjustedQuote;
              outAmount = BigInt(adjustedQuote.outAmount ?? 0);
            }
          }
        }

        const sig = await this.executeJupiterSwap(quote);
        if (sig) {
          OrcaBot.lastTopupAt = Date.now();
          this.lastStatus.lastAction = reason === "auto" ? "auto-sol-topup" : "manual-sol-topup";
          swaps += 1;
          remainingLamports = remainingLamports > outAmount ? remainingLamports - outAmount : 0n;
        }
      }

      if (swaps > 0) {
        return { performed: true };
      }
      logger.warn("sol topup failed: no viable route or insufficient balance");
      return { performed: false, reason: "no-route" };
    } catch (err) {
      logger.warn({ err }, "sol topup failed");
      return { performed: false, reason: "error" };
    } finally {
      OrcaBot.topupInFlight = false;
    }
  }

  private async fetchJupiterQuoteExactIn(
    inputMint: string,
    outputMint: string,
    amount: number | string,
    slippageBps: number
  ): Promise<any | null> {
    const result = await this.fetchJupiterQuoteExactInDetailed(
      inputMint,
      outputMint,
      amount,
      slippageBps
    );
    if (!result.quote) {
      if (result.error) {
        logger.warn({ err: result.error }, "jupiter quote failed");
      } else {
        logger.warn("jupiter quote failed");
      }
      return null;
    }
    return result.quote;
  }

  private async executeJupiterSwap(quoteResponse: any): Promise<string | null> {
    const result = await this.executeJupiterSwapDetailed(quoteResponse);
    if (!result.sig) {
      if (result.error) {
        logger.warn({ err: result.error }, "jupiter swap failed");
      } else {
        logger.warn("jupiter swap failed");
      }
      return null;
    }
    return result.sig;
  }

  private async fetchJupiterQuoteExactInDetailed(
    inputMint: string,
    outputMint: string,
    amount: number | string,
    slippageBps: number
  ): Promise<{ quote: any | null; error?: string }> {
    const base = this.config.jupiterApiUrl.replace(/\/+$/, "");
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: String(amount),
      swapMode: "ExactIn",
      slippageBps: String(slippageBps)
    });
    if (JUPITER_DIRECT_ONLY) {
      params.set("onlyDirectRoutes", "true");
    }
    if (Array.isArray(this.config.jupiterExcludeDexes) && this.config.jupiterExcludeDexes.length > 0) {
      params.set("excludeDexes", this.config.jupiterExcludeDexes.join(","));
    }
    try {
      const { res, text } = await this.jupiterRequest(
        `${base}/swap/v1/quote?${params.toString()}`,
        { headers: { "x-api-key": this.config.jupiterApiKey ?? "" } },
        { retries: 2 }
      );
      if (!res.ok) {
        return { quote: null, error: formatJupiterError(res.status, text) };
      }
      if (!text) {
        return { quote: null, error: "Resposta vazia" };
      }
      try {
        return { quote: JSON.parse(text) };
      } catch {
        return { quote: null, error: "JSON invalido" };
      }
    } catch (err) {
      return { quote: null, error: stringifyError(err) };
    }
  }

  private async executeJupiterSwapDetailed(quoteResponse: any): Promise<{ sig: string | null; error?: string }> {
    const base = this.config.jupiterApiUrl.replace(/\/+$/, "");
    let lastError: string | null = null;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { res, text } = await this.jupiterRequest(
          `${base}/swap/v1/swap`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": this.config.jupiterApiKey ?? ""
            },
            body: JSON.stringify({
              quoteResponse,
              userPublicKey: this.wallet.publicKey.toBase58(),
              wrapAndUnwrapSol: true
            })
          },
          { retries: 2 }
        );
        if (!res.ok) {
          lastError = formatJupiterError(res.status, text);
          if (attempt < maxAttempts && this.isKaminoRetryableError(lastError)) {
            await this.sleep(KAMINO_REBALANCE_RETRY_SEC * 1000);
            continue;
          }
          return { sig: null, error: lastError };
        }
        if (!text) {
          return { sig: null, error: "Resposta vazia" };
        }
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          return { sig: null, error: "JSON invalido" };
        }
        const swapTx = data?.swapTransaction;
        if (!swapTx) {
          return { sig: null, error: "swapTransaction ausente" };
        }
        const tx = VersionedTransaction.deserialize(Buffer.from(swapTx, "base64"));
        const signed = await this.wallet.signTransaction(tx);
        const sig = await this.connection.sendRawTransaction(signed.serialize(), { maxRetries: 2 });
        await this.connection.confirmTransaction(sig, "confirmed");
        const feeLamports = await this.fetchTxFeeLamports(sig);
        this.addActionFee(feeLamports);
        return { sig };
      } catch (err) {
        const logs = await extractSendTxLogs(err);
        const message = formatErrorWithLogs(stringifyError(err), logs);
        lastError = message;
        const lower = message.toLowerCase();
        const isJupiterRetryable =
          this.isKaminoRetryableError(message) ||
          lower.includes("0x1771") ||
          lower.includes("0x1553") ||
          lower.includes("sqrtprice") ||
          lower.includes("sqrt_price") ||
          lower.includes("price out of bounds") ||
          lower.includes("priceoutofbounds") ||
          lower.includes("simulation failed");
        if (attempt < maxAttempts && isJupiterRetryable) {
          logger.warn({ attempt, err: message }, "swap jupiter retry after transient/slippage/price-bounds error");
          await this.sleep(KAMINO_REBALANCE_RETRY_SEC * 1000);
          continue;
        }
        return { sig: null, error: message };
      }
    }
    return { sig: null, error: lastError ?? "Swap Jupiter falhou apos retries" };
  }

  private async swapWalletToSol(reason: "auto" | "manual"): Promise<SwapWalletToSolResult> {
    const details: SwapWalletToSolDetail[] = [];
    if (!this.config.jupiterApiKey) {
      logger.warn("swap-to-sol skipped: missing Jupiter API key");
      return { swaps: 0, failed: 0, totalOutLamports: 0, reason: "missing-api-key", details };
    }

    const tokens = await this.getWalletTokens();
    if (!tokens.length) {
      return { swaps: 0, failed: 0, totalOutLamports: 0, reason: "no-tokens", details };
    }
    const excludeSet = new Set(
      (this.config.autoSwapToSolExcludeMints ?? [])
        .map((mint) => String(mint).trim())
        .filter((mint) => mint)
    );
    const minOutLamports = Math.max(
      0,
      Math.floor((this.config.autoSwapToSolMinOutSol ?? 0) * LAMPORTS_PER_SOL)
    );
    const minOutLamportsBigint = BigInt(minOutLamports);
    let swaps = 0;
    let failed = 0;
    let totalOutLamports = 0;
    let totalOutLamportsBigint = 0n;
    let blocked = 0;

    for (const token of tokens) {
      const baseDetail: SwapWalletToSolDetail = {
        mint: token.mint,
        amountInRaw: token.rawAmount,
        amountInUi: token.uiAmount,
        decimals: token.decimals,
        status: "skipped"
      };
      if (token.mint === NATIVE_MINT.toBase58()) {
        details.push({ ...baseDetail, reason: "native-sol" });
        continue;
      }
      if (token.decimals === 0) {
        details.push({ ...baseDetail, reason: "non-fungible" });
        continue;
      }
      if (this.isSwapAllowlistActive() && !this.isSwapAllowed(token.mint)) {
        blocked += 1;
        details.push({ ...baseDetail, reason: "not-allowed" });
        continue;
      }
      if (excludeSet.has(token.mint)) {
        details.push({ ...baseDetail, reason: "excluded" });
        continue;
      }
      const amountIn = token.rawAmountBigint;
      if (amountIn <= 0n) {
        details.push({ ...baseDetail, reason: "invalid-amount" });
        continue;
      }
      if (!isValidU64(amountIn)) {
        details.push({ ...baseDetail, status: "failed", reason: "invalid-amount", error: "amountIn out of u64 range" });
        continue;
      }
      try {
        const quoteResult = await this.fetchJupiterQuoteExactInDetailed(
          token.mint,
          NATIVE_MINT.toBase58(),
          amountIn.toString(),
          this.config.autoSolSlippageBps
        );
        if (!quoteResult.quote) {
          failed += 1;
          details.push({
            ...baseDetail,
            status: "failed",
            reason: quoteResult.error ? "api-error" : "no-quote",
            error: quoteResult.error ?? undefined
          });
          continue;
        }

        const quoteInAmount = parseU64(quoteResult.quote.inAmount ?? amountIn.toString());
        const quoteOutAmount = parseU64(quoteResult.quote.outAmount ?? "0");
        if (!quoteInAmount || !quoteOutAmount) {
          failed += 1;
          details.push({
            ...baseDetail,
            status: "failed",
            reason: "no-quote",
            error: "quote inAmount/outAmount invalid or out of u64 range"
          });
          continue;
        }
        if (quoteInAmount !== amountIn) {
          logger.warn(
            { amountIn: amountIn.toString(), quoteInAmount: quoteInAmount.toString() },
            "jupiter quote inAmount differs from requested amountIn"
          );
        }

        const outAmountNumber = toSafeNumber(quoteOutAmount);
        if (outAmountNumber == null) {
          logger.warn(
            { outAmount: quoteOutAmount.toString() },
            "jupiter quote outAmount exceeds JS safe integer; omitting outLamports"
          );
        }
        if (quoteOutAmount <= 0n) {
          failed += 1;
          details.push({ ...baseDetail, status: "failed", reason: "no-quote", error: "outAmount invalido" });
          continue;
        }
        if (quoteOutAmount < minOutLamportsBigint) {
          failed += 1;
          details.push({
            ...baseDetail,
            status: "failed",
            reason: "below-min",
            outLamports: outAmountNumber ?? undefined
          });
          continue;
        }

        const routePlan = summarizeJupiterRoutePlan(quoteResult.quote);
        logger.info(
          {
            inputMint: token.mint,
            outputMint: NATIVE_MINT.toBase58(),
            amountIn: amountIn.toString(),
            decimals: token.decimals,
            slippageBps: this.config.autoSolSlippageBps,
            excludeDexes: this.config.jupiterExcludeDexes ?? [],
            quoteInAmount: quoteInAmount.toString(),
            quoteOutAmount: quoteOutAmount.toString(),
            routePlan
          },
          "jupiter swap context"
        );

        const swapResult = await this.executeJupiterSwapDetailed(quoteResult.quote);
        if (swapResult.sig) {
          swaps += 1;
          if (outAmountNumber != null) {
            totalOutLamports += outAmountNumber;
          }
          totalOutLamportsBigint += quoteOutAmount;
          details.push({
            ...baseDetail,
            status: "swapped",
            reason: "ok",
            outLamports: outAmountNumber ?? undefined,
            signature: swapResult.sig
          });
        } else {
          failed += 1;
          details.push({
            ...baseDetail,
            status: "failed",
            reason: swapResult.error ? "api-error" : "swap-failed",
            error: swapResult.error ?? undefined,
            outLamports: outAmountNumber ?? undefined
          });
        }
      } catch (err) {
        failed += 1;
        logger.warn({ err, mint: token.mint }, "swap-to-sol failed for token");
        details.push({
          ...baseDetail,
          status: "failed",
          reason: "api-error",
          error: stringifyError(err)
        });
      }
    }

    let finalReason = undefined;
    if (swaps === 0) {
      if (failed > 0) {
        finalReason = "failed";
      } else if (blocked > 0) {
        finalReason = "not-allowed";
      } else {
        finalReason = "no-route";
      }
    }
    logger.info(
      { reason, swaps, failed, totalOutLamports, totalOutLamportsBigint: totalOutLamportsBigint.toString(), finalReason },
      "swap-to-sol complete"
    );
    return { swaps, failed, totalOutLamports, reason: finalReason, details };
  }

  private async updatePortfolioSnapshot(price: number, solUsdPrice: number | null): Promise<void> {
    if (!this.poolState) {
      return;
    }

    const walletBalances = await this.getTokenBalances();
    const positionBalances = this.currentPosition
      ? await this.getPositionTokenAmounts(this.currentPosition)
      : { tokenA: 0, tokenB: 0, feeA: 0, feeB: 0 };

    const totalA = walletBalances.tokenA + positionBalances.tokenA;
    const totalB = walletBalances.tokenB + positionBalances.tokenB;
    const positionValueTokenB = positionBalances.tokenB + positionBalances.tokenA * price;
    const positionFeesTokenB = positionBalances.feeB + positionBalances.feeA * price;

    let feesValueSol: number | null = null;
    if (this.poolState.isTokenBSol) {
      feesValueSol = positionFeesTokenB;
    } else if (this.poolState.isTokenASol && price > 0) {
      feesValueSol = positionBalances.feeA + positionBalances.feeB / price;
    }

    const portfolioValueTokenB = totalB + totalA * price + positionFeesTokenB;

    let portfolioValueSol: number | null = null;
    if (this.poolState.isTokenBSol) {
      portfolioValueSol = totalB + totalA * price + positionFeesTokenB;
    } else if (this.poolState.isTokenASol && price > 0) {
      portfolioValueSol = totalA + totalB / price + (feesValueSol ?? 0);
    }
    const MAX_SANE_PORTFOLIO_SOL = 10_000;
    if (portfolioValueSol != null && portfolioValueSol > MAX_SANE_PORTFOLIO_SOL) {
      logger.error(
        { portfolioValueSol, totalA, totalB, price, feesValueSol },
        "portfolioValueSol absurdo; descartando snapshot de portfolio"
      );
      portfolioValueSol = null;
    }

    this.lastStatus.tokenABalance = walletBalances.tokenA;
    this.lastStatus.tokenBBalance = walletBalances.tokenB;
    this.lastStatus.positionTokenA = positionBalances.tokenA;
    this.lastStatus.positionTokenB = positionBalances.tokenB;
    this.lastStatus.portfolioValue = portfolioValueSol ?? portfolioValueTokenB;

    if (portfolioValueSol != null) {
      if (this.initialPortfolioValueSol === null) {
        this.initialPortfolioValueSol = portfolioValueSol;
      }
      this.lastStatus.pnl = portfolioValueSol - this.initialPortfolioValueSol;
      this.lastStatus.portfolioUsd = solUsdPrice ? portfolioValueSol * solUsdPrice : null;
      if (solUsdPrice) {
        const rawPnlUsd = (portfolioValueSol - this.initialPortfolioValueSol) * solUsdPrice;
        const maxSanePnlUsd = (this.config.budgetUsd ?? 100) * 10;
        if (Math.abs(rawPnlUsd) <= maxSanePnlUsd) {
          this.lastStatus.pnlUsd = rawPnlUsd;
        } else {
          logger.warn({ rawPnlUsd, maxSanePnlUsd }, "pnlUsd descartado por exceder range esperado");
          this.lastStatus.pnlUsd = null;
          this.initialPortfolioValueSol = null;
        }
      } else {
        this.lastStatus.pnlUsd = null;
      }
    } else {
      if (this.initialPortfolioValue === null) {
        this.initialPortfolioValue = portfolioValueTokenB;
      }
      this.lastStatus.pnl = portfolioValueTokenB - this.initialPortfolioValue;
      this.lastStatus.portfolioUsd = null;
      this.lastStatus.pnlUsd = null;
    }

    if (!this.currentPosition) {
      this.lastStatus.positionValue = null;
      this.lastStatus.positionPnl = null;
      this.lastStatus.positionValueUsd = null;
      this.lastStatus.positionPnlUsd = null;
      this.lastStatus.positionEntryUsd = null;
      this.lastStatus.positionFeesUsd = null;
      this.lastPositionValueUsdWithFees = null;
      return;
    }

    let positionValueSol: number | null = null;
    if (this.poolState.isTokenBSol) {
      positionValueSol = positionValueTokenB;
    } else if (this.poolState.isTokenASol && price > 0) {
      positionValueSol = positionBalances.tokenA + positionBalances.tokenB / price;
    }

    let positionValueSolWithFees: number | null = null;
    if (this.poolState.isTokenBSol) {
      positionValueSolWithFees = positionValueTokenB + positionFeesTokenB;
    } else if (this.poolState.isTokenASol && price > 0) {
      positionValueSolWithFees = positionBalances.tokenA + positionBalances.tokenB / price + (feesValueSol ?? 0);
    }

    this.lastStatus.positionValue = positionValueSol ?? positionValueTokenB;
    this.lastStatus.positionValueUsd = positionValueSol != null && solUsdPrice
      ? positionValueSol * solUsdPrice
      : null;

    const positionValueTokenBWithFees = positionValueTokenB + positionFeesTokenB;
    if (positionValueSolWithFees != null) {
      if (this.initialPositionValueSol === null) {
        // Correção Bug 2: validar que o valor inicial é razoável antes de usar como anchor.
        // Se positionValueSolWithFees for absurdo (> 1 milhão de SOL), ignorar e aguardar.
        if (positionValueSolWithFees > 0 && positionValueSolWithFees < 1_000_000) {
          this.initialPositionValueSol = positionValueSolWithFees;
        }
      }
      if (this.initialPositionValueSol !== null) {
        this.lastStatus.positionPnl = positionValueSolWithFees - this.initialPositionValueSol;
      } else {
        this.lastStatus.positionPnl = null;
      }
    } else {
      if (this.initialPositionValue === null) {
        // Correção Bug 2: validar magnitude antes de usar como anchor.
        if (positionValueTokenBWithFees > 0 && positionValueTokenBWithFees < 1_000_000_000) {
          this.initialPositionValue = positionValueTokenBWithFees;
        }
      }
      if (this.initialPositionValue !== null) {
        this.lastStatus.positionPnl = positionValueTokenBWithFees - this.initialPositionValue;
      } else {
        this.lastStatus.positionPnl = null;
      }
    }
    const pnlBasis = positionValueSolWithFees != null ? portfolioValueSol : portfolioValueTokenB;
    if (this.lastStatus.positionPnl != null && !isMagnitudeSane(this.lastStatus.positionPnl, pnlBasis)) {
      logger.warn({ pnl: this.lastStatus.positionPnl, basis: pnlBasis }, "position pnl out of expected range");
      this.lastStatus.positionPnl = null;
    }

    this.lastStatus.positionFeesUsd = (feesValueSol != null && solUsdPrice)
      ? feesValueSol * solUsdPrice
      : null;
    const budgetUsd = this.config.budgetUsd ?? null;
    const portfolioUsd = this.lastStatus.portfolioUsd ?? null;
    if (this.lastStatus.positionFeesUsd != null
      && !isEntryUsdSane(this.lastStatus.positionFeesUsd, budgetUsd, portfolioUsd)) {
      this.lastStatus.positionFeesUsd = null;
    }

    const positionValueUsdWithFees = positionValueSolWithFees != null && solUsdPrice
      ? positionValueSolWithFees * solUsdPrice
      : null;

    this.lastPositionValueUsdWithFees = positionValueUsdWithFees;

    if (positionValueUsdWithFees != null) {
      if (this.positionEntryUsd != null
        && !isEntryUsdSane(this.positionEntryUsd, budgetUsd, portfolioUsd, {
          minBudgetFactor: MIN_ENTRY_BUDGET_FACTOR
        })) {
        this.positionEntryUsd = null;
      }
      if (this.positionEntryUsd == null) {
        if (isEntryUsdSane(positionValueUsdWithFees, budgetUsd, portfolioUsd, {
          minBudgetFactor: MIN_ENTRY_BUDGET_FACTOR
        })) {
          this.positionEntryUsd = positionValueUsdWithFees;
        }
      }
      if (this.positionEntryUsd != null) {
        this.lastStatus.positionEntryUsd = this.positionEntryUsd;
        this.lastStatus.positionPnlUsd = positionValueUsdWithFees - this.positionEntryUsd;
      } else {
        this.lastStatus.positionEntryUsd = null;
        this.lastStatus.positionPnlUsd = null;
      }
    } else {
      this.lastStatus.positionEntryUsd = null;
      this.lastStatus.positionPnlUsd = null;
    }
    if (this.lastStatus.positionPnlUsd != null
      && !isUsdMagnitudeSane(this.lastStatus.positionPnlUsd, budgetUsd, portfolioUsd)) {
      logger.warn(
        { pnlUsd: this.lastStatus.positionPnlUsd, budgetUsd, portfolioUsd },
        "position pnl usd out of expected range"
      );
      this.lastStatus.positionPnlUsd = null;
    }
  }

  private async getPositionTokenAmounts(position: any): Promise<{ tokenA: number; tokenB: number; feeA: number; feeB: number }> {
    if (!this.poolState) {
      return { tokenA: 0, tokenB: 0, feeA: 0, feeB: 0 };
    }

    if (typeof position.refreshData === "function") {
      try {
        await position.refreshData();
      } catch (err) {
        logger.warn({ err }, "failed to refresh position data");
      }
    }
    const data = position.getData?.() ?? position.getData;
    if (!data) {
      return { tokenA: 0, tokenB: 0, feeA: 0, feeB: 0 };
    }

    const poolData = this.poolState.pool.getData();
    const tokenExtensionCtx = await whirlpools.TokenExtensionUtil.buildTokenExtensionContext(
      this.ctx.fetcher,
      poolData,
      whirlpools.IGNORE_CACHE
    );

    const quote = whirlpools.decreaseLiquidityQuoteByLiquidityWithParams({
      liquidity: data.liquidity,
      slippageTolerance: common.Percentage.fromFraction(0, 10_000),
      tickLowerIndex: data.tickLowerIndex,
      tickUpperIndex: data.tickUpperIndex,
      sqrtPrice: poolData.sqrtPrice,
      tickCurrentIndex: poolData.tickCurrentIndex,
      tokenExtensionCtx
    });

    const tokenA = toNumber(common.DecimalUtil.fromBN(quote.tokenEstA, this.poolState.decimalsA));
    const tokenB = toNumber(common.DecimalUtil.fromBN(quote.tokenEstB, this.poolState.decimalsB));
    const feesQuote = await this.getCollectFeesQuote(data, poolData, tokenExtensionCtx);
    let feeA = 0;
    let feeB = 0;
    if (feesQuote) {
      const rawFeeA = feesQuote.feeOwedA ?? feesQuote.feeA ?? feesQuote.fee_a ?? 0;
      const rawFeeB = feesQuote.feeOwedB ?? feesQuote.feeB ?? feesQuote.fee_b ?? 0;
      feeA = toUiAmount(rawFeeA, this.poolState.decimalsA);
      feeB = toUiAmount(rawFeeB, this.poolState.decimalsB);
    } else {
      const rawFeeA = data.feeOwedA ?? data.feesOwedA ?? data.feeOwedTokenA ?? data.feeOwed0 ?? 0;
      const rawFeeB = data.feeOwedB ?? data.feesOwedB ?? data.feeOwedTokenB ?? data.feeOwed1 ?? 0;
      feeA = normalizeTokenAmount(rawFeeA, this.poolState.decimalsA);
      feeB = normalizeTokenAmount(rawFeeB, this.poolState.decimalsB);
    }
    const maxSaneFeeA = Math.max(tokenA * 10, 1);
    const maxSaneFeeB = Math.max(tokenB * 10, 1);
    if (feeA > maxSaneFeeA) {
      logger.warn({ rawFeeA: feeA, maxSaneFeeA, decimalsA: this.poolState.decimalsA }, "feeA fora do range; descartando");
      feeA = 0;
    }
    if (feeB > maxSaneFeeB) {
      logger.warn({ rawFeeB: feeB, maxSaneFeeB, decimalsB: this.poolState.decimalsB }, "feeB fora do range; descartando");
      feeB = 0;
    }
    return { tokenA, tokenB, feeA, feeB };
  }

  private async getCollectFeesQuote(positionData: any, poolData: any, tokenExtensionCtx: any): Promise<any | null> {
    if (!this.poolState) {
      return null;
    }
    if (typeof (whirlpools as any).collectFeesQuote !== "function") {
      return null;
    }

    const programId = (whirlpools as any).ORCA_WHIRLPOOL_PROGRAM_ID ?? (whirlpools as any).WHIRLPOOL_PROGRAM_ID;
    if (!programId) {
      return null;
    }

    const tickLowerIndex = positionData?.tickLowerIndex;
    const tickUpperIndex = positionData?.tickUpperIndex;
    const tickSpacing = poolData?.tickSpacing ?? this.poolState.tickSpacing;
    if (tickLowerIndex == null || tickUpperIndex == null || tickSpacing == null) {
      return null;
    }

    try {
      const [tickLower, tickUpper] = await Promise.all([
        this.getTickData(tickLowerIndex, tickSpacing, programId),
        this.getTickData(tickUpperIndex, tickSpacing, programId)
      ]);
      if (!tickLower || !tickUpper) {
        return null;
      }
      return (whirlpools as any).collectFeesQuote({
        whirlpool: poolData,
        position: positionData,
        tickLower,
        tickUpper,
        tokenExtensionCtx
      });
    } catch (err) {
      logger.warn({ err }, "failed to compute collectFeesQuote");
      return null;
    }
  }

  private async getTickData(tickIndex: number, tickSpacing: number, programId: PublicKey): Promise<any | null> {
    if (!this.poolState) {
      return null;
    }
    if (!this.ctx?.fetcher) {
      return null;
    }
    const poolAddress = this.poolState.poolAddress;
    let tickArrayPda: any;
    try {
      if (typeof (whirlpools as any).TickUtil?.getPdaWithTickIndex === "function") {
        tickArrayPda = (whirlpools as any).TickUtil.getPdaWithTickIndex(
          tickIndex,
          tickSpacing,
          poolAddress,
          programId
        );
      } else if (typeof (whirlpools as any).PDAUtil?.getTickArrayFromTickIndex === "function") {
        tickArrayPda = (whirlpools as any).PDAUtil.getTickArrayFromTickIndex(
          tickIndex,
          tickSpacing,
          poolAddress,
          programId
        );
      } else if (typeof (whirlpools as any).PDAUtil?.getTickArray === "function"
        && typeof (whirlpools as any).TickUtil?.getStartTickIndex === "function") {
        const startTick = (whirlpools as any).TickUtil.getStartTickIndex(tickIndex, tickSpacing);
        tickArrayPda = (whirlpools as any).PDAUtil.getTickArray(
          programId,
          poolAddress,
          startTick
        );
      } else {
        return null;
      }
      const tickArrayAddress = tickArrayPda?.publicKey ?? tickArrayPda;
      const ignoreCache = (whirlpools as any).IGNORE_CACHE;
      const tickArray = await this.ctx.fetcher.getTickArray(tickArrayAddress, ignoreCache);
      const tickArrayData = tickArray?.getData?.() ?? tickArray;
      if (!tickArrayData) {
        return null;
      }
      if (typeof (whirlpools as any).TickUtil?.getTickFromTickArrayData === "function") {
        return (whirlpools as any).TickUtil.getTickFromTickArrayData(
          tickArrayData,
          tickIndex,
          tickSpacing
        );
      }
      if (typeof (whirlpools as any).TickArrayUtil?.getTickFromArray === "function") {
        return (whirlpools as any).TickArrayUtil.getTickFromArray(
          tickArrayData,
          tickIndex,
          tickSpacing
        );
      }
      return null;
    } catch (err) {
      logger.warn({ err }, "failed to fetch tick data");
      return null;
    }
  }

  private getTicksForRange(range: Range, referencePrice: number): { lowerTick: number; upperTick: number } {
    if (!this.poolState) {
      throw new Error("poolState not initialized");
    }

    const lowerIndex = whirlpools.PriceMath.priceToTickIndex(
      new Decimal(range.lower),
      this.poolState.decimalsA,
      this.poolState.decimalsB
    );
    const upperIndex = whirlpools.PriceMath.priceToTickIndex(
      new Decimal(range.upper),
      this.poolState.decimalsA,
      this.poolState.decimalsB
    );

    const referenceTickIndex = whirlpools.PriceMath.priceToTickIndex(
      new Decimal(referencePrice),
      this.poolState.decimalsA,
      this.poolState.decimalsB
    );

    return alignTickRangeToSpacing(lowerIndex, upperIndex, this.poolState.tickSpacing, {
      preferredSide: this.lastStatus.effectiveExitSide,
      referenceTickIndex
    });
  }

  private async executeTx(
    tx: any,
    label: string
  ): Promise<{ ok: boolean; sig: string | null; feeLamports: number | null }> {
    if (this.config.dryRun) {
      logger.info({ label }, "dry-run enabled; skipping transaction execution");
      return { ok: false, sig: null, feeLamports: null };
    }

    if (typeof tx.buildAndExecute === "function") {
      const sigResult = await tx.buildAndExecute();
      const sig = sigResult ? String(sigResult) : null;
      logger.info({ label, sig }, "transaction executed");
      const feeLamports = sig ? await this.fetchTxFeeLamports(sig) : null;
      this.addActionFee(feeLamports);
      return { ok: true, sig, feeLamports };
    }

    if (typeof tx.execute === "function") {
      const sigResult = await tx.execute();
      const sig = sigResult ? String(sigResult) : null;
      logger.info({ label, sig }, "transaction executed");
      const feeLamports = sig ? await this.fetchTxFeeLamports(sig) : null;
      this.addActionFee(feeLamports);
      return { ok: true, sig, feeLamports };
    }

    throw new Error("Unsupported transaction object; update src/orca.ts for your SDK version");
  }

  private toRawAmountString(amountUi: number, decimals: number): string | null {
    if (!Number.isFinite(amountUi) || amountUi <= 0) {
      return null;
    }
    if (!Number.isFinite(decimals) || decimals < 0) {
      return null;
    }
    const raw = common.DecimalUtil.toBN(new Decimal(amountUi), decimals);
    const text = raw?.toString?.() ?? String(raw);
    if (!text || text === "0") {
      return null;
    }
    return text;
  }

  private async maybeSwapFeesToUsdc(feeA: number, feeB: number): Promise<void> {
    if (!this.poolState) {
      return;
    }
    if (!this.config.jupiterApiKey) {
      logger.warn("swap-fees-to-usdc skipped: missing Jupiter API key");
      return;
    }

    const targetMint = (this.config.autoSwapFeesToUsdcTargetMint || "").trim();
    if (!targetMint) {
      logger.warn("swap-fees-to-usdc skipped: target mint not set");
      return;
    }

    const nativeSol = (await this.connection.getBalance(this.wallet.publicKey)) / LAMPORTS_PER_SOL;
    const availableSol = Math.max(0, nativeSol - this.config.minSolBalance);

    const candidates = [
      {
        mint: this.poolState.tokenMintA.toBase58(),
        decimals: this.poolState.decimalsA,
        uiAmount: feeA
      },
      {
        mint: this.poolState.tokenMintB.toBase58(),
        decimals: this.poolState.decimalsB,
        uiAmount: feeB
      }
    ];

    for (const token of candidates) {
      if (!Number.isFinite(token.uiAmount) || token.uiAmount <= 0) {
        continue;
      }
      if (token.mint === targetMint) {
        continue;
      }
      if (this.isSwapAllowlistActive() && !this.isSwapAllowed(token.mint)) {
        logger.info({ mint: token.mint }, "swap-fees-to-usdc skipped: mint not allowed");
        continue;
      }
      let amountUi = token.uiAmount;
      if (token.mint === NATIVE_MINT.toBase58()) {
        if (availableSol <= 0) {
          continue;
        }
        amountUi = Math.min(amountUi, availableSol);
        if (amountUi <= 0) {
          continue;
        }
      }
      const amountRaw = this.toRawAmountString(amountUi, token.decimals);
      if (!amountRaw) {
        continue;
      }

      const quote = await this.fetchJupiterQuoteExactIn(
        token.mint,
        targetMint,
        amountRaw,
        this.config.autoSolSlippageBps
      );
      if (!quote) {
        continue;
      }
      // Guard: verifica se o retorno bruto do swap cobre o mínimo configurado.
      // outAmount do Jupiter para USDC/USDT já é em decimais do token (6 casas).
      // Para outros tokens, usa o preço SOL/USD como referência se disponível.
      const minUsd = Number(this.config.autoSwapFeesToUsdcMinUsd ?? 0);
      if (minUsd > 0) {
        const rawOut = Number(quote.outAmount ?? 0);
        if (rawOut <= 0) {
          logger.info(
            { mint: token.mint, minUsd },
            "swap-fees-to-usdc skipped: outAmount zero"
          );
          continue;
        }
        // Tenta estimar o valor em USD do retorno.
        // Se o outputMint for USDC/USDT (6 decimais), a conversão é direta.
        // Para outros casos, usa 6 decimais como aproximação conservadora.
        const outDecimals = targetMint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
          || targetMint === "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
          ? 6
          : 6; // fallback conservador — ajuste se usar outro token alvo
        const outUsd = rawOut / Math.pow(10, outDecimals);
        if (outUsd < minUsd) {
          logger.info(
            { mint: token.mint, outUsd: outUsd.toFixed(4), minUsd },
            "swap-fees-to-usdc skipped: retorno abaixo do minimo configurado"
          );
          continue;
        }
      }

      const sig = await this.executeJupiterSwap(quote);
      if (sig) {
        logger.info(
          { mint: token.mint, outMint: targetMint, amountRaw },
          "swap-fees-to-usdc executed"
        );
      }
    }
  }

  /**
   * Transfere o saldo de stablecoin (targetMint) para a carteira destino
   * configurada em autoSwapFeesToUsdcDestWallet, após o swap das fees.
   * Só é chamado se autoSwapFeesToUsdcDestWallet estiver definido.
   */
  private async readTargetMintBalance(targetMint: string): Promise<bigint> {
    try {
      const mintPubkey = new PublicKey(targetMint);
      const sourceAta = getAssociatedTokenAddressSync(mintPubkey, this.wallet.publicKey);
      const accountInfo = await getAccount(this.connection, sourceAta);
      return accountInfo.amount ?? 0n;
    } catch {
      return 0n;
    }
  }

  private async maybeTransferFeesToDestWallet(preBalance: bigint): Promise<void> {
    const destWalletStr = (this.config.autoSwapFeesToUsdcDestWallet ?? "").trim();
    if (!destWalletStr) {
      return;
    }

    const targetMint = (this.config.autoSwapFeesToUsdcTargetMint || "").trim();
    if (!targetMint) {
      return;
    }

    let destPubkey: PublicKey;
    try {
      destPubkey = new PublicKey(destWalletStr);
    } catch {
      logger.warn({ dest: destWalletStr }, "transfer-fees: endereço destino inválido");
      return;
    }

    try {
      const mintPubkey = new PublicKey(targetMint);
      const sourceAta = getAssociatedTokenAddressSync(mintPubkey, this.wallet.publicKey);
      const destAta = getAssociatedTokenAddressSync(mintPubkey, destPubkey);

      // Lê saldo atual da ATA de origem
      let postBalance = 0n;
      try {
        const accountInfo = await getAccount(this.connection, sourceAta);
        postBalance = accountInfo.amount ?? 0n;
      } catch {
        // Conta não existe ou saldo zero — nada a transferir
        return;
      }

      if (postBalance <= 0n) {
        return;
      }

      const delta = postBalance - (preBalance ?? 0n);
      if (delta <= 0n) {
        logger.info(
          { preBalance: preBalance?.toString(), postBalance: postBalance.toString(), targetMint },
          "transfer-fees-to-dest-wallet: transfer skipped (zero delta)"
        );
        return;
      }

      // Decimais para estimar USD
      let decimals = 6;
      try {
        const mintInfo = await getMint(this.connection, mintPubkey);
        decimals = Number(mintInfo.decimals ?? 6);
      } catch {
        // fallback permanece 6
      }

      const minUsd = Number(this.config.autoSwapFeesToUsdcMinUsd ?? 0);
      if (minUsd > 0) {
        const deltaUsd = Number(delta) / Math.pow(10, Math.max(0, decimals));
        if (!(Number.isFinite(deltaUsd) && deltaUsd >= minUsd)) {
          logger.info(
            { preBalance: preBalance?.toString(), postBalance: postBalance.toString(), delta: delta.toString(), minUsd, targetMint },
            "transfer-fees-to-dest-wallet: transfer skipped (delta below minUsd)"
          );
          return;
        }
      }

      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: this.wallet.publicKey, recentBlockhash: blockhash });

      // Cria a ATA de destino se ainda não existir
      let destAtaExists = false;
      try {
        await getAccount(this.connection, destAta);
        destAtaExists = true;
      } catch {
        destAtaExists = false;
      }

      if (!destAtaExists) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            this.wallet.publicKey, // payer
            destAta,               // ata a criar
            destPubkey,            // owner da ata
            mintPubkey             // mint
          )
        );
      }

      // Instrução de transferência
      tx.add(
        createTransferInstruction(
          sourceAta,             // origem
          destAta,               // destino
          this.wallet.publicKey, // authority
          delta                  // quantidade (raw)
        )
      );

      const signed = await this.wallet.signTransaction(tx);
      const sig = await this.connection.sendRawTransaction(signed.serialize(), { maxRetries: 2 });
      await this.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

      logger.info(
        {
          mint: targetMint,
          dest: destWalletStr,
          preBalance: preBalance?.toString(),
          postBalance: postBalance.toString(),
          delta: delta.toString(),
          sig
        },
        "transfer-fees-to-dest-wallet: transferência concluída"
      );
    } catch (err) {
      logger.warn({ err, dest: destWalletStr }, "transfer-fees-to-dest-wallet: falhou");
    }
  }

  private resetActionFee(): void {
    this.actionFeeLamports = null;
    this.lastStatus.lastActionFeeLamports = null;
  }

  private resetPositionAnchors(): void {
    this.initialPositionValue = null;
    this.initialPositionValueSol = null;
    this.positionEntryUsd = null;
    this.lastPositionValueUsdWithFees = null;
    this.lastStatus.positionEntryUsd = null;
    this.lastStatus.positionPnlUsd = null;
  }

  private addActionFee(feeLamports: number | null): void {
    if (feeLamports == null) {
      return;
    }
    this.actionFeeLamports = (this.actionFeeLamports ?? 0) + feeLamports;
    this.lastStatus.lastActionFeeLamports = this.actionFeeLamports;
  }

  private async fetchTxFeeLamports(signature: string): Promise<number | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const tx = await this.connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0
        });
        if (tx?.meta?.fee != null) {
          return tx.meta.fee;
        }
      } catch (err) {
        logger.warn({ err, signature }, "failed to fetch transaction fee");
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
    return null;
  }
}

function normalizeTokenAmount(raw: any, decimals: number): number {
  if (raw == null) {
    return 0;
  }
  if (typeof raw === "number") {
    return raw;
  }
  if (typeof raw === "bigint") {
    return Number(raw) / 10 ** decimals;
  }
  if (typeof raw === "string") {
    const num = Number(raw);
    return Number.isFinite(num) ? num / 10 ** decimals : 0;
  }
  if (typeof raw?.toArrayLike === "function") {
    return toNumber(common.DecimalUtil.fromBN(raw, decimals));
  }
  if (typeof raw?.toNumber === "function" && typeof raw?.toFixed === "function") {
    return raw.toNumber();
  }
  return toNumber(raw);
}

function applyPctToBigInt(amount: bigint, pct: number): bigint {
  if (!Number.isFinite(pct) || pct <= 0) {
    return 0n;
  }
  if (pct >= 1) {
    return amount;
  }
  const scale = 1_000_000n;
  const pctScaled = BigInt(Math.max(0, Math.round(pct * 1_000_000)));
  if (pctScaled <= 0n) {
    return 0n;
  }
  const result = (amount * pctScaled) / scale;
  return result > 0n ? result : 0n;
}

function scaleInputAmount(maxInput: bigint, outAmount: bigint, targetOut: bigint): bigint {
  if (outAmount <= 0n || targetOut <= 0n) {
    return 0n;
  }
  const result = (maxInput * targetOut) / outAmount;
  return result > 0n ? result : 0n;
}

function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}


function toNumber(value: any): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value?.toNumber === "function") {
    return value.toNumber();
  }
  if (typeof value?.toString === "function") {
    return Number(value.toString());
  }
  return Number(value);
}

function extractQuoteAmounts(
  quote: any,
  decimalsA: number,
  decimalsB: number
): { requiredA: number; requiredB: number } {
  const tokenA = quote.tokenMaxA ?? quote.tokenEstA ?? quote.tokenA ?? 0;
  const tokenB = quote.tokenMaxB ?? quote.tokenEstB ?? quote.tokenB ?? 0;
  return {
    requiredA: toUiAmount(tokenA, decimalsA),
    requiredB: toUiAmount(tokenB, decimalsB)
  };
}

function toUiAmount(value: any, decimals: number): number {
  if (value == null) {
    return 0;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 1000 && decimals > 0) {
      return value / 10 ** decimals;
    }
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value) / 10 ** decimals;
  }
  if (Decimal?.isDecimal?.(value)) {
    return value.toNumber();
  }
  try {
    const dec = common.DecimalUtil.fromBN(value, decimals);
    return toNumber(dec);
  } catch {
    return toNumber(value);
  }
}

function isEntryUsdSane(
  entryUsd: number,
  budgetUsd: number | null,
  portfolioUsd: number | null,
  options?: { minBudgetFactor?: number }
): boolean {
  if (!Number.isFinite(entryUsd) || entryUsd < 0 || Math.abs(entryUsd) > MAX_USD_SANITY) {
    return false;
  }
  const budget = Number.isFinite(budgetUsd ?? NaN) ? Number(budgetUsd) : null;
  const portfolio = Number.isFinite(portfolioUsd ?? NaN) ? Number(portfolioUsd) : null;
  const minBudgetFactor = Number.isFinite(options?.minBudgetFactor ?? NaN)
    ? Number(options?.minBudgetFactor)
    : null;
  if (budget != null && budget > 0 && minBudgetFactor != null && minBudgetFactor > 0) {
    if (entryUsd < budget * minBudgetFactor) {
      return false;
    }
  }
  if (budget != null && budget > 0 && entryUsd > budget * 10) {
    return false;
  }
  if (portfolio != null && portfolio > 0 && entryUsd > portfolio * 10) {
    return false;
  }
  if ((budget == null || budget <= 0) && (portfolio == null || portfolio <= 0) && entryUsd > 1_000_000) {
    return false;
  }
  return true;
}

function isMagnitudeSane(value: number, reference: number | null, maxFactor = 10, maxFallback = 1_000_000): boolean {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_USD_SANITY) {
    return false;
  }
  const abs = Math.abs(value);
  if (reference != null && reference > 0) {
    return abs <= reference * maxFactor;
  }
  return abs <= maxFallback;
}

function isUsdMagnitudeSane(value: number, budgetUsd: number | null, portfolioUsd: number | null): boolean {
  const budget = Number.isFinite(budgetUsd ?? NaN) ? Number(budgetUsd) : null;
  const portfolio = Number.isFinite(portfolioUsd ?? NaN) ? Number(portfolioUsd) : null;
  const reference = Math.max(budget ?? 0, portfolio ?? 0) || null;
  return isMagnitudeSane(value, reference);
}

const MAX_U64 = 18_446_744_073_709_551_615n;

function isValidU64(value: bigint): boolean {
  return value > 0n && value <= MAX_U64;
}

function parseU64(value: unknown): bigint | null {
  if (value == null) {
    return null;
  }
  try {
    const parsed = BigInt(value as any);
    return isValidU64(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toSafeNumber(value: bigint): number | null {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(value);
}

function toRawAmount(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0n;
  }
  const factor = Math.pow(10, Math.max(0, decimals));
  return BigInt(Math.floor(amount * factor));
}

function summarizeJupiterRoutePlan(quote: any): Array<{ label: string | null; ammKey: string | null; inMint: string | null; outMint: string | null }> {
  const plan = Array.isArray(quote?.routePlan) ? quote.routePlan : [];
  return plan.map((step: any) => {
    const info = step?.swapInfo ?? step?.swap ?? step ?? {};
    const label = info?.label ?? info?.ammName ?? info?.ammLabel ?? null;
    const ammKey = info?.ammKey ?? null;
    const inMint = info?.inputMint ?? null;
    const outMint = info?.outputMint ?? null;
    return { label, ammKey, inMint, outMint };
  });
}

function truncateLogs(logs: string[], max = 40): string[] {
  if (!Array.isArray(logs)) {
    return [];
  }
  return logs.slice(0, Math.max(0, max));
}

function formatErrorWithLogs(message: string, logs: string[] | null): string {
  if (!logs || logs.length === 0) {
    return message;
  }
  const truncated = truncateLogs(logs);
  const suffix = logs.length > truncated.length ? " ...[truncated]" : "";
  return `${message} | logs: ${truncated.join(" | ")}${suffix}`;
}

async function extractSendTxLogs(err: unknown): Promise<string[] | null> {
  if (!err || typeof err !== "object") {
    return null;
  }
  const anyErr = err as any;
  if (Array.isArray(anyErr.logs)) {
    return anyErr.logs;
  }
  if (typeof anyErr.getLogs === "function") {
    try {
      const logs = await anyErr.getLogs();
      return Array.isArray(logs) ? logs : null;
    } catch {
      return null;
    }
  }
  if (anyErr.name === "SendTransactionError" && Array.isArray(anyErr?.txLogs)) {
    return anyErr.txLogs;
  }
  return null;
}

function isPriceSlippageError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("0x17b5") || msg.includes("PriceSlippageOutOfBounds");
}

function parseJupiterErrorMessage(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const direct = typeof parsed === "string" ? parsed : null;
    const message = parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? parsed?.msg ?? direct;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

function formatJupiterError(status: number | null, body: string): string {
  const message = parseJupiterErrorMessage(body);
  if (status != null && status > 0) {
    return message ? `HTTP ${status}: ${message}` : `HTTP ${status}`;
  }
  return message ?? "Erro na API";
}

function truncateJupiterError(value: string, max = 160): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}




