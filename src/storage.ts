import path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";
import { logger } from "./logger.js";
import { getRedisClient, getRedisKey } from "./redis.js";
import { compactSnapshots, normalizeSnapshots, type PoolSnapshot } from "./snapshots.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type HistoryState = {
  history: unknown[];
  lastEventPortfolioValue: number | null;
  lastEventPortfolioUsd: number | null;
  hedgeState?: unknown;
  kaminoState?: unknown;
};

export type HistoryStore = {
  load(): Promise<HistoryState | null>;
  save(state: HistoryState): Promise<void>;
  clear(): Promise<void>;
};

export function defaultHistoryFile(name = "history.json"): string {
  return path.join(__dirname, "..", "data", name);
}

/** Nomes de pool viram nome de arquivo: remove qualquer coisa fora de [A-Za-z0-9_-]. */
export function sanitizeStoreName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** Arquivo de historico de uma pool: data/history-<poolId>.json */
export function historyFileFor(poolId: string): string {
  return defaultHistoryFile(`history-${sanitizeStoreName(poolId)}.json`);
}

/**
 * Caminho legado: versoes antigas gravavam em data/<poolId>, sem prefixo nem
 * extensao. Mantido apenas para migrar o arquivo na primeira leitura.
 */
export function legacyHistoryFileFor(poolId: string): string {
  return defaultHistoryFile(sanitizeStoreName(poolId));
}

class FileHistoryStore implements HistoryStore {
  private filePath: string;
  private legacyPath: string | null;
  private migrated = false;

  constructor(filePath: string, legacyPath: string | null = null) {
    this.filePath = filePath;
    this.legacyPath = legacyPath;
  }

  /** Renomeia o arquivo legado para o nome novo, uma unica vez. */
  private async migrateLegacyFile(): Promise<void> {
    if (this.migrated || !this.legacyPath || this.legacyPath === this.filePath) {
      this.migrated = true;
      return;
    }
    this.migrated = true;
    try {
      await fs.access(this.filePath);
      return;
    } catch {}
    try {
      await fs.access(this.legacyPath);
    } catch {
      return;
    }
    try {
      await fs.rename(this.legacyPath, this.filePath);
      logger.info({ from: this.legacyPath, to: this.filePath }, "migrated legacy history file");
    } catch (err) {
      logger.warn({ err }, "failed to migrate legacy history file");
    }
  }

  async load(): Promise<HistoryState | null> {
    await this.migrateLegacyFile();
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(raw) as HistoryState;
    } catch {
      return null;
    }
  }

  async save(state: HistoryState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }

  async clear(): Promise<void> {
    await this.save({ history: [], lastEventPortfolioValue: null, lastEventPortfolioUsd: null });
  }
}

class RedisHistoryStore implements HistoryStore {
  private key: string;

  constructor(key: string) {
    this.key = key;
  }

  async load(): Promise<HistoryState | null> {
    const client = await getRedisClient();
    if (!client) {
      return null;
    }
    const raw = await client.get(this.key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as HistoryState;
  }

  async save(state: HistoryState): Promise<void> {
    const client = await getRedisClient();
    if (!client) {
      throw new Error("Redis not configured");
    }
    await client.set(this.key, JSON.stringify(state));
  }

  async clear(): Promise<void> {
    const client = await getRedisClient();
    if (!client) {
      throw new Error("Redis not configured");
    }
    await client.del(this.key);
  }
}

export async function createHistoryStore(name: string): Promise<HistoryStore> {
  const client = await getRedisClient();
  if (client) {
    return new RedisHistoryStore(getRedisKey(`history:${name}`));
  }
  return new FileHistoryStore(historyFileFor(name), legacyHistoryFileFor(name));
}

export type SnapshotState = {
  points: PoolSnapshot[];
  updatedAt: string | null;
};

export type SnapshotAppendOptions = {
  maxPoints: number;
  downsample: boolean;
};

export type SnapshotStore = {
  load(): Promise<SnapshotState | null>;
  append(point: PoolSnapshot, options: SnapshotAppendOptions): Promise<void>;
  flush(): Promise<void>;
  clear(): Promise<void>;
};

export function snapshotFileFor(poolId: string): string {
  return defaultHistoryFile(`snapshots-${sanitizeStoreName(poolId)}.json`);
}

/**
 * Backend em arquivo. Diferente dos outros stores deste modulo:
 *
 * - mantem os pontos em memoria (a serie inteira e reescrita a cada flush, entao
 *   reler do disco a cada amostra seria desperdicio);
 * - grava JSON compacto, sem indentacao — sao milhares de pontos numericos;
 * - grava em arquivo temporario e renomeia, porque este arquivo e escrito com
 *   frequencia muito maior que os demais e uma queda no meio da escrita
 *   corromperia a serie inteira.
 */
class FileSnapshotStore implements SnapshotStore {
  private filePath: string;
  private points: PoolSnapshot[] | null = null;
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private debounceMs: number;
  private writing: Promise<void> | null = null;

  constructor(filePath: string, debounceMs = 0) {
    this.filePath = filePath;
    this.debounceMs = Math.max(0, debounceMs);
  }

  private async ensureLoaded(): Promise<PoolSnapshot[]> {
    if (this.points) {
      return this.points;
    }
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as SnapshotState;
      this.points = normalizeSnapshots(parsed?.points);
    } catch {
      this.points = [];
    }
    return this.points;
  }

  async load(): Promise<SnapshotState | null> {
    const points = await this.ensureLoaded();
    return { points, updatedAt: points.length ? new Date(points[points.length - 1].t).toISOString() : null };
  }

  async append(point: PoolSnapshot, options: SnapshotAppendOptions): Promise<void> {
    const points = await this.ensureLoaded();
    points.push(point);
    this.points = compactSnapshots(points, options.maxPoints, options.downsample);
    this.dirty = true;
    if (this.debounceMs === 0) {
      await this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, this.debounceMs);
      // Nao segura o processo aberto so por causa do flush pendente.
      this.flushTimer.unref?.();
    }
  }

  async flush(): Promise<void> {
    if (!this.dirty || !this.points) {
      return;
    }
    if (this.writing) {
      await this.writing;
    }
    if (!this.dirty || !this.points) {
      return;
    }
    this.dirty = false;
    const state: SnapshotState = {
      points: this.points,
      updatedAt: new Date().toISOString()
    };
    const tmpPath = `${this.filePath}.tmp`;
    this.writing = (async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(tmpPath, JSON.stringify(state), "utf8");
      await fs.rename(tmpPath, this.filePath);
    })();
    try {
      await this.writing;
    } catch (err) {
      this.dirty = true;
      logger.warn({ err }, "failed to save snapshots");
    } finally {
      this.writing = null;
    }
  }

  async clear(): Promise<void> {
    this.points = [];
    this.dirty = false;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      await fs.rm(this.filePath);
    } catch {}
  }
}

/**
 * Backend Redis. Usa uma lista em vez de um blob JSON: `RPUSH` + `LTRIM` custa
 * O(1) por amostra, enquanto reescrever a serie inteira a cada amostra ficaria
 * mais caro a cada ponto adicionado. O `LTRIM` ja implementa a retencao, entao
 * aqui nao ha downsampling — a cauda antiga e descartada.
 */
class RedisSnapshotStore implements SnapshotStore {
  private key: string;

  constructor(key: string) {
    this.key = key;
  }

  async load(): Promise<SnapshotState | null> {
    const client = await getRedisClient();
    if (!client) {
      return null;
    }
    const raw = await client.lRange(this.key, 0, -1);
    const points = normalizeSnapshots(
      raw
        .map((line) => {
          try {
            return JSON.parse(line) as PoolSnapshot;
          } catch {
            return null;
          }
        })
        .filter((p): p is PoolSnapshot => p != null)
    );
    return { points, updatedAt: points.length ? new Date(points[points.length - 1].t).toISOString() : null };
  }

  async append(point: PoolSnapshot, options: SnapshotAppendOptions): Promise<void> {
    const client = await getRedisClient();
    if (!client) {
      throw new Error("Redis not configured");
    }
    await client.rPush(this.key, JSON.stringify(point));
    if (options.maxPoints > 0) {
      await client.lTrim(this.key, -options.maxPoints, -1);
    }
  }

  async flush(): Promise<void> {
    // RPUSH ja persistiu.
  }

  async clear(): Promise<void> {
    const client = await getRedisClient();
    if (!client) {
      throw new Error("Redis not configured");
    }
    await client.del(this.key);
  }
}

export async function createSnapshotStore(
  name: string,
  options: { flushDebounceMs?: number } = {}
): Promise<SnapshotStore> {
  const client = await getRedisClient();
  if (client) {
    return new RedisSnapshotStore(getRedisKey(`snapshots:${sanitizeStoreName(name)}`));
  }
  return new FileSnapshotStore(snapshotFileFor(name), options.flushDebounceMs ?? 0);
}

export type PoolsState<T> = {
  selectedPoolId: string | null;
  activePoolIds?: string[];
  pools: T[];
};

export type PoolsStore<T> = {
  load(): Promise<PoolsState<T> | null>;
  save(state: PoolsState<T>): Promise<void>;
};

class FilePoolsStore<T> implements PoolsStore<T> {
  private filePath: string;
  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<PoolsState<T> | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(raw) as PoolsState<T>;
    } catch {
      return null;
    }
  }

  async save(state: PoolsState<T>): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}

class DualPoolsStore<T> implements PoolsStore<T> {
  private key: string;
  private fileStore: FilePoolsStore<T>;

  constructor(key: string, filePath: string) {
    this.key = key;
    this.fileStore = new FilePoolsStore<T>(filePath);
  }

  async load(): Promise<PoolsState<T> | null> {
    const client = await getRedisClient();
    if (!client) {
      return this.fileStore.load();
    }
    try {
      const raw = await client.get(this.key);
      if (raw) {
        return JSON.parse(raw) as PoolsState<T>;
      }
    } catch (err) {
      logger.warn({ err }, "failed to load pools from redis; falling back to file");
    }
    const fileState = await this.fileStore.load();
    if (fileState) {
      try {
        await client.set(this.key, JSON.stringify(fileState));
      } catch (err) {
        logger.warn({ err }, "failed to restore pools into redis from file");
      }
    }
    return fileState;
  }

  async save(state: PoolsState<T>): Promise<void> {
    await this.fileStore.save(state);
    const client = await getRedisClient();
    if (!client) {
      return;
    }
    try {
      await client.set(this.key, JSON.stringify(state));
    } catch (err) {
      logger.warn({ err }, "failed to save pools to redis; file backup kept");
    }
  }
}

class RedisPoolsStore<T> implements PoolsStore<T> {
  private key: string;
  constructor(key: string) {
    this.key = key;
  }

  async load(): Promise<PoolsState<T> | null> {
    const client = await getRedisClient();
    if (!client) {
      return null;
    }
    const raw = await client.get(this.key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as PoolsState<T>;
  }

  async save(state: PoolsState<T>): Promise<void> {
    const client = await getRedisClient();
    if (!client) {
      throw new Error("Redis not configured");
    }
    await client.set(this.key, JSON.stringify(state));
  }
}

export async function createPoolsStore<T>(): Promise<PoolsStore<T>> {
  const client = await getRedisClient();
  if (client) {
    const filePath = defaultHistoryFile("pools.json");
    return new DualPoolsStore<T>(getRedisKey("pools"), filePath);
  }
  const filePath = defaultHistoryFile("pools.json");
  return new FilePoolsStore<T>(filePath);
}

export type SwapAllowlistState = {
  mints: string[];
  updatedAt: string | null;
};

export type SwapAllowlistStore = {
  load(): Promise<SwapAllowlistState | null>;
  save(state: SwapAllowlistState): Promise<void>;
};

export function defaultSwapAllowlistFile(name = "swap-allowlist.json"): string {
  return path.join(__dirname, "..", "data", name);
}

class FileSwapAllowlistStore implements SwapAllowlistStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<SwapAllowlistState | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return { mints: parsed.map((item) => String(item)), updatedAt: null };
      }
      if (parsed && typeof parsed === "object") {
        const mints = Array.isArray((parsed as any).mints)
          ? (parsed as any).mints.map((item: any) => String(item))
          : [];
        const updatedAt = typeof (parsed as any).updatedAt === "string" ? (parsed as any).updatedAt : null;
        return { mints, updatedAt };
      }
      return { mints: [], updatedAt: null };
    } catch {
      return null;
    }
  }

  async save(state: SwapAllowlistState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}

class RedisSwapAllowlistStore implements SwapAllowlistStore {
  private key: string;

  constructor(key: string) {
    this.key = key;
  }

  async load(): Promise<SwapAllowlistState | null> {
    const client = await getRedisClient();
    if (!client) {
      return null;
    }
    const raw = await client.get(this.key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { mints: parsed.map((item) => String(item)), updatedAt: null };
    }
    if (parsed && typeof parsed === "object") {
      const mints = Array.isArray((parsed as any).mints)
        ? (parsed as any).mints.map((item: any) => String(item))
        : [];
      const updatedAt = typeof (parsed as any).updatedAt === "string" ? (parsed as any).updatedAt : null;
      return { mints, updatedAt };
    }
    return { mints: [], updatedAt: null };
  }

  async save(state: SwapAllowlistState): Promise<void> {
    const client = await getRedisClient();
    if (!client) {
      throw new Error("Redis not configured");
    }
    await client.set(this.key, JSON.stringify(state));
  }
}

export async function createSwapAllowlistStore(): Promise<SwapAllowlistStore> {
  const client = await getRedisClient();
  if (client) {
    return new RedisSwapAllowlistStore(getRedisKey("swap-allowlist"));
  }
  const filePath = defaultSwapAllowlistFile();
  return new FileSwapAllowlistStore(filePath);
}

export type AiAnalysisState = {
  analyses: unknown[];
  chats?: Record<string, unknown>;
  updatedAt: string | null;
};

export type AiAnalysisStore = {
  load(): Promise<AiAnalysisState | null>;
  save(state: AiAnalysisState): Promise<void>;
};

export function defaultAiAnalysisFile(name = "ai-analyses.json"): string {
  return path.join(__dirname, "..", "data", name);
}

class FileAiAnalysisStore implements AiAnalysisStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<AiAnalysisState | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return { analyses: parsed, updatedAt: null };
      }
      if (parsed && typeof parsed === "object") {
        const analyses = Array.isArray((parsed as any).analyses)
          ? (parsed as any).analyses
          : [];
        const chats = (parsed as any).chats && typeof (parsed as any).chats === "object"
          ? (parsed as any).chats as Record<string, unknown>
          : {};
        const updatedAt = typeof (parsed as any).updatedAt === "string"
          ? (parsed as any).updatedAt
          : null;
        return { analyses, chats, updatedAt };
      }
      return { analyses: [], chats: {}, updatedAt: null };
    } catch {
      return null;
    }
  }

  async save(state: AiAnalysisState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}

class RedisAiAnalysisStore implements AiAnalysisStore {
  private key: string;

  constructor(key: string) {
    this.key = key;
  }

  async load(): Promise<AiAnalysisState | null> {
    const client = await getRedisClient();
    if (!client) {
      return null;
    }
    const raw = await client.get(this.key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { analyses: parsed, updatedAt: null };
    }
    if (parsed && typeof parsed === "object") {
      const analyses = Array.isArray((parsed as any).analyses)
        ? (parsed as any).analyses
        : [];
      const chats = (parsed as any).chats && typeof (parsed as any).chats === "object"
        ? (parsed as any).chats as Record<string, unknown>
        : {};
      const updatedAt = typeof (parsed as any).updatedAt === "string"
        ? (parsed as any).updatedAt
        : null;
      return { analyses, chats, updatedAt };
    }
    return { analyses: [], chats: {}, updatedAt: null };
  }

  async save(state: AiAnalysisState): Promise<void> {
    const client = await getRedisClient();
    if (!client) {
      throw new Error("Redis not configured");
    }
    await client.set(this.key, JSON.stringify(state));
  }
}

export async function createAiAnalysisStore(): Promise<AiAnalysisStore> {
  const client = await getRedisClient();
  if (client) {
    return new RedisAiAnalysisStore(getRedisKey("ai-analysis"));
  }
  const filePath = defaultAiAnalysisFile();
  return new FileAiAnalysisStore(filePath);
}

export type KaminoMarketEntry = {
  id: string;
  name: string;
  address: string;
  createdAt: string;
  updatedAt: string;
};

export type KaminoMarketsState = {
  markets: KaminoMarketEntry[];
  updatedAt: string | null;
};

export type KaminoMarketsStore = {
  load(): Promise<KaminoMarketsState | null>;
  save(state: KaminoMarketsState): Promise<void>;
};

export function defaultKaminoMarketsFile(name = "kamino-markets.json"): string {
  return path.join(__dirname, "..", "data", name);
}

function normalizeKaminoMarketsState(input: unknown): KaminoMarketsState {
  if (!input || typeof input !== "object") {
    return { markets: [], updatedAt: null };
  }
  const rawMarkets = Array.isArray((input as any).markets)
    ? (input as any).markets
    : (Array.isArray(input) ? input : []);
  const markets = rawMarkets.map((item: any) => {
    const address = String(item?.address ?? item?.marketAddress ?? "").trim();
    if (!address) return null;
    const id = String(item?.id ?? address).trim() || address;
    const name = String(item?.name ?? item?.label ?? address).trim() || address;
    const createdAt = typeof item?.createdAt === "string" ? item.createdAt : new Date().toISOString();
    const updatedAt = typeof item?.updatedAt === "string" ? item.updatedAt : createdAt;
    return { id, name, address, createdAt, updatedAt };
  }).filter(Boolean) as KaminoMarketEntry[];
  const updatedAt = typeof (input as any).updatedAt === "string" ? (input as any).updatedAt : null;
  return { markets, updatedAt };
}

class FileKaminoMarketsStore implements KaminoMarketsStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<KaminoMarketsState | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return normalizeKaminoMarketsState(parsed);
    } catch {
      return null;
    }
  }

  async save(state: KaminoMarketsState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}

class RedisKaminoMarketsStore implements KaminoMarketsStore {
  private key: string;

  constructor(key: string) {
    this.key = key;
  }

  async load(): Promise<KaminoMarketsState | null> {
    const client = await getRedisClient();
    if (!client) {
      return null;
    }
    const raw = await client.get(this.key);
    if (!raw) {
      return null;
    }
    return normalizeKaminoMarketsState(JSON.parse(raw));
  }

  async save(state: KaminoMarketsState): Promise<void> {
    const client = await getRedisClient();
    if (!client) {
      throw new Error("Redis not configured");
    }
    await client.set(this.key, JSON.stringify(state));
  }
}

export async function createKaminoMarketsStore(): Promise<KaminoMarketsStore> {
  const client = await getRedisClient();
  if (client) {
    return new RedisKaminoMarketsStore(getRedisKey("kamino-markets"));
  }
  const filePath = defaultKaminoMarketsFile();
  return new FileKaminoMarketsStore(filePath);
}

export type KaminoLoanEntry = {
  id: string;
  marketAddress: string;
  ownerPoolId: string | null;
  ownerPoolName: string | null;
  collateralUsd: number | null;
  debtUsd: number | null;
  avgPriceUsdc: number | null;
  targetPriceUsdc: number | null;
  deposits: {
    mint: string;
    amount: number;
    avgPriceUsdc?: number | null;
    targetPriceUsdc?: number | null;
  }[];
  borrows: { mint: string; amount: number }[];
  lastSeenAt: string;
  lastError: string | null;
};

export type KaminoLoansState = {
  loans: KaminoLoanEntry[];
  updatedAt: string | null;
};

export type KaminoLoansStore = {
  load(): Promise<KaminoLoansState | null>;
  save(state: KaminoLoansState): Promise<void>;
};

export function defaultKaminoLoansFile(name = "kamino-loans.json"): string {
  return path.join(__dirname, "..", "data", name);
}

function normalizeKaminoLoansState(input: unknown): KaminoLoansState {
  if (!input || typeof input !== "object") {
    return { loans: [], updatedAt: null };
  }
  const rawLoans = Array.isArray((input as any).loans)
    ? (input as any).loans
    : (Array.isArray(input) ? input : []);
  const loans = rawLoans.map((item: any) => {
    const marketAddress = String(item?.marketAddress ?? item?.market ?? "").trim();
    if (!marketAddress) return null;
    const id = String(item?.id ?? marketAddress).trim() || marketAddress;
    const ownerPoolId = item?.ownerPoolId ? String(item.ownerPoolId) : null;
    const ownerPoolName = item?.ownerPoolName ? String(item.ownerPoolName) : null;
    const collateralUsd = item?.collateralUsd == null ? null : Number(item.collateralUsd);
    const debtUsd = item?.debtUsd == null ? null : Number(item.debtUsd);
    const avgPriceUsdc = item?.avgPriceUsdc == null ? null : Number(item.avgPriceUsdc);
    const targetPriceUsdc = item?.targetPriceUsdc == null ? null : Number(item.targetPriceUsdc);
    const deposits = Array.isArray(item?.deposits)
      ? item.deposits.map((dep: any) => ({
        mint: String(dep?.mint ?? "").trim(),
        amount: Number(dep?.amount ?? 0),
        avgPriceUsdc: dep?.avgPriceUsdc == null ? null : Number(dep.avgPriceUsdc),
        targetPriceUsdc: dep?.targetPriceUsdc == null ? null : Number(dep.targetPriceUsdc)
      })).filter((dep: any) => dep.mint)
      : [];
    const borrows = Array.isArray(item?.borrows)
      ? item.borrows.map((bor: any) => ({
        mint: String(bor?.mint ?? "").trim(),
        amount: Number(bor?.amount ?? 0)
      })).filter((bor: any) => bor.mint)
      : [];
    const lastSeenAt = typeof item?.lastSeenAt === "string"
      ? item.lastSeenAt
      : new Date().toISOString();
    const lastError = item?.lastError ? String(item.lastError) : null;
    return {
      id,
      marketAddress,
      ownerPoolId,
      ownerPoolName,
      collateralUsd,
      debtUsd,
      avgPriceUsdc,
      targetPriceUsdc,
      deposits,
      borrows,
      lastSeenAt,
      lastError
    };
  }).filter(Boolean) as KaminoLoanEntry[];
  const updatedAt = typeof (input as any).updatedAt === "string" ? (input as any).updatedAt : null;
  return { loans, updatedAt };
}

class FileKaminoLoansStore implements KaminoLoansStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<KaminoLoansState | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return normalizeKaminoLoansState(parsed);
    } catch {
      return null;
    }
  }

  async save(state: KaminoLoansState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}

class RedisKaminoLoansStore implements KaminoLoansStore {
  private key: string;

  constructor(key: string) {
    this.key = key;
  }

  async load(): Promise<KaminoLoansState | null> {
    const client = await getRedisClient();
    if (!client) {
      return null;
    }
    const raw = await client.get(this.key);
    if (!raw) {
      return null;
    }
    return normalizeKaminoLoansState(JSON.parse(raw));
  }

  async save(state: KaminoLoansState): Promise<void> {
    const client = await getRedisClient();
    if (!client) {
      throw new Error("Redis not configured");
    }
    await client.set(this.key, JSON.stringify(state));
  }
}

export async function createKaminoLoansStore(): Promise<KaminoLoansStore> {
  const client = await getRedisClient();
  if (client) {
    return new RedisKaminoLoansStore(getRedisKey("kamino-loans"));
  }
  const filePath = defaultKaminoLoansFile();
  return new FileKaminoLoansStore(filePath);
}

// ── Pending Returns ────────────────────────────────────────────────────────

export type PendingReturnEntry = {
  id: string;
  walletAddress: string;
  mint: string;
  amount: number;
  symbol: string;
  createdAt: string;
  confirmedAt: string | null;
  txSig: string | null;
  note: string | null;
};

export type PendingReturnsState = {
  returns: PendingReturnEntry[];
  updatedAt: string | null;
};

export type PendingReturnsStore = {
  load(): Promise<PendingReturnsState | null>;
  save(state: PendingReturnsState): Promise<void>;
};

export function defaultPendingReturnsFile(name = "pending-returns.json"): string {
  return path.join(__dirname, "..", "data", name);
}

export async function createPendingReturnsStore(): Promise<PendingReturnsStore> {
  const file = defaultPendingReturnsFile();
  return {
    async load() {
      try {
        const raw = await fs.readFile(file, "utf-8");
        const parsed = JSON.parse(raw);
        const returns = Array.isArray(parsed?.returns) ? parsed.returns : [];
        return { returns, updatedAt: parsed?.updatedAt ?? null };
      } catch {
        return null;
      }
    },
    async save(state) {
      await fs.writeFile(file, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
    }
  };
}
