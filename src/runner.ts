import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { OrcaBot, BotStatus } from "./orca.js";
import { Config } from "./config.js";
import { withRetry } from "./retry.js";
import { logger } from "./logger.js";
import { HistoryStore } from "./storage.js";

function isEntryUsdSane(entryUsd: number, budgetUsd: number | null, portfolioUsd: number | null): boolean {
  if (!Number.isFinite(entryUsd) || entryUsd < 0) {
    return false;
  }
  const budget = Number.isFinite(budgetUsd ?? NaN) ? Number(budgetUsd) : null;
  const portfolio = Number.isFinite(portfolioUsd ?? NaN) ? Number(portfolioUsd) : null;
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
      return "operacional";
    default:
      return "operacional";
  }
}

export type RunnerStatus = BotStatus & {
  running: boolean;
  lastTickAt: string | null;
};

export type HistoryEvent = {
  id: string;
  timestamp: string;
  positionOpenedAt: string | null;
  positionClosedAt: string | null;
  actionType: string | null;
  action: string | null;
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

  constructor(bot: OrcaBot, config: Config, options: { historyStore: HistoryStore }) {
    this.bot = bot;
    this.config = config;
    this.historyStore = options.historyStore;
  }

  async init(): Promise<void> {
    await this.loadHistoryIfNeeded();
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
      return this.getStatus();
    }
    this.inFlight = true;
    try {
      await withRetry(() => this.bot.closeActivePosition(), { retries: 2, baseDelayMs: 1000 });
      this.lastTickAt = new Date().toISOString();
      this.recordEvent(this.bot.getStatus());
    } catch (err) {
      logger.error({ err }, "close-position failed");
      this.bot.setError(err);
    } finally {
      this.inFlight = false;
    }
    return this.getStatus();
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

  getStatus(): RunnerStatus {
    const status = this.bot.getStatus();
    return {
      ...status,
      running: this.running,
      lastTickAt: this.lastTickAt
    };
  }

  updateConfig(config: Config): void {
    const prevInterval = this.config.pollIntervalMs;
    this.config = config;
    this.bot.updateConfig(config);
    if (this.running && prevInterval !== config.pollIntervalMs) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.schedule();
    }
  }

  getHistory(): HistoryEvent[] {
    return [...this.history].reverse();
  }

  async clearHistory(): Promise<void> {
    this.history = [];
    this.lastEventPortfolioValue = null;
    this.lastEventPortfolioUsd = null;
    this.entryByMint = new Map();
    await this.historyStore.clear();
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
        if (isEntryUsdSane(item.positionEntryUsd, item.budgetUsd ?? null, item.portfolioUsd ?? null)) {
          entryByMint.set(item.positionMint, item.positionEntryUsd);
        }
      }
    }
    this.entryByMint = entryByMint;
    await this.saveHistory();
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
    this.inFlight = true;
    try {
      await withRetry(() => this.bot.tick(), { retries: 3, baseDelayMs: 1000 });
      this.lastTickAt = new Date().toISOString();
      this.recordEvent(this.bot.getStatus());
    } catch (err) {
      logger.error({ err }, "tick failed");
      this.bot.setError(err);
    } finally {
      this.inFlight = false;
    }
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
      return isEntryUsdSane(fallback, status.budgetUsd ?? null, status.portfolioUsd ?? null)
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

    if (!status.lastAction || status.lastAction === "no-action") {
      if (status.positionMint) {
        const timestamp = new Date().toISOString();
        const openedAt = mergedPositionMint ? this.openedAtByMint.get(mergedPositionMint) ?? null : null;
        const actionType = resolveActionType("resume-position");
        this.pushEvent({
          id: this.createEventId(timestamp),
          timestamp,
          positionOpenedAt: openedAt,
          positionClosedAt: null,
          actionType,
          action: "resume-position",
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
          pnlDeltaUsd: null
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

      const closeEvent: HistoryEvent = {
        id: this.createEventId(timestamp),
        timestamp,
        positionOpenedAt: closeOpenedAt,
        positionClosedAt: timestamp,
        actionType: resolveActionType("close-position"),
        action: "close-position",
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
        pnlDeltaUsd: null
      };
      this.pushEvent(closeEvent);

      const openMint = status.positionMint ?? null;
      let openOpenedAt = openMint ? this.openedAtByMint.get(openMint) ?? null : null;
      if (openMint) {
        this.openedAtByMint.set(openMint, timestamp);
        openOpenedAt = timestamp;
      }
      const openEvent: HistoryEvent = {
        id: this.createEventId(timestamp),
        timestamp,
        positionOpenedAt: openOpenedAt,
        positionClosedAt: null,
        actionType: resolveActionType("open-position"),
        action: "open-position",
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
        pnlDeltaUsd: null
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
    const actionType = resolveActionType(action);
    const event: HistoryEvent = {
      id: this.createEventId(timestamp),
      timestamp,
      positionOpenedAt,
      positionClosedAt: action === "close-position" ? timestamp : null,
      actionType,
      action,
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
      pnlDeltaUsd
    };
    this.pushEvent(event);
  }

  private pushEvent(event: HistoryEvent): void {
    if ((event.action === "resume-position" || event.action === "skip-low-sol-position") && this.history.length > 0) {
      const last = this.history[this.history.length - 1];
      if (last?.action === event.action && last?.positionMint === event.positionMint) {
        this.history[this.history.length - 1] = { ...event, id: last.id, timestamp: last.timestamp };
        if (event.positionMint && typeof event.positionEntryUsd === "number") {
          if (isEntryUsdSane(event.positionEntryUsd, event.budgetUsd ?? null, event.portfolioUsd ?? null)) {
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
      if (isEntryUsdSane(event.positionEntryUsd, event.budgetUsd ?? null, event.portfolioUsd ?? null)) {
        this.entryByMint.set(event.positionMint, event.positionEntryUsd);
      }
    }
    if (this.history.length > 200) {
      this.history.shift();
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
          if (entryUsd != null && !isEntryUsdSane(entryUsd, budgetUsd, portfolioUsd)) {
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

            if (next.positionMint) {
              if (next.action === "open-position" || (next.action === "rebalanced" && rebalanceTrusted)) {
                openedByMint.set(next.positionMint, next.timestamp);
                if (!next.positionOpenedAt || next.positionOpenedAt !== next.timestamp) {
                  next = { ...next, positionOpenedAt: next.timestamp };
                  mutated = true;
                }
              } else {
                const openedAt = openedByMint.get(next.positionMint) ?? null;
                if (openedAt && next.positionOpenedAt !== openedAt) {
                  next = { ...next, positionOpenedAt: openedAt };
                  mutated = true;
                }
              }
            }

            normalized[i] = next;
            if (next.positionMint) {
              previousMint = next.positionMint;
            }
          }
          const entryByMint = new Map<string, number>();
          for (const item of normalized) {
            if (item.positionMint && typeof item.positionEntryUsd === "number") {
              if (isEntryUsdSane(item.positionEntryUsd, item.budgetUsd ?? null, item.portfolioUsd ?? null)) {
                entryByMint.set(item.positionMint, item.positionEntryUsd);
              }
            }
          }
          this.history = normalized;
          this.openedAtByMint = openedByMint;
          this.entryByMint = entryByMint;
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
        lastEventPortfolioUsd: this.lastEventPortfolioUsd
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
