import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info"
});

export function stringifyError(err: unknown): string {
  if (err instanceof Error) {
    const message = (err.message ?? "").trim();
    if (message.length > 0) {
      return message;
    }
    const name = (err.name ?? "").trim();
    if (name.length > 0) {
      return name;
    }
    const stack = (err.stack ?? "").trim();
    if (stack.length > 0) {
      const firstLine = stack.split("\n")[0]?.trim();
      if (firstLine) {
        return firstLine;
      }
    }
    return "Erro sem detalhes";
  }
  if (err && typeof err === "object") {
    const raw = err as any;
    const message = String(raw?.message ?? "").trim();
    if (message.length > 0 && message !== "[object Object]") {
      return message;
    }
    const name = String(raw?.name ?? raw?.type ?? "").trim();
    if (name.length > 0) {
      return name;
    }
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") {
        return json;
      }
    } catch {
      // ignore json serialization errors
    }
  }
  return String(err);
}
