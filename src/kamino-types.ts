export type KaminoBorrowAsset = "usdc" | "usdt" | "auto";

export type KaminoCloseRule = "avg-price" | "breakeven" | "manual";

export type KaminoCollateralEntry = {
  mint: string;
  amount: number;
  usd: number | null;
  debtUsd: number | null;
  avgPriceUsdc: number | null;
  targetPriceUsdc: number | null;
  currentPriceUsdc?: number | null;
  gapToTargetPct?: number | null;
  currentUsd?: number | null;
  pnlUsd?: number | null;
};

export type KaminoCycleState = {
  active: boolean;
  ownerPoolId?: string | null;
  ownerPoolName?: string | null;
  marketAddress?: string | null;
  lastSeenAt?: string | null;
  repayRetryUntil?: string | null;
  repayRetryAttempts?: number | null;
  repayRetryReason?: string | null;
  baselineTokenA?: number | null;
  baselineTokenB?: number | null;
  reservedTokenA?: number | null;
  reservedTokenB?: number | null;
  reservedCollateralDust?: number | null;
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
  lastSuccessfulOperation?: {
    type: "deposit" | "borrow" | "repay" | "withdraw" | "repay-with-collateral";
    signature: string;
    timestamp: string;
    mint: string;
    amount: number;
  } | null;
};

export type PendingReturn = {
  id: string;
  walletAddress: string;
  mint: string;
  amount: number;
  symbol: string;
  createdAt: string;
  confirmedAt: string | null;
  txSig: string | null;
  note: string | null;
};
