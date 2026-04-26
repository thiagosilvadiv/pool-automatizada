import { describe, expect, it } from "vitest";
import { decideRecoveredKaminoResume } from "../src/kamino-reopen-policy.js";

describe("kamino recovered reopen policy", () => {
  it("reopens from wallet balances without trying to close the loan", () => {
    expect(decideRecoveredKaminoResume({
      walletTokenA: 0.42,
      walletTokenB: 0,
      debtAmount: 46.53,
      walletDebtBalance: 0
    })).toEqual({
      action: "use-wallet",
      maxTokenA: 0.42,
      maxTokenB: 0,
      reason: "Saldo da wallet disponivel para reabrir a pool sem fechar o emprestimo."
    });
  });

  it("uses the debt balance found in wallet to rebuild the pool side", () => {
    expect(decideRecoveredKaminoResume({
      walletTokenA: 0,
      walletTokenB: 0,
      debtAmount: 46.53,
      walletDebtBalance: 44
    })).toEqual({
      action: "swap-debt-balance",
      debtBalanceToUse: 44,
      reason: "Saldo da divida encontrado na wallet; convertendo para reabrir a pool sem fechar o emprestimo."
    });
  });

  it("waits only when there is active debt and no usable balance", () => {
    expect(decideRecoveredKaminoResume({
      walletTokenA: 0,
      walletTokenB: 0,
      debtAmount: 46.53,
      walletDebtBalance: 0
    })).toEqual({
      action: "wait-funds",
      reason: "Divida ativa sem saldo utilizavel na wallet para reabrir a pool."
    });
  });
});
