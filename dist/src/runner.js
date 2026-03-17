import { withRetry } from "./retry.js";
import { logger } from "./logger.js";
import path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "data");
export class BotRunner {
    constructor(bot, config, options) {
        this.timer = null;
        this.running = false;
        this.inFlight = false;
        this.lastTickAt = null;
        this.history = [];
        this.lastEventPortfolioValue = null;
        this.lastEventPortfolioUsd = null;
        this.historyLoaded = false;
        this.resumeRecorded = false;
        this.bot = bot;
        this.config = config;
        this.historyFile = options?.historyFile ?? path.join(DATA_DIR, "history.json");
    }
    async init() {
        await this.loadHistoryIfNeeded();
    }
    async start() {
        if (this.running) {
            return;
        }
        await this.loadHistoryIfNeeded();
        this.running = true;
        await this.tickOnce();
        this.schedule();
    }
    stop() {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    async closePositionNow() {
        if (this.inFlight) {
            return this.getStatus();
        }
        this.inFlight = true;
        try {
            await withRetry(() => this.bot.closeActivePosition(), { retries: 2, baseDelayMs: 1000 });
            this.lastTickAt = new Date().toISOString();
            this.recordEvent(this.bot.getStatus());
        }
        catch (err) {
            logger.error({ err }, "close-position failed");
            this.bot.setError(err);
        }
        finally {
            this.inFlight = false;
        }
        return this.getStatus();
    }
    getStatus() {
        const status = this.bot.getStatus();
        return {
            ...status,
            running: this.running,
            lastTickAt: this.lastTickAt
        };
    }
    getHistory() {
        return [...this.history].reverse();
    }
    async clearHistory() {
        this.history = [];
        this.lastEventPortfolioValue = null;
        this.lastEventPortfolioUsd = null;
        await this.saveHistory();
    }
    schedule() {
        if (!this.running) {
            return;
        }
        this.timer = setTimeout(async () => {
            await this.tickOnce();
            this.schedule();
        }, this.config.pollIntervalMs);
    }
    async tickOnce() {
        if (this.inFlight) {
            return;
        }
        this.inFlight = true;
        try {
            await withRetry(() => this.bot.tick(), { retries: 3, baseDelayMs: 1000 });
            this.lastTickAt = new Date().toISOString();
            this.recordEvent(this.bot.getStatus());
        }
        catch (err) {
            logger.error({ err }, "tick failed");
            this.bot.setError(err);
        }
        finally {
            this.inFlight = false;
        }
    }
    recordEvent(status) {
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
            "out-of-range-wait"
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
        const event = {
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
    pushEvent(event) {
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
    async loadHistoryIfNeeded() {
        if (this.historyLoaded) {
            return;
        }
        this.historyLoaded = true;
        try {
            const raw = await fs.readFile(this.historyFile, "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.history)) {
                this.history = parsed.history;
            }
            if (typeof parsed?.lastEventPortfolioValue === "number") {
                this.lastEventPortfolioValue = parsed.lastEventPortfolioValue;
            }
            if (typeof parsed?.lastEventPortfolioUsd === "number") {
                this.lastEventPortfolioUsd = parsed.lastEventPortfolioUsd;
            }
        }
        catch {
            // ignore missing or invalid history
        }
    }
    async saveHistory() {
        try {
            await fs.mkdir(DATA_DIR, { recursive: true });
            const payload = {
                history: this.history,
                lastEventPortfolioValue: this.lastEventPortfolioValue,
                lastEventPortfolioUsd: this.lastEventPortfolioUsd
            };
            await fs.writeFile(this.historyFile, JSON.stringify(payload, null, 2), "utf8");
        }
        catch (err) {
            logger.warn({ err }, "failed to save history");
        }
    }
}
