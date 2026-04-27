const DEFAULT_KAMINO_MIN_BORROW_USD = 0.01;

export function computeRiskAwareRepayChunk(params: {
  debtRemaining: number;
  capacityUi: number;
  priceCollToDebt: number;
  minStable: number;
}): { chunk: number; reason?: string } {
  const { debtRemaining, capacityUi, priceCollToDebt, minStable } = params;
  if (!Number.isFinite(capacityUi) || capacityUi <= 0) {
    return { chunk: 0, reason: "capacidade de saque insuficiente" };
  }
  if (!Number.isFinite(priceCollToDebt) || priceCollToDebt <= 0) {
    return { chunk: 0, reason: "preco indisponivel para colateral" };
  }
  const capacityDebt = capacityUi * priceCollToDebt;
  const chunk = Math.min(debtRemaining, capacityDebt);
  if (chunk < minStable) {
    return { chunk: 0, reason: "capacidade de saque insuficiente" };
  }
  return { chunk };
}

export function computeKaminoTargetToleranceAmount(params: {
  targetAmount: number;
  unitUsd: number;
  minBorrowUsd?: number;
}): number {
  const targetAmount = Number(params.targetAmount);
  const baseTolerance = Math.max(1e-6, targetAmount * 1e-6);
  const unitUsd = Number(params.unitUsd);
  if (!(Number.isFinite(unitUsd) && unitUsd > 0)) {
    return baseTolerance;
  }
  const minBorrowUsd = Number(params.minBorrowUsd ?? DEFAULT_KAMINO_MIN_BORROW_USD);
  if (!(Number.isFinite(minBorrowUsd) && minBorrowUsd > 0)) {
    return baseTolerance;
  }
  const operationalTolerance = minBorrowUsd / unitUsd;
  if (!(Number.isFinite(operationalTolerance) && operationalTolerance > 0)) {
    return baseTolerance;
  }
  return Math.max(baseTolerance, operationalTolerance);
}
