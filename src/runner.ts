import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { OrcaBot, BotStatus } from "./orca.js";
import { Config } from "./config.js";
import { withRetry } from "./retry.js";
import { logger } from "./logger.js";
import { HistoryStore } from "./storage.js";
import { HedgeManager, HedgeCloseResult, HedgeState } from "./hedge.js";

const MIN_ENTRY_BUDGET_FACTOR = 0.25;

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

function resolveActionType(action: string | null): string | null {
  if (!action) {
    return null;
  }
  switch (action) {
    case "open-position":
      return "abertura";
    case "close-position":
      return "fechamento";
    case "rebalanced":
      return "fechamento";
    case "resume-position":
    case "skip-low-sol-position":
      return "monitorando";
    case "swap":
    case "manual-sol-topup":
    case "auto-sol-topup":
    case "manual-swap-to-sol":
      return "operacional";
    default:
      return "operacional";
  }
}

export type RunnerStatus = BotStatus & {
  running: boolean;
  lastTickAt: string | null;
  hedgeActive: boolean;
  hedgeSymbol: string | null;
  hedgeNotionalUsd: number | null;
  hedgeLeverage: number | null;
  hedgeOpenedAt: string | null;
  hedgeLastError: string | null;
};

export type HistoryEvent = {
  id: string;
  timestamp: string;
  positionOpenedAt: string | null;
  positionClosedAt: string | null;
  actionType: string | null;
  action: string | null;
  trendDirection: "up" | "down" | null;
  price: number | null;
  solUsdPrice: number | null;
  budgetUsd: number | null;
  budgetSol: number | null;
  targetRange: BotStatus["targetRange"];
  positionRange: BotStatus["positionRange"];
  positionMint: string | null;
  tokenABalance: number | null;
  tokenBBalance: number | null;
  positionTokenA: number | null;
  positionTokenB: number | null;
  openTokenA: number | null;
  openTokenB: number | null;
  closeTokenA: number | null;
  closeTokenB: number | null;
  positionEntryUsd: number | null;
  positionFeesUsd: number | null;
  positionPnlUsd: number | null;
  positionExitUsd: number | null;
  txFeeLamports: number | null;
  txFeeUsd: number | null;
  portfolioValue: number | null;
  pnl: number | null;
  portfolioUsd: number | null;
  pnlUsd: number | null;
  pnlDelta: number | null;
  pnlDeltaUsd: number | null;
  hedgeSymbol: string | null;
  hedgeNotionalUsd: number | null;
  hedgeLeverage: number | null;
  hedgePnlUsd: number | null;
};

export class BotRunner {
  private bot: OrcaBot;
  private config: Config;
  private historyStore: HistoryStore;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inFlight = false;
  private lastTickAt: string | null = null;
  private history: HistoryEvent[] = [];
  private lastEventPortfolioValue: number | null = null;
  private lastEventPortfolioUsd: number | null = null;
  private historyLoaded = false;
  private eventIdSeed = Math.floor(Math.random() * 1_000_000);
  private openedAtByMint = new Map<string, string>();
  private entryByMint = new Map<string, number>();
  private trendByMint = new Map<string, "up" | "down">();
  private hedgeManager: HedgeManager;
  private lastHedgeClose: HedgeCloseResult | null = null;
  private pendingClose = false;
  private pendingCloseRequestedAt: string | null = null;

  constructor(bot: OrcaBot, config: Config, options: { historyStore: HistoryStore }) {
    this.bot = bot;
    this.config = config;
    this.historyStore = options.historyStore;
    this.hedgeManager = new HedgeManager(config);
  }

  async init(): Promise<void> {
    await this.loadHistoryIfNeeded();
    const synced = await this.hedgeManager.syncFromBybit();
    if (synced) {
      await this.saveHistory();
    }
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    await this.loadHistoryIfNeeded();
    this.running = true;
    await this.tickOnce();
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async closePositionNow(): Promise<RunnerStatus> {
    if (this.inFlight) {
      this.pendingClose = true;
      this.pendingCloseRequestedAt = new Date().toISOString();
      logger.info({ pendingCloseRequestedAt: this.pendingCloseRequestedAt }, "close requested during tick; pending");
      return this.getStatus();
    }
    return this.performClose("manual");
  }

  async topUpSolNow(): Promise<{ ok: boolean; reason?: string; status: RunnerStatus }> {
    if (this.inFlight) {
      return { ok: false, reason: "busy", status: this.getStatus() };
    }
    this.inFlight = true;
    try {
      const result = await this.bot.topUpSolNow();
      this.lastTickAt = new Date().toISOString();
      this.recordEvent(this.bot.getStatus());
      return { ok: result.ok, reason: result.reason, status: this.getStatus() };
    } catch (err) {
      logger.error({ err }, "topup-sol failed");
      this.bot.setError(err);
      return { ok: false, reason: err instanceof Error ? err.message : String(err), status: this.getStatus() };
    } finally {
      this.inFlight = false;
    }
  }

  async swapWalletToSolNow(): Promise<{ ok: boolean; reason?: string; swaps: number; failed: number; totalOutLamports: number; details: any[]; status: RunnerStatus }> {
    if (this.inFlight) {
      return { ok: false, reason: "busy", swaps: 0, failed: 0, totalOutLamports: 0, details: [], status: this.getStatus() };
    }
    this.inFlight = true;
    try {
      const result = await this.bot.swapWalletToSolNow();
      this.lastTickAt = new Date().toISOString();
      if (result.swaps > 0) {
        this.recordEvent(this.bot.getStatus());
      }
      return {
        ok: result.ok,
        reason: result.reason,
        swaps: result.swaps,
        failed: result.failed,
        totalOutLamports: result.totalOutLamports,
        details: result.details ?? [],
        status: this.getStatus()
      };
    } catch (err) {
      logger.error({ err }, "swap-wallet-to-sol failed");
      this.bot.setError(err);
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
        swaps: 0,
        failed: 0,
        totalOutLamports: 0,
        details: [],
        status: this.getStatus()
      };
    } finally {
      this.inFlight = false;
    }
  }

  getStatus(): RunnerStatus {
    const status = this.bot.getStatus();
    const hedgeState = this.hedgeManager.getState();
    return {
      ...status,
      running: this.running,
      lastTickAt: this.lastTickAt,
      hedgeActive: Boolean(hedgeState?.active),
      hedgeSymbol: hedgeState?.symbol ?? null,
      hedgeNotionalUsd: hedgeState?.notionalUsd ?? null,
      hedgeLeverage: hedgeState?.leverage ?? null,
      hedgeOpenedAt: hedgeState?.openedAt ?? null,
      hedgeLastError: this.hedgeManager.getLastError()
    };
  }

  updateConfig(config: Config): void {
    const prevInterval = this.config.pollIntervalMs;
    this.config = config;
    this.bot.updateConfig(config);
    this.hedgeManager.updateConfig(config);
    if (this.running && prevInterval !== config.pollIntervalMs) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.schedule();
    }
  }

  updateSwapAllowlist(mints: string[]): void {
    this.bot.setSwapAllowlist(mints);
  }

  getHistory(): HistoryEvent[] {
    return [...this.history].reverse();
  }

  async clearHistory(): Promise<void> {
    this.history = [];
    this.lastEventPortfolioValue = null;
    this.lastEventPortfolioUsd = null;
    this.entryByMint = new Map();
    this.trendByMint = new Map();
    await this.saveHistory();
  }

  async deleteHistoryEvents(ids: string[]): Promise<void> {
    if (!ids.length) {
      return;
    }
    const toDelete = new Set(ids);
    const next = this.history.filter((event) => !toDelete.has(event.id));
    if (next.length === this.history.length) {
      return;
    }
    this.history = next;
    this.recalculateLastEventValues();
    const entryByMint = new Map<string, number>();
    for (const item of this.history) {
      if (item.positionMint && typeof item.positionEntryUsd === "number") {
        if (isEntryUsdSane(item.positionEntryUsd, item.budgetUsd ?? null, item.portfolioUsd ?? null, {
          minBudgetFactor: MIN_ENTRY_BUDGET_FACTOR
        })) {
          entryByMint.set(item.positionMint, item.positionEntryUsd);
        }
      }
    }
    const trendByMint = new Map<string, "up" | "down">();
    for (const item of this.history) {
      if (!item.positionMint) {
        continue;
      }
      if (item.action === "open-position" && (item.trendDirection === "up" || item.trendDirection === "down")) {
        trendByMint.set(item.positionMint, item.trendDirection);
      }
      if (item.action === "close-position") {
        trendByMint.delete(item.positionMint);
      }
    }
    this.entryByMint = entryByMint;
    this.trendByMint = trendByMint;
    await this.saveHistory();
  }

  private resolveTrendForMint(mint: string | null, fallback: "up" | "down" | null): "up" | "down" | null {
    if (!mint) {
      return fallback ?? null;
    }
    return this.trendByMint.get(mint) ?? fallback ?? null;
  }

  private schedule(): void {
    if (!this.running) {
      return;
    }
    this.timer = setTimeout(async () => {
      await this.tickOnce();
      this.schedule();
    }, this.config.pollIntervalMs);
  }

  private async tickOnce(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    if (this.pendingClose) {
      await this.performClose("pending");
      return;
    }
    this.inFlight = true;
    try {
      await withRetry(() => this.bot.tick(), { retries: 3, baseDelayMs: 1000 });
      this.lastTickAt = new Date().toISOString();
      const status = this.bot.getStatus();
      const hedgeResult = await this.hedgeManager.ensureOpen(status);
      if (this.config.hedgeEnabled && status.positionMint && !this.hedgeManager.getState()?.active) {
        if (hedgeResult.status === "failed") {
          const reason = hedgeResult.error ?? this.hedgeManager.getLastError() ?? "hedge failed";
          logger.error({ reason }, "hedge failed; closing position");
          this.bot.setError(new Error(`Hedge falhou: ${reason}`));
          try {
            await withRetry(() => this.bot.closeActivePosition(), { retries: 2, baseDelayMs: 1000 });
            this.lastHedgeClose = await this.hedgeManager.closeIfOpen();
          } catch (err) {
            logger.error({ err }, "auto-close after hedge failure failed");
            this.bot.setError(err);
          } finally {
            this.lastTickAt = new Date().toISOString();
            this.recordEvent(this.bot.getStatus());
            this.stop();
          }
          return;
        }
      }
      this.recordEvent(status);
    } catch (err) {
      logger.error({ err }, "tick failed");
      this.bot.setError(err);
    } finally {
      this.inFlight = false;
      if (this.pendingClose) {
        await this.performClose("pending");
      }
    }
  }

  private async performClose(mode: "manual" | "pending"): Promise<RunnerStatus> {
    if (this.inFlight) {
      return this.getStatus();
    }
    this.inFlight = true;
    const wasRunning = this.running;
    let closed = false;
    let status: BotStatus | null = null;
    try {
      status = await withRetry(() => this.bot.closeActivePosition(), { retries: 2, baseDelayMs: 1000 });
      closed = status.lastAction === "close-position";
      if (closed) {
        this.lastHedgeClose = await this.hedgeManager.closeIfOpen();
      }
      this.lastTickAt = new Date().toISOString();
      this.recordEvent(status);
    } catch (err) {
      logger.error({ err, mode }, "close-position failed");
      this.bot.setError(err);
    } finally {
      this.inFlight = false;
    }
    if (closed) {
      this.pendingClose = false;
      this.pendingCloseRequestedAt = null;
      if (this.running) {
        this.stop();
      }
    } else if (wasRunning) {
      this.pendingClose = true;
      if (!this.pendingCloseRequestedAt) {
        this.pendingCloseRequestedAt = new Date().toISOString();
      }
    } else {
      this.pendingClose = false;
      this.pendingCloseRequestedAt = null;
    }
    return this.getStatus();
  }

  private recordEvent(status: BotStatus): void {
    const action = status.lastAction;
    const eventPositionMint = status.eventPositionMint ?? null;
    const eventPositionEntryUsd = status.eventPositionEntryUsd ?? null;
    const eventPositionFeesUsd = status.eventPositionFeesUsd ?? null;
    const eventPositionExitUsd = status.eventPositionExitUsd ?? null;
    const resolveEntryFallback = (entry: number | null, mint: string | null): number | null => {
      if (entry != null) {
        return entry;
      }
      if (!mint) {
        return null;
      }
      const fallback = this.entryByMint.get(mint) ?? null;
      if (fallback == null) {
        return null;
      }
      return isEntryUsdSane(fallback, status.budgetUsd ?? null, status.portfolioUsd ?? null, {
        minBudgetFactor: MIN_ENTRY_BUDGET_FACTOR
      })
        ? fallback
        : null;
    };
    let mergedPositionMint = status.positionMint ?? null;
    let mergedPositionEntryUsd = status.positionEntryUsd ?? null;
    let mergedPositionFeesUsd = status.positionFeesUsd ?? null;
    let mergedPositionPnlUsd = status.positionPnlUsd ?? null;
    let mergedPositionExitUsd: number | null = null;

    if (action === "close-position") {
      mergedPositionMint = eventPositionMint ?? mergedPositionMint;
      mergedPositionEntryUsd = resolveEntryFallback(eventPositionEntryUsd ?? mergedPositionEntryUsd, mergedPositionMint);
      mergedPositionFeesUsd = eventPositionFeesUsd ?? mergedPositionFeesUsd;
      mergedPositionExitUsd = eventPositionExitUsd ?? null;
      if (mergedPositionExitUsd != null && mergedPositionEntryUsd != null) {
        mergedPositionPnlUsd = mergedPositionExitUsd - mergedPositionEntryUsd;
      }
    } else if (action === "rebalanced") {
      mergedPositionExitUsd = eventPositionExitUsd ?? null;
    }
    const txFeeLamports = status.lastActionFeeLamports ?? null;
    const txFeeUsd = txFeeLamports != null && status.solUsdPrice != null
      ? (txFeeLamports / LAMPORTS_PER_SOL) * status.solUsdPrice
      : null;
    if (mergedPositionPnlUsd != null && txFeeUsd != null) {
      mergedPositionPnlUsd -= txFeeUsd;
    }
    if (mergedPositionFeesUsd != null
      && !isEntryUsdSane(mergedPositionFeesUsd, status.budgetUsd ?? null, status.portfolioUsd ?? null)) {
      mergedPositionFeesUsd = null;
    }

    const trendNow = status.trendDirection ?? null;
    const hedgeClose = action === "close-position" ? this.lastHedgeClose : null;

    if (!status.lastAction || status.lastAction === "no-action") {
      if (status.positionMint) {
        const timestamp = new Date().toISOString();
        const openedAt = mergedPositionMint ? this.openedAtByMint.get(mergedPositionMint) ?? null : null;
        const actionType = resolveActionType("resume-position");
        const trendForMint = this.resolveTrendForMint(mergedPositionMint, trendNow);
        if (mergedPositionMint && trendNow && !this.trendByMint.has(mergedPositionMint)) {
          this.trendByMint.set(mergedPositionMint, trendNow);
        }
        this.pushEvent({
          id: this.createEventId(timestamp),
          timestamp,
          positionOpenedAt: openedAt,
          positionClosedAt: null,
          actionType,
          action: "resume-position",
          trendDirection: trendForMint,
          price: status.lastPrice,
          solUsdPrice: status.solUsdPrice,
          budgetUsd: status.budgetUsd,
          budgetSol: status.budgetSol,
          targetRange: status.targetRange,
          positionRange: status.positionRange,
          positionMint: mergedPositionMint,
          tokenABalance: status.tokenABalance,
          tokenBBalance: status.tokenBBalance,
          positionTokenA: status.positionTokenA,
          positionTokenB: status.positionTokenB,
          openTokenA: null,
          openTokenB: null,
          closeTokenA: null,
          closeTokenB: null,
          positionEntryUsd: mergedPositionEntryUsd,
          positionFeesUsd: mergedPositionFeesUsd,
          positionPnlUsd: mergedPositionPnlUsd,
          positionExitUsd: null,
          txFeeLamports,
          txFeeUsd,
          portfolioValue: status.portfolioValue,
          pnl: status.pnl,
          portfolioUsd: status.portfolioUsd,
          pnlUsd: status.pnlUsd,
          pnlDelta: null,
          pnlDeltaUsd: null,
          hedgeSymbol: null,
          hedgeNotionalUsd: null,
          hedgeLeverage: null,
          hedgePnlUsd: null
        });
      }
      return;
    }
    const skipped = [
      "insufficient-balance",
      "quote-failed",
      "dry-run-open",
      "skip-low-sol",
      "close-no-position",
      "out-of-range-wait",
      "cooldown-wait"
    ];
    if (skipped.includes(status.lastAction)) {
      return;
    }
    if (action === "rebalanced") {
      const timestamp = new Date().toISOString();
      const closeMint = eventPositionMint ?? null;
      const closeOpenedAt = closeMint ? this.openedAtByMint.get(closeMint) ?? null : null;
      const closeEntryUsd = resolveEntryFallback(eventPositionEntryUsd ?? null, closeMint);
      const closeFeesUsd = eventPositionFeesUsd ?? null;
      const closeExitUsd = eventPositionExitUsd ?? null;
      let closePnlUsd = closeExitUsd != null && closeEntryUsd != null
        ? closeExitUsd - closeEntryUsd
        : null;
      if (closePnlUsd != null && txFeeUsd != null) {
        closePnlUsd -= txFeeUsd;
      }

      const trendForClose = this.resolveTrendForMint(closeMint, trendNow);
      const closeEvent: HistoryEvent = {
        id: this.createEventId(timestamp),
        timestamp,
        positionOpenedAt: closeOpenedAt,
        positionClosedAt: timestamp,
        actionType: resolveActionType("close-position"),
        action: "close-position",
        trendDirection: trendForClose,
        price: status.lastPrice,
        solUsdPrice: status.solUsdPrice,
        budgetUsd: status.budgetUsd,
        budgetSol: status.budgetSol,
        targetRange: status.targetRange,
        positionRange: status.positionRange,
        positionMint: closeMint,
        tokenABalance: status.tokenABalance,
        tokenBBalance: status.tokenBBalance,
        positionTokenA: status.positionTokenA,
        positionTokenB: status.positionTokenB,
        openTokenA: null,
        openTokenB: null,
        closeTokenA: status.lastCloseTokenA,
        closeTokenB: status.lastCloseTokenB,
        positionEntryUsd: closeEntryUsd,
        positionFeesUsd: closeFeesUsd,
        positionPnlUsd: closePnlUsd,
        positionExitUsd: closeExitUsd,
        txFeeLamports,
        txFeeUsd,
        portfolioValue: status.portfolioValue,
        pnl: status.pnl,
        portfolioUsd: status.portfolioUsd,
        pnlUsd: status.pnlUsd,
        pnlDelta: null,
        pnlDeltaUsd: null,
        hedgeSymbol: null,
        hedgeNotionalUsd: null,
        hedgeLeverage: null,
        hedgePnlUsd: null
      };
      this.pushEvent(closeEvent);
      if (closeMint) {
        this.trendByMint.delete(closeMint);
      }

      const openMint = status.positionMint ?? null;
      let openOpenedAt = openMint ? this.openedAtByMint.get(openMint) ?? null : null;
      if (openMint) {
        this.openedAtByMint.set(openMint, timestamp);
        openOpenedAt = timestamp;
      }
      if (openMint && trendNow) {
        this.trendByMint.set(openMint, trendNow);
      }
      const openEvent: HistoryEvent = {
        id: this.createEventId(timestamp),
        timestamp,
        positionOpenedAt: openOpenedAt,
        positionClosedAt: null,
        actionType: resolveActionType("open-position"),
        action: "open-position",
        trendDirection: trendNow,
        price: status.lastPrice,
        solUsdPrice: status.solUsdPrice,
        budgetUsd: status.budgetUsd,
        budgetSol: status.budgetSol,
        targetRange: status.targetRange,
        positionRange: status.positionRange,
        positionMint: openMint,
        tokenABalance: status.tokenABalance,
        tokenBBalance: status.tokenBBalance,
        positionTokenA: status.positionTokenA,
        positionTokenB: status.positionTokenB,
        openTokenA: status.lastOpenTokenA,
        openTokenB: status.lastOpenTokenB,
        closeTokenA: null,
        closeTokenB: null,
        positionEntryUsd: status.positionEntryUsd,
        positionFeesUsd: status.positionFeesUsd,
        positionPnlUsd: status.positionPnlUsd,
        positionExitUsd: null,
        txFeeLamports: null,
        txFeeUsd: null,
        portfolioValue: status.portfolioValue,
        pnl: status.pnl,
        portfolioUsd: status.portfolioUsd,
        pnlUsd: status.pnlUsd,
        pnlDelta: null,
        pnlDeltaUsd: null,
        hedgeSymbol: null,
        hedgeNotionalUsd: null,
        hedgeLeverage: null,
        hedgePnlUsd: null
      };
      this.pushEvent(openEvent);
      return;
    }
    const pnlDelta = status.portfolioValue != null && this.lastEventPortfolioValue != null
      ? status.portfolioValue - this.lastEventPortfolioValue
      : null;
    const pnlDeltaUsd = status.portfolioUsd != null && this.lastEventPortfolioUsd != null
      ? status.portfolioUsd - this.lastEventPortfolioUsd
      : null;

    const timestamp = new Date().toISOString();
    let positionOpenedAt = mergedPositionMint ? this.openedAtByMint.get(mergedPositionMint) ?? null : null;
    if ((action === "open-position" || action === "rebalanced") && mergedPositionMint) {
      this.openedAtByMint.set(mergedPositionMint, timestamp);
      positionOpenedAt = timestamp;
    }
    if (action === "close-position" && mergedPositionMint) {
      positionOpenedAt = this.openedAtByMint.get(mergedPositionMint) ?? positionOpenedAt;
    }
    if (action === "open-position" && mergedPositionMint && trendNow) {
      this.trendByMint.set(mergedPositionMint, trendNow);
    }
    const actionType = resolveActionType(action);
    const eventTrend = this.resolveTrendForMint(mergedPositionMint, trendNow);
    const event: HistoryEvent = {
      id: this.createEventId(timestamp),
      timestamp,
      positionOpenedAt,
      positionClosedAt: action === "close-position" ? timestamp : null,
      actionType,
      action,
      trendDirection: eventTrend,
      price: status.lastPrice,
      solUsdPrice: status.solUsdPrice,
      budgetUsd: status.budgetUsd,
      budgetSol: status.budgetSol,
      targetRange: status.targetRange,
      positionRange: status.positionRange,
      positionMint: mergedPositionMint,
      tokenABalance: status.tokenABalance,
      tokenBBalance: status.tokenBBalance,
      positionTokenA: status.positionTokenA,
      positionTokenB: status.positionTokenB,
      openTokenA: status.lastOpenTokenA,
      openTokenB: status.lastOpenTokenB,
      closeTokenA: status.lastCloseTokenA,
      closeTokenB: status.lastCloseTokenB,
      positionEntryUsd: mergedPositionEntryUsd,
      positionFeesUsd: mergedPositionFeesUsd,
      positionPnlUsd: mergedPositionPnlUsd,
      positionExitUsd: mergedPositionExitUsd,
      txFeeLamports,
      txFeeUsd,
      portfolioValue: status.portfolioValue,
      pnl: status.pnl,
      portfolioUsd: status.portfolioUsd,
      pnlUsd: status.pnlUsd,
      pnlDelta,
      pnlDeltaUsd,
      hedgeSymbol: hedgeClose?.symbol ?? null,
      hedgeNotionalUsd: hedgeClose?.notionalUsd ?? null,
      hedgeLeverage: hedgeClose?.leverage ?? null,
      hedgePnlUsd: hedgeClose?.pnlUsd ?? null
    };
    this.pushEvent(event);
    if (action === "close-position" && mergedPositionMint) {
      this.trendByMint.delete(mergedPositionMint);
    }
    if (action === "close-position") {
      this.lastHedgeClose = null;
    }
  }

  private pushEvent(event: HistoryEvent): void {
    if ((event.action === "resume-position" || event.action === "skip-low-sol-position") && this.history.length > 0) {
      const last = this.history[this.history.length - 1];
      if (last?.action === event.action && last?.positionMint === event.positionMint) {
        this.history[this.history.length - 1] = { ...event, id: last.id, timestamp: last.timestamp };
        if (event.positionMint && typeof event.positionEntryUsd === "number") {
          if (isEntryUsdSane(event.positionEntryUsd, event.budgetUsd ?? null, event.portfolioUsd ?? null, {
            minBudgetFactor: MIN_ENTRY_BUDGET_FACTOR
          })) {
            this.entryByMint.set(event.positionMint, event.positionEntryUsd);
          }
        }
        if (event.portfolioValue != null) {
          this.lastEventPortfolioValue = event.portfolioValue;
        }
        if (event.portfolioUsd != null) {
          this.lastEventPortfolioUsd = event.portfolioUsd;
        }
        void this.saveHistory();
        return;
      }
    }

    this.history.push(event);
    if (event.positionMint && event.positionOpenedAt) {
      this.openedAtByMint.set(event.positionMint, event.positionOpenedAt);
    }
    if (event.positionMint && typeof event.positionEntryUsd === "number") {
      if (isEntryUsdSane(event.positionEntryUsd, event.budgetUsd ?? null, event.portfolioUsd ?? null, {
        minBudgetFactor: MIN_ENTRY_BUDGET_FACTOR
      })) {
        this.entryByMint.set(event.positionMint, event.positionEntryUsd);
      }
    }
    const maxHistory = Number.isFinite(this.config.historyMaxEvents)
      ? Math.floor(this.config.historyMaxEvents)
      : 0;
    if (maxHistory > 0 && this.history.length > maxHistory) {
      this.history.splice(0, this.history.length - maxHistory);
    }
    if (event.portfolioValue != null) {
      this.lastEventPortfolioValue = event.portfolioValue;
    }
    if (event.portfolioUsd != null) {
      this.lastEventPortfolioUsd = event.portfolioUsd;
    }
    void this.saveHistory();
  }

  private async loadHistoryIfNeeded(): Promise<void> {
    if (this.historyLoaded) {
      return;
    }
    this.historyLoaded = true;
    try {
        const parsed = await this.historyStore.load();
        const storedHedgeState = (parsed as { hedgeState?: HedgeState | null } | null)?.hedgeState ?? null;
        if (storedHedgeState) {
          this.hedgeManager.hydrate(storedHedgeState);
        }
        if (Array.isArray(parsed?.history)) {
          let mutated = false;
          const normalized: HistoryEvent[] = [];
          parsed.history.forEach((item, index) => {
            if (!item || typeof item !== "object") {
              mutated = true;
              return;
            }
          const raw = item as HistoryEvent;
          const existingId = (raw as { id?: string }).id;
          const id = typeof existingId === "string" && existingId.trim().length > 0
            ? existingId
            : this.buildLegacyEventId(raw, index);
          if (id !== existingId) {
            mutated = true;
          }
          let next: HistoryEvent = { ...raw, id };
          const normalizedTrend = raw.trendDirection === "up" || raw.trendDirection === "down" ? raw.trendDirection : null;
          if (normalizedTrend !== (raw as any).trendDirection) {
            next = { ...next, trendDirection: normalizedTrend };
            mutated = true;
          } else if (next.trendDirection == null) {
            next = { ...next, trendDirection: normalizedTrend };
          }
          const entryUsd = typeof raw.positionEntryUsd === "number" ? raw.positionEntryUsd : null;
          const feesUsd = typeof raw.positionFeesUsd === "number" ? raw.positionFeesUsd : null;
          const budgetUsd = typeof raw.budgetUsd === "number" ? raw.budgetUsd : null;
          const portfolioUsd = typeof raw.portfolioUsd === "number" ? raw.portfolioUsd : null;
          const desiredActionType = resolveActionType(next.action ?? null);
          if (desiredActionType !== (next.actionType ?? null)) {
            next = { ...next, actionType: desiredActionType };
            mutated = true;
          }
          if (next.action === "close-position" && !next.positionClosedAt) {
            next = { ...next, positionClosedAt: next.timestamp };
            mutated = true;
          }
          if (entryUsd != null && !isEntryUsdSane(entryUsd, budgetUsd, portfolioUsd, {
            minBudgetFactor: MIN_ENTRY_BUDGET_FACTOR
          })) {
            next = { ...next, positionEntryUsd: null, positionPnlUsd: null };
            mutated = true;
          }
            if (feesUsd != null && !isEntryUsdSane(feesUsd, budgetUsd, portfolioUsd)) {
              next = { ...next, positionFeesUsd: null };
              mutated = true;
            }
            normalized.push(next);
          });
          const openedByMint = new Map<string, string>();
          const trendByMint = new Map<string, "up" | "down">();
          let previousMint: string | null = null;
          for (let i = 0; i < normalized.length; i += 1) {
            let next = normalized[i];
            let rebalanceTrusted = true;
            if (next.action === "rebalanced") {
              const currentMint = next.positionMint ?? null;
              const suspicious = !currentMint || (previousMint && currentMint === previousMint);
              if (suspicious) {
                let futureMint: string | null = null;
                for (let j = i + 1; j < normalized.length; j += 1) {
                  const candidate = normalized[j]?.positionMint ?? null;
                  if (!candidate) {
                    continue;
                  }
                  if (previousMint && candidate === previousMint) {
                    continue;
                  }
                  futureMint = candidate;
                  break;
                }
                if (futureMint) {
                  if (next.positionMint !== futureMint) {
                    next = { ...next, positionMint: futureMint };
                    mutated = true;
                  }
                  rebalanceTrusted = true;
                } else {
                  rebalanceTrusted = false;
                }
              }
            }

            const mint = next.positionMint ?? null;
            if (mint) {
              if (next.action === "open-position" || (next.action === "rebalanced" && rebalanceTrusted)) {
                openedByMint.set(mint, next.timestamp);
                if (!next.positionOpenedAt || next.positionOpenedAt !== next.timestamp) {
                  next = { ...next, positionOpenedAt: next.timestamp };
                  mutated = true;
                }
                if (next.trendDirection === "up" || next.trendDirection === "down") {
                  trendByMint.set(mint, next.trendDirection);
                }
              } else {
                const openedAt = openedByMint.get(mint) ?? null;
                if (openedAt && next.positionOpenedAt !== openedAt) {
                  next = { ...next, positionOpenedAt: openedAt };
                  mutated = true;
                }
                const storedTrend = trendByMint.get(mint) ?? null;
                if (storedTrend && next.trendDirection !== storedTrend) {
                  next = { ...next, trendDirection: storedTrend };
                  mutated = true;
                }
              }
            }
            if (next.positionMint && next.action === "close-position") {
              trendByMint.delete(next.positionMint);
            }

            normalized[i] = next;
            if (next.positionMint) {
              previousMint = next.positionMint;
            }
          }
          const entryByMint = new Map<string, number>();
          for (const item of normalized) {
            if (item.positionMint && typeof item.positionEntryUsd === "number") {
              if (isEntryUsdSane(item.positionEntryUsd, item.budgetUsd ?? null, item.portfolioUsd ?? null, {
                minBudgetFactor: MIN_ENTRY_BUDGET_FACTOR
              })) {
                entryByMint.set(item.positionMint, item.positionEntryUsd);
              }
            }
          }
          const maxHistory = Number.isFinite(this.config.historyMaxEvents)
            ? Math.floor(this.config.historyMaxEvents)
            : 0;
          if (maxHistory > 0 && normalized.length > maxHistory) {
            normalized.splice(0, normalized.length - maxHistory);
            mutated = true;
          }
          this.history = normalized;
          this.openedAtByMint = openedByMint;
          this.entryByMint = entryByMint;
          this.trendByMint = trendByMint;
          if (mutated) {
            await this.saveHistory();
          }
      }
      if (typeof parsed?.lastEventPortfolioValue === "number") {
        this.lastEventPortfolioValue = parsed.lastEventPortfolioValue;
      }
      if (typeof parsed?.lastEventPortfolioUsd === "number") {
        this.lastEventPortfolioUsd = parsed.lastEventPortfolioUsd;
      }
    } catch {
      // ignore missing or invalid history
    }

    const status = this.bot.getStatus();
    if (status.positionMint && this.history.length > 0) {
      for (let i = this.history.length - 1; i >= 0; i -= 1) {
        const item = this.history[i];
        if (item?.positionMint === status.positionMint && Number.isFinite(item.positionEntryUsd ?? NaN)) {
          this.bot.setPositionEntryUsd(item.positionEntryUsd ?? null);
          break;
        }
      }
    }
  }

  private async saveHistory(): Promise<void> {
    try {
      const payload = {
        history: this.history,
        lastEventPortfolioValue: this.lastEventPortfolioValue,
        lastEventPortfolioUsd: this.lastEventPortfolioUsd,
        hedgeState: this.hedgeManager.getState()
      };
      await this.historyStore.save(payload);
    } catch (err) {
      logger.warn({ err }, "failed to save history");
    }
  }

  private recalculateLastEventValues(): void {
    this.lastEventPortfolioValue = null;
    this.lastEventPortfolioUsd = null;
    for (let i = this.history.length - 1; i >= 0; i -= 1) {
      const item = this.history[i];
      if (this.lastEventPortfolioValue == null && item.portfolioValue != null) {
        this.lastEventPortfolioValue = item.portfolioValue;
      }
      if (this.lastEventPortfolioUsd == null && item.portfolioUsd != null) {
        this.lastEventPortfolioUsd = item.portfolioUsd;
      }
      if (this.lastEventPortfolioValue != null && this.lastEventPortfolioUsd != null) {
        break;
      }
    }
  }

  private createEventId(timestamp: string): string {
    const parsed = Date.parse(timestamp);
    const timePart = Number.isFinite(parsed) ? parsed.toString(36) : Date.now().toString(36);
    const rand = (this.eventIdSeed++ % 1_000_000).toString(36);
    return `evt_${timePart}_${rand}`;
  }

  private buildLegacyEventId(event: HistoryEvent, index: number): string {
    const parsed = Date.parse(event.timestamp);
    const timePart = Number.isFinite(parsed) ? parsed.toString(36) : "legacy";
    const indexPart = index.toString(36);
    return `evt_${timePart}_${indexPart}`;
  }
}
