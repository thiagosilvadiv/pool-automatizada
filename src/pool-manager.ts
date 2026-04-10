import path from "path";
import { fileURLToPath } from "url";
import { PublicKey, Transaction } from "@solana/web3.js";
import { createCloseAccountInstruction, TOKEN_PROGRAM_ID, NATIVE_MINT } from "@solana/spl-token";

import { Config } from "./config.js";
import { createKaminoClient } from "./kamino-client.js";
import { OrcaBot } from "./orca.js";
import { BotRunner } from "./runner.js";
import type { HistoryEvent } from "./runner.js";
import { logger, stringifyError } from "./logger.js";
import { BalanceCoordinator } from "./balance-coordinator.js";
import {
  createHistoryStore,
  createPoolsStore,
  createKaminoLoansStore,
  createSwapAllowlistStore,
  KaminoLoanEntry,
  KaminoLoansState,
  KaminoLoansStore,
  KaminoMarketEntry,
  PoolsStore,
  PoolsState,
  SwapAllowlistStore
} from "./storage.js";
import { getTrendSnapshot } from "./trend.js";
import { getSolUsdPrice } from "./pyth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEFAULT_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

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

function isFatalStartupErrorMessage(message: string): boolean {
  const text = String(message ?? "").toLowerCase();
  return text.includes("tokeninvalidaccountownererror")
    || text.includes("accountownererror")
    || text.includes("invalid account owner");
}

function normalizeStartupErrorMessage(raw: string): string {
  if (isFatalStartupErrorMessage(raw)) {
    return "Whirlpool/token incompatível: o endereço informado não parece uma Orca Whirlpool válida para este bot (mint owner inválido).";
  }
  return raw;
}
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
  rangeAnchor?: "lower" | "middle" | "upper" | null;
  preferredExitToken?: "tokenA" | "tokenB" | null;
  preferredExitDirection?: "down" | "up";
  trendEnabled?: boolean;
  trendTimeframe?: "1m" | "5m" | "15m" | "30m" | "1h";
  trendTargetUp?: "sol" | "other" | "tokenA" | "tokenB";
  trendTargetDown?: "sol" | "other" | "tokenA" | "tokenB";
  autoAddLiquidityEnabled?: boolean;
  kaminoRebalanceEnabled?: boolean;
  kaminoDepositPct?: number;
  kaminoBorrowAsset?: "usdc" | "usdt" | "auto";
  kaminoMarketAddress?: string | null;
  kaminoMaxLtv?: number;
  kaminoCloseRule?: "avg-price" | "breakeven" | "manual";
  kaminoPriceBufferPct?: number;
  kaminoIncludePoolLossInTarget?: boolean;
  kaminoCollateralMode?: "exit" | "max-value" | "tokenA" | "tokenB" | "both";
  kaminoAutoCloseOnTokenChange?: boolean;
  kaminoConvertToCollateral?: boolean;
  kaminoAvgPriceBasis?: "deposit" | "debt";
  kaminoAvgMode?: "cumulative" | "reset";
  hedgeEnabled?: boolean;
  hedgePct?: number;
  hedgeSymbol?: string;
  hedgeLeverage?: number;
  hedgeMarginPct?: number;
  hedgeEntryMode?: "off" | "trend-down" | "trend-up" | "trend-any" | "force-down" | "force-up";
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

export type AutoResumeStatus = {
  enabled: boolean;
  maxAttempts: number;
  baseDelayMs: number;
  activePoolIds: string[];
  pendingPoolIds: string[];
  inFlightPoolIds: string[];
  attempts: Record<string, number>;
  lastErrors: Record<string, string>;
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
  private pendingAutoAddPools = new Set<string>();
  private autoAddInProgress = false;
  private autoAddTimer: NodeJS.Timeout | null = null;
  private autoAddScanTimer: NodeJS.Timeout | null = null;
  private autoAddScanInFlight = false;
  private activePoolIds = new Set<string>();
  private resumeTimers = new Map<string, NodeJS.Timeout>();
  private resumeAttempts = new Map<string, number>();
  private resumeInFlight = new Set<string>();
  private resumeLastError = new Map<string, string>();
  private rehydratePoolsInFlight: Promise<boolean> | null = null;
  private kaminoLoansStore!: KaminoLoansStore;
  private kaminoLoansState: KaminoLoansState = { loans: [], updatedAt: null };
  private kaminoMarkets: KaminoMarketEntry[] = [];
  private kaminoScanTimer: NodeJS.Timeout | null = null;
  private kaminoScanInFlight = false;
  private kaminoScanCooldownUntil: number | null = null;
  private balanceCoordinator = new BalanceCoordinator();

  constructor(baseConfig: Config, connection: any, wallet: any) {
    this.baseConfig = baseConfig;
    this.connection = connection;
    this.wallet = wallet;
  }

  async init(): Promise<void> {
    this.poolsStore = await createPoolsStore<PoolEntry>();
    this.swapAllowlistStore = await createSwapAllowlistStore();
    this.kaminoLoansStore = await createKaminoLoansStore();
    this.kaminoLoansState = (await this.kaminoLoansStore.load()) ?? { loans: [], updatedAt: null };
    await this.loadSwapAllowlist();
    await this.loadPools();
    if (this.baseConfig.autoResumeEnabled) {
      await this.resumeActivePools();
    }
    this.startKaminoLoansScan();
    this.startAutoAddLiquidityChecks();
  }

  getSwapAllowlist(): { mints: string[]; updatedAt: string | null } {
    return { mints: [...this.swapAllowlist], updatedAt: this.swapAllowlistUpdatedAt };
  }

  setKaminoMarkets(markets: KaminoMarketEntry[]): void {
    this.kaminoMarkets = Array.isArray(markets) ? markets.map((item) => ({ ...item })) : [];
    void this.scanKaminoLoans();
  }

  getKaminoLoans(): KaminoLoanEntry[] {
    return Array.isArray(this.kaminoLoansState.loans)
      ? this.kaminoLoansState.loans.map((loan) => ({ ...loan }))
      : [];
  }

  listKaminoMarketCandidates(): string[] {
    return this.collectKaminoMarketAddresses();
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

  getAutoResumeStatus(): AutoResumeStatus {
    return {
      enabled: Boolean(this.baseConfig.autoResumeEnabled),
      maxAttempts: this.baseConfig.autoResumeMaxAttempts,
      baseDelayMs: this.baseConfig.autoResumeBaseDelayMs,
      activePoolIds: [...this.activePoolIds],
      pendingPoolIds: [...this.resumeTimers.keys()],
      inFlightPoolIds: [...this.resumeInFlight],
      attempts: Object.fromEntries(this.resumeAttempts),
      lastErrors: Object.fromEntries(this.resumeLastError)
    };
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
    if (this.entries.length > 0) {
      return [...this.entries];
    }
    if (this.pools.size > 0) {
      return Array.from(this.pools.values()).map((record) => record.entry);
    }
    return [];
  }

  async ensurePoolsHydrated(): Promise<boolean> {
    const hasEntries = this.entries.length > 0;
    const hasRecords = this.pools.size > 0;
    if (hasEntries && hasRecords) {
      return false;
    }
    if (this.rehydratePoolsInFlight) {
      return this.rehydratePoolsInFlight;
    }
    this.rehydratePoolsInFlight = this.rehydratePoolsFromStore();
    try {
      return await this.rehydratePoolsInFlight;
    } finally {
      this.rehydratePoolsInFlight = null;
    }
  }

  async listSummaries(): Promise<PoolSummary[]> {
    return Promise.all(this.entries.map(async (entry) => {
      const record = this.pools.get(entry.id);
      const status = record?.runner.getStatus();
      const poolConfig: Config = {
        ...this.baseConfig,
        whirlpoolAddress: entry.whirlpoolAddress,
        ...(entry.overrides ?? {}),
        // Força hedge/trend desligados na listagem (evita chamadas externas)
        trendEnabled: false,
        hedgeEnabled: false,
        hedgeEntryMode: "off"
      };
      const trendEnabled = false;
      const hedgeEntryMode = "off";
      const trendUses = false;
      const trendRequested = false;
      const trendDirection: "up" | "down" | null = null;
      const trendUpdatedAt: string | null = null;
      const trendTimeframe: "1m" | "5m" | "15m" | "30m" | "1h" | null = null;
      const trendStale = false;
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
    this.balanceCoordinator.clearPool(id);
    this.clearResumeTracking(id);
    this.activePoolIds.delete(id);
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
    await this.startPoolInternal(id, { persistState: true, source: "manual" });
  }

  async stopPool(id: string): Promise<void> {
    const record = this.getRecord(id);
    record.runner.stop();
    this.balanceCoordinator.clearPool(id);
    this.clearResumeTracking(id);
    if (this.activePoolIds.delete(id)) {
      await this.savePools();
    }
  }

  async closePool(id: string): Promise<void> {
    const record = this.getRecord(id);
    await record.runner.closePositionNow();
    this.clearResumeTracking(id);
    if (this.activePoolIds.delete(id)) {
      await this.savePools();
    }
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

  async updateHistoryEvent(
    id: string,
    eventId: string,
    field: keyof HistoryEvent,
    value: number
  ): Promise<void> {
    const record = this.getRecord(id);
    await record.runner.updateHistoryEvent(eventId, field, value);
  }

  async startSelected(): Promise<void> {
    if (!this.selectedPoolId) {
      throw new Error("No pool selected");
    }
    await this.startPool(this.selectedPoolId);
  }

  async stopSelected(): Promise<void> {
    if (!this.selectedPoolId) {
      return;
    }
    await this.stopPool(this.selectedPoolId);
  }

  async closeSelected(): Promise<void> {
    if (!this.selectedPoolId) {
      throw new Error("No pool selected");
    }
    await this.closePool(this.selectedPoolId);
  }

  async resetSelectedKaminoCycle(clearPools = false): Promise<void> {
    if (!this.selectedPoolId) {
      return;
    }
    await this.resetKaminoCycle(this.selectedPoolId, clearPools);
  }

  async resetKaminoCycle(id: string, clearPools = false): Promise<void> {
    const record = this.getRecord(id);
    record.runner.resetKaminoCycle();
    if (clearPools) {
      const store = await createPoolsStore<PoolEntry>();
      await store.save({ selectedPoolId: null, activePoolIds: [], pools: [] });
    }
  }

  async closeKaminoCycleSelected(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.selectedPoolId) {
      throw new Error("No pool selected");
    }
    const record = this.getRecord(this.selectedPoolId);
    const result = await record.runner.closeKaminoCycleNow();
    return { ok: result.ok, reason: result.reason };
  }

  async testKaminoSelected(input: {
    collateralMint: string;
    collateralAmount: number;
    borrowUsd?: number;
  }): Promise<{ ok: boolean; reason?: string; depositSig?: string; borrowSig?: string }> {
    if (!this.selectedPoolId) {
      throw new Error("No pool selected");
    }
    const record = this.getRecord(this.selectedPoolId);
    const result = await record.runner.testKaminoNow(input);
    return {
      ok: result.ok,
      reason: result.reason,
      depositSig: result.depositSig,
      borrowSig: result.borrowSig
    };
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

  async addLiquiditySelected(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.selectedPoolId) {
      throw new Error("No pool selected");
    }
    const record = this.getRecord(this.selectedPoolId);
    return record.runner.autoAddLiquidity({});
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

  getKaminoLogs(id: string): ReturnType<BotRunner["getKaminoLogs"]> {
    const record = this.getRecord(id);
    return record.runner.getKaminoLogs();
  }

  getKaminoHealth(id: string): ReturnType<BotRunner["getKaminoHealth"]> {
    const record = this.getRecord(id);
    return record.runner.getKaminoHealth();
  }

  getSelectedKaminoLogs(): ReturnType<BotRunner["getKaminoLogs"]> {
    if (!this.selectedPoolId) {
      return [];
    }
    return this.getKaminoLogs(this.selectedPoolId);
  }

  clearHedgeLogs(id: string): void {
    const record = this.getRecord(id);
    record.runner.clearHedgeLogs();
  }

  clearKaminoLogs(id: string): void {
    const record = this.getRecord(id);
    record.runner.clearKaminoLogs();
  }

  clearSelectedHedgeLogs(): void {
    if (!this.selectedPoolId) {
      return;
    }
    this.clearHedgeLogs(this.selectedPoolId);
  }

  clearSelectedKaminoLogs(): void {
    if (!this.selectedPoolId) {
      return;
    }
    this.clearKaminoLogs(this.selectedPoolId);
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

  async updateSelectedHistoryEvent(
    eventId: string,
    field: keyof HistoryEvent,
    value: number
  ): Promise<void> {
    if (!this.selectedPoolId) {
      throw new Error("No pool selected");
    }
    await this.updateHistoryEvent(this.selectedPoolId, eventId, field, value);
  }

  private startKaminoLoansScan(): void {
    if (this.kaminoScanTimer) {
      clearInterval(this.kaminoScanTimer);
    }
    const intervalMs = Math.max(5000, Number(this.baseConfig.kaminoScanIntervalSec ?? 30) * 1000);
    this.kaminoScanTimer = setInterval(() => {
      void this.scanKaminoLoans();
    }, intervalMs);
    void this.scanKaminoLoans();
  }

  private collectKaminoMarketAddresses(): string[] {
    const markets = new Set<string>();
    const baseMarket = this.baseConfig.kaminoMarketAddress
      ?? process.env.KAMINO_MARKET
      ?? process.env.KAMINO_MAIN_MARKET
      ?? null;
    if (baseMarket) markets.add(baseMarket.trim());
    for (const entry of this.entries) {
      const overrideMarket = entry.overrides?.kaminoMarketAddress ?? null;
      if (overrideMarket) markets.add(String(overrideMarket).trim());
    }
    for (const entry of this.kaminoMarkets) {
      if (entry.address) markets.add(String(entry.address).trim());
    }
    const mainMarket = process.env.KAMINO_MAIN_MARKET ? String(process.env.KAMINO_MAIN_MARKET).trim() : "";
    if (mainMarket) {
      markets.add(mainMarket);
    }
    for (const loan of this.kaminoLoansState.loans ?? []) {
      if (loan.marketAddress) markets.add(String(loan.marketAddress).trim());
    }
    return Array.from(markets).filter((addr) => addr);
  }

  private resolveKaminoLoanOwner(marketAddress: string, existing?: KaminoLoanEntry): { id: string | null; name: string | null } {
    if (existing?.ownerPoolId) {
      return { id: existing.ownerPoolId, name: existing.ownerPoolName ?? null };
    }
    for (const record of this.pools.values()) {
      const status = record.runner.getStatus();
      if (status?.kaminoMarketAddress && status.kaminoMarketAddress === marketAddress && status.kaminoOwnerPoolId) {
        return { id: status.kaminoOwnerPoolId, name: status.kaminoOwnerPoolName ?? null };
      }
    }
    const candidates = this.entries.filter((entry) => {
      const market = entry.overrides?.kaminoMarketAddress
        ?? this.baseConfig.kaminoMarketAddress
        ?? process.env.KAMINO_MARKET
        ?? null;
      return market && marketAddress && market === marketAddress;
    });
    if (candidates.length === 1) {
      return { id: candidates[0].id, name: candidates[0].name };
    }
    return { id: null, name: null };
  }

  private async computeKaminoUsd(
    deposits: { mint: string; amount: number }[],
    borrows: { mint: string; amount: number }[]
  ): Promise<{ collateralUsd: number | null; debtUsd: number | null }> {
    const usdcMint = (this.baseConfig.autoSwapFeesToUsdcTargetMint || DEFAULT_USDC_MINT).trim() || DEFAULT_USDC_MINT;
    const usdtMint = String(process.env.KAMINO_USDT_MINT ?? DEFAULT_USDT_MINT).trim() || DEFAULT_USDT_MINT;
    let solUsdPrice: number | null = null;
    const needsSol = deposits.some((item) => item.mint === NATIVE_MINT.toBase58())
      || borrows.some((item) => item.mint === NATIVE_MINT.toBase58());
    if (needsSol) {
      const feedId = this.baseConfig.pythSolUsdFeedId;
      if (feedId) {
        try {
          const price = await getSolUsdPrice(
            this.connection,
            feedId,
            this.baseConfig.priceStaleMaxSec ?? null,
            30000
          );
          solUsdPrice = price.price;
        } catch (err) {
          logger.warn({ err }, "falha ao ler SOL/USD para Kamino loans");
        }
      }
    }
    let collateralUsd = 0;
    let collateralPriced = false;
    for (const dep of deposits) {
      if (!dep.mint || !Number.isFinite(dep.amount)) continue;
      if (dep.mint === usdcMint || dep.mint === usdtMint) {
        collateralUsd += dep.amount;
        collateralPriced = true;
      } else if (dep.mint === NATIVE_MINT.toBase58() && solUsdPrice != null) {
        collateralUsd += dep.amount * solUsdPrice;
        collateralPriced = true;
      }
    }
    let debtUsd = 0;
    let debtPriced = false;
    for (const bor of borrows) {
      if (!bor.mint || !Number.isFinite(bor.amount)) continue;
      if (bor.mint === usdcMint || bor.mint === usdtMint) {
        debtUsd += bor.amount;
        debtPriced = true;
      } else if (bor.mint === NATIVE_MINT.toBase58() && solUsdPrice != null) {
        debtUsd += bor.amount * solUsdPrice;
        debtPriced = true;
      }
    }
    return {
      collateralUsd: collateralPriced ? collateralUsd : null,
      debtUsd: debtPriced ? debtUsd : null
    };
  }

  private async scanKaminoLoans(): Promise<void> {
    if (this.kaminoScanInFlight) {
      return;
    }
    if (this.baseConfig.dryRun || process.env.KAMINO_NOOP === "true") {
      return;
    }
    const nowMs = Date.now();
    if (this.kaminoScanCooldownUntil && nowMs < this.kaminoScanCooldownUntil) {
      return;
    }
    this.kaminoScanInFlight = true;
    try {
      const markets = this.collectKaminoMarketAddresses();
      if (!markets.length) {
        return;
      }
      const now = new Date().toISOString();
      const existingByMarket = new Map<string, KaminoLoanEntry>(
        (this.kaminoLoansState.loans ?? []).map((loan) => [loan.marketAddress, loan])
      );
      const nextByMarket = new Map<string, KaminoLoanEntry>();
      for (const [market, loan] of existingByMarket.entries()) {
        nextByMarket.set(market, loan);
      }
      for (const marketAddress of markets) {
        const existing = existingByMarket.get(marketAddress);
        try {
          const kamino = await createKaminoClient(
            { connection: this.connection, wallet: this.wallet, config: this.baseConfig },
            marketAddress
          );
          const position = await kamino.getPositionState();
          const hasDebt = (position?.debtAmount ?? 0) > 0;
          const hasCollateral = (position?.collateralAmount ?? 0) > 0;
          if (!position || (!hasDebt && !hasCollateral)) {
            if (existing) {
              nextByMarket.set(marketAddress, {
                ...existing,
                lastError: "Sem posicao ativa no market",
                lastSeenAt: existing.lastSeenAt ?? now
              });
            }
            continue;
          }

          const deposits = Array.isArray(position.deposits) ? position.deposits : [];
          const borrows = Array.isArray(position.borrows) ? position.borrows : [];
          const owner = this.resolveKaminoLoanOwner(marketAddress, existing);
          const usd = await this.computeKaminoUsd(deposits, borrows);
          const depositEntries: {
            mint: string;
            amount: number;
            avgPriceUsdc: number | null;
            targetPriceUsdc: number | null;
          }[] = [];
          for (const dep of deposits) {
            const mint = String(dep?.mint ?? "").trim();
            if (!mint) {
              continue;
            }
            const prev = Array.isArray(existing?.deposits)
              ? existing.deposits.find((item) => item.mint === mint)
              : null;
            depositEntries.push({
              mint,
              amount: Number(dep?.amount ?? 0),
              avgPriceUsdc: prev?.avgPriceUsdc ?? null,
              targetPriceUsdc: prev?.targetPriceUsdc ?? null
            });
          }
          // Tentar obter avgPriceUsdc/targetPriceUsdc do kaminoState
          // interno da pool (mais preciso que o valor do loan anterior).
          let liveAvgPriceUsdc: number | null = existing?.avgPriceUsdc ?? null;
          let liveTargetPriceUsdc: number | null = existing?.targetPriceUsdc ?? null;
          let ownerRecord: PoolRecord | undefined;
          if (owner.id && this.pools.has(owner.id)) {
            ownerRecord = this.pools.get(owner.id);
            if (ownerRecord) {
              const ownerStatus = ownerRecord.runner.getStatus();
              if (
                Number.isFinite(ownerStatus.kaminoAvgPriceUsdc ?? NaN) &&
                (ownerStatus.kaminoAvgPriceUsdc ?? 0) > 0
              ) {
                liveAvgPriceUsdc = ownerStatus.kaminoAvgPriceUsdc!;
              }
              if (
                Number.isFinite(ownerStatus.kaminoTargetPriceUsdc ?? NaN) &&
                (ownerStatus.kaminoTargetPriceUsdc ?? 0) > 0
              ) {
                liveTargetPriceUsdc = ownerStatus.kaminoTargetPriceUsdc!;
              }
            }
          }
          const updated: KaminoLoanEntry = {
            id: existing?.id ?? marketAddress,
            marketAddress,
            ownerPoolId: owner.id ?? null,
            ownerPoolName: owner.name ?? null,
            collateralUsd: usd.collateralUsd,
            debtUsd: usd.debtUsd,
            avgPriceUsdc: liveAvgPriceUsdc,
            targetPriceUsdc: liveTargetPriceUsdc,
            deposits: depositEntries,
            borrows,
            lastSeenAt: now,
            lastError: null
          };
          nextByMarket.set(marketAddress, updated);

          if (owner.id && this.pools.has(owner.id)) {
            const record = ownerRecord ?? this.pools.get(owner.id);
            if (record) {
              // Não sobrescrever o kaminoState se o runner está executando
              // uma operação (deposit/borrow em andamento). Isso evita que o
              // scan sobrescreva avgPriceUsdc com null no meio de um ciclo.
              if (!record.runner.isBusy()) {
                record.runner.recoverKaminoFromLoan(updated);
              }
            }
          }
        } catch (err) {
          if (isRateLimitError(err)) {
            const cooldownMs = 60_000;
            this.kaminoScanCooldownUntil = Date.now() + cooldownMs;
            if (existing) {
              nextByMarket.set(marketAddress, {
                ...existing,
                lastError: "Rate limit Kamino (429); aguardando antes de re-tentar.",
                lastSeenAt: existing.lastSeenAt ?? now
              });
            }
            break;
          }
          if (existing) {
            nextByMarket.set(marketAddress, {
              ...existing,
              lastError: stringifyError(err),
              lastSeenAt: existing.lastSeenAt ?? now
            });
          }
        }
      }
      this.kaminoLoansState = {
        loans: Array.from(nextByMarket.values()),
        updatedAt: now
      };
      await this.kaminoLoansStore.save(this.kaminoLoansState);
    } catch (err) {
      logger.warn({ err }, "kamino loans scan failed");
    } finally {
      this.kaminoScanInFlight = false;
    }
  }

  private async resumeActivePools(): Promise<void> {
    const validIds = [...this.activePoolIds].filter((id) => this.entries.some((entry) => entry.id === id));
    if (validIds.length !== this.activePoolIds.size) {
      this.activePoolIds = new Set(validIds);
      await this.savePools();
    }
    for (const id of validIds) {
      await this.tryResumePool(id);
    }
  }

  private async startPoolInternal(
    id: string,
    options: { persistState: boolean; source: "manual" | "resume" }
  ): Promise<void> {
    const record = this.getRecord(id);
    const status = record.runner.getStatus();
    if (status.running) {
      if (!this.activePoolIds.has(id)) {
        this.activePoolIds.add(id);
        if (options.persistState) {
          await this.savePools();
        }
      }
      this.clearResumeTracking(id);
      return;
    }
    await record.runner.start();
    const startedStatus = record.runner.getStatus();
    const startupError = (startedStatus.lastError ?? "").trim();
    if (!startedStatus.lastTickAt && startupError && isFatalStartupErrorMessage(startupError)) {
      record.runner.stop();
      this.balanceCoordinator.clearPool(id);
      this.clearResumeTracking(id);
      throw new Error(normalizeStartupErrorMessage(startupError));
    }
    const shouldPersist = options.persistState && !this.activePoolIds.has(id);
    this.activePoolIds.add(id);
    this.clearResumeTracking(id);
    if (shouldPersist) {
      await this.savePools();
    }
    logger.info({ poolId: id, source: options.source }, "pool started");
  }

  private async tryResumePool(id: string): Promise<void> {
    if (!this.baseConfig.autoResumeEnabled) {
      return;
    }
    if (!this.activePoolIds.has(id)) {
      this.clearResumeTracking(id);
      return;
    }
    if (this.resumeInFlight.has(id)) {
      return;
    }
    const existingTimer = this.resumeTimers.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.resumeTimers.delete(id);
    }
    this.resumeInFlight.add(id);
    const attempt = (this.resumeAttempts.get(id) ?? 0) + 1;
    this.resumeAttempts.set(id, attempt);
    logger.info(
      { poolId: id, attempt, maxAttempts: this.baseConfig.autoResumeMaxAttempts },
      "attempting auto-resume pool start"
    );
    try {
      await this.startPoolInternal(id, { persistState: false, source: "resume" });
      logger.info({ poolId: id, attempt }, "pool auto-resume succeeded");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.resumeLastError.set(id, message);
      if (attempt < this.baseConfig.autoResumeMaxAttempts) {
        const delayMs = this.computeResumeBackoffDelay(attempt);
        logger.warn({ poolId: id, attempt, delayMs, err }, "pool auto-resume failed; scheduling retry");
        const timer = setTimeout(() => {
          this.resumeTimers.delete(id);
          void this.tryResumePool(id);
        }, delayMs);
        this.resumeTimers.set(id, timer);
      } else {
        logger.error(
          { poolId: id, attempt, maxAttempts: this.baseConfig.autoResumeMaxAttempts, err },
          "pool auto-resume reached max attempts; waiting manual action or next restart"
        );
      }
    } finally {
      this.resumeInFlight.delete(id);
    }
  }

  private computeResumeBackoffDelay(attempt: number): number {
    const base = Math.max(100, this.baseConfig.autoResumeBaseDelayMs);
    const exponent = Math.max(0, attempt - 1);
    const delay = base * (2 ** exponent);
    return Math.min(delay, 10 * 60 * 1000);
  }

  private clearResumeTracking(id: string): void {
    const timer = this.resumeTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.resumeTimers.delete(id);
    }
    this.resumeAttempts.delete(id);
    this.resumeInFlight.delete(id);
    this.resumeLastError.delete(id);
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

    let pools = this.normalizeLoadedPools(data?.pools ?? []);
    let selectedPoolId = data?.selectedPoolId ?? null;
    const persistedActivePoolIds = this.normalizePoolIdList((data as any)?.activePoolIds);

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
    this.activePoolIds = new Set(
      persistedActivePoolIds.filter((id) => pools.some((entry) => entry.id === id))
    );

    for (const entry of pools) {
      try {
        await this.createPool(entry);
      } catch (err) {
        logger.warn({ err, entry }, "failed to initialize pool");
      }
    }

    await this.savePools();
  }

  private async rehydratePoolsFromStore(): Promise<boolean> {
    const hadEntries = this.entries.length > 0;
    const hadRecords = this.pools.size > 0;
    if (hadEntries && hadRecords) {
      return false;
    }

    let data: PoolsState<PoolEntry> | null = null;
    try {
      data = await this.poolsStore.load();
    } catch (err) {
      logger.warn({ err }, "failed to rehydrate pools from store");
      return false;
    }

    const storedPools = this.normalizeLoadedPools(data?.pools ?? []);
    if (!storedPools.length) {
      return false;
    }

    const currentEntries = this.entries.length > 0
      ? [...this.entries]
      : Array.from(this.pools.values()).map((record) => record.entry);
    const mergedPools = this.normalizeLoadedPools([...currentEntries, ...storedPools]);
    const missingEntries = this.entries.length === 0 || mergedPools.length !== this.entries.length;
    if (missingEntries) {
      this.entries = mergedPools;
    }

    const desiredSelectedPoolId = data?.selectedPoolId ?? this.selectedPoolId ?? mergedPools[0]?.id ?? null;
    this.selectedPoolId = mergedPools.find((entry) => entry.id === desiredSelectedPoolId)?.id
      ?? (mergedPools[0]?.id ?? null);

    const persistedActivePoolIds = this.normalizePoolIdList((data as any)?.activePoolIds);
    if (persistedActivePoolIds.length > 0 || this.activePoolIds.size === 0) {
      this.activePoolIds = new Set(
        persistedActivePoolIds.filter((id) => mergedPools.some((entry) => entry.id === id))
      );
    }

    let createdCount = 0;
    for (const entry of mergedPools) {
      if (this.pools.has(entry.id)) {
        continue;
      }
      try {
        await this.createPool(entry);
        createdCount += 1;
      } catch (err) {
        logger.warn({ err, entry }, "failed to rehydrate missing pool record");
      }
    }

    const recovered = missingEntries || createdCount > 0;
    if (recovered) {
      logger.warn(
        {
          restoredEntries: mergedPools.length,
          recreatedRecords: createdCount,
          hadEntries,
          hadRecords
        },
        "pool state disappeared from memory; rehydrated from store"
      );
      await this.savePools();
      if (createdCount > 0 && this.baseConfig.autoResumeEnabled && this.activePoolIds.size > 0) {
        await this.resumeActivePools();
      }
    }
    return recovered;
  }

  private async createPool(entry: PoolEntry): Promise<void> {
    const poolConfig: Config = {
      ...this.baseConfig,
      whirlpoolAddress: entry.whirlpoolAddress,
      ...(entry.overrides ?? {})
    };
    const createBot = async () => OrcaBot.create({
      connection: this.connection,
      wallet: this.wallet,
      config: poolConfig,
      skipWarmup: true,
      poolId: entry.id,
      balanceCoordinator: this.balanceCoordinator,
      getKaminoMarketCandidates: () => this.collectKaminoMarketAddresses(),
      onLowSol: async () => {
        await this.maybeCloseEmptyAccountsOnLowSol();
      }
    });
    let bot: OrcaBot | null = null;
    let lastCreateError: unknown = null;
    const maxCreateAttempts = 3;
    for (let attempt = 1; attempt <= maxCreateAttempts; attempt += 1) {
      try {
        bot = await createBot();
        break;
      } catch (err) {
        lastCreateError = err;
        if (attempt < maxCreateAttempts && isRateLimitError(err)) {
          logger.warn(
            { err, poolId: entry.id, whirlpool: entry.whirlpoolAddress, attempt },
            "rate limit while creating pool; retrying"
          );
          await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
          continue;
        }
      }
    }
    if (!bot) {
      const reason = stringifyError(lastCreateError).trim() || "erro sem detalhes";
      throw new Error(`Falha ao inicializar pool (${entry.name}): ${reason}`);
    }
    bot.setSwapAllowlist(this.swapAllowlist);
    const historyStore = await createHistoryStore(entry.id);
    const runner = new BotRunner(bot, poolConfig, {
      historyStore,
      poolId: entry.id,
      poolName: entry.name,
      onAutoAddRequest: (poolId) => {
        this.queueAutoAdd(poolId);
      }
    });
    try {
      await runner.init();
    } catch (err) {
      const reason = stringifyError(err).trim() || "erro sem detalhes";
      throw new Error(`Falha ao iniciar runner da pool (${entry.name}): ${reason}`);
    }
    runner.updateSwapAllowlist(this.swapAllowlist);
    this.pools.set(entry.id, { entry, runner });
  }

  private async savePools(): Promise<void> {
    const payload: PoolsState<PoolEntry> = {
      selectedPoolId: this.selectedPoolId,
      activePoolIds: this.entries
        .map((entry) => entry.id)
        .filter((id) => this.activePoolIds.has(id)),
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

  private queueAutoAdd(poolId: string): void {
    if (!poolId) {
      return;
    }
    this.pendingAutoAddPools.add(poolId);
    this.scheduleAutoAdd();
  }

  private startAutoAddLiquidityChecks(): void {
    if (this.autoAddScanTimer) {
      clearInterval(this.autoAddScanTimer);
    }
    const intervalMs = Math.max(60, Number(this.baseConfig.autoAddLiquidityCheckIntervalSec ?? 300)) * 1000;
    this.autoAddScanTimer = setInterval(() => {
      void this.runPeriodicAutoAddCheck();
    }, intervalMs);
  }

  private async runPeriodicAutoAddCheck(): Promise<void> {
    if (this.autoAddScanInFlight) {
      return;
    }
    this.autoAddScanInFlight = true;
    try {
      for (const [id, record] of this.pools.entries()) {
        if (!record.runner.isAutoAddEnabled()) {
          continue;
        }
        const status = record.runner.getStatus();
        if (!status?.running || !status?.positionMint) {
          continue;
        }
        if (record.runner.isBusy()) {
          continue;
        }
        this.queueAutoAdd(id);
      }
    } finally {
      this.autoAddScanInFlight = false;
    }
  }

  private scheduleAutoAdd(): void {
    if (this.autoAddInProgress || this.autoAddTimer) {
      return;
    }
    this.autoAddTimer = setTimeout(() => {
      this.autoAddTimer = null;
      void this.processAutoAddQueue();
    }, 1500);
  }

  private async processAutoAddQueue(): Promise<void> {
    if (this.autoAddInProgress) {
      return;
    }
    this.autoAddInProgress = true;
    try {
      const pendingIds = Array.from(this.pendingAutoAddPools);
      if (!pendingIds.length) {
        return;
      }
      const eligible: string[] = [];
      for (const id of pendingIds) {
        const record = this.pools.get(id);
        if (!record) {
          this.pendingAutoAddPools.delete(id);
          continue;
        }
        if (!record.runner.isAutoAddEnabled()) {
          this.pendingAutoAddPools.delete(id);
          continue;
        }
        const status = record.runner.getStatus();
        if (!status.positionMint) {
          this.pendingAutoAddPools.delete(id);
          continue;
        }
        eligible.push(id);
      }

      if (!eligible.length) {
        return;
      }

      const anyBusy = eligible.some((id) => this.pools.get(id)?.runner.isBusy());
      if (anyBusy) {
        this.scheduleAutoAdd();
        return;
      }

      const share = 1 / eligible.length;
      const balancesList = await Promise.all(eligible.map(async (id) => {
        const record = this.pools.get(id);
        if (!record) {
          return { id, balances: null as { tokenA: number; tokenB: number } | null };
        }
        try {
          const balances = await record.runner.getWalletBalances();
          return { id, balances };
        } catch (err) {
          logger.warn({ err, poolId: id }, "failed to fetch wallet balances for auto-add");
          return { id, balances: null as { tokenA: number; tokenB: number } | null };
        }
      }));

      const limitsById = new Map<string, { maxTokenA: number; maxTokenB: number }>();
      for (const item of balancesList) {
        if (!item.balances) {
          continue;
        }
        const maxTokenA = Number.isFinite(item.balances.tokenA) ? item.balances.tokenA * share : 0;
        const maxTokenB = Number.isFinite(item.balances.tokenB) ? item.balances.tokenB * share : 0;
        limitsById.set(item.id, { maxTokenA, maxTokenB });
      }

      for (const id of eligible) {
        const record = this.pools.get(id);
        if (!record) {
          this.pendingAutoAddPools.delete(id);
          continue;
        }
        const limits = limitsById.get(id);
        if (!limits) {
          this.pendingAutoAddPools.delete(id);
          continue;
        }
        const result = await record.runner.autoAddLiquidity(limits);
        if (!result.ok) {
          logger.warn({ poolId: id, reason: result.reason }, "auto-add liquidity failed");
        }
        this.pendingAutoAddPools.delete(id);
      }
    } finally {
      this.autoAddInProgress = false;
      if (this.pendingAutoAddPools.size > 0) {
        this.scheduleAutoAdd();
      }
    }
  }

  private normalizeSwapAllowlist(mints: string[]): string[] {
    const normalized = Array.isArray(mints)
      ? mints.map((mint) => String(mint).trim()).filter((mint) => mint.length > 0)
      : [];
    return Array.from(new Set(normalized));
  }

  private normalizePoolIdList(ids: unknown): string[] {
    if (!Array.isArray(ids)) {
      return [];
    }
    const normalized = ids
      .map((id) => String(id ?? "").trim())
      .filter((id) => id.length > 0);
    return Array.from(new Set(normalized));
  }

  private normalizeLoadedPools(pools: PoolEntry[]): PoolEntry[] {
    const deduped = this.deduplicatePools(Array.isArray(pools) ? pools : []);
    if (deduped.length !== pools.length) {
      logger.warn({ before: pools.length, after: deduped.length }, "duplicate pools detected; keeping most recent");
    }
    return deduped.map((entry) => {
      if (typeof entry.createdAt === "string" && entry.createdAt.trim()) {
        return entry;
      }
      return { ...entry, createdAt: new Date().toISOString() };
    });
  }

  private normalizeOverrides(overrides?: PoolOverrides): PoolOverrides | undefined {
    if (!overrides) {
      return undefined;
    }
    const sanitized = overrides as Record<string, unknown>;
    delete sanitized.pnlTargetUsd;
    delete sanitized.pnlTargetPct;
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

    if (overrides.rangeAnchor != null) {
      const value = String(overrides.rangeAnchor).trim().toLowerCase();
      if (value !== "lower" && value !== "middle" && value !== "upper") {
        throw new Error("rangeAnchor override must be lower, middle, or upper");
      }
      normalized.rangeAnchor = value as "lower" | "middle" | "upper";
    }

    if (overrides.preferredExitToken != null) {
      const value = String(overrides.preferredExitToken);
      if (value !== "tokenA" && value !== "tokenB") {
        throw new Error("preferredExitToken override must be tokenA or tokenB");
      }
      normalized.preferredExitToken = value as "tokenA" | "tokenB";
    }
    if (overrides.preferredExitDirection != null) {
      const value = String(overrides.preferredExitDirection).trim().toLowerCase();
      if (value !== "down" && value !== "up") {
        throw new Error("preferredExitDirection override must be down or up");
      }
      normalized.preferredExitDirection = value as "down" | "up";
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

    if (overrides.autoAddLiquidityEnabled != null) {
      const raw = overrides.autoAddLiquidityEnabled as unknown;
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
        throw new Error("autoAddLiquidityEnabled override must be boolean");
      }
      normalized.autoAddLiquidityEnabled = value;
    }

    if (overrides.kaminoRebalanceEnabled != null) {
      const raw = overrides.kaminoRebalanceEnabled as unknown;
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
        throw new Error("kaminoRebalanceEnabled override must be boolean");
      }
      normalized.kaminoRebalanceEnabled = value;
    }

    if (overrides.kaminoDepositPct != null) {
      const value = Number(overrides.kaminoDepositPct);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error("kaminoDepositPct override must be between 0 and 100");
      }
      normalized.kaminoDepositPct = value;
    }

    if (overrides.kaminoBorrowAsset != null) {
      const value = String(overrides.kaminoBorrowAsset).trim().toLowerCase();
      if (!["usdc", "usdt", "auto"].includes(value)) {
        throw new Error("kaminoBorrowAsset override must be usdc, usdt, or auto");
      }
      normalized.kaminoBorrowAsset = value as PoolOverrides["kaminoBorrowAsset"];
    }

    if (overrides.kaminoMarketAddress != null) {
      const value = String(overrides.kaminoMarketAddress).trim();
      if (!value) {
        throw new Error("kaminoMarketAddress override must be a non-empty string");
      }
      normalized.kaminoMarketAddress = value;
    }

    if (overrides.kaminoMaxLtv != null) {
      const value = Number(overrides.kaminoMaxLtv);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error("kaminoMaxLtv override must be between 0 and 1");
      }
      normalized.kaminoMaxLtv = value;
    }

    if (overrides.kaminoCloseRule != null) {
      const value = String(overrides.kaminoCloseRule).trim().toLowerCase();
      if (!["avg-price", "breakeven", "manual"].includes(value)) {
        throw new Error("kaminoCloseRule override must be avg-price, breakeven, or manual");
      }
      normalized.kaminoCloseRule = value as PoolOverrides["kaminoCloseRule"];
    }

    if (overrides.kaminoPriceBufferPct != null) {
      const value = Number(overrides.kaminoPriceBufferPct);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("kaminoPriceBufferPct override must be >= 0");
      }
      normalized.kaminoPriceBufferPct = value;
    }

    if (overrides.kaminoIncludePoolLossInTarget != null) {
      const raw = overrides.kaminoIncludePoolLossInTarget as unknown;
      if (typeof raw === "boolean") {
        normalized.kaminoIncludePoolLossInTarget = raw;
      } else if (typeof raw === "string") {
        const value = raw.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(value)) {
          normalized.kaminoIncludePoolLossInTarget = true;
        } else if (["0", "false", "no", "off"].includes(value)) {
          normalized.kaminoIncludePoolLossInTarget = false;
        } else {
          throw new Error("kaminoIncludePoolLossInTarget override must be boolean");
        }
      } else {
        throw new Error("kaminoIncludePoolLossInTarget override must be boolean");
      }
    }

    if (overrides.kaminoCollateralMode != null) {
      const value = String(overrides.kaminoCollateralMode).trim().toLowerCase();
      if (!["exit", "max-value", "both", "dual", "tokena", "tokenb", "token_a", "token_b"].includes(value)) {
        throw new Error("kaminoCollateralMode override must be exit, max-value, tokenA, tokenB, or both");
      }
      if (value === "tokena" || value === "token_a") {
        normalized.kaminoCollateralMode = "tokenA";
      } else if (value === "tokenb" || value === "token_b") {
        normalized.kaminoCollateralMode = "tokenB";
      } else if (value === "dual") {
        normalized.kaminoCollateralMode = "both";
      } else {
        normalized.kaminoCollateralMode = value as PoolOverrides["kaminoCollateralMode"];
      }
    }
    if (overrides.kaminoAutoCloseOnTokenChange != null) {
      const raw = overrides.kaminoAutoCloseOnTokenChange as unknown;
      let value: boolean | null = null;
      if (typeof raw === "boolean") {
        value = raw;
      } else if (typeof raw === "string") {
        const normalizedValue = raw.trim().toLowerCase();
        if (["true", "1", "yes", "sim", "on"].includes(normalizedValue)) {
          value = true;
        } else if (["false", "0", "no", "nao", "off"].includes(normalizedValue)) {
          value = false;
        }
      }
      if (value === null) {
        throw new Error("kaminoAutoCloseOnTokenChange override must be boolean");
      }
      normalized.kaminoAutoCloseOnTokenChange = value;
    }

    if (overrides.kaminoConvertToCollateral != null) {
      const raw = overrides.kaminoConvertToCollateral as unknown;
      let value: boolean | null = null;
      if (typeof raw === "boolean") {
        value = raw;
      } else if (typeof raw === "string") {
        const normalizedValue = raw.trim().toLowerCase();
        if (["true", "1", "yes", "sim", "on"].includes(normalizedValue)) {
          value = true;
        } else if (["false", "0", "no", "nao", "off"].includes(normalizedValue)) {
          value = false;
        }
      }
      if (value === null) {
        throw new Error("kaminoConvertToCollateral override must be boolean");
      }
      normalized.kaminoConvertToCollateral = value;
    }

    if (overrides.kaminoAvgPriceBasis != null) {
      const value = String(overrides.kaminoAvgPriceBasis).trim().toLowerCase();
      if (!["deposit", "debt"].includes(value)) {
        throw new Error("kaminoAvgPriceBasis override must be deposit or debt");
      }
      normalized.kaminoAvgPriceBasis = value as PoolOverrides["kaminoAvgPriceBasis"];
    }

    if (overrides.kaminoAvgMode != null) {
      const value = String(overrides.kaminoAvgMode).trim().toLowerCase();
      if (!["cumulative", "reset"].includes(value)) {
        throw new Error("kaminoAvgMode override must be cumulative or reset");
      }
      normalized.kaminoAvgMode = value as PoolOverrides["kaminoAvgMode"];
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

    if (overrides.hedgeEntryMode != null) {
      const value = String(overrides.hedgeEntryMode).trim().toLowerCase();
      const allowed = ["off", "trend-down", "trend-up", "trend-any", "force-down", "force-up"];
      if (!allowed.includes(value)) {
        throw new Error("hedgeEntryMode override must be off, trend-down, trend-up, trend-any, force-down, or force-up");
      }
      normalized.hedgeEntryMode = value as PoolOverrides["hedgeEntryMode"];
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

    if (normalized.hedgeEntryMode && ["trend-down", "trend-up", "trend-any"].includes(normalized.hedgeEntryMode)) {
      if (!this.baseConfig.trendNetworkId || !this.baseConfig.trendNetworkId.trim()) {
        throw new Error("trendNetworkId is required when hedgeEntryMode uses trend");
      }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  private applyOverrideUpdates(
    current: PoolOverrides,
    updates: PoolOverrides
  ): PoolOverrides {
    const next: PoolOverrides = { ...current };
    if ("pnlTargetUsd" in (next as Record<string, unknown>)) {
      delete (next as Record<string, unknown>).pnlTargetUsd;
    }
    if ("pnlTargetPct" in (next as Record<string, unknown>)) {
      delete (next as Record<string, unknown>).pnlTargetPct;
    }

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

    if ("rangeAnchor" in updates) {
      if (updates.rangeAnchor == null) {
        delete next.rangeAnchor;
      } else {
        const value = String(updates.rangeAnchor).trim().toLowerCase();
        if (value !== "lower" && value !== "middle" && value !== "upper") {
          throw new Error("rangeAnchor override must be lower, middle, or upper");
        }
        next.rangeAnchor = value as "lower" | "middle" | "upper";
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
    if ("preferredExitDirection" in updates) {
      if (updates.preferredExitDirection == null) {
        delete next.preferredExitDirection;
      } else {
        const value = String(updates.preferredExitDirection).trim().toLowerCase();
        if (value !== "down" && value !== "up") {
          throw new Error("preferredExitDirection override must be down or up");
        }
        next.preferredExitDirection = value as "down" | "up";
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

    if ("autoAddLiquidityEnabled" in updates) {
      if (updates.autoAddLiquidityEnabled == null) {
        delete next.autoAddLiquidityEnabled;
      } else {
        const raw = updates.autoAddLiquidityEnabled as unknown;
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
          throw new Error("autoAddLiquidityEnabled override must be boolean");
        }
        next.autoAddLiquidityEnabled = value;
      }
    }

    if ("kaminoRebalanceEnabled" in updates) {
      if (updates.kaminoRebalanceEnabled == null) {
        delete next.kaminoRebalanceEnabled;
      } else {
        const raw = updates.kaminoRebalanceEnabled as unknown;
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
          throw new Error("kaminoRebalanceEnabled override must be boolean");
        }
        next.kaminoRebalanceEnabled = value;
      }
    }

    if ("kaminoDepositPct" in updates) {
      if (updates.kaminoDepositPct == null) {
        delete next.kaminoDepositPct;
      } else {
        const value = Number(updates.kaminoDepositPct);
        if (!Number.isFinite(value) || value < 0 || value > 100) {
          throw new Error("kaminoDepositPct override must be between 0 and 100");
        }
        next.kaminoDepositPct = value;
      }
    }

    if ("kaminoBorrowAsset" in updates) {
      if (updates.kaminoBorrowAsset == null) {
        delete next.kaminoBorrowAsset;
      } else {
        const value = String(updates.kaminoBorrowAsset).trim().toLowerCase();
        if (!["usdc", "usdt", "auto"].includes(value)) {
          throw new Error("kaminoBorrowAsset override must be usdc, usdt, or auto");
        }
        next.kaminoBorrowAsset = value as PoolOverrides["kaminoBorrowAsset"];
      }
    }

    if ("kaminoMarketAddress" in updates) {
      if (updates.kaminoMarketAddress == null) {
        delete next.kaminoMarketAddress;
      } else {
        const value = String(updates.kaminoMarketAddress).trim();
        if (!value) {
          throw new Error("kaminoMarketAddress override must be a non-empty string");
        }
        next.kaminoMarketAddress = value;
      }
    }

    if ("kaminoMaxLtv" in updates) {
      if (updates.kaminoMaxLtv == null) {
        delete next.kaminoMaxLtv;
      } else {
        const value = Number(updates.kaminoMaxLtv);
        if (!Number.isFinite(value) || value < 0 || value > 1) {
          throw new Error("kaminoMaxLtv override must be between 0 and 1");
        }
        next.kaminoMaxLtv = value;
      }
    }

    if ("kaminoCloseRule" in updates) {
      if (updates.kaminoCloseRule == null) {
        delete next.kaminoCloseRule;
      } else {
        const value = String(updates.kaminoCloseRule).trim().toLowerCase();
        if (!["avg-price", "breakeven", "manual"].includes(value)) {
          throw new Error("kaminoCloseRule override must be avg-price, breakeven, or manual");
        }
        next.kaminoCloseRule = value as PoolOverrides["kaminoCloseRule"];
      }
    }

    if ("kaminoPriceBufferPct" in updates) {
      if (updates.kaminoPriceBufferPct == null) {
        delete next.kaminoPriceBufferPct;
      } else {
        const value = Number(updates.kaminoPriceBufferPct);
        if (!Number.isFinite(value) || value < 0) {
          throw new Error("kaminoPriceBufferPct override must be >= 0");
        }
        next.kaminoPriceBufferPct = value;
      }
    }

    if ("kaminoIncludePoolLossInTarget" in updates) {
      if (updates.kaminoIncludePoolLossInTarget == null) {
        delete next.kaminoIncludePoolLossInTarget;
      } else {
        const raw = updates.kaminoIncludePoolLossInTarget as unknown;
        if (typeof raw === "boolean") {
          next.kaminoIncludePoolLossInTarget = raw;
        } else if (typeof raw === "string") {
          const value = raw.trim().toLowerCase();
          if (["1", "true", "yes", "on"].includes(value)) {
            next.kaminoIncludePoolLossInTarget = true;
          } else if (["0", "false", "no", "off"].includes(value)) {
            next.kaminoIncludePoolLossInTarget = false;
          } else {
            throw new Error("kaminoIncludePoolLossInTarget override must be boolean");
          }
        } else {
          throw new Error("kaminoIncludePoolLossInTarget override must be boolean");
        }
      }
    }

    if ("kaminoCollateralMode" in updates) {
      if (updates.kaminoCollateralMode == null) {
        delete next.kaminoCollateralMode;
      } else {
        const value = String(updates.kaminoCollateralMode).trim().toLowerCase();
        if (!["exit", "max-value", "both", "dual", "tokena", "tokenb", "token_a", "token_b"].includes(value)) {
          throw new Error("kaminoCollateralMode override must be exit, max-value, tokenA, tokenB, or both");
        }
        if (value === "tokena" || value === "token_a") {
          next.kaminoCollateralMode = "tokenA";
        } else if (value === "tokenb" || value === "token_b") {
          next.kaminoCollateralMode = "tokenB";
        } else if (value === "dual") {
          next.kaminoCollateralMode = "both";
        } else {
          next.kaminoCollateralMode = value as PoolOverrides["kaminoCollateralMode"];
        }
      }
    }
    if ("kaminoAutoCloseOnTokenChange" in updates) {
      if (updates.kaminoAutoCloseOnTokenChange == null) {
        delete next.kaminoAutoCloseOnTokenChange;
      } else {
        const raw = updates.kaminoAutoCloseOnTokenChange as unknown;
        let value: boolean | null = null;
        if (typeof raw === "boolean") {
          value = raw;
        } else if (typeof raw === "string") {
          const normalizedValue = raw.trim().toLowerCase();
          if (["true", "1", "yes", "sim", "on"].includes(normalizedValue)) {
            value = true;
          } else if (["false", "0", "no", "nao", "off"].includes(normalizedValue)) {
            value = false;
          }
        }
        if (value === null) {
          throw new Error("kaminoAutoCloseOnTokenChange override must be boolean");
        }
        next.kaminoAutoCloseOnTokenChange = value;
      }
    }

    if ("kaminoConvertToCollateral" in updates) {
      if (updates.kaminoConvertToCollateral == null) {
        delete next.kaminoConvertToCollateral;
      } else {
        const raw = updates.kaminoConvertToCollateral as unknown;
        let value: boolean | null = null;
        if (typeof raw === "boolean") {
          value = raw;
        } else if (typeof raw === "string") {
          const normalizedValue = raw.trim().toLowerCase();
          if (["true", "1", "yes", "sim", "on"].includes(normalizedValue)) {
            value = true;
          } else if (["false", "0", "no", "nao", "off"].includes(normalizedValue)) {
            value = false;
          }
        }
        if (value === null) {
          throw new Error("kaminoConvertToCollateral override must be boolean");
        }
        next.kaminoConvertToCollateral = value;
      }
    }

    if ("kaminoAvgPriceBasis" in updates) {
      if (updates.kaminoAvgPriceBasis == null) {
        delete next.kaminoAvgPriceBasis;
      } else {
        const value = String(updates.kaminoAvgPriceBasis).trim().toLowerCase();
        if (!["deposit", "debt"].includes(value)) {
          throw new Error("kaminoAvgPriceBasis override must be deposit or debt");
        }
        next.kaminoAvgPriceBasis = value as PoolOverrides["kaminoAvgPriceBasis"];
      }
    }

    if ("kaminoAvgMode" in updates) {
      if (updates.kaminoAvgMode == null) {
        delete next.kaminoAvgMode;
      } else {
        const value = String(updates.kaminoAvgMode).trim().toLowerCase();
        if (!["cumulative", "reset"].includes(value)) {
          throw new Error("kaminoAvgMode override must be cumulative or reset");
        }
        next.kaminoAvgMode = value as PoolOverrides["kaminoAvgMode"];
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

    if ("hedgeEntryMode" in updates) {
      if (updates.hedgeEntryMode == null) {
        delete next.hedgeEntryMode;
      } else {
        const value = String(updates.hedgeEntryMode).trim().toLowerCase();
        const allowed = ["off", "trend-down", "trend-up", "trend-any", "force-down", "force-up"];
        if (!allowed.includes(value)) {
          throw new Error("hedgeEntryMode override must be off, trend-down, trend-up, trend-any, force-down, or force-up");
        }
        next.hedgeEntryMode = value as PoolOverrides["hedgeEntryMode"];
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

    if (next.hedgeEntryMode && ["trend-down", "trend-up", "trend-any"].includes(next.hedgeEntryMode)) {
      if (!this.baseConfig.trendNetworkId || !this.baseConfig.trendNetworkId.trim()) {
        throw new Error("trendNetworkId is required when hedgeEntryMode uses trend");
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
