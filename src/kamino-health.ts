import type { KaminoCycleState } from "./kamino-types.js";


type ErrorType = "rate-limit" | "insufficient-funds" | "blockhash" | "protocol" | "unknown";

type HealthContext = {
  hasOpenPosition?: boolean;
};

export type ErrorRecord = {
  timestamp: number;
  type: ErrorType;
  code?: string;
  message: string;
  operation: string;
};

function classifyError(message: string): ErrorType {
  const msg = message.toLowerCase();
  if (msg.includes("429") || msg.includes("too many requests") || msg.includes("8100002")) {
    return "rate-limit";
  }
  if (msg.includes("insufficient funds") || /\b0x1\b/.test(msg) || /custom program error: 0x1(?![0-9a-f])/i.test(msg)) {
    return "insufficient-funds";
  }
  if (msg.includes("-32002") || msg.includes("blockhash")) {
    return "blockhash";
  }
  if (msg.includes("0x") || msg.includes("custom program error")) {
    return "protocol";
  }
  return "unknown";
}

export class KaminoHealthMonitor {
  private errors: ErrorRecord[] = [];
  private lastProgressAt: number = Date.now();
  private consecutiveErrors = 0;

  recordError(err: any, operation: string): void {
    const message = String(err?.message ?? err ?? "");
    const record: ErrorRecord = {
      timestamp: Date.now(),
      type: classifyError(message),
      code: (err as any)?.__code ? String((err as any).__code) : undefined,
      message,
      operation
    };
    this.errors.push(record);
    if (this.errors.length > 200) {
      this.errors.shift();
    }
    this.consecutiveErrors += 1;
  }

  recordSuccess(_operation: string): void {
    this.lastProgressAt = Date.now();
    this.consecutiveErrors = 0;
  }

  isStuck(state: KaminoCycleState | null, context?: HealthContext): boolean {
    if (!state?.active) return false;
    if (context?.hasOpenPosition) return false;
    const stuckThresholdMs = 30 * 60 * 1000; // 30 min
    return (Date.now() - this.lastProgressAt) > stuckThresholdMs;
  }

  getRecentErrorRate(windowMs = 5 * 60 * 1000): {
    rateLimitCount: number;
    protocolErrorCount: number;
    totalCount: number;
  } {
    const cutoff = Date.now() - windowMs;
    const recent = this.errors.filter((err) => err.timestamp >= cutoff);
    const rateLimitCount = recent.filter((err) => err.type === "rate-limit").length;
    const protocolErrorCount = recent.filter((err) => err.type === "protocol").length;
    return { rateLimitCount, protocolErrorCount, totalCount: recent.length };
  }

  diagnose(state: KaminoCycleState | null, context?: HealthContext): string[] {
    const issues: string[] = [];
    const rates = this.getRecentErrorRate();
    if (rates.rateLimitCount > 5) {
      issues.push("RATE_LIMIT_EXCESSIVO: RPC está throttling. Considere trocar endpoint.");
    }
    if (this.isStuck(state, context)) {
      issues.push("CICLO_PRESO: Kamino ativo há mais de 30min sem progresso.");
    }
    if (this.consecutiveErrors > 3) {
      issues.push(`ERROS_CONSECUTIVOS: ${this.consecutiveErrors} falhas seguidas sem sucesso.`);
    }
    return issues;
  }

  getConsecutiveErrors(): number {
    return this.consecutiveErrors;
  }

  getLastProgressAt(): number {
    return this.lastProgressAt;
  }

  getRecentErrors(windowMs = 5 * 60 * 1000): ErrorRecord[] {
    const cutoff = Date.now() - windowMs;
    return this.errors.filter((err) => err.timestamp >= cutoff);
  }
}
