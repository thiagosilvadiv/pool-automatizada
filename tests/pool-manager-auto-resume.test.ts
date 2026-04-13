import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type Config } from "../src/config.js";
import { PoolManager } from "../src/pool-manager.js";
vi.mock("../src/orca.js", () => ({
  OrcaBot: {
    create: vi.fn()
  }
}));

const originalEnv = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

function buildConfig(overrides: Record<string, unknown> = {}): Config {
  process.env.CONFIG_JSON = JSON.stringify({
    rpcUrl: "http://localhost:8899",
    whirlpoolAddress: "So11111111111111111111111111111111111111112",
    rangeWidthPct: 1,
    ...overrides
  });
  return loadConfig();
}

function createEntry(id: string, name = "Pool", address = "So11111111111111111111111111111111111111112") {
  return {
    id,
    name,
    whirlpoolAddress: address,
    createdAt: "2026-03-30T00:00:00.000Z"
  };
}

function createRunner(options?: {
  running?: boolean;
  startImpl?: () => Promise<void>;
  closeImpl?: () => Promise<void>;
  rebalanceImpl?: () => Promise<void>;
  autoAddEnabled?: boolean;
  busy?: boolean;
  status?: Record<string, unknown>;
  autoAddImpl?: (limits: { maxTokenA?: number; maxTokenB?: number; enforceMinUsd?: boolean }) => Promise<{ ok: boolean; reason?: string }>;
}) {
  let running = Boolean(options?.running);
  const start = vi.fn(async () => {
    if (options?.startImpl) {
      await options.startImpl();
    }
    running = true;
  });
  const stop = vi.fn(() => {
    running = false;
  });
  const closePositionNow = vi.fn(async () => {
    if (options?.closeImpl) {
      await options.closeImpl();
    }
    running = false;
    return {
      running,
      lastAction: "close-position"
    };
  });
  const rebalancePositionNow = vi.fn(async () => {
    if (options?.rebalanceImpl) {
      await options.rebalanceImpl();
    }
    return {
      running,
      lastAction: "rebalanced"
    };
  });
  const getStatus = vi.fn(() => ({ running, ...(options?.status ?? {}) }));

  return {
    start,
    stop,
    closePositionNow,
    rebalancePositionNow,
    getStatus,
    updateConfig: vi.fn(),
    getHistory: vi.fn(() => []),
    getHedgeLogs: vi.fn(() => []),
    clearHistory: vi.fn(async () => {}),
    deleteHistoryEvents: vi.fn(async () => {}),
    updateHistoryEvent: vi.fn(async () => {}),
    clearHedgeLogs: vi.fn(),
    topUpSolNow: vi.fn(async () => ({ ok: true })),
    swapWalletToSolNow: vi.fn(async () => ({ ok: true, swaps: 0, failed: 0, totalOutLamports: 0, details: [] })),
    updateSwapAllowlist: vi.fn(),
    isAutoAddEnabled: vi.fn(() => Boolean(options?.autoAddEnabled)),
    isBusy: vi.fn(() => Boolean(options?.busy)),
    getWalletBalances: vi.fn(async () => ({ tokenA: 0, tokenB: 0 })),
    autoAddLiquidity: vi.fn(async (limits: { maxTokenA?: number; maxTokenB?: number; enforceMinUsd?: boolean }) => {
      if (options?.autoAddImpl) {
        return options.autoAddImpl(limits);
      }
      return { ok: true };
    })
  };
}

function wirePool(manager: PoolManager, entry: ReturnType<typeof createEntry>, runner: ReturnType<typeof createRunner>) {
  (manager as any).entries.push(entry);
  (manager as any).pools.set(entry.id, { entry, runner });
}

function createManager(configOverrides: Record<string, unknown> = {}) {
  const config = buildConfig(configOverrides);
  const manager = new PoolManager(config, {}, {});
  const saves: any[] = [];
  (manager as any).poolsStore = {
    load: vi.fn(async () => null),
    save: vi.fn(async (payload: any) => {
      saves.push(payload);
    })
  };
  (manager as any).swapAllowlistStore = {
    load: vi.fn(async () => ({ mints: [], updatedAt: null })),
    save: vi.fn(async () => {})
  };
  return { manager, config, saves };
}

describe("pool-manager auto-resume", () => {
  beforeEach(() => {
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("persists activePoolIds on start/stop/remove", async () => {
    const { manager, saves } = createManager();
    const e1 = createEntry("pool-1", "Pool 1", "So11111111111111111111111111111111111111112");
    const e2 = createEntry("pool-2", "Pool 2", "So11111111111111111111111111111111111111113");
    wirePool(manager, e1, createRunner());
    wirePool(manager, e2, createRunner());

    await manager.startPool("pool-1");
    expect((manager as any).activePoolIds.has("pool-1")).toBe(true);
    expect(saves.at(-1)?.activePoolIds ?? []).toContain("pool-1");

    await manager.stopPool("pool-1");
    expect((manager as any).activePoolIds.has("pool-1")).toBe(false);
    expect(saves.at(-1)?.activePoolIds ?? []).not.toContain("pool-1");

    await manager.startPool("pool-2");
    await manager.removePool("pool-2");
    expect((manager as any).activePoolIds.has("pool-2")).toBe(false);
    expect(saves.at(-1)?.activePoolIds ?? []).not.toContain("pool-2");
  });

  it("keeps the pool active when manual rebalance is requested", async () => {
    const { manager, saves } = createManager();
    const entry = createEntry("pool-1", "Pool 1", "So11111111111111111111111111111111111111112");
    const runner = createRunner({ running: true });
    wirePool(manager, entry, runner);
    (manager as any).selectedPoolId = entry.id;
    (manager as any).activePoolIds = new Set([entry.id]);

    await manager.closeSelected();

    expect(runner.rebalancePositionNow).toHaveBeenCalledTimes(1);
    expect((manager as any).activePoolIds.has(entry.id)).toBe(true);
    expect(saves).toHaveLength(0);
  });

  it("loads legacy pool state without activePoolIds", async () => {
    const { manager, saves } = createManager();
    const entry = createEntry("pool-legacy", "Legacy", "So11111111111111111111111111111111111111112");
    const runner = createRunner();
    (manager as any).poolsStore.load = vi.fn(async () => ({
      selectedPoolId: entry.id,
      pools: [entry]
    }));
    (manager as any).createPool = vi.fn(async (loadedEntry: any) => {
      (manager as any).pools.set(loadedEntry.id, { entry: loadedEntry, runner });
    });

    await (manager as any).loadPools();

    expect((manager as any).activePoolIds.size).toBe(0);
    expect(saves.at(-1)?.activePoolIds ?? []).toEqual([]);
  });

  it("rehydrates pools from store when in-memory state disappears", async () => {
    const { manager, saves } = createManager();
    const entry = createEntry("pool-restore", "Restore", "So11111111111111111111111111111111111111112");
    const runner = createRunner();
    (manager as any).selectedPoolId = entry.id;
    (manager as any).activePoolIds = new Set([entry.id]);
    (manager as any).poolsStore.load = vi.fn(async () => ({
      selectedPoolId: entry.id,
      activePoolIds: [entry.id],
      pools: [entry]
    }));
    (manager as any).createPool = vi.fn(async (loadedEntry: any) => {
      (manager as any).pools.set(loadedEntry.id, { entry: loadedEntry, runner });
    });

    const recovered = await manager.ensurePoolsHydrated();

    expect(recovered).toBe(true);
    expect(manager.listPools()).toEqual([entry]);
    expect((manager as any).pools.has(entry.id)).toBe(true);
    expect((manager as any).selectedPoolId).toBe(entry.id);
    expect(saves.at(-1)?.pools ?? []).toEqual([entry]);
  });

  it("resumes all previously active pools", async () => {
    const { manager } = createManager({ autoResumeEnabled: true, autoResumeMaxAttempts: 3, autoResumeBaseDelayMs: 100 });
    const e1 = createEntry("pool-a", "A", "So11111111111111111111111111111111111111112");
    const e2 = createEntry("pool-b", "B", "So11111111111111111111111111111111111111113");
    const r1 = createRunner();
    const r2 = createRunner();
    wirePool(manager, e1, r1);
    wirePool(manager, e2, r2);
    (manager as any).activePoolIds = new Set(["pool-a", "pool-b"]);

    await (manager as any).resumeActivePools();

    expect(r1.start).toHaveBeenCalledTimes(1);
    expect(r2.start).toHaveBeenCalledTimes(1);
  });

  it("retries with exponential backoff and succeeds", async () => {
    vi.useFakeTimers();
    const { manager } = createManager({ autoResumeEnabled: true, autoResumeMaxAttempts: 4, autoResumeBaseDelayMs: 100 });
    const entry = createEntry("pool-r", "Retry", "So11111111111111111111111111111111111111112");
    let attempts = 0;
    const runner = createRunner({
      startImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("temporary RPC issue");
        }
      }
    });
    wirePool(manager, entry, runner);
    (manager as any).activePoolIds = new Set([entry.id]);

    await (manager as any).resumeActivePools();
    expect(runner.start).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(runner.start).toHaveBeenCalledTimes(2);
    expect((manager as any).resumeTimers.size).toBe(0);
    expect((manager as any).resumeLastError.has(entry.id)).toBe(false);
  });

  it("does not duplicate resume attempts while one is in-flight", async () => {
    let resolveStart: (() => void) | null = null;
    const startGate = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });

    const { manager } = createManager({ autoResumeEnabled: true, autoResumeMaxAttempts: 3, autoResumeBaseDelayMs: 100 });
    const entry = createEntry("pool-g", "Gate", "So11111111111111111111111111111111111111112");
    const runner = createRunner({
      startImpl: async () => {
        await startGate;
      }
    });
    wirePool(manager, entry, runner);
    (manager as any).activePoolIds = new Set([entry.id]);

    const p1 = (manager as any).resumeActivePools();
    const p2 = (manager as any).resumeActivePools();
    await Promise.resolve();
    expect(runner.start).toHaveBeenCalledTimes(1);

    resolveStart?.();
    await Promise.all([p1, p2]);
    expect(runner.start).toHaveBeenCalledTimes(1);
  });

  it("respects max attempts and keeps pool marked active", async () => {
    vi.useFakeTimers();
    const { manager, config } = createManager({ autoResumeEnabled: true, autoResumeMaxAttempts: 3, autoResumeBaseDelayMs: 100 });
    const entry = createEntry("pool-f", "Fail", "So11111111111111111111111111111111111111112");
    const runner = createRunner({
      startImpl: async () => {
        throw new Error("still failing");
      }
    });
    wirePool(manager, entry, runner);
    (manager as any).activePoolIds = new Set([entry.id]);

    await (manager as any).resumeActivePools();
    await vi.advanceTimersByTimeAsync(100 + 200 + 400);

    expect(runner.start).toHaveBeenCalledTimes(config.autoResumeMaxAttempts);
    expect((manager as any).activePoolIds.has(entry.id)).toBe(true);
    expect((manager as any).resumeLastError.get(entry.id)).toContain("still failing");
    expect((manager as any).resumeTimers.size).toBe(0);
  });

  it("delegates manual add-liquidity to the selected pool runner", async () => {
    const { manager } = createManager();
    const entry = createEntry("pool-add", "Add", "So11111111111111111111111111111111111111112");
    const runner = createRunner({ autoAddEnabled: true });
    wirePool(manager, entry, runner);
    (manager as any).selectedPoolId = entry.id;

    const result = await manager.addLiquiditySelected();

    expect(result.ok).toBe(true);
    expect(runner.autoAddLiquidity).toHaveBeenCalledWith({ enforceMinUsd: false });
  });

  it("keeps the pool active after a manual close-position", async () => {
    const { manager } = createManager();
    const entry = createEntry("pool-close", "Close", "So11111111111111111111111111111111111111112");
    const runner = createRunner({ running: true });
    wirePool(manager, entry, runner);
    (manager as any).selectedPoolId = entry.id;
    (manager as any).activePoolIds.add(entry.id);

    await manager.closeSelected();

    expect(runner.rebalancePositionNow).toHaveBeenCalledTimes(1);
    expect((manager as any).activePoolIds.has(entry.id)).toBe(true);
  });

  it("queues periodic auto-add checks for running pools with an open position", async () => {
    vi.useFakeTimers();
    const { manager } = createManager({ autoAddLiquidityCheckIntervalSec: 300 });
    const entry = createEntry("pool-auto-add", "Auto Add", "So11111111111111111111111111111111111111112");
    const runner = createRunner({
      running: true,
      autoAddEnabled: true,
      status: {
        running: true,
        positionMint: "mint-1"
      }
    });
    wirePool(manager, entry, runner);

    await (manager as any).runPeriodicAutoAddCheck();
    await vi.advanceTimersByTimeAsync(1500);

    expect(runner.autoAddLiquidity).toHaveBeenCalledTimes(1);
  });
});
