export type KaminoLockState = {
  poolId: string;
  poolName: string;
  marketAddress: string | null;
  updatedAt: string;
};

let currentLock: KaminoLockState | null = null;

export function getKaminoLock(): KaminoLockState | null {
  return currentLock ? { ...currentLock } : null;
}

export function tryAcquireKaminoLock(input: {
  poolId: string;
  poolName: string;
  marketAddress: string | null;
}): { ok: boolean; owner?: KaminoLockState } {
  if (!currentLock || currentLock.poolId === input.poolId) {
    currentLock = {
      poolId: input.poolId,
      poolName: input.poolName,
      marketAddress: input.marketAddress ?? null,
      updatedAt: new Date().toISOString()
    };
    return { ok: true, owner: { ...currentLock } };
  }
  return { ok: false, owner: { ...currentLock } };
}

export function releaseKaminoLock(poolId: string): void {
  if (currentLock?.poolId === poolId) {
    currentLock = null;
  }
}
