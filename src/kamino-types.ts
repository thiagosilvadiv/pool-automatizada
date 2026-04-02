export type KaminoBorrowAsset = "usdc" | "usdt" | "auto";

export type KaminoCloseRule = "avg-price" | "breakeven" | "manual";

export type KaminoCollateralEntry = {
  mint: string;
  amount: number;
  usd: number | null;
  debtUsd: number | null;
  avgPriceUsdc: number | null;
  targetPriceUsdc: number | null;
};

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
  collaterals: KaminoCollateralEntry[];
  cycleCount: number;
  updatedAt: string | null;
  lastError?: string | null;
};
