function clampPositive(value: number | null | undefined): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

export function shouldBootstrapAutoAddFromWallet(params: {
  balanceTokenA?: number | null;
  balanceTokenB?: number | null;
  plannedAddUsd?: number | null;
  autoAddMinUsd?: number | null;
}): boolean {
  const balanceTokenA = clampPositive(params.balanceTokenA);
  const balanceTokenB = clampPositive(params.balanceTokenB);
  const plannedAddUsd = clampPositive(params.plannedAddUsd);
  const autoAddMinUsd = clampPositive(params.autoAddMinUsd);

  if (balanceTokenA <= 0 || balanceTokenB <= 0) {
    return true;
  }

  if (autoAddMinUsd > 0 && plannedAddUsd > 0 && plannedAddUsd < autoAddMinUsd) {
    return true;
  }

  return false;
}
