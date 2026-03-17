import path from "path";
import { fileURLToPath } from "url";
import { PublicKey } from "@solana/web3.js";

import { Config } from "./config.js";
import { OrcaBot } from "./orca.js";
import { BotRunner } from "./runner.js";
import { logger } from "./logger.js";
import { createHistoryStore, createPoolsStore, PoolsStore, PoolsState } from "./storage.js";

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
};

export type PoolSummary = {
  id: string;
  name: string;
  whirlpoolAddress: string;
  selected: boolean;
  running: boolean;
  lastAction: string | null;
  lastError: string | null;
  lastPrice: number | null;
  positionValueUsd: number | null;
  positionPnlUsd: number | null;
  positionValueSol: number | null;
  positionPnlSol: number | null;
  overrides: PoolOverrides | null;
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
  private pools = new Map<string, PoolRecord>();
  private entries: PoolEntry[] = [];
  private selectedPoolId: string | null = null;
  private pendingAdds = new Set<string>();

  constructor(baseConfig: Config, connection: any, wallet: any) {
    this.baseConfig = baseConfig;
    this.connection = connection;
    this.wallet = wallet;
  }

  async init(): Promise<void> {
    this.poolsStore = await createPoolsStore<PoolEntry>();
    await this.loadPools();
  }

  getSelectedPoolId(): string | null {
    return this.selectedPoolId;
  }

  listPools(): PoolEntry[] {
    return [...this.entries];
  }

  listSummaries(): PoolSummary[] {
    return this.entries.map((entry) => {
      const record = this.pools.get(entry.id);
      const status = record?.runner.getStatus();
      return {
        id: entry.id,
        name: entry.name,
        whirlpoolAddress: entry.whirlpoolAddress,
        selected: entry.id === this.selectedPoolId,
        running: status?.running ?? false,
        lastAction: status?.lastAction ?? null,
        lastError: status?.lastError ?? null,
        lastPrice: status?.lastPrice ?? null,
        positionValueUsd: status?.positionValueUsd ?? null,
        positionPnlUsd: status?.positionPnlUsd ?? null,
        positionValueSol: status?.positionValue ?? null,
        positionPnlSol: status?.positionPnl ?? null,
        overrides: entry.overrides ?? null
      };
    });
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

  hasPool(id: string): boolean {
    return this.pools.has(id);
  }

  async clearHistory(id: string): Promise<void> {
    const record = this.getRecord(id);
    await record.runner.clearHistory();
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

  async clearSelectedHistory(): Promise<void> {
    if (!this.selectedPoolId) {
      return;
    }
    await this.clearHistory(this.selectedPoolId);
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
    pools = deduped;

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
      config: poolConfig
    });
    const historyStore = await createHistoryStore(entry.id);
    const runner = new BotRunner(bot, poolConfig, { historyStore });
    await runner.init();
    this.pools.set(entry.id, { entry, runner });
  }

  private async savePools(): Promise<void> {
    const payload: PoolsState<PoolEntry> = {
      selectedPoolId: this.selectedPoolId,
      pools: this.entries
    };
    await this.poolsStore.save(payload);
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
