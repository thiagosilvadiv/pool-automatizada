export type KaminoRecoveredResumePlan =
  | {
      action: "use-wallet";
      maxTokenA: number;
      maxTokenB: number;
      reason: string;
    }
  | {
      action: "swap-debt-balance";
      debtBalanceToUse: number;
      reason: string;
    }
  | {
      action: "wait-funds";
      reason: string;
    };

function clampPositive(value: number | null | undefined): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

export function decideRecoveredKaminoResume(params: {
  walletTokenA?: number | null;
  walletTokenB?: number | null;
  debtAmount?: number | null;
  walletDebtBalance?: number | null;
}): KaminoRecoveredResumePlan {
  const walletTokenA = clampPositive(params.walletTokenA);
  const walletTokenB = clampPositive(params.walletTokenB);
  const debtAmount = clampPositive(params.debtAmount);
  const walletDebtBalance = clampPositive(params.walletDebtBalance);

  if (walletTokenA > 0 || walletTokenB > 0) {
    return {
      action: "use-wallet",
      maxTokenA: walletTokenA,
      maxTokenB: walletTokenB,
      reason: debtAmount > 1e-8
        ? "Saldo da wallet disponivel para reabrir a pool sem fechar o emprestimo."
        : "Saldo da wallet disponivel para reabrir a pool."
    };
  }

  if (debtAmount > 1e-8 && walletDebtBalance > 1e-8) {
    return {
      action: "swap-debt-balance",
      debtBalanceToUse: Math.min(walletDebtBalance, debtAmount),
      reason: "Saldo da divida encontrado na wallet; convertendo para reabrir a pool sem fechar o emprestimo."
    };
  }

  if (debtAmount > 1e-8) {
    return {
      action: "wait-funds",
      reason: "Divida ativa sem saldo utilizavel na wallet para reabrir a pool."
    };
  }

  return {
    action: "wait-funds",
    reason: "Aguardando saldo emprestado para reabrir a pool."
  };
}
