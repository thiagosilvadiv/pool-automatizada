import { logger } from "./logger.js";
export async function withRetry(fn, options) {
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        }
        catch (err) {
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
