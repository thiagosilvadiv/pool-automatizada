import { Connection, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID, NATIVE_MINT } from "@solana/spl-token";
import DecimalJs from "decimal.js";
import * as whirlpoolsSdk from "@orca-so/whirlpools-sdk";
import * as commonSdk from "@orca-so/common-sdk";

import { Config } from "./config.js";
import { logger } from "./logger.js";
import { calculateRange, isPriceOutOfRange, resolveDirectionalExitPreference, Range } from "./strategy.js";
import { alignTickRangeToSpacing } from "./tick-range.js";
import { WalletLike } from "./solana.js";
import { getSolUsdPrice } from "./pyth.js";
import { getTrendSnapshot } from "./trend.js";
import type { TrendDirection, TrendTarget, TrendTimeframe } from "./trend.js";

const whirlpools = whirlpoolsSdk as any;
const common = commonSdk as any;
const Decimal: any = DecimalJs;
const MIN_ENTRY_BUDGET_FACTOR = 0.25;

export type BotContext = {
  connection: Connection;
  wallet: WalletLike;
  config: Config;
  onLowSol?: () => Promise<void>;
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
  private onLowSol?: () => Promise<void>;
  private lastTrendPreferredExitToken: "tokenA" | "tokenB" | null = null;
  private swapAllowlist: Set<string> | null = null;
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
    trendStale: null
  };

  private constructor(ctx: any, client: any, botCtx: BotContext) {
    this.ctx = ctx;
    this.client = client;
    this.connection = botCtx.connection;
    this.wallet = botCtx.wallet;
    this.config = botCtx.config;
    this.onLowSol = botCtx.onLowSol;
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
    await this.refreshPoolState();
    const trendSnapshot = await this.updateTrendStatus();
    const preferredExitToken = this.resolvePreferredExitToken(trendSnapshot.direction, trendSnapshot.stale);
    this.lastStatus.trendPreferredExitToken = preferredExitToken;
    const preferredExitDirection = this.config.preferredExitDirection === "up" ? "up" : "down";
    const exitPreference = resolveDirectionalExitPreference(preferredExitToken, preferredExitDirection);
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
      if (finalSol < this.config.minSolBalance) {
        logger.warn({ solBalance: finalSol, reason: topupResult.reason }, "SOL balance below minSolBalance; skipping");
        await this.loadExistingPosition();
        if (this.currentPosition) {
          const price = await this.getCurrentPrice();
          const range = calculateRange(price, this.config.rangeWidthPct, {
            exitBiasPct: this.config.rangeExitBiasPct,
            exitSide,
            valueToken
          });
          const solUsdPrice = await this.tryGetSolUsdPrice();
          this.lastStatus.lastPrice = price;
          this.lastStatus.targetRange = range;
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
    }
    const price = await this.getCurrentPrice();
    const range = calculateRange(price, this.config.rangeWidthPct, {
      exitBiasPct: this.config.rangeExitBiasPct,
      exitSide,
      valueToken
    });
    this.lastStatus.lastPrice = price;
    this.lastStatus.targetRange = range;
    const solUsdPrice = await this.tryGetSolUsdPrice();
    this.lastStatus.solUsdPrice = solUsdPrice;
    this.lastStatus.budgetUsd = this.config.budgetUsd;
    this.lastStatus.budgetSol = solUsdPrice && this.config.budgetUsd
      ? this.config.budgetUsd / solUsdPrice
      : null;
    await this.updatePortfolioSnapshot(price, solUsdPrice);

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

      logger.info({ price, range }, "no active position found; opening new position");
      const result = await this.openPosition(range, price, solUsdPrice);
      this.lastStatus.lastAction = result;
      if (result === "open-position") {
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
    if (!outOfRange) {
      logger.info({ price, positionRange }, "price within range; no action");
      this.outOfRangeSince = null;
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

    logger.info({ price, positionRange }, "price out of range; rebalancing");
    this.outOfRangeSince = null;
    await this.updatePortfolioSnapshot(price, solUsdPrice);
    this.captureCloseSnapshot();
    await this.closePosition(this.currentPosition);
    this.currentPosition = null;
    this.currentPositionMint = null;
    this.missingPositionSince = null;
    await this.loadExistingPosition();
    if (this.currentPosition) {
      logger.error({ price, positionRange }, "position still open after rebalance close; aborting open");
      this.setError("Fechamento falhou: posição ainda aberta");
      this.lastStatus.lastAction = "close-failed";
      this.lastStatus.positionRange = await this.getPositionRange(this.currentPosition);
      this.lastStatus.positionMint = this.currentPositionMint;
      return this.getStatus();
    }
    const result = await this.openPosition(range, price, solUsdPrice);
    this.lastStatus.lastAction = result === "open-position" ? "rebalanced" : result;
    if (result === "open-position") {
      this.lastRebalanceAt = Date.now();
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
      this.setError("Fechamento falhou: posição ainda aberta");
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
    const valueCapUsd = Number.isFinite(valueCap) && valueCap > 0 ? valueCap : null;
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

    this.resetPositionAnchors();
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

  private async openPosition(range: Range, price: number, solUsdPrice: number | null): Promise<string> {
    if (!this.poolState) {
      throw new Error("poolState not initialized");
    }

    const { lowerTick, upperTick } = this.getTicksForRange(range);
    const slippage = common.Percentage.fromFraction(this.config.slippageBps, 10_000);
    let balances = await this.getTokenBalances();
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
      balances = await this.getTokenBalances();
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

    if (usableA <= 0 && usableB <= 0) {
      logger.warn("insufficient token balances to open position");
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
      logger.warn("unable to build liquidity quote with available balances");
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
        logger.warn({ err, attempt }, "failed to build liquidity quote");
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

    return false;
  }

  private async swap(inputMint: PublicKey, amountIn: number, slippage: any): Promise<boolean> {
    if (!this.poolState) {
      return false;
    }
    if (amountIn <= 0) {
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

  getStatus(): BotStatus {
    return { ...this.lastStatus };
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

  setError(err: unknown): void {
    this.lastStatus.lastError = stringifyError(err);
  }

  setSwapAllowlist(mints: string[]): void {
    const normalized = Array.isArray(mints)
      ? mints.map((mint) => String(mint).trim()).filter((mint) => mint.length > 0)
      : [];
    this.swapAllowlist = normalized.length ? new Set(normalized) : null;
  }

  updateConfig(config: Config): void {
    this.config = config;
    this.outOfRangeSince = null;
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

  private async getTokenBalances(): Promise<{ tokenA: number; tokenB: number }> {
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
        return { sig: null, error: formatJupiterError(res.status, text) };
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
      return { sig: null, error: message };
    }
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
      this.lastStatus.pnlUsd = solUsdPrice
        ? (portfolioValueSol - this.initialPortfolioValueSol) * solUsdPrice
        : null;
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
        this.initialPositionValueSol = positionValueSolWithFees;
      }
      this.lastStatus.positionPnl = positionValueSolWithFees - this.initialPositionValueSol;
    } else {
      if (this.initialPositionValue === null) {
        this.initialPositionValue = positionValueTokenBWithFees;
      }
      this.lastStatus.positionPnl = positionValueTokenBWithFees - this.initialPositionValue;
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

  private getTicksForRange(range: Range): { lowerTick: number; upperTick: number } {
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

    return alignTickRangeToSpacing(lowerIndex, upperIndex, this.poolState.tickSpacing);
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
      const sig = await this.executeJupiterSwap(quote);
      if (sig) {
        logger.info({ mint: token.mint, outMint: targetMint, amountRaw }, "swap-fees-to-usdc executed");
      }
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
    return value;
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
  if (!Number.isFinite(entryUsd) || entryUsd < 0) {
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
  if (!Number.isFinite(value)) {
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

function stringifyError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
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
  return `${text.slice(0, max - 1)}…`;
}
