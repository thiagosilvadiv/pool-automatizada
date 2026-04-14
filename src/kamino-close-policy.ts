export type KaminoCloseMode = "manual" | "target" | "token-change";
export type KaminoCloseTrigger =
  | "manual"
  | "price-target"
  | "wait-funds"
  | "token-change"
  | "debt-zero"
  | "recover-debt-zero";

export function isKaminoCloseAllowed(params: {
  mode: KaminoCloseMode;
  trigger: KaminoCloseTrigger;
  debtAmount: number;
}): boolean {
  const debtAmount = Number.isFinite(params.debtAmount) ? Math.max(0, params.debtAmount) : 0;
  if (params.mode === "manual" || params.trigger === "manual") {
    return true;
  }
  if (params.trigger === "price-target") {
    return true;
  }
  if (
    (params.trigger === "debt-zero" || params.trigger === "recover-debt-zero")
    && debtAmount <= 1e-8
  ) {
    return true;
  }
  return false;
}

export function computeKaminoPnlNoFeesUsd(params: {
  entryUsd: number | null;
  exitUsd: number | null;
  feesUsd?: number | null;
  txFeeUsd?: number | null;
}): number | null {
  const entryUsd = Number.isFinite(params.entryUsd) ? Number(params.entryUsd) : null;
  const exitUsd = Number.isFinite(params.exitUsd) ? Number(params.exitUsd) : null;
  if (entryUsd == null || exitUsd == null) {
    return null;
  }
  const feesUsd = Number.isFinite(params.feesUsd) ? Number(params.feesUsd) : 0;
  const txFeeUsd = Number.isFinite(params.txFeeUsd) ? Number(params.txFeeUsd) : 0;
  return exitUsd - entryUsd - feesUsd - txFeeUsd;
}

export function shouldUseKaminoAfterClose(closePnlNoFeesUsd: number | null): boolean {
  return closePnlNoFeesUsd != null && Number.isFinite(closePnlNoFeesUsd) && closePnlNoFeesUsd < 0;
}
