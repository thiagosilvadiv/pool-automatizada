export type BalanceReservation = {
  mint: string;
  amount: number;
};

export class BalanceCoordinator {
  private reservations = new Map<string, Map<string, number>>();

  setPoolReservations(poolId: string, entries: BalanceReservation[]): void {
    const next = new Map<string, number>();
    for (const entry of entries) {
      const mint = String(entry.mint ?? "").trim();
      const amount = Number(entry.amount ?? 0);
      if (!mint || !Number.isFinite(amount) || amount <= 0) {
        continue;
      }
      next.set(mint, amount);
    }
    if (next.size === 0) {
      this.reservations.delete(poolId);
      return;
    }
    this.reservations.set(poolId, next);
  }

  clearPool(poolId: string): void {
    this.reservations.delete(poolId);
  }

  getReserved(poolId: string, mint: string): number {
    const pool = this.reservations.get(poolId);
    if (!pool) return 0;
    const value = pool.get(mint) ?? 0;
    return Number.isFinite(value) ? value : 0;
  }

  getAvailableBalance(poolId: string, mint: string, actual: number): number {
    const actualNum = Number.isFinite(actual) ? Number(actual) : 0;
    let reservedTotal = 0;
    for (const [id, entries] of this.reservations.entries()) {
      const value = entries.get(mint) ?? 0;
      if (!Number.isFinite(value)) continue;
      if (id === poolId) continue;
      reservedTotal += value;
    }
    const available = actualNum - Math.max(0, reservedTotal);
    return available > 0 ? available : 0;
  }
}
