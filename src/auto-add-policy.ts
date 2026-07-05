function clampPositive(value: number | null | undefined): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

export function getAutoAddMinUsdTolerance(autoAddMinUsd?: number | null): number {
  const minUsd = clampPositive(autoAddMinUsd);
  if (minUsd <= 0) {
    return 0;
  }

  return Math.min(0.25, Math.max(0.05, minUsd * 0.05));
}

export function isAutoAddBelowMinUsd(params: {
  plannedAddUsd?: number | null;
  autoAddMinUsd?: number | null;
}): boolean {
  const autoAddMinUsd = clampPositive(params.autoAddMinUsd);
  if (params.plannedAddUsd == null) {
    return false;
  }

  const plannedAddUsd = Number(params.plannedAddUsd);
  if (autoAddMinUsd <= 0 || !Number.isFinite(plannedAddUsd)) {
    return false;
  }

  return plannedAddUsd + getAutoAddMinUsdTolerance(autoAddMinUsd) < autoAddMinUsd;
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

  if (autoAddMinUsd > 0 && plannedAddUsd > 0 && isAutoAddBelowMinUsd({ plannedAddUsd, autoAddMinUsd })) {
    return true;
  }

  return false;
}
