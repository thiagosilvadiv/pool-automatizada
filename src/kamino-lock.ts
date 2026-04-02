export type KaminoLockState = {
  poolId: string;
  poolName: string;
  marketAddress: string | null;
  updatedAt: string;
};

const locksByMarket = new Map<string, KaminoLockState>();

function resolveMarketKey(marketAddress: string | null): string {
  const trimmed = String(marketAddress ?? "").trim();
  return trimmed || "default";
}

export function getKaminoLock(marketAddress: string | null): KaminoLockState | null {
  const key = resolveMarketKey(marketAddress);
  const lock = locksByMarket.get(key);
  return lock ? { ...lock } : null;
}

export function tryAcquireKaminoLock(input: {
  poolId: string;
  poolName: string;
  marketAddress: string | null;
}): { ok: boolean; owner?: KaminoLockState } {
  const key = resolveMarketKey(input.marketAddress);
  const current = locksByMarket.get(key) ?? null;
  if (!current || current.poolId === input.poolId) {
    const next = {
      poolId: input.poolId,
      poolName: input.poolName,
      marketAddress: input.marketAddress ?? null,
      updatedAt: new Date().toISOString()
    };
    locksByMarket.set(key, next);
    return { ok: true, owner: { ...next } };
  }
  return { ok: false, owner: { ...current } };
}

export function releaseKaminoLock(poolId: string, marketAddress: string | null): void {
  const key = resolveMarketKey(marketAddress);
  const current = locksByMarket.get(key);
  if (current?.poolId === poolId) {
    locksByMarket.delete(key);
  }
}
