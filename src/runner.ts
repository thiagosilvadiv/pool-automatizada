import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { OrcaBot, BotStatus, KaminoLogItem } from "./orca.js";
import type { KaminoCycleState } from "./kamino-types.js";
import { Config } from "./config.js";
import { withRetry } from "./retry.js";
import { logger } from "./logger.js";
import { HistoryStore, type KaminoLoanEntry } from "./storage.js";
import { HedgeManager, HedgeCloseResult, HedgeState } from "./hedge.js";

const MIN_ENTRY_BUDGET_FACTOR = 0.25;
const MAX_USD_SANITY = 1_000_000_000;

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

function isRateLimitError(err: unknown): boolean {
  const raw: any = err as any;
  const message = String(raw?.message ?? raw?.context?.message ?? err).toLowerCase();
  const status = raw?.context?.statusCode ?? raw?.statusCode;
  const code = raw?.context?.__code ?? raw?.__code ?? raw?.code;
  return status === 429
    || String(code) === "8100002"
    || message.includes("too many requests")
    || message.includes("429");
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
    case "kamino-rebalanced":
    case "kamino-close":
      return "fechamento";
    case "resume-position":
    case "skip-low-sol-position":
      return "monitorando";
    case "swap":
    case "manual-sol-topup":
    case "auto-sol-topup":
    case "manual-swap-to-sol":
    case "kamino-deposit":
    case "kamino-borrow":
    case "kamino-reopen":
    case "kamino-repay":
    case "kamino-withdraw":
    case "kamino-rebalance-failed":
    case "kamino-wait-funds":
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
  hedgeFeesUsd: number | null;
  hedgePnlUsd: number | null;
  hedgeDecision: "opened" | "skipped" | "failed" | null;
  hedgeDecisionReason: string | null;
};

export type HedgeLogEntry = {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  action: "open" | "close" | "open-failed" | "close-failed" | "open-skip";
  message: string;
  symbol: string | null;
  qty: number | null;
  notionalUsd: number | null;
  leverage: number | null;
  pnlUsd: number | null;
};

const MAX_HEDGE_LOGS = 80;

export type KaminoLogEntry = {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  action: string;
  message: string;
  marketAddress: string | null;
  poolId: string | null;
  poolName: string | null;
};

const MAX_KAMINO_LOGS = 80;

export class BotRunner {
  private bot: OrcaBot;
  private config: Config;
  private poolId: string;
  private poolName: string;
  private historyStore: HistoryStore;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inFlight = false;
  private lastTickAt: string | null = null;
  private history: HistoryEvent[] = [];
  private lastEventPortfolioValue: number | null = null;
  private lastEventPortfolioUsd: number | null = null;
  private historyLoaded = false;
  private hedgeLogs: HedgeLogEntry[] = [];
  private kaminoLogs: KaminoLogEntry[] = [];
  private eventIdSeed = Math.floor(Math.random() * 1_000_000);
  private logIdSeed = Math.floor(Math.random() * 1_000_000);
  private kaminoLogIdSeed = Math.floor(Math.random() * 1_000_000);
  private openedAtByMint = new Map<string, string>();
  private entryByMint = new Map<string, number>();
  private trendByMint = new Map<string, "up" | "down">();
  private hedgeManager: HedgeManager;
  private lastHedgeClose: HedgeCloseResult | null = null;
  private hedgeDecisionByMint = new Map<string, { status: "opened" | "skipped" | "failed"; reason: string | null }>();
  private pendingClose = false;
  private pendingCloseMode: "manual" = "manual";
  private pendingKaminoClose = false;
  private rateLimitUntil: number | null = null;
  private pendingCloseRequestedAt: string | null = null;
  private autoAddRequestedByMint = new Set<string>();
  private onAutoAddRequest?: (poolId: string) => void;

  constructor(
    bot: OrcaBot,
    config: Config,
    options: { historyStore: HistoryStore; poolId: string; poolName: string; onAutoAddRequest?: (poolId: string) => void }
  ) {
    this.bot = bot;
    this.config = config;
    this.historyStore = options.historyStore;
    this.hedgeManager = new HedgeManager(config);
    this.poolId = options.poolId;
    this.poolName = options.poolName;
    this.onAutoAddRequest = options.onAutoAddRequest;
    this.bot.setPoolMeta({ id: options.poolId, name: options.poolName });
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
      this.pendingCloseMode = "manual";
      this.pendingCloseRequestedAt = new Date().toISOString();
      logger.info({ pendingCloseRequestedAt: this.pendingCloseRequestedAt }, "close requested during tick; pending");
      return this.getStatus();
    }
    return this.performClose("manual");
  }

  async closeKaminoCycleNow(): Promise<{ ok: boolean; reason?: string; status: RunnerStatus }> {
    if (this.inFlight) {
      this.pendingKaminoClose = true;
      logger.info("closeKaminoCycleNow: bot ocupado, agendando fechamento para próximo tick");
      return { ok: true, reason: "scheduled", status: this.getStatus() };
    }
    this.inFlight = true;
    try {
      const result = await this.bot.closeKaminoCycleNow();
      this.lastTickAt = new Date().toISOString();
      this.recordEvent(this.bot.getStatus());
      this.flushQueuedHistory();
      this.flushKaminoLogs();
      return { ok: result.ok, reason: result.reason, status: this.getStatus() };
    } catch (err) {
      logger.error({ err }, "close-kamino failed");
      this.bot.setError(err);
      return { ok: false, reason: err instanceof Error ? err.message : String(err), status: this.getStatus() };
    } finally {
      this.inFlight = false;
    }
  }

  resetKaminoCycle(): void {
    this.bot.resetKaminoCycle();
    this.flushKaminoLogs();
  }

  async testKaminoNow(input: {
    collateralMint: string;
    collateralAmount: number;
    borrowUsd?: number;
  }): Promise<{ ok: boolean; reason?: string; depositSig?: string; borrowSig?: string; status: RunnerStatus }> {
    if (this.inFlight) {
      return { ok: false, reason: "busy", status: this.getStatus() };
    }
    this.inFlight = true;
    try {
      const result = await this.bot.testKaminoNow(input);
      this.lastTickAt = new Date().toISOString();
      this.recordEvent(this.bot.getStatus());
      this.flushQueuedHistory();
      this.flushKaminoLogs();
      return { ...result, status: this.getStatus() };
    } catch (err) {
      logger.error({ err }, "kamino-test failed");
      this.bot.setError(err);
      return { ok: false, reason: err instanceof Error ? err.message : String(err), status: this.getStatus() };
    } finally {
      this.inFlight = false;
    }
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
      this.flushKaminoLogs();
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
      this.flushKaminoLogs();
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
    const prevEntryMode = this.config.hedgeEntryMode;
    this.config = config;
    this.bot.updateConfig(config);
    this.hedgeManager.updateConfig(config);
    if (prevEntryMode !== config.hedgeEntryMode) {
      const mint = this.bot.getStatus().positionMint ?? null;
      const decision = this.getHedgeDecision(mint);
      if (mint && this.isHedgeDecisionLocked(decision)) {
        this.hedgeDecisionByMint.delete(mint);
      }
    }
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

  recoverKaminoFromLoan(loan: KaminoLoanEntry): void {
    if (!loan || (loan.ownerPoolId && loan.ownerPoolId !== this.poolId)) {
      return;
    }
    const current = this.bot.getKaminoState();
    if (current?.active) {
      return;
    }
    const deposits = Array.isArray(loan.deposits) ? loan.deposits : [];
    const borrows = Array.isArray(loan.borrows) ? loan.borrows : [];
    const collaterals = deposits.map((dep) => ({
      mint: dep.mint,
      amount: dep.amount,
      usd: null,
      debtUsd: null,
      avgPriceUsdc: null,
      targetPriceUsdc: null
    }));
    const borrowMints = Array.from(new Set(borrows.map((bor) => bor.mint).filter(Boolean)));
    const debtMint = borrowMints.length === 1 ? borrowMints[0] : null;
    const debtAmount = borrows.reduce((sum, bor) => sum + (Number(bor.amount) || 0), 0);
    const single = collaterals.length === 1 ? collaterals[0] : null;
    this.bot.setKaminoState({
      active: true,
      ownerPoolId: loan.ownerPoolId ?? this.poolId,
      ownerPoolName: loan.ownerPoolName ?? this.poolName,
      marketAddress: loan.marketAddress,
      collateralMint: single ? single.mint : null,
      collateralAmount: single ? single.amount : 0,
      collateralUsd: loan.collateralUsd ?? null,
      debtMint,
      debtAmount: debtMint ? debtAmount : 0,
      debtUsd: loan.debtUsd ?? null,
      avgPriceUsdc: null,
      targetPriceUsdc: null,
      collaterals,
      cycleCount: Math.max(current?.cycleCount ?? 0, 1),
      updatedAt: new Date().toISOString(),
      lastError: "Ciclo Kamino recuperado do registro global."
    });
    this.addKaminoLog({
      level: "warn",
      action: "recover",
      message: "Empréstimo Kamino recuperado do registro global.",
      marketAddress: loan.marketAddress ?? null
    });
  }

  isBusy(): boolean {
    return this.inFlight || this.pendingClose;
  }

  isAutoAddEnabled(): boolean {
    return Boolean(this.config.autoAddLiquidityEnabled);
  }

  async getWalletBalances(): Promise<{ tokenA: number; tokenB: number }> {
    return this.bot.getWalletBalances();
  }

  async autoAddLiquidity(limits: { maxTokenA?: number; maxTokenB?: number }): Promise<{ ok: boolean; reason?: string }> {
    if (this.inFlight) {
      return { ok: false, reason: "busy" };
    }
    this.inFlight = true;
    try {
      const result = await this.bot.addLiquidityFromWallet(limits);
      this.lastTickAt = new Date().toISOString();
      this.recordEvent(this.bot.getStatus());
      this.flushKaminoLogs();
      return result;
    } catch (err) {
      logger.error({ err }, "auto-add liquidity failed");
      this.bot.setError(err);
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    } finally {
      this.inFlight = false;
    }
  }

  getHistory(): HistoryEvent[] {
    return [...this.history].reverse();
  }

  getHedgeLogs(): HedgeLogEntry[] {
    return [...this.hedgeLogs].reverse();
  }

  getKaminoLogs(): KaminoLogEntry[] {
    return [...this.kaminoLogs].reverse();
  }

  clearHedgeLogs(): void {
    this.hedgeLogs = [];
  }

  clearKaminoLogs(): void {
    this.kaminoLogs = [];
  }

  async clearHistory(): Promise<void> {
    this.history = [];
    this.lastEventPortfolioValue = null;
    this.lastEventPortfolioUsd = null;
    this.entryByMint = new Map();
    this.trendByMint = new Map();
    this.hedgeDecisionByMint = new Map();
    this.autoAddRequestedByMint = new Set();
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
    const autoAddByMint = new Set<string>();
    for (const item of this.history) {
      if (!item.positionMint) {
        continue;
      }
      if (item.action === "add-liquidity") {
        autoAddByMint.add(item.positionMint);
      }
      if (item.action === "close-position") {
        autoAddByMint.delete(item.positionMint);
      }
    }
    const hedgeDecisionByMint = new Map<string, { status: "opened" | "skipped" | "failed"; reason: string | null }>();
    for (const item of this.history) {
      const mint = item.positionMint ?? null;
      if (!mint) {
        continue;
      }
      if (item.action === "open-position") {
        const decision = item.hedgeDecision;
        if (decision === "opened" || decision === "skipped" || decision === "failed") {
          hedgeDecisionByMint.set(mint, { status: decision, reason: item.hedgeDecisionReason ?? null });
        }
      }
      if (item.action === "close-position") {
        hedgeDecisionByMint.delete(mint);
      }
    }
    this.entryByMint = entryByMint;
    this.trendByMint = trendByMint;
    this.hedgeDecisionByMint = hedgeDecisionByMint;
    this.autoAddRequestedByMint = autoAddByMint;
    await this.saveHistory();
  }

  async updateHistoryEvent(id: string, field: keyof HistoryEvent, value: number): Promise<void> {
    await this.loadHistoryIfNeeded();
    const index = this.history.findIndex((event) => event.id === id);
    if (index < 0) {
      throw new Error("History event not found");
    }
    const current = this.history[index];
    const next: HistoryEvent = { ...current, [field]: value };
    this.history[index] = next;
    if (field === "positionEntryUsd") {
      const mint = next.positionMint ?? null;
      if (mint) {
        let latestEntry: number | null = null;
        for (const item of this.history) {
          if (item.positionMint !== mint || typeof item.positionEntryUsd !== "number") {
            continue;
          }
          if (isEntryUsdSane(item.positionEntryUsd, item.budgetUsd ?? null, item.portfolioUsd ?? null, {
            minBudgetFactor: MIN_ENTRY_BUDGET_FACTOR
          })) {
            latestEntry = item.positionEntryUsd;
          }
        }
        if (latestEntry != null) {
          this.entryByMint.set(mint, latestEntry);
        } else {
          this.entryByMint.delete(mint);
        }
      }
    }
    await this.saveHistory();
  }

  private resolveTrendForMint(mint: string | null, fallback: "up" | "down" | null): "up" | "down" | null {
    if (!mint) {
      return fallback ?? null;
    }
    return this.trendByMint.get(mint) ?? fallback ?? null;
  }

  private normalizeHedgeDecision(
    result: { status: "opened" | "skipped" | "failed"; error?: string; reason?: string }
  ): { status: "opened" | "skipped" | "failed"; reason: string | null } | null {
    const reason = result.reason ?? (result.status === "failed" ? (result.error ?? this.hedgeManager.getLastError() ?? null) : null);
    if (result.status === "skipped" && !reason) {
      return null;
    }
    return { status: result.status, reason: reason ?? null };
  }

  private isHedgeDecisionLocked(
    decision: { status: "opened" | "skipped" | "failed"; reason: string | null } | null
  ): boolean {
    if (!decision || decision.status !== "skipped") {
      return false;
    }
    const reason = (decision.reason ?? "").trim().toLowerCase();
    if (!reason) {
      return false;
    }
    return reason.startsWith("ignorado");
  }

  private rememberHedgeDecision(
    mint: string | null,
    decision: { status: "opened" | "skipped" | "failed"; reason: string | null } | null
  ): void {
    if (!mint || !decision) {
      return;
    }
    this.hedgeDecisionByMint.set(mint, decision);
  }

  private getHedgeDecision(
    mint: string | null
  ): { status: "opened" | "skipped" | "failed"; reason: string | null } | null {
    if (!mint) {
      return null;
    }
    return this.hedgeDecisionByMint.get(mint) ?? null;
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
    if (this.rateLimitUntil && Date.now() < this.rateLimitUntil) {
      return;
    }
    if (this.pendingKaminoClose) {
      this.pendingKaminoClose = false;
      this.inFlight = true;
      try {
        const result = await this.bot.closeKaminoCycleNow();
        this.lastTickAt = new Date().toISOString();
        this.flushKaminoLogs();
        if (!result.ok) {
          logger.warn({ reason: result.reason }, "pendingKaminoClose falhou");
        }
      } catch (err) {
        logger.error({ err }, "pendingKaminoClose erro");
        this.bot.setError(err);
      } finally {
        this.inFlight = false;
      }
      return;
    }
    if (this.pendingClose) {
      await this.performClose(this.pendingCloseMode);
      return;
    }
    this.inFlight = true;
    try {
      await withRetry(() => this.bot.tick(), { retries: 3, baseDelayMs: 1000 });
      this.lastTickAt = new Date().toISOString();
      const status = this.bot.getStatus();
      this.flushKaminoLogs();
      const isRebalanced = status.lastAction === "rebalanced" || status.lastAction === "kamino-rebalanced";
      const currentMint = status.positionMint ?? null;
      if (this.config.hedgeEnabled) {
        const hedgeState = this.hedgeManager.getState();
        if (hedgeState?.active) {
          const hedgeMint = hedgeState.positionMint ?? null;
          const closeMint = status.lastAction === "close-position"
            ? (status.eventPositionMint ?? status.positionMint ?? null)
            : null;
          const legacyAttached = !hedgeMint && Boolean(currentMint || closeMint);
          const skipExternalClose = legacyAttached || Boolean(closeMint && hedgeMint && hedgeMint === closeMint);
          if (!skipExternalClose && (!hedgeMint || hedgeMint !== currentMint)) {
            const externalClose = await this.hedgeManager.closeIfOpen({ allowUnowned: true });
            if (externalClose) {
              this.logHedgeClose(externalClose, "Hedge externo fechado");
            } else {
              const errMessage = this.hedgeManager.getLastError();
              if (errMessage) {
                this.logHedgeError("close-failed", `Falha ao fechar hedge externo: ${errMessage}`, hedgeState.symbol);
              }
            }
          }
        }
      }
      let hedgeCloseForRebalance: HedgeCloseResult | null = null;
      let hadHedge = this.hedgeManager.getState()?.active ?? false;

      if (isRebalanced && this.config.hedgeEnabled) {
        if (!hadHedge) {
          const synced = await this.hedgeManager.syncFromBybit();
          hadHedge = synced || (this.hedgeManager.getState()?.active ?? false);
        }
        if (hadHedge) {
          const expectedMint = status.eventPositionMint ?? status.positionMint ?? null;
          const allowUnowned = this.hedgeManager.getState()?.positionMint == null;
          hedgeCloseForRebalance = await this.hedgeManager.closeIfOpen({
            expectedPositionMint: expectedMint,
            allowUnowned
          });
          if (hedgeCloseForRebalance) {
            this.logHedgeClose(hedgeCloseForRebalance, "Hedge fechado para re-range");
          } else {
            const symbol = (this.config.hedgeSymbol ?? "").trim().toUpperCase();
            if (symbol) {
              const openedAt = expectedMint ? this.openedAtByMint.get(expectedMint) ?? null : null;
              const openedAfterMs = openedAt ? Date.parse(openedAt) : undefined;
              const fallback = await this.hedgeManager.fetchClosedPnlFallback(symbol, {
                openedAfterMs,
                closeAtMs: Date.now()
              });
              if (fallback) {
                const baseUsd = status.eventPositionEntryUsd
                  ?? status.positionEntryUsd
                  ?? status.positionValueUsd
                  ?? status.budgetUsd
                  ?? null;
                const pct = Number(this.config.hedgePct ?? NaN);
                const notionalUsd = Number.isFinite(baseUsd ?? NaN) && baseUsd != null && Number.isFinite(pct) && pct > 0
                  ? Number(baseUsd) * (pct / 100)
                  : 0;
                const leverage = Number.isFinite(Number(this.config.hedgeLeverage ?? NaN))
                  ? Number(this.config.hedgeLeverage ?? 1)
                  : 1;
                const qtyEst = await this.hedgeManager.estimateQtyFromNotional(symbol, notionalUsd);
                hedgeCloseForRebalance = {
                  symbol,
                  qty: Number.isFinite(qtyEst ?? NaN) ? Number(qtyEst) : 0,
                  notionalUsd,
                  leverage,
                  feesUsd: fallback.feesUsd ?? null,
                  pnlUsd: fallback.pnlUsd ?? null,
                  closedAt: new Date().toISOString()
                };
                this.logHedgeClose(hedgeCloseForRebalance, "Hedge fechado para re-range");
              }
            }
            if (!hedgeCloseForRebalance) {
              const errMessage = this.hedgeManager.getLastError();
              if (errMessage) {
                this.logHedgeError("close-failed", `Falha ao fechar hedge: ${errMessage}`, this.config.hedgeSymbol);
              }
            }
          }
        }
      }

      let hedgeCloseForClosePosition: HedgeCloseResult | null = null;
      if (!isRebalanced && status.lastAction === "close-position" && this.config.hedgeEnabled) {
        const expectedMint = status.eventPositionMint ?? status.positionMint ?? null;
        hedgeCloseForClosePosition = await this.closeHedgeForPosition(expectedMint, status, "Hedge fechado junto da pool");
        this.lastHedgeClose = hedgeCloseForClosePosition;
      }

      let hedgeResult: { status: "opened" | "skipped" | "failed"; error?: string; reason?: string } = { status: "skipped" };
      let hedgeDecision: { status: "opened" | "skipped" | "failed"; reason: string | null } | null = null;
      const existingDecision = this.getHedgeDecision(currentMint);
      const lockedDecision = this.isHedgeDecisionLocked(existingDecision);
      const allowHedgeOpen = !isRebalanced || !hadHedge || hedgeCloseForRebalance != null;
      if (this.config.hedgeEnabled && allowHedgeOpen && !lockedDecision) {
        hedgeResult = await this.hedgeManager.ensureOpen(status);
        hedgeDecision = this.normalizeHedgeDecision(hedgeResult);
        this.rememberHedgeDecision(status.positionMint ?? null, hedgeDecision);
        if (hedgeResult.status === "opened") {
          const message = isRebalanced ? "Hedge aberto apos re-range" : "Hedge aberto";
          this.logHedgeOpen(message);
        } else if (hedgeResult.status === "skipped" && hedgeResult.reason) {
          this.logHedgeSkip(hedgeResult.reason, this.config.hedgeSymbol);
        } else if (hedgeResult.status === "failed") {
          const reason = hedgeResult.error ?? this.hedgeManager.getLastError() ?? "Falha ao abrir hedge";
          this.logHedgeError("open-failed", `Falha ao abrir hedge: ${reason}`, this.config.hedgeSymbol);
        }
      } else if (lockedDecision) {
        hedgeDecision = existingDecision;
      }

      if (this.config.hedgeEnabled && status.positionMint && !this.hedgeManager.getState()?.active) {
        if (hedgeResult.status === "failed") {
          const reason = hedgeResult.error ?? this.hedgeManager.getLastError() ?? "hedge failed";
          logger.error({ reason }, "hedge failed; closing position");
          this.bot.setError(new Error(`Hedge falhou: ${reason}`));
          let hedgeCloseAfterFailure: HedgeCloseResult | null = null;
          try {
            const closeStatus = await withRetry(() => this.bot.closeActivePosition(), { retries: 2, baseDelayMs: 1000 });
            const expectedMint = closeStatus.eventPositionMint ?? closeStatus.positionMint ?? null;
            hedgeCloseAfterFailure = await this.hedgeManager.closeIfOpen({ expectedPositionMint: expectedMint });
            this.lastHedgeClose = hedgeCloseAfterFailure;
            if (hedgeCloseAfterFailure) {
              this.logHedgeClose(hedgeCloseAfterFailure, "Hedge fechado apos falha");
            } else {
              const errMessage = this.hedgeManager.getLastError();
              if (errMessage) {
                this.logHedgeError("close-failed", `Falha ao fechar hedge: ${errMessage}`, this.config.hedgeSymbol);
              }
            }
          } catch (err) {
            logger.error({ err }, "auto-close after hedge failure failed");
            this.bot.setError(err);
          } finally {
            this.lastTickAt = new Date().toISOString();
            this.recordEvent(this.bot.getStatus(), { hedgeClose: hedgeCloseAfterFailure });
            this.stop();
          }
          return;
        }
      }
      this.recordEvent(status, { hedgeClose: hedgeCloseForClosePosition ?? hedgeCloseForRebalance });
      this.flushQueuedHistory();
      this.flushKaminoLogs();
      this.maybeRequestAutoAdd(status);
    } catch (err) {
      if (isRateLimitError(err)) {
        const backoffMs = 15000;
        this.rateLimitUntil = Date.now() + backoffMs;
        this.bot.setError("RPC rate limit (429). Aguardando para tentar novamente.");
        logger.warn({ err, backoffMs }, "tick rate-limited");
      } else {
        logger.error({ err }, "tick failed");
        this.bot.setError(err);
      }
    } finally {
      this.inFlight = false;
      if (this.pendingClose) {
        await this.performClose(this.pendingCloseMode);
      }
    }
  }

  private async closeHedgeForPosition(
    expectedMint: string | null,
    status: BotStatus,
    successMessage: string
  ): Promise<HedgeCloseResult | null> {
    const stateBeforeClose = this.hedgeManager.getState();
    const closeDecision = this.getHedgeDecision(expectedMint);
    let allowUnowned = this.hedgeManager.getState()?.positionMint == null;
    if (!this.hedgeManager.getState()?.active) {
      const synced = await this.hedgeManager.syncFromBybit();
      if (synced) {
        allowUnowned = this.hedgeManager.getState()?.positionMint == null;
      }
    }
    if (!this.hedgeManager.getState()?.active && closeDecision?.status === "opened") {
      allowUnowned = true;
    }
    let hedgeClose = await this.hedgeManager.closeIfOpen({
      expectedPositionMint: expectedMint,
      allowUnowned
    });
    if (!hedgeClose && closeDecision?.status === "opened") {
      hedgeClose = await this.hedgeManager.closeIfOpen({
        expectedPositionMint: expectedMint,
        allowUnowned: true
      });
    }
    if (!hedgeClose) {
      const symbols = Array.from(
        new Set(
          [
            stateBeforeClose?.symbol ?? null,
            this.config.hedgeSymbol ?? null
          ]
            .map((item) => String(item ?? "").trim().toUpperCase())
            .filter((item) => item.length > 0)
        )
      );
      const openedAt = expectedMint
        ? this.openedAtByMint.get(expectedMint) ?? null
        : stateBeforeClose?.openedAt ?? null;
      const openedAfterMs = openedAt ? Date.parse(openedAt) : undefined;
      const closeAtMs = Date.now();

      for (const symbol of symbols) {
        const fallback = await this.hedgeManager.fetchClosedPnlFallback(symbol, {
          openedAfterMs,
          closeAtMs
        });
        if (!fallback) {
          continue;
        }
        const baseUsd = status.eventPositionEntryUsd
          ?? status.positionEntryUsd
          ?? status.positionValueUsd
          ?? status.budgetUsd
          ?? null;
        const pct = Number(this.config.hedgePct ?? NaN);
        const fallbackNotional = Number.isFinite(stateBeforeClose?.notionalUsd ?? NaN)
          ? Number(stateBeforeClose?.notionalUsd ?? 0)
          : null;
        const notionalUsd = fallbackNotional != null && fallbackNotional > 0
          ? fallbackNotional
          : Number.isFinite(baseUsd ?? NaN) && baseUsd != null && Number.isFinite(pct) && pct > 0
          ? Number(baseUsd) * (pct / 100)
          : 0;
        const leverage = Number.isFinite(Number(stateBeforeClose?.leverage ?? NaN))
          ? Number(stateBeforeClose?.leverage ?? 1)
          : Number.isFinite(Number(this.config.hedgeLeverage ?? NaN))
          ? Number(this.config.hedgeLeverage ?? 1)
          : 1;
        const qtyFromState = Number.isFinite(stateBeforeClose?.qty ?? NaN)
          ? Number(stateBeforeClose?.qty ?? 0)
          : null;
        const qtyEst = qtyFromState != null && qtyFromState > 0
          ? qtyFromState
          : await this.hedgeManager.estimateQtyFromNotional(symbol, notionalUsd);
        hedgeClose = {
          symbol,
          qty: Number.isFinite(qtyEst ?? NaN) ? Number(qtyEst) : 0,
          notionalUsd,
          leverage,
          feesUsd: fallback.feesUsd ?? null,
          pnlUsd: fallback.pnlUsd ?? null,
          closedAt: new Date().toISOString()
        };
        this.logHedgeClose(hedgeClose, "Hedge reconciliado via Bybit (fallback)");
        return hedgeClose;
      }
    }
    const stateAfterClose = this.hedgeManager.getState();
    if (!hedgeClose && stateBeforeClose?.active && !stateAfterClose?.active) {
      hedgeClose = {
        symbol: stateBeforeClose.symbol,
        qty: stateBeforeClose.qty,
        notionalUsd: stateBeforeClose.notionalUsd,
        leverage: stateBeforeClose.leverage,
        feesUsd: null,
        pnlUsd: null,
        closedAt: new Date().toISOString()
      };
      this.logHedgeClose(hedgeClose, "Hedge fechado sem conciliacao completa");
      return hedgeClose;
    }
    if (hedgeClose) {
      this.logHedgeClose(hedgeClose, successMessage);
      return hedgeClose;
    }
    const errMessage = this.hedgeManager.getLastError();
    if (errMessage) {
      this.logHedgeError("close-failed", `Falha ao fechar hedge: ${errMessage}`, this.config.hedgeSymbol);
    }
    return null;
  }

  private async performClose(mode: "manual"): Promise<RunnerStatus> {
    if (this.inFlight) {
      return this.getStatus();
    }
    this.inFlight = true;
    const wasRunning = this.running;
    let closed = false;
    let status: BotStatus | null = null;
    let hedgeClose: HedgeCloseResult | null = null;
    try {
      status = await withRetry(() => this.bot.closeActivePosition(), { retries: 2, baseDelayMs: 1000 });
      closed = status.lastAction === "close-position";
      if (closed) {
        const expectedMint = status.eventPositionMint ?? status.positionMint ?? null;
        hedgeClose = await this.closeHedgeForPosition(expectedMint, status, "Hedge fechado junto da pool");
        this.lastHedgeClose = hedgeClose;
      }
      this.lastTickAt = new Date().toISOString();
      this.recordEvent(status, { hedgeClose });
    } catch (err) {
      logger.error({ err, mode }, "close-position failed");
      this.bot.setError(err);
    } finally {
      this.inFlight = false;
    }
    if (closed) {
      this.pendingClose = false;
      this.pendingCloseRequestedAt = null;
      if (this.running && mode === "manual") {
        this.stop();
      }
    } else if (wasRunning) {
      this.pendingClose = true;
      this.pendingCloseMode = mode;
      if (!this.pendingCloseRequestedAt) {
        this.pendingCloseRequestedAt = new Date().toISOString();
      }
    } else {
      this.pendingClose = false;
      this.pendingCloseRequestedAt = null;
    }
    return this.getStatus();
  }

  private recordEvent(status: BotStatus, options?: { hedgeClose?: HedgeCloseResult | null }): void {
    const action = status.lastAction;
    const eventPositionMint = status.eventPositionMint ?? null;
    const eventPositionEntryUsd = status.eventPositionEntryUsd ?? null;
    const eventPositionFeesUsd = status.eventPositionFeesUsd ?? null;
    const eventPositionExitUsd = status.eventPositionExitUsd ?? null;
    const decisionForMint = (mint: string | null) => this.getHedgeDecision(mint);
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

    if (action === "open-position") {
      // Na abertura não há PnL real ainda. Zera para evitar que valores
      // residuais do fechamento anterior (ex: kaminoNetUsd) vaze para
      // os registros de Abertura e Monitorando seguintes.
      mergedPositionPnlUsd = null;
      mergedPositionEntryUsd = status.positionEntryUsd ?? null;
      mergedPositionFeesUsd = null;
    } else if (action === "close-position") {
      mergedPositionMint = eventPositionMint ?? mergedPositionMint;
      mergedPositionEntryUsd = resolveEntryFallback(eventPositionEntryUsd ?? mergedPositionEntryUsd, mergedPositionMint);
      mergedPositionFeesUsd = eventPositionFeesUsd ?? mergedPositionFeesUsd;
      mergedPositionExitUsd = eventPositionExitUsd ?? null;
      if (mergedPositionExitUsd != null && mergedPositionEntryUsd != null) {
        mergedPositionPnlUsd = mergedPositionExitUsd - mergedPositionEntryUsd;
      }
    } else if (action === "rebalanced" || action === "kamino-rebalanced") {
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
    const hedgeClose = action === "close-position"
      ? (options?.hedgeClose ?? this.lastHedgeClose ?? null)
      : null;

    if (!status.lastAction || status.lastAction === "no-action") {
      if (status.positionMint) {
        const timestamp = new Date().toISOString();
        const openedAt = mergedPositionMint ? this.openedAtByMint.get(mergedPositionMint) ?? null : null;
        const actionType = resolveActionType("resume-position");
        const trendForMint = this.resolveTrendForMint(mergedPositionMint, trendNow);
        const hedgeDecision = decisionForMint(mergedPositionMint);
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
          hedgeFeesUsd: null,
          hedgePnlUsd: null,
          hedgeDecision: hedgeDecision?.status ?? null,
          hedgeDecisionReason: hedgeDecision?.reason ?? null
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
      "cooldown-wait",
      "kamino-wait-funds"
    ];
    if (skipped.includes(status.lastAction)) {
      return;
    }
    if (action === "rebalanced" || action === "kamino-rebalanced") {
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
      const hedgeClose = options?.hedgeClose ?? null;
      const closeHedgeDecision = decisionForMint(closeMint);

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
        hedgeSymbol: hedgeClose?.symbol ?? null,
        hedgeNotionalUsd: hedgeClose?.notionalUsd ?? null,
        hedgeLeverage: hedgeClose?.leverage ?? null,
        hedgeFeesUsd: hedgeClose?.feesUsd ?? null,
        hedgePnlUsd: hedgeClose?.pnlUsd ?? null,
        hedgeDecision: closeHedgeDecision?.status ?? null,
        hedgeDecisionReason: closeHedgeDecision?.reason ?? null
      };
      this.pushEvent(closeEvent);
      if (closeMint) {
        this.trendByMint.delete(closeMint);
      }

      const openMint = status.positionMint ?? null;
      const openHedgeDecision = decisionForMint(openMint);
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
        hedgeFeesUsd: null,
        hedgePnlUsd: null,
        hedgeDecision: openHedgeDecision?.status ?? null,
        hedgeDecisionReason: openHedgeDecision?.reason ?? null
      };
      this.pushEvent(openEvent);
      if (closeMint) {
        this.hedgeDecisionByMint.delete(closeMint);
      }
      if (openMint && openHedgeDecision) {
        this.hedgeDecisionByMint.set(openMint, openHedgeDecision);
      }
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
    if ((action === "open-position" || action === "rebalanced" || action === "kamino-rebalanced") && mergedPositionMint) {
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
    const eventHedgeDecision = decisionForMint(mergedPositionMint);
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
      hedgeFeesUsd: hedgeClose?.feesUsd ?? null,
      hedgePnlUsd: hedgeClose?.pnlUsd ?? null,
      hedgeDecision: eventHedgeDecision?.status ?? null,
      hedgeDecisionReason: eventHedgeDecision?.reason ?? null
    };
    this.pushEvent(event);
    if (action === "close-position" && mergedPositionMint) {
      this.trendByMint.delete(mergedPositionMint);
      this.autoAddRequestedByMint.delete(mergedPositionMint);
      this.hedgeDecisionByMint.delete(mergedPositionMint);
    }
    if (action === "close-position") {
      this.lastHedgeClose = null;
    }
  }

  private flushQueuedHistory(): void {
    const queued = this.bot.drainHistoryActions();
    if (!queued.length) {
      return;
    }
    queued.forEach((snapshot) => {
      this.recordEvent(snapshot);
    });
  }

  private maybeRequestAutoAdd(status: BotStatus): void {
    if (!this.config.autoAddLiquidityEnabled) {
      return;
    }
    const mint = status.positionMint ?? null;
    if (!mint) {
      return;
    }
    if (status.lastAction !== "no-action") {
      return;
    }
    if (this.autoAddRequestedByMint.has(mint)) {
      return;
    }
    this.autoAddRequestedByMint.add(mint);
    if (this.onAutoAddRequest) {
      this.onAutoAddRequest(this.poolId);
    }
  }

  private pushEvent(event: HistoryEvent): void {
    if ((event.action === "resume-position" || event.action === "skip-low-sol-position") && this.history.length > 0) {
      let matchIndex = -1;
      for (let i = this.history.length - 1; i >= 0; i -= 1) {
        const candidate = this.history[i];
        if (candidate?.action === event.action && candidate?.positionMint === event.positionMint) {
          matchIndex = i;
          break;
        }
      }
      if (matchIndex >= 0) {
        const previous = this.history[matchIndex];
        this.history[matchIndex] = { ...event, id: previous.id, timestamp: previous.timestamp };
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
        const storedKaminoState = (parsed as { kaminoState?: KaminoCycleState | null } | null)?.kaminoState ?? null;
        if (storedKaminoState) {
          this.bot.setKaminoState(storedKaminoState);
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
            if (next.action === "rebalanced" || next.action === "kamino-rebalanced") {
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
              if (next.action === "open-position" || ((next.action === "rebalanced" || next.action === "kamino-rebalanced") && rebalanceTrusted)) {
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
          const autoAddByMint = new Set<string>();
          for (const item of normalized) {
            if (!item.positionMint) {
              continue;
            }
            if (item.action === "add-liquidity") {
              autoAddByMint.add(item.positionMint);
            }
            if (item.action === "close-position") {
              autoAddByMint.delete(item.positionMint);
            }
          }
          const hedgeDecisionByMint = new Map<string, { status: "opened" | "skipped" | "failed"; reason: string | null }>();
          for (const item of normalized) {
            const mint = item.positionMint ?? null;
            if (!mint) {
              continue;
            }
            if (item.action === "open-position") {
              const decision = item.hedgeDecision;
              if (decision === "opened" || decision === "skipped" || decision === "failed") {
                hedgeDecisionByMint.set(mint, { status: decision, reason: item.hedgeDecisionReason ?? null });
              }
            }
            if (item.action === "close-position") {
              hedgeDecisionByMint.delete(mint);
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
          this.hedgeDecisionByMint = hedgeDecisionByMint;
          this.autoAddRequestedByMint = autoAddByMint;
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
        hedgeState: this.hedgeManager.getState(),
        kaminoState: this.bot.getKaminoState()
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

  private addHedgeLog(entry: Omit<HedgeLogEntry, "id" | "timestamp"> & { timestamp?: string }): void {
    const timestamp = entry.timestamp ?? new Date().toISOString();
    const log: HedgeLogEntry = {
      id: this.createLogId(timestamp),
      timestamp,
      level: entry.level,
      action: entry.action,
      message: entry.message,
      symbol: entry.symbol ?? null,
      qty: entry.qty ?? null,
      notionalUsd: entry.notionalUsd ?? null,
      leverage: entry.leverage ?? null,
      pnlUsd: entry.pnlUsd ?? null
    };
    this.hedgeLogs.push(log);
    if (this.hedgeLogs.length > MAX_HEDGE_LOGS) {
      this.hedgeLogs.splice(0, this.hedgeLogs.length - MAX_HEDGE_LOGS);
    }
  }

  private addKaminoLog(entry: KaminoLogItem): void {
    const timestamp = entry.timestamp ?? new Date().toISOString();
    const log: KaminoLogEntry = {
      id: this.createKaminoLogId(timestamp),
      timestamp,
      level: entry.level,
      action: entry.action,
      message: entry.message,
      marketAddress: entry.marketAddress ?? null,
      poolId: this.poolId ?? null,
      poolName: this.poolName ?? null
    };
    this.kaminoLogs.push(log);
    if (this.kaminoLogs.length > MAX_KAMINO_LOGS) {
      this.kaminoLogs.splice(0, this.kaminoLogs.length - MAX_KAMINO_LOGS);
    }
  }

  private flushKaminoLogs(): void {
    const logs = this.bot.drainKaminoLogs();
    if (!logs.length) {
      return;
    }
    logs.forEach((item) => this.addKaminoLog(item));
  }

  private logHedgeOpen(message: string): void {
    const state = this.hedgeManager.getState();
    this.addHedgeLog({
      level: "info",
      action: "open",
      message,
      symbol: state?.symbol ?? null,
      qty: state?.qty ?? null,
      notionalUsd: state?.notionalUsd ?? null,
      leverage: state?.leverage ?? null,
      pnlUsd: null
    });
  }

  private logHedgeClose(result: HedgeCloseResult, message: string): void {
    this.addHedgeLog({
      level: "info",
      action: "close",
      message,
      symbol: result.symbol ?? null,
      qty: result.qty ?? null,
      notionalUsd: result.notionalUsd ?? null,
      leverage: result.leverage ?? null,
      pnlUsd: result.pnlUsd ?? null,
      timestamp: result.closedAt ?? undefined
    });
  }

  private logHedgeSkip(message: string, symbol?: string | null): void {
    this.addHedgeLog({
      level: "info",
      action: "open-skip",
      message,
      symbol: symbol ? String(symbol).trim().toUpperCase() : null,
      qty: null,
      notionalUsd: null,
      leverage: null,
      pnlUsd: null
    });
  }

  private logHedgeError(action: "open-failed" | "close-failed", message: string, symbol?: string | null): void {
    this.addHedgeLog({
      level: "error",
      action,
      message,
      symbol: symbol ? String(symbol).trim().toUpperCase() : null,
      qty: null,
      notionalUsd: null,
      leverage: null,
      pnlUsd: null
    });
  }

  private createLogId(timestamp: string): string {
    const parsed = Date.parse(timestamp);
    const timePart = Number.isFinite(parsed) ? parsed.toString(36) : Date.now().toString(36);
    const rand = (this.logIdSeed++ % 1_000_000).toString(36);
    return `log_${timePart}_${rand}`;
  }

  private createKaminoLogId(timestamp: string): string {
    const parsed = Date.parse(timestamp);
    const timePart = Number.isFinite(parsed) ? parsed.toString(36) : Date.now().toString(36);
    const rand = (this.kaminoLogIdSeed++ % 1_000_000).toString(36);
    return `klog_${timePart}_${rand}`;
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
