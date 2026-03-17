import { logger } from "./logger.js";

export type RetryOptions = {
  retries: number;
  baseDelayMs: number;
};

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > options.retries) {
        throw err;
      }
      const delay = options.baseDelayMs * attempt;
      logger.warn({ err, attempt, delay }, "retrying after error");
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
