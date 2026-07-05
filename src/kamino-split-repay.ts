import { stringifyError } from "./logger.js";
import type { KaminoWithdrawResult } from "./kamino-client.js";


export async function performSplitRepayWithCollateralHelper(params: {
  kamino: {
    withdraw(input: { mint: string; amount: number }): Promise<KaminoWithdrawResult>;
    repay(input: { mint: string; amount: number }): Promise<string>;
  };
  swapTokenToStable: (input: {
    inputMint: string;
    inputDecimals: number;
    amountUi: number;
    stableMint: string;
    stableDecimals: number;
    label?: string;
  }) => Promise<number | null>;
  collMint: string;
  collDecimals: number;
  debtMint: string;
  debtDecimals: number;
  repayUi: number;
  capacityUi: number;
  priceCollToDebt: number;
  minWithdraw: number;
  logger: (payload: any, msg: string, level?: "info" | "warn" | "error") => void;
  isRetryable: (msg: string) => boolean;
  onWithdrawSuccess?: (result: KaminoWithdrawResult) => void;
  onRepaySuccess?: (signature: string, amount: number, mint: string) => void;
}): Promise<{ performed: boolean; retryable?: boolean; error?: string; debtRemaining?: number }> {
  const {
    kamino,
    swapTokenToStable,
    collMint,
    collDecimals,
    debtMint,
    debtDecimals,
    repayUi,
    capacityUi,
    priceCollToDebt,
    minWithdraw,
    logger,
    isRetryable,
    onWithdrawSuccess,
    onRepaySuccess
  } = params;
  const runOnce = async <T>(fn: () => Promise<T>): Promise<T> => fn();
  if (!Number.isFinite(priceCollToDebt) || priceCollToDebt <= 0) {
    const error = "preco do colateral indisponivel para split repay";
    return { performed: false, error };
  }
  if (!Number.isFinite(capacityUi) || capacityUi <= 0) {
    return { performed: false, error: "capacidade insuficiente para split" };
  }
  const requiredCollateral = repayUi / priceCollToDebt;
  if (!Number.isFinite(requiredCollateral) || requiredCollateral > capacityUi + 1e-9) {
    const needed = Number.isFinite(requiredCollateral) ? requiredCollateral.toFixed(8) : "indisponivel";
    return { performed: false, error: `capacidade insuficiente para split (need ${needed}, cap ${capacityUi.toFixed(8)})` };
  }
  let collNeeded = Math.max(minWithdraw, Math.min(capacityUi, requiredCollateral * 1.02));
  let withdrawAttempts = 0;
  const maxWithdrawAttempts = 3;
  while (withdrawAttempts < maxWithdrawAttempts) {
    if (collNeeded < minWithdraw || collNeeded > capacityUi + 1e-9) {
      const error = `capacidade insuficiente para split (need ${collNeeded.toFixed(8)}, cap ${capacityUi.toFixed(8)})`;
      return { performed: false, error };
    }
    try {
      const withdrawResult = await runOnce(() => kamino.withdraw({ mint: collMint, amount: collNeeded }));
      const actualAmount = Number(withdrawResult.actualAmount ?? collNeeded);
      logger(
        { sig: withdrawResult.signature, amount: actualAmount, mint: collMint },
        "split-repay withdraw",
        "info"
      );
      if (onWithdrawSuccess) {
        onWithdrawSuccess(withdrawResult);
      }
      collNeeded = actualAmount;
      break;
    } catch (err) {
      withdrawAttempts += 1;
      const message = stringifyError(err);
      const lower = message.toLowerCase();
      if (
        lower.includes("withdrawtoolarge") ||
        lower.includes("withdraw too large") ||
        lower.includes("6011") ||
        lower.includes("0x177b")
      ) {
        let maxWithdrawFromError: number | null = null;
        try {
          const decoded = decodeURIComponent(message);
          const matchMax = decoded.match(/max_withdraw_value[=\s:]+([0-9]+(?:\.[0-9]+)?)/i);
          if (matchMax) {
            const parsed = parseFloat(matchMax[1]);
            if (Number.isFinite(parsed) && parsed > 0) {
              maxWithdrawFromError = parsed;
            }
          }
        } catch {
          // ignore malformed error payloads.
        }
        if (maxWithdrawFromError != null) {
          const priceFactor = priceCollToDebt > 0 ? priceCollToDebt : 1;
          collNeeded = Math.max(minWithdraw, (maxWithdrawFromError * 0.85) / priceFactor);
        } else {
          collNeeded = Math.max(minWithdraw, collNeeded / 2);
        }
        if (withdrawAttempts >= maxWithdrawAttempts) {
          return { performed: false, error: message };
        }
        continue;
      }
      if (isRetryable(message)) {
        return { performed: false, retryable: true, error: message };
      }
      return { performed: false, error: message };
    }
  }
  let stableOut = 0;
  try {
    const swapped = await runOnce(() =>
      swapTokenToStable({
        inputMint: collMint,
        inputDecimals: collDecimals,
        amountUi: collNeeded,
        stableMint: debtMint,
        stableDecimals: debtDecimals,
        label: "split-repay-coll->stable"
      })
    );
    stableOut = swapped ?? 0;
    if (stableOut <= 0) {
      return { performed: false, error: "swap retornou valor zero" };
    }
    logger({ in: collNeeded, out: stableOut, collMint, debtMint }, "split-repay swap", "info");
  } catch (err) {
    const message = stringifyError(err);
    if (isRetryable(message)) {
      return { performed: false, retryable: true, error: message };
    }
    return { performed: false, error: message };
  }
  const repayAmount = Math.min(repayUi, stableOut);
  if (repayAmount <= 0) {
    return { performed: false, error: "valor de repay <= 0 apos swap" };
  }
  try {
    const repaySig = await runOnce(() => kamino.repay({ mint: debtMint, amount: repayAmount }));
    logger({ sig: repaySig, amount: repayAmount, mint: debtMint }, "split-repay repay", "info");
    if (onRepaySuccess) {
      onRepaySuccess(repaySig, repayAmount, debtMint);
    }
    const remaining = Math.max(0, repayUi - repayAmount);
    return { performed: true, debtRemaining: remaining };
  } catch (err) {
    const message = stringifyError(err);
    if (isRetryable(message)) {
      return { performed: false, retryable: true, error: message };
    }
    return { performed: false, error: message };
  }
}
