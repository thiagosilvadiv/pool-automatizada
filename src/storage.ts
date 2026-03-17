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
