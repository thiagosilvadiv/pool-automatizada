import path from "path";
import { fileURLToPath } from "url";
import { PublicKey, Transaction } from "@solana/web3.js";
import { createCloseAccountInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { Config } from "./config.js";
import { OrcaBot } from "./orca.js";
import { BotRunner } from "./runner.js";
import { logger } from "./logger.js";
import {
  createHistoryStore,
  createPoolsStore,
  createSwapAllowlistStore,
  PoolsStore,
  PoolsState,
  SwapAllowlistStore
} from "./storage.js";
import { getTrendSnapshot } from "./trend.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export type PoolEntry = {
  id: string;
  name: string;
  whirlpoolAddress: string;
  overrides?: PoolOverrides;
  createdAt: string;
};

export type PoolOverrides = {
  rangeWidthPct?: number;
  budgetUsd?: number | null;
  rangeExitBiasPct?: number;
  preferredExitToken?: "tokenA" | "tokenB" | null;
  trendEnabled?: boolean;
  trendTimeframe?: "1m" | "5m" | "15m" | "30m" | "1h";
  trendTargetUp?: "sol" | "other" | "tokenA" | "tokenB";
  trendTargetDown?: "sol" | "other" | "tokenA" | "tokenB";
  hedgeEnabled?: boolean;
  hedgePct?: number;
  hedgeSymbol?: string;
  hedgeLeverage?: number;
  hedgeMarginPct?: number;
};

export type PoolSummary = {
  id: string;
  name: string;
  whirlpoolAddress: string;
  createdAt: string;
  selected: boolean;
  running: boolean;
  lastAction: string | null;
  lastError: string | null;
  lastPrice: number | null;
  positionValueUsd: number | null;
  positionPnlUsd: number | null;
  positionValueSol: number | null;
  positionPnlSol: number | null;
  tokenAMint: string | null;
  tokenBMint: string | null;
  isTokenASol: boolean | null;
  isTokenBSol: boolean | null;
  trendDirection: "up" | "down" | null;
  trendUpdatedAt: string | null;
  trendTimeframe: "1m" | "5m" | "15m" | "30m" | "1h" | null;
  trendEnabled: boolean;
  trendStale: boolean;
  overrides: PoolOverrides | null;
};

export type CloseEmptyAccountsResult = {
  closedCount: number;
  failedCount: number;
  reclaimedLamports: number;
  signatures: string[];
};

type PoolRecord = {
  entry: PoolEntry;
  runner: BotRunner;
};

export class PoolManager {
  private baseConfig: Config;
  private connection: any;
  private wallet: any;
  private poolsStore!: PoolsStore<PoolEntry>;
  private swapAllowlistStore!: SwapAllowlistStore;
  private pools = new Map<string, PoolRecord>();
  private entries: PoolEntry[] = [];
  private selectedPoolId: string | null = null;
  private pendingAdds = new Set<string>();
  private autoCloseTimer: NodeJS.Timeout | null = null;
  private closeEmptyInFlight = false;
  private lastLowSolAutoCloseAt: number | null = null;
  private swapAllowlist: string[] = [];
  private swapAllowlistUpdatedAt: string | null = null;

  constructor(baseConfig: Config, connection: any, wallet: any) {
    this.baseConfig = baseConfig;
    this.connection = connection;
    this.wallet = wallet;
  }

  async init(): Promise<void> {
    this.poolsStore = await createPoolsStore<PoolEntry>();
    this.swapAllowlistStore = await createSwapAllowlistStore();
    await this.loadSwapAllowlist();
    await this.loadPools();
  }

  getSwapAllowlist(): { mints: string[]; updatedAt: string | null } {
    return { mints: [...this.swapAllowlist], updatedAt: this.swapAllowlistUpdatedAt };
  }

  async setSwapAllowlist(mints: string[]): Promise<{ mints: string[]; updatedAt: string }> {
    const normalized = this.normalizeSwapAllowlist(mints);
    const updatedAt = new Date().toISOString();
    this.swapAllowlist = normalized;
    this.swapAllowlistUpdatedAt = updatedAt;
    await this.swapAllowlistStore.save({ mints: normalized, updatedAt });
    for (const record of this.pools.values()) {
      record.runner.updateSwapAllowlist(normalized);
    }
    return { mints: normalized, updatedAt };
  }

  getSelectedPoolId(): string | null {
    return this.selectedPoolId;
  }

  getPoolConfig(id: string): Config | null {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) {
      return null;
    }
    return {
      ...this.baseConfig,
      whirlpoolAddress: entry.whirlpoolAddress,
      ...(entry.overrides ?? {})
    };
  }

  listPools(): PoolEntry[] {
    return [...this.entries];
  }

  async listSummaries(): Promise<PoolSummary[]> {
    return Promise.all(this.entries.map(async (entry) => {
      const record = this.pools.get(entry.id);
      const status = record?.runner.getStatus();
      const poolConfig: Config = {
        ...this.baseConfig,
        whirlpoolAddress: entry.whirlpoolAddress,
        ...(entry.overrides ?? {})
      };
      const trendEnabled = Boolean(poolConfig.trendEnabled);
      let trendDirection: "up" | "down" | null = null;
      let trendUpdatedAt: string | null = null;
      let trendTimeframe: "1m" | "5m" | "15m" | "30m" | "1h" | null = trendEnabled ? poolConfig.trendTimeframe : null;
      let trendStale = false;
      if (trendEnabled) {
        try {
          const snapshot = await getTrendSnapshot({
            networkId: poolConfig.trendNetworkId,
            poolAddress: entry.whirlpoolAddress,
            timeframe: poolConfig.trendTimeframe,
            staleSec: poolConfig.trendStaleSec,
            cacheSec: poolConfig.trendCacheSec
          });
          trendDirection = snapshot?.direction ?? null;
          trendUpdatedAt = snapshot?.updatedAt ?? null;
          trendTimeframe = snapshot?.timeframe ?? poolConfig.trendTimeframe ?? null;
          trendStale = snapshot?.stale ?? false;
        } catch (err) {
          trendDirection = null;
          trendUpdatedAt = null;
          trendTimeframe = poolConfig.trendTimeframe ?? null;
          trendStale = true;
        }
      }
      return {
        id: entry.id,
        name: entry.name,
        whirlpoolAddress: entry.whirlpoolAddress,
        createdAt: entry.createdAt,
        selected: entry.id === this.selectedPoolId,
        running: status?.running ?? false,
        lastAction: status?.lastAction ?? null,
        lastError: status?.lastError ?? null,
        lastPrice: status?.lastPrice ?? null,
        positionValueUsd: status?.positionValueUsd ?? null,
        positionPnlUsd: status?.positionPnlUsd ?? null,
        positionValueSol: status?.positionValue ?? null,
        positionPnlSol: status?.positionPnl ?? null,
        tokenAMint: status?.tokenAMint ?? null,
        tokenBMint: status?.tokenBMint ?? null,
        isTokenASol: status?.isTokenASol ?? null,
        isTokenBSol: status?.isTokenBSol ?? null,
        trendDirection,
        trendUpdatedAt,
        trendTimeframe,
        trendEnabled,
        trendStale,
        overrides: entry.overrides ?? null
      };
    }));
  }

  async selectPool(id: string): Promise<void> {
    if (!this.entries.find((entry) => entry.id === id)) {
      throw new Error("Pool not found");
    }
    this.selectedPoolId = id;
    await this.savePools();
  }

  async addPool(
    name: string,
    whirlpoolAddress: string,
    overrides?: PoolOverrides
  ): Promise<PoolEntry> {
    const trimmedName = name.trim();
    const trimmedAddress = whirlpoolAddress.trim();
    if (!trimmedName) {
      throw new Error("Pool name is required");
    }
    if (!trimmedAddress) {
      throw new Error("Whirlpool address is required");
    }
    // Validate address
    try {
      new PublicKey(trimmedAddress);
    } catch {
      throw new Error("Invalid whirlpool address");
    }

    if (this.pendingAdds.has(trimmedAddress)) {
      throw new Error("Pool is already being added");
    }
    if (this.entries.some((entry) => entry.whirlpoolAddress === trimmedAddress)) {
      throw new Error("Pool already exists");
    }

    this.pendingAdds.add(trimmedAddress);
    try {
    const normalizedOverrides = this.normalizeOverrides(overrides);

    const entry: PoolEntry = {
      id: this.generateId(),
      name: trimmedName,
      whirlpoolAddress: trimmedAddress,
      overrides: normalizedOverrides,
      createdAt: new Date().toISOString()
    };

    await this.createPool(entry);
    this.entries.push(entry);
    if (!this.selectedPoolId) {
      this.selectedPoolId = entry.id;
    }
    await this.savePools();
    return entry;
    } finally {
      this.pendingAdds.delete(trimmedAddress);
    }
  }

  async removePool(id: string): Promise<void> {
    const record = this.pools.get(id);
    if (record) {
      record.runner.stop();
      this.pools.delete(id);
    }
    this.entries = this.entries.filter((entry) => entry.id !== id);
    if (this.selectedPoolId === id) {
      this.selectedPoolId = this.entries[0]?.id ?? null;
    }
    await this.savePools();
  }

  async updatePoolOverrides(id: string, overrides: PoolOverrides): Promise<PoolEntry> {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) {
      throw new Error("Pool not found");
    }

    const updatedOverrides = this.applyOverrideUpdates(entry.overrides ?? {}, overrides);
    entry.overrides = Object.keys(updatedOverrides).length > 0 ? updatedOverrides : undefined;

    await this.savePools();

    const record = this.pools.get(id);
    if (record) {
      const poolConfig: Config = {
        ...this.baseConfig,
        whirlpoolAddress: entry.whirlpoolAddress,
        ...(entry.overrides ?? {})
      };
      record.runner.updateConfig(poolConfig);
    }

    return entry;
  }

  async startPool(id: string): Promise<void> {
    const record = this.getRecord(id);
    await record.runner.start();
  }

  stopPool(id: string): void {
    const record = this.getRecord(id);
    record.runner.stop();
  }

  async closePool(id: string): Promise<void> {
    const record = this.getRecord(id);
    await record.runner.closePositionNow();
  }

  getStatus(id: string): ReturnType<BotRunner["getStatus"]> | null {
    const record = this.pools.get(id);
    return record?.runner.getStatus() ?? null;
  }

  getHistory(id: string): ReturnType<BotRunner["getHistory"]> {
    const record = this.getRecord(id);
    return record.runner.getHistory();
  }

  getHedgeLogs(id: string): ReturnType<BotRunner["getHedgeLogs"]> {
    const record = this.getRecord(id);
    return record.runner.getHedgeLogs();
  }

  hasPool(id: string): boolean {
    return this.pools.has(id);
  }

  async clearHistory(id: string): Promise<void> {
    const record = this.getRecord(id);
    await record.runner.clearHistory();
  }

  async deleteHistoryEvents(id: string, ids: string[]): Promise<void> {
    const record = this.getRecord(id);
    await record.runner.deleteHistoryEvents(ids);
  }

  async startSelected(): Promise<void> {
    if (!this.selectedPoolId) {
      throw new Error("No pool selected");
    }
    await this.startPool(this.selectedPoolId);
  }

  stopSelected(): void {
    if (!this.selectedPoolId) {
      return;
    }
    this.stopPool(this.selectedPoolId);
  }

  async closeSelected(): Promise<void> {
    if (!this.selectedPoolId) {
      throw new Error("No pool selected");
    }
    await this.closePool(this.selectedPoolId);
  }

  async topUpSolSelected(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.selectedPoolId) {
      throw new Error("No pool selected");
    }
    const record = this.getRecord(this.selectedPoolId);
    const result = await record.runner.topUpSolNow();
    return { ok: result.ok, reason: result.reason };
  }

  async swapWalletToSolSelected(): Promise<{ ok: boolean; reason?: string; swaps: number; failed: number; totalOutLamports: number; details: any[] }> {
    if (!this.selectedPoolId) {
      throw new Error("No pool selected");
    }
    const record = this.getRecord(this.selectedPoolId);
    const result = await record.runner.swapWalletToSolNow();
    return {
      ok: result.ok,
      reason: result.reason,
      swaps: result.swaps,
      failed: result.failed,
      totalOutLamports: result.totalOutLamports,
      details: result.details ?? []
    };
  }

  startAutoCloseEmptyAccounts(): void {
    if (!this.baseConfig.autoCloseEmptyAccountsEnabled) {
      return;
    }
    const intervalMs = Math.max(1, this.baseConfig.autoCloseEmptyAccountsIntervalSec) * 1000;
    if (this.autoCloseTimer) {
      clearInterval(this.autoCloseTimer);
    }
    this.autoCloseTimer = setInterval(() => {
      void this.runAutoCloseEmptyAccounts();
    }, intervalMs);
  }

  async closeEmptyTokenAccounts(): Promise<CloseEmptyAccountsResult> {
    if (this.closeEmptyInFlight) {
      throw new Error("close-empty-accounts already running");
    }
    this.closeEmptyInFlight = true;
    try {
      const owner = this.wallet.publicKey;
      const ownerBase58 = owner.toBase58();
      const accounts = await this.connection.getParsedTokenAccountsByOwner(
        owner,
        { programId: TOKEN_PROGRAM_ID }
      );

      const candidates = accounts.value.filter((acct: any) => {
        const info = acct?.account?.data?.parsed?.info;
        if (!info || info.owner !== ownerBase58) {
          return false;
        }
        const amountStr = String(info.tokenAmount?.amount ?? "0");
        if (amountStr !== "0") {
          return false;
        }
        const closeAuthority = info.closeAuthority ?? null;
        if (closeAuthority && closeAuthority !== ownerBase58) {
          return false;
        }
        return true;
      });

      let closedCount = 0;
      let failedCount = 0;
      let reclaimedLamports = 0;
      const signatures: string[] = [];

      for (const acct of candidates) {
        const accountPubkey = acct.pubkey as PublicKey;
        const lamports = Number(acct?.account?.lamports ?? 0);
        try {
          const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
          const tx = new Transaction({
            feePayer: owner,
            recentBlockhash: blockhash
          }).add(createCloseAccountInstruction(accountPubkey, owner, owner));
          const signed = await this.wallet.signTransaction(tx);
          const sig = await this.connection.sendRawTransaction(signed.serialize(), { maxRetries: 2 });
          await this.connection.confirmTransaction(sig, "confirmed");
          closedCount += 1;
          reclaimedLamports += lamports;
          signatures.push(sig);
        } catch (err) {
          failedCount += 1;
          logger.warn({ err, account: accountPubkey.toBase58() }, "failed to close empty token account");
        }
      }

      return { closedCount, failedCount, reclaimedLamports, signatures };
    } finally {
      this.closeEmptyInFlight = false;
    }
  }

  async maybeCloseEmptyAccountsOnLowSol(): Promise<void> {
    if (!this.baseConfig.autoCloseEmptyAccountsOnLowSol) {
      return;
    }
    if (this.closeEmptyInFlight) {
      return;
    }
    const now = Date.now();
    const cooldownMs = Math.max(1, this.baseConfig.autoCloseEmptyAccountsLowSolCooldownSec) * 1000;
    if (this.lastLowSolAutoCloseAt && now - this.lastLowSolAutoCloseAt < cooldownMs) {
      logger.info({ cooldownSec: this.baseConfig.autoCloseEmptyAccountsLowSolCooldownSec }, "low-sol auto-close cooldown active");
      return;
    }
    this.lastLowSolAutoCloseAt = now;
    try {
      const result = await this.closeEmptyTokenAccounts();
      logger.info(
        {
          closedCount: result.closedCount,
          failedCount: result.failedCount,
          reclaimedLamports: result.reclaimedLamports
        },
        "low-sol auto-close empty token accounts complete"
      );
    } catch (err) {
      logger.warn({ err }, "low-sol auto-close empty token accounts failed");
    }
  }

  private async runAutoCloseEmptyAccounts(): Promise<void> {
    if (this.closeEmptyInFlight) {
      return;
    }
    try {
      const result = await this.closeEmptyTokenAccounts();
      logger.info(
        {
          closedCount: result.closedCount,
          failedCount: result.failedCount,
          reclaimedLamports: result.reclaimedLamports
        },
        "auto-close empty token accounts complete"
      );
    } catch (err) {
      logger.warn({ err }, "auto-close empty token accounts failed");
    }
  }

  getSelectedStatus(): ReturnType<BotRunner["getStatus"]> | null {
    if (!this.selectedPoolId) {
      return null;
    }
    return this.getStatus(this.selectedPoolId);
  }

  getSelectedHistory(): ReturnType<BotRunner["getHistory"]> {
    if (!this.selectedPoolId) {
      return [];
    }
    return this.getHistory(this.selectedPoolId);
  }

  getSelectedHedgeLogs(): ReturnType<BotRunner["getHedgeLogs"]> {
    if (!this.selectedPoolId) {
      return [];
    }
    return this.getHedgeLogs(this.selectedPoolId);
  }

  clearHedgeLogs(id: string): void {
    const record = this.getRecord(id);
    record.runner.clearHedgeLogs();
  }

  clearSelectedHedgeLogs(): void {
    if (!this.selectedPoolId) {
      return;
    }
    this.clearHedgeLogs(this.selectedPoolId);
  }

  async clearSelectedHistory(): Promise<void> {
    if (!this.selectedPoolId) {
      return;
    }
    await this.clearHistory(this.selectedPoolId);
  }

  async deleteSelectedHistoryEvents(ids: string[]): Promise<void> {
    if (!this.selectedPoolId) {
      return;
    }
    await this.deleteHistoryEvents(this.selectedPoolId, ids);
  }

  private getRecord(id: string): PoolRecord {
    const record = this.pools.get(id);
    if (!record) {
      throw new Error("Pool not found");
    }
    return record;
  }

  private async loadPools(): Promise<void> {
    let data: PoolsState<PoolEntry> | null = null;
    try {
      data = await this.poolsStore.load();
    } catch (err) {
      logger.warn({ err }, "failed to load pools store");
      data = null;
    }

    let pools = data?.pools ?? [];
    let selectedPoolId = data?.selectedPoolId ?? null;

    const deduped = this.deduplicatePools(pools);
    if (deduped.length !== pools.length) {
      logger.warn({ before: pools.length, after: deduped.length }, "duplicate pools detected; keeping most recent");
    }
    pools = deduped.map((entry) => {
      if (typeof entry.createdAt === "string" && entry.createdAt.trim()) {
        return entry;
      }
      return { ...entry, createdAt: new Date().toISOString() };
    });

    if (pools.length === 0 && this.baseConfig.whirlpoolAddress) {
      const entry: PoolEntry = {
        id: this.generateId(),
        name: "Pool principal",
        whirlpoolAddress: this.baseConfig.whirlpoolAddress,
        createdAt: new Date().toISOString()
      };
      pools = [entry];
      selectedPoolId = entry.id;
    }

    this.entries = pools;
    this.selectedPoolId = pools.find((entry) => entry.id === selectedPoolId)?.id ?? (pools[0]?.id ?? null);

    for (const entry of pools) {
      try {
        await this.createPool(entry);
      } catch (err) {
        logger.warn({ err, entry }, "failed to initialize pool");
      }
    }

    await this.savePools();
  }

  private async createPool(entry: PoolEntry): Promise<void> {
    const poolConfig: Config = {
      ...this.baseConfig,
      whirlpoolAddress: entry.whirlpoolAddress,
      ...(entry.overrides ?? {})
    };
    const bot = await OrcaBot.create({
      connection: this.connection,
      wallet: this.wallet,
      config: poolConfig,
      onLowSol: async () => {
        await this.maybeCloseEmptyAccountsOnLowSol();
      }
    });
    bot.setSwapAllowlist(this.swapAllowlist);
    const historyStore = await createHistoryStore(entry.id);
    const runner = new BotRunner(bot, poolConfig, { historyStore });
    await runner.init();
    runner.updateSwapAllowlist(this.swapAllowlist);
    this.pools.set(entry.id, { entry, runner });
  }

  private async savePools(): Promise<void> {
    const payload: PoolsState<PoolEntry> = {
      selectedPoolId: this.selectedPoolId,
      pools: this.entries
    };
    await this.poolsStore.save(payload);
  }

  private async loadSwapAllowlist(): Promise<void> {
    try {
      const state = await this.swapAllowlistStore.load();
      const rawMints = Array.isArray(state?.mints) ? state?.mints : [];
      this.swapAllowlist = this.normalizeSwapAllowlist(rawMints);
      this.swapAllowlistUpdatedAt = state?.updatedAt ?? null;
    } catch (err) {
      logger.warn({ err }, "failed to load swap allowlist");
      this.swapAllowlist = [];
      this.swapAllowlistUpdatedAt = null;
    }
  }

  private normalizeSwapAllowlist(mints: string[]): string[] {
    const normalized = Array.isArray(mints)
      ? mints.map((mint) => String(mint).trim()).filter((mint) => mint.length > 0)
      : [];
    return Array.from(new Set(normalized));
  }

  private normalizeOverrides(overrides?: PoolOverrides): PoolOverrides | undefined {
    if (!overrides) {
      return undefined;
    }
    const normalized: PoolOverrides = {};

    if (overrides.rangeWidthPct != null) {
      const value = Number(overrides.rangeWidthPct);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("rangeWidthPct override must be > 0");
      }
      normalized.rangeWidthPct = value;
    }

    if (overrides.budgetUsd != null) {
      const value = Number(overrides.budgetUsd);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("budgetUsd override must be >= 0");
      }
      normalized.budgetUsd = value === 0 ? null : value;
    }

    if (overrides.rangeExitBiasPct != null) {
      const value = Number(overrides.rangeExitBiasPct);
      if (!Number.isFinite(value) || value < 0 || value >= 100) {
        throw new Error("rangeExitBiasPct override must be between 0 and 99.9");
      }
      normalized.rangeExitBiasPct = value;
    }

    if (overrides.preferredExitToken != null) {
      const value = String(overrides.preferredExitToken);
      if (value !== "tokenA" && value !== "tokenB") {
        throw new Error("preferredExitToken override must be tokenA or tokenB");
      }
      normalized.preferredExitToken = value as "tokenA" | "tokenB";
    }

    if (overrides.trendEnabled != null) {
      const raw = overrides.trendEnabled as unknown;
      let value: boolean | null = null;
      if (typeof raw === "boolean") {
        value = raw;
      } else if (typeof raw === "string") {
        const normalizedValue = String(raw).trim().toLowerCase();
        if (["1", "true", "yes", "on", "sim"].includes(normalizedValue)) {
          value = true;
        } else if (["0", "false", "no", "off", "nao"].includes(normalizedValue)) {
          value = false;
        }
      }
      if (value === null) {
        throw new Error("trendEnabled override must be boolean");
      }
      normalized.trendEnabled = value;
    }

    if (overrides.trendTimeframe != null) {
      const value = String(overrides.trendTimeframe).trim().toLowerCase();
      if (!["1m", "5m", "15m", "30m", "1h"].includes(value)) {
        throw new Error("trendTimeframe override must be 1m, 5m, 15m, 30m, or 1h");
      }
      normalized.trendTimeframe = value as PoolOverrides["trendTimeframe"];
    }

    if (overrides.trendTargetUp != null) {
      const value = String(overrides.trendTargetUp).trim().toLowerCase();
      if (!["sol", "other", "tokena", "tokenb", "token_a", "token_b"].includes(value)) {
        throw new Error("trendTargetUp override must be sol, other, tokenA, or tokenB");
      }
      normalized.trendTargetUp = value.startsWith("token") ? (value.replace("_", "").toLowerCase() === "tokena" ? "tokenA" : "tokenB") : (value as PoolOverrides["trendTargetUp"]);
    }

    if (overrides.trendTargetDown != null) {
      const value = String(overrides.trendTargetDown).trim().toLowerCase();
      if (!["sol", "other", "tokena", "tokenb", "token_a", "token_b"].includes(value)) {
        throw new Error("trendTargetDown override must be sol, other, tokenA, or tokenB");
      }
      normalized.trendTargetDown = value.startsWith("token") ? (value.replace("_", "").toLowerCase() === "tokena" ? "tokenA" : "tokenB") : (value as PoolOverrides["trendTargetDown"]);
    }

    if (overrides.hedgeEnabled != null) {
      const raw = overrides.hedgeEnabled as unknown;
      let value: boolean | null = null;
      if (typeof raw === "boolean") {
        value = raw;
      } else if (typeof raw === "string") {
        const normalizedValue = String(raw).trim().toLowerCase();
        if (["1", "true", "yes", "on", "sim"].includes(normalizedValue)) {
          value = true;
        } else if (["0", "false", "no", "off", "nao"].includes(normalizedValue)) {
          value = false;
        }
      }
      if (value === null) {
        throw new Error("hedgeEnabled override must be boolean");
      }
      normalized.hedgeEnabled = value;
    }

    if (overrides.hedgePct != null) {
      const value = Number(overrides.hedgePct);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error("hedgePct override must be between 0 and 100");
      }
      normalized.hedgePct = value;
    }

    if (overrides.hedgeSymbol != null) {
      const value = String(overrides.hedgeSymbol).trim().toUpperCase();
      if (!value) {
        throw new Error("hedgeSymbol override must be a non-empty string");
      }
      normalized.hedgeSymbol = value;
    }

    if (overrides.hedgeLeverage != null) {
      const value = Number(overrides.hedgeLeverage);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error("hedgeLeverage override must be >= 1");
      }
      normalized.hedgeLeverage = value;
    }

    if (overrides.hedgeMarginPct != null) {
      const value = Number(overrides.hedgeMarginPct);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error("hedgeMarginPct override must be between 0 and 100");
      }
      normalized.hedgeMarginPct = value;
    }

    if (normalized.hedgeEnabled === true) {
      const symbol = normalized.hedgeSymbol ?? this.baseConfig.hedgeSymbol ?? "";
      if (!symbol || !symbol.trim()) {
        throw new Error("hedgeSymbol override required when hedgeEnabled is true");
      }
      const pct = normalized.hedgePct ?? this.baseConfig.hedgePct;
      if (!Number.isFinite(pct) || pct <= 0) {
        throw new Error("hedgePct must be > 0 when hedgeEnabled is true");
      }
      if (!this.baseConfig.bybitApiKey || !this.baseConfig.bybitApiSecret) {
        throw new Error("BYBIT_API_KEY and BYBIT_API_SECRET are required when hedgeEnabled is true");
      }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  private applyOverrideUpdates(
    current: PoolOverrides,
    updates: PoolOverrides
  ): PoolOverrides {
    const next: PoolOverrides = { ...current };

    if ("rangeWidthPct" in updates) {
      if (updates.rangeWidthPct == null) {
        delete next.rangeWidthPct;
      } else {
        const value = Number(updates.rangeWidthPct);
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error("rangeWidthPct override must be > 0");
        }
        next.rangeWidthPct = value;
      }
    }

    if ("budgetUsd" in updates) {
      if (updates.budgetUsd == null) {
        next.budgetUsd = null;
      } else {
        const value = Number(updates.budgetUsd);
        if (!Number.isFinite(value) || value < 0) {
          throw new Error("budgetUsd override must be >= 0");
        }
        next.budgetUsd = value === 0 ? null : value;
      }
    }

    if ("rangeExitBiasPct" in updates) {
      if (updates.rangeExitBiasPct == null) {
        delete next.rangeExitBiasPct;
      } else {
        const value = Number(updates.rangeExitBiasPct);
        if (!Number.isFinite(value) || value < 0 || value >= 100) {
          throw new Error("rangeExitBiasPct override must be between 0 and 99.9");
        }
        next.rangeExitBiasPct = value;
      }
    }

    if ("preferredExitToken" in updates) {
      if (updates.preferredExitToken == null) {
        delete next.preferredExitToken;
      } else {
        const value = String(updates.preferredExitToken);
        if (value !== "tokenA" && value !== "tokenB") {
          throw new Error("preferredExitToken override must be tokenA or tokenB");
        }
        next.preferredExitToken = value as "tokenA" | "tokenB";
      }
    }

    if ("trendEnabled" in updates) {
      if (updates.trendEnabled == null) {
        delete next.trendEnabled;
      } else {
        const raw = updates.trendEnabled as unknown;
        let value: boolean | null = null;
        if (typeof raw === "boolean") {
          value = raw;
        } else if (typeof raw === "string") {
          const normalizedValue = String(raw).trim().toLowerCase();
          if (["1", "true", "yes", "on", "sim"].includes(normalizedValue)) {
            value = true;
          } else if (["0", "false", "no", "off", "nao"].includes(normalizedValue)) {
            value = false;
          }
        }
        if (value === null) {
          throw new Error("trendEnabled override must be boolean");
        }
        next.trendEnabled = value;
      }
    }

    if ("trendTimeframe" in updates) {
      if (updates.trendTimeframe == null) {
        delete next.trendTimeframe;
      } else {
        const value = String(updates.trendTimeframe).trim().toLowerCase();
        if (!["1m", "5m", "15m", "30m", "1h"].includes(value)) {
          throw new Error("trendTimeframe override must be 1m, 5m, 15m, 30m, or 1h");
        }
        next.trendTimeframe = value as PoolOverrides["trendTimeframe"];
      }
    }

    if ("trendTargetUp" in updates) {
      if (updates.trendTargetUp == null) {
        delete next.trendTargetUp;
      } else {
        const value = String(updates.trendTargetUp).trim().toLowerCase();
        if (!["sol", "other", "tokena", "tokenb", "token_a", "token_b"].includes(value)) {
          throw new Error("trendTargetUp override must be sol, other, tokenA, or tokenB");
        }
        next.trendTargetUp = value.startsWith("token") ? (value.replace("_", "").toLowerCase() === "tokena" ? "tokenA" : "tokenB") : (value as PoolOverrides["trendTargetUp"]);
      }
    }

    if ("trendTargetDown" in updates) {
      if (updates.trendTargetDown == null) {
        delete next.trendTargetDown;
      } else {
        const value = String(updates.trendTargetDown).trim().toLowerCase();
        if (!["sol", "other", "tokena", "tokenb", "token_a", "token_b"].includes(value)) {
          throw new Error("trendTargetDown override must be sol, other, tokenA, or tokenB");
        }
        next.trendTargetDown = value.startsWith("token") ? (value.replace("_", "").toLowerCase() === "tokena" ? "tokenA" : "tokenB") : (value as PoolOverrides["trendTargetDown"]);
      }
    }

    if ("hedgeEnabled" in updates) {
      if (updates.hedgeEnabled == null) {
        delete next.hedgeEnabled;
      } else {
        const raw = updates.hedgeEnabled as unknown;
        let value: boolean | null = null;
        if (typeof raw === "boolean") {
          value = raw;
        } else if (typeof raw === "string") {
          const normalizedValue = String(raw).trim().toLowerCase();
          if (["1", "true", "yes", "on", "sim"].includes(normalizedValue)) {
            value = true;
          } else if (["0", "false", "no", "off", "nao"].includes(normalizedValue)) {
            value = false;
          }
        }
        if (value === null) {
          throw new Error("hedgeEnabled override must be boolean");
        }
        next.hedgeEnabled = value;
      }
    }

    if ("hedgePct" in updates) {
      if (updates.hedgePct == null) {
        delete next.hedgePct;
      } else {
        const value = Number(updates.hedgePct);
        if (!Number.isFinite(value) || value < 0 || value > 100) {
          throw new Error("hedgePct override must be between 0 and 100");
        }
        next.hedgePct = value;
      }
    }

    if ("hedgeSymbol" in updates) {
      if (updates.hedgeSymbol == null) {
        delete next.hedgeSymbol;
      } else {
        const value = String(updates.hedgeSymbol).trim().toUpperCase();
        if (!value) {
          throw new Error("hedgeSymbol override must be a non-empty string");
        }
        next.hedgeSymbol = value;
      }
    }

    if ("hedgeLeverage" in updates) {
      if (updates.hedgeLeverage == null) {
        delete next.hedgeLeverage;
      } else {
        const value = Number(updates.hedgeLeverage);
        if (!Number.isFinite(value) || value < 1) {
          throw new Error("hedgeLeverage override must be >= 1");
        }
        next.hedgeLeverage = value;
      }
    }

    if ("hedgeMarginPct" in updates) {
      if (updates.hedgeMarginPct == null) {
        delete next.hedgeMarginPct;
      } else {
        const value = Number(updates.hedgeMarginPct);
        if (!Number.isFinite(value) || value < 0 || value > 100) {
          throw new Error("hedgeMarginPct override must be between 0 and 100");
        }
        next.hedgeMarginPct = value;
      }
    }

    if (next.hedgeEnabled === true) {
      const symbol = next.hedgeSymbol ?? this.baseConfig.hedgeSymbol ?? "";
      if (!symbol || !symbol.trim()) {
        throw new Error("hedgeSymbol override required when hedgeEnabled is true");
      }
      const pct = next.hedgePct ?? this.baseConfig.hedgePct;
      if (!Number.isFinite(pct) || pct <= 0) {
        throw new Error("hedgePct must be > 0 when hedgeEnabled is true");
      }
      if (!this.baseConfig.bybitApiKey || !this.baseConfig.bybitApiSecret) {
        throw new Error("BYBIT_API_KEY and BYBIT_API_SECRET are required when hedgeEnabled is true");
      }
    }

    return next;
  }

  private deduplicatePools(pools: PoolEntry[]): PoolEntry[] {
    const byAddress = new Map<string, PoolEntry>();
    for (const entry of pools) {
      const key = entry.whirlpoolAddress;
      const existing = byAddress.get(key);
      if (!existing) {
        byAddress.set(key, entry);
        continue;
      }
      const existingTime = Date.parse(existing.createdAt);
      const entryTime = Date.parse(entry.createdAt);
      if (!Number.isNaN(entryTime) && (Number.isNaN(existingTime) || entryTime > existingTime)) {
        byAddress.set(key, entry);
      }
    }
    return Array.from(byAddress.values());
  }

  private generateId(): string {
    const now = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `pool_${now}_${rand}`;
  }
}
