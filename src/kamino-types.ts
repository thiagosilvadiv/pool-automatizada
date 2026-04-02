export type KaminoBorrowAsset = "usdc" | "usdt" | "auto";

export type KaminoCloseRule = "avg-price" | "breakeven" | "manual";

export type KaminoCycleState = {
  active: boolean;
  collateralMint: string | null;
  collateralAmount: number;
  collateralUsd: number | null;
  debtMint: string | null;
  debtAmount: number;
  debtUsd: number | null;
  avgPriceUsdc: number | null;
  targetPriceUsdc: number | null;
  cycleCount: number;
  updatedAt: string | null;
  lastError?: string | null;
};
