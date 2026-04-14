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
