import { createClient, RedisClientType } from "redis";
import { logger } from "./logger.js";

let client: RedisClientType | null = null;

export function isRedisEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export async function getRedisClient(): Promise<RedisClientType | null> {
  const url = process.env.REDIS_URL;
  if (!url) {
    return null;
  }
  if (client) {
    return client;
  }
  client = createClient({ url });
  client.on("error", (err) => {
    logger.warn({ err }, "redis client error");
  });
  await client.connect();
  return client;
}

export function getRedisKey(key: string): string {
  const prefix = process.env.REDIS_PREFIX?.trim() || "orca-bot";
  return `${prefix}:${key}`;
}
