import path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";
import { logger } from "./logger.js";
import { getRedisClient, getRedisKey } from "./redis.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type HistoryState = {
  history: unknown[];
  lastEventPortfolioValue: number | null;
  lastEventPortfolioUsd: number | null;
  hedgeState?: unknown;
};

export type HistoryStore = {
  load(): Promise<HistoryState | null>;
  save(state: HistoryState): Promise<void>;
  clear(): Promise<void>;
};

export function defaultHistoryFile(name = "history.json"): string {
  return path.join(__dirname, "..", "data", name);
}

class FileHistoryStore implements HistoryStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<HistoryState | null> {
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
  return new FileHistoryStore(defaultHistoryFile(name));
}

export type PoolsState<T> = {
  selectedPoolId: string | null;
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
    return new RedisPoolsStore<T>(getRedisKey("pools"));
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
