import { OrcaBot, BotStatus } from "./orca.js";
import { Config } from "./config.js";
import { withRetry } from "./retry.js";
import { logger } from "./logger.js";
import { HistoryStore } from "./storage.js";

export type RunnerStatus = BotStatus & {
  running: boolean;
  lastTickAt: string | null;
};

export type HistoryEvent = {
  timestamp: string;
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
  private resumeRecorded = false;

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
    await this.historyStore.clear();
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
    if (!status.lastAction || status.lastAction === "no-action") {
      if (!this.resumeRecorded && status.positionMint) {
        this.resumeRecorded = true;
        this.pushEvent({
          timestamp: new Date().toISOString(),
          action: "resume-position",
          price: status.lastPrice,
          solUsdPrice: status.solUsdPrice,
          budgetUsd: status.budgetUsd,
          budgetSol: status.budgetSol,
          targetRange: status.targetRange,
          positionRange: status.positionRange,
          positionMint: status.positionMint,
          tokenABalance: status.tokenABalance,
          tokenBBalance: status.tokenBBalance,
          positionTokenA: status.positionTokenA,
          positionTokenB: status.positionTokenB,
          openTokenA: null,
          openTokenB: null,
          closeTokenA: null,
          closeTokenB: null,
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
    const pnlDelta = status.portfolioValue != null && this.lastEventPortfolioValue != null
      ? status.portfolioValue - this.lastEventPortfolioValue
      : null;
    const pnlDeltaUsd = status.portfolioUsd != null && this.lastEventPortfolioUsd != null
      ? status.portfolioUsd - this.lastEventPortfolioUsd
      : null;

    const event: HistoryEvent = {
      timestamp: new Date().toISOString(),
      action: status.lastAction,
      price: status.lastPrice,
      solUsdPrice: status.solUsdPrice,
      budgetUsd: status.budgetUsd,
      budgetSol: status.budgetSol,
      targetRange: status.targetRange,
      positionRange: status.positionRange,
      positionMint: status.positionMint,
      tokenABalance: status.tokenABalance,
      tokenBBalance: status.tokenBBalance,
      positionTokenA: status.positionTokenA,
      positionTokenB: status.positionTokenB,
      openTokenA: status.lastOpenTokenA,
      openTokenB: status.lastOpenTokenB,
      closeTokenA: status.lastCloseTokenA,
      closeTokenB: status.lastCloseTokenB,
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
    this.history.push(event);
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
        this.history = parsed.history as HistoryEvent[];
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
}
