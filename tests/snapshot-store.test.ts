import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Sem REDIS_URL os factories caem no backend de arquivo.
vi.mock("../src/redis.js", () => ({
  getRedisClient: async () => null,
  getRedisKey: (key: string) => key
}));

const dataDir = path.join(process.cwd(), "data");
const created: string[] = [];

async function removeIfPresent(file: string): Promise<void> {
  try {
    await fs.rm(file);
  } catch {}
}

afterEach(async () => {
  await Promise.all(created.splice(0).map(removeIfPresent));
});

describe("createSnapshotStore (arquivo)", () => {
  it("grava e recarrega a serie no caminho data/snapshots-<poolId>.json", async () => {
    const { createSnapshotStore, snapshotFileFor } = await import("../src/storage.js");
    const poolId = `test_snap_${Date.now()}`;
    const file = snapshotFileFor(poolId);
    created.push(file);
    expect(file).toBe(path.join(dataDir, `snapshots-${poolId}.json`));

    const store = await createSnapshotStore(poolId);
    await store.append(basePoint(1000), { maxPoints: 10, downsample: true });
    await store.append(basePoint(2000), { maxPoints: 10, downsample: true });
    await store.flush();

    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    expect(raw.points.map((p: { t: number }) => p.t)).toEqual([1000, 2000]);
    expect(raw.updatedAt).toBeTruthy();

    // Um store novo (como apos reiniciar o processo) le o que ficou em disco.
    const reopened = await createSnapshotStore(poolId);
    const state = await reopened.load();
    expect(state?.points).toHaveLength(2);
  });

  it("aplica retencao ao ultrapassar maxPoints", async () => {
    const { createSnapshotStore, snapshotFileFor } = await import("../src/storage.js");
    const poolId = `test_snap_trim_${Date.now()}`;
    created.push(snapshotFileFor(poolId));
    const store = await createSnapshotStore(poolId);
    for (let i = 0; i < 20; i += 1) {
      await store.append(basePoint(i * 1000), { maxPoints: 6, downsample: true });
    }
    await store.flush();
    const state = await store.load();
    expect(state?.points.length).toBeLessThanOrEqual(6);
  });

  it("clear apaga o arquivo", async () => {
    const { createSnapshotStore, snapshotFileFor } = await import("../src/storage.js");
    const poolId = `test_snap_clear_${Date.now()}`;
    const file = snapshotFileFor(poolId);
    created.push(file);
    const store = await createSnapshotStore(poolId);
    await store.append(basePoint(1), { maxPoints: 10, downsample: true });
    await store.flush();
    await store.clear();
    await expect(fs.access(file)).rejects.toBeTruthy();
  });

  it("nao deixa o poolId escapar do diretorio data/", async () => {
    const { snapshotFileFor } = await import("../src/storage.js");
    const file = snapshotFileFor("../../etc/passwd");
    expect(path.dirname(file)).toBe(dataDir);
    expect(path.basename(file)).toBe("snapshots-______etc_passwd.json");
  });
});

describe("createHistoryStore (arquivo)", () => {
  it("usa data/history-<poolId>.json", async () => {
    const { historyFileFor } = await import("../src/storage.js");
    expect(historyFileFor("pool_abc")).toBe(path.join(dataDir, "history-pool_abc.json"));
  });

  it("migra o arquivo legado sem extensao na primeira leitura", async () => {
    const { createHistoryStore, historyFileFor, legacyHistoryFileFor } = await import("../src/storage.js");
    const poolId = `test_hist_${Date.now()}`;
    const legacy = legacyHistoryFileFor(poolId);
    const target = historyFileFor(poolId);
    created.push(legacy, target);

    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      legacy,
      JSON.stringify({ history: [{ id: "evt-1" }], lastEventPortfolioValue: null, lastEventPortfolioUsd: null }),
      "utf8"
    );

    const store = await createHistoryStore(poolId);
    const state = await store.load();

    expect(state?.history).toHaveLength(1);
    await expect(fs.access(target)).resolves.toBeUndefined();
    await expect(fs.access(legacy)).rejects.toBeTruthy();
  });

  it("nao sobrescreve um arquivo novo ja existente com o legado", async () => {
    const { createHistoryStore, historyFileFor, legacyHistoryFileFor } = await import("../src/storage.js");
    const poolId = `test_hist_keep_${Date.now()}`;
    const legacy = legacyHistoryFileFor(poolId);
    const target = historyFileFor(poolId);
    created.push(legacy, target);

    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(legacy, JSON.stringify({ history: [{ id: "old" }] }), "utf8");
    await fs.writeFile(target, JSON.stringify({ history: [{ id: "new" }] }), "utf8");

    const state = await (await createHistoryStore(poolId)).load();
    expect((state?.history as Array<{ id: string }>)[0].id).toBe("new");
  });
});

function basePoint(t: number) {
  return {
    t,
    price: 1,
    solUsd: 100,
    posValueUsd: 1,
    posPnlUsd: 0,
    posEntryUsd: 1,
    posFeesUsd: 0,
    portfolioUsd: 1,
    pnlUsd: 0,
    posValueSol: 0.01,
    posPnlSol: 0,
    rangeLower: 0.9,
    rangeUpper: 1.1,
    posLower: 0.9,
    posUpper: 1.1,
    kCollatUsd: null,
    kDebtUsd: null,
    kLtv: null,
    running: 1 as const,
    inRange: 1 as const,
    posMint: "mint"
  };
}
