import type { Decimal as DecimalType } from "decimal.js";

export function lamportsToUi(lamports: DecimalType | null | undefined, decimals: number): number {
  if (!lamports || !(lamports as any).isFinite?.()) return 0;
  const divisor = Math.pow(10, Math.max(0, decimals));
  return (lamports as any).div(divisor).toNumber();
}

export function applyWithdrawBuffer(capacityUi: number, bufferPct: number): number {
  const pct = Math.max(0, Math.min(1, bufferPct));
  return Math.max(0, capacityUi * pct);
}

export function buildRpcUrlList(primary: string, rawList?: string): string[] {
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    const trimmed = String(value).trim();
    if (!trimmed) return;
    seen.add(trimmed);
  };
  add(primary);
  if (rawList) {
    rawList
      .split(/[,;\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => add(item));
  }
  return Array.from(seen);
}

export function isBlockhashError(err: any): boolean {
  const msg = String(err?.message ?? err).toLowerCase();
  if (isObligationBorrowsEmptyError(err)) return false;
  if (isObligationDepositsEmptyError(err)) return false;
  return (
    msg.includes("blockhash not found") ||
    msg.includes("blockhash expired") ||
    msg.includes("-32002") ||
    msg.includes("error #1") ||
    msg.includes("blockheight exceeded") ||
    msg.includes("lastvalidblockheight") ||
    msg.includes("block height exceeded")
  );
}

export function isObligationBorrowsEmptyError(err: any): boolean {
  const msg = String(err?.message ?? err).toLowerCase();
  const logs: string[] = (err as any)?.__originalErr?.context?.logs
    ?? (err as any)?.context?.logs
    ?? (err as any)?.logs
    ?? [];
  const logsText = logs.join(" ").toLowerCase();
  return (
    msg.includes("obligationborrowsempty") ||
    msg.includes("obligation borrows are empty") ||
    msg.includes("obligation has no borrows") ||
    msg.includes("0x1785") ||
    msg.includes("6021") ||
    logsText.includes("obligationborrowsempty") ||
    logsText.includes("obligation borrows are empty") ||
    logsText.includes("obligation has no borrows") ||
    logsText.includes("0x1785") ||
    logsText.includes("error code: 6021")
  );
}

export function isObligationDepositsEmptyError(err: any): boolean {
  const msg = String(err?.message ?? err).toLowerCase();
  const logs: string[] = (err as any)?.__originalErr?.context?.logs
    ?? (err as any)?.context?.logs
    ?? (err as any)?.logs
    ?? [];
  const logsText = logs.join(" ").toLowerCase();
  return (
    msg.includes("obligationdepositsempty") ||
    msg.includes("obligation deposits are empty") ||
    msg.includes("obligation has no deposits") ||
    msg.includes("has no deposits") ||
    msg.includes("0x1784") ||
    msg.includes("6020") ||
    logsText.includes("obligationdepositsempty") ||
    logsText.includes("obligation deposits are empty") ||
    logsText.includes("obligation has no deposits") ||
    logsText.includes("has no deposits") ||
    logsText.includes("0x1784") ||
    logsText.includes("error code: 6020")
  );
}

export function isInsufficientFundsError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message ?? err).toLowerCase();
  if (
    msg.includes("insufficient funds") ||
    /custom program error: 0x1(?![0-9a-f])/i.test(msg) ||
    msg.includes("\"0x1\"") ||
    msg.includes("error: insufficient funds")
  ) {
    return true;
  }

  const context = err?.context ?? err?.cause ?? err?.__context;
  const logs: string[] = context?.logs ?? err?.logs ?? err?.data?.logs ?? [];
  if (Array.isArray(logs)) {
    for (const log of logs) {
      const line = String(log).toLowerCase();
      if (line.includes("insufficient funds") || /custom program error: 0x1(?![0-9a-f])/i.test(line)) {
        return true;
      }
    }
  }

  const data = err?.data ?? context?.data;
  if (typeof data === "string" && data.length > 0) {
    try {
      const decoded = Buffer.from(data, "base64").toString("utf8").toLowerCase();
      if (decoded.includes("insufficient%20funds") || decoded.includes("insufficient funds")) {
        return true;
      }
    } catch {
      // ignore decode failures; callers still get the original error.
    }
  }

  if (err?.cause && err.cause !== err) {
    return isInsufficientFundsError(err.cause);
  }
  return false;
}
