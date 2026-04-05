import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info"
});

export function stringifyError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
