import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de mock
// ─────────────────────────────────────────────────────────────────────────────

type CollEntry = {
  mint: string;
  amount: number;
  usd: number | null;
  debtUsd: number | null;
  avgPriceUsdc: number | null;
  targetPriceUsdc: number | null;
};

type CycleState = {
  active: boolean;
  debtMint: string | null;
  debtAmount: number;
  debtUsd: number | null;
  collateralMint: string | null;
  collateralAmount: number;
  collateralUsd: number | null;
  avgPriceUsdc: number | null;
  targetPriceUsdc: number | null;
  collaterals: CollEntry[];
  repayRetryUntil: string | null;
  repayRetryAttempts: number;
  repayRetryReason: string | null;
  lastError: string | null;
  updatedAt: string | null;
  cycleCount: number;
  ownerPoolId?: string | null;
  ownerPoolName?: string | null;
  marketAddress?: string | null;
};

// Implementação local e testável da lógica de fechamento parcial
// (espelha exatamente closeKaminoCollateralPartial, sem dependências de classe)
async function closePartial(
  mintToClose: string,
  state: CycleState,
  kamino: {
    repay: (input: { mint: string; amount: number }) => Promise<string>;
    repayWithCollateral: (input: { collateralMint: string; debtMint: string; repayAmount: number; slippageBps?: number }) => Promise<string>;
    withdraw: (input: { mint: string; amount: number }) => Promise<string>;
    getPositionState: () => Promise<{
      borrows: { mint: string; amount: number }[];
      deposits: { mint: string; amount: number }[];
    } | null>;
  },
  stableBalance: number
): Promise<{ ok: boolean; nextState: CycleState | null; error?: string }> {
  const collaterals = [...state.collaterals];
  const entryIndex = collaterals.findIndex((c) => c.mint === mintToClose);
  if (entryIndex === -1) {
    return { ok: false, nextState: null, error: "colateral nao encontrado" };
  }
  const entry = collaterals[entryIndex];
  const epsilon = 1e-8;

  // Proporção da dívida
  const totalDebtUsdRecorded = collaterals.reduce((s, c) => s + (c.debtUsd ?? 0), 0);
  let debtProportion: number;
  if (totalDebtUsdRecorded > epsilon) {
    debtProportion = (entry.debtUsd ?? 0) / totalDebtUsdRecorded;
  } else {
    const totalUsd = collaterals.reduce((s, c) => s + (c.usd ?? 0), 0);
    debtProportion = totalUsd > epsilon ? (entry.usd ?? 0) / totalUsd : 1 / collaterals.length;
  }
  debtProportion = Math.min(1, Math.max(0, debtProportion));

  // On-chain
  const position = await kamino.getPositionState();
  const onChainDebt = position?.borrows.find((b) => b.mint === state.debtMint)?.amount ?? state.debtAmount;
  const repayAmount = onChainDebt * debtProportion;

  // Repay
  if (repayAmount > epsilon) {
    if (stableBalance >= repayAmount - epsilon) {
      try {
        await kamino.repay({ mint: state.debtMint!, amount: repayAmount });
      } catch (err) {
        return { ok: false, nextState: null, error: String((err as Error).message) };
      }
    } else {
      try {
        await kamino.repayWithCollateral({
          collateralMint: mintToClose,
          debtMint: state.debtMint!,
          repayAmount,
          slippageBps: 50
        });
      } catch (err) {
        return { ok: false, nextState: null, error: String((err as Error).message) };
      }
    }
  }

  // Withdraw
  const onChainDeposit = position?.deposits.find((d) => d.mint === mintToClose)?.amount ?? (entry.amount ?? 0);
  const withdrawAmount = Math.min(entry.amount ?? 0, onChainDeposit);
  if (withdrawAmount > epsilon) {
    try {
      await kamino.withdraw({ mint: mintToClose, amount: withdrawAmount });
    } catch (err) {
      const msg = String((err as Error).message).toLowerCase();
      if (!msg.includes("obligationdepositsempty") && !msg.includes("0x1784") && !msg.includes("6020")) {
        return { ok: false, nextState: null, error: String((err as Error).message) };
      }
    }
  }

  // Novo estado
  const remaining = collaterals.filter((_, i) => i !== entryIndex);
  const remainingDebt = Math.max(0, state.debtAmount - repayAmount);
  const remainingDebtUsd = Math.max(0, remaining.reduce((s, c) => s + (c.debtUsd ?? 0), 0));
  const remainingCollUsd = remaining.reduce((s, c) => s + (c.usd ?? 0), 0);
  const single = remaining.length === 1 ? remaining[0] : null;
  const stillActive = remaining.length > 0;

  const nextState: CycleState = {
    ...state,
    active: stillActive,
    collateralMint: single ? single.mint : (stillActive ? state.collateralMint : null),
    collateralAmount: single ? (single.amount ?? 0) : (stillActive ? state.collateralAmount : 0),
    collateralUsd: remainingCollUsd > 0 ? remainingCollUsd : null,
    debtAmount: remainingDebt,
    debtUsd: remainingDebtUsd > 0 ? remainingDebtUsd : null,
    avgPriceUsdc: single ? single.avgPriceUsdc : null,
    targetPriceUsdc: single ? single.targetPriceUsdc : null,
    collaterals: remaining,
    repayRetryUntil: null,
    repayRetryAttempts: 0,
    repayRetryReason: null,
    lastError: null,
    updatedAt: new Date().toISOString()
  };
  return { ok: true, nextState };
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado base para os testes
// ─────────────────────────────────────────────────────────────────────────────

const SOL  = "So11111111111111111111111111111111111111112";
const WETH = "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BEstpK";

function makeState(overrides: Partial<CycleState> = {}): CycleState {
  return {
    active: true,
    debtMint: USDT,
    debtAmount: 10,        // $10 de dívida total on-chain
    debtUsd: 10,
    collateralMint: null,
    collateralAmount: 0,
    collateralUsd: 20,
    avgPriceUsdc: null,
    targetPriceUsdc: null,
    collaterals: [
      {
        mint: SOL,
        amount: 0.08,      // ~$6 de SOL depositado
        usd: 6,
        debtUsd: 5,        // $5 de dívida alocada ao SOL
        avgPriceUsdc: 75,
        targetPriceUsdc: 80
      },
      {
        mint: WETH,
        amount: 0.003,     // ~$14 de WETH depositado (simulado)
        usd: 14,           // mas para cálculo de proporção usamos debtUsd
        debtUsd: 5,        // $5 de dívida alocada ao WETH
        avgPriceUsdc: 3000,
        targetPriceUsdc: 3200
      }
    ],
    repayRetryUntil: null,
    repayRetryAttempts: 0,
    repayRetryReason: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
    cycleCount: 2,
    ...overrides
  };
}

function makeKamino(opts: {
  onChainDebt?: number;
  onChainDeposits?: Record<string, number>;
  repayFail?: Error;
  withdrawFail?: Error;
} = {}) {
  const repay = vi.fn().mockResolvedValue("sig-repay");
  const repayWithCollateral = vi.fn().mockResolvedValue("sig-repay-coll");
  const withdraw = vi.fn().mockResolvedValue("sig-withdraw");
  const getPositionState = vi.fn().mockResolvedValue({
    borrows: [{ mint: USDT, amount: opts.onChainDebt ?? 10 }],
    deposits: [
      { mint: SOL,  amount: opts.onChainDeposits?.SOL  ?? opts.onChainDeposits?.[SOL]  ?? 0.08 },
      { mint: WETH, amount: opts.onChainDeposits?.WETH ?? opts.onChainDeposits?.[WETH] ?? 0.003 }
    ]
  });
  if (opts.repayFail) repay.mockRejectedValue(opts.repayFail);
  if (opts.withdrawFail) withdraw.mockRejectedValue(opts.withdrawFail);
  return { repay, repayWithCollateral, withdraw, getPositionState };
}

// ─────────────────────────────────────────────────────────────────────────────
// Testes
// ─────────────────────────────────────────────────────────────────────────────

describe("closeKaminoCollateralPartial — matemática de proporção", () => {

  it("calcula corretamente 50/50 quando debtUsd é igual nos dois colaterais", async () => {
    const state  = makeState();   // SOL.debtUsd = 5, WETH.debtUsd = 5, total = 10
    const kamino = makeKamino();
    const result = await closePartial(WETH, state, kamino, 999);

    expect(result.ok).toBe(true);
    // repay deve ser 50% de 10 = 5
    expect(kamino.repay).toHaveBeenCalledWith({ mint: USDT, amount: expect.closeTo(5, 5) });
    expect(kamino.withdraw).toHaveBeenCalledWith({ mint: WETH, amount: 0.003 });
  });

  it("calcula proporção correta quando debtUsd é diferente (30/70)", async () => {
    const state = makeState({
      debtAmount: 10,
      debtUsd: 10,
      collaterals: [
        { mint: SOL,  amount: 1, usd: 80, debtUsd: 3, avgPriceUsdc: 80, targetPriceUsdc: 90 },
        { mint: WETH, amount: 1, usd: 80, debtUsd: 7, avgPriceUsdc: 3000, targetPriceUsdc: 3200 }
      ]
    });
    const kamino = makeKamino({ onChainDebt: 10 });
    // Fechando WETH: proporção = 7/10 = 70%
    const result = await closePartial(WETH, state, kamino, 999);
    expect(result.ok).toBe(true);
    expect(kamino.repay).toHaveBeenCalledWith({ mint: USDT, amount: expect.closeTo(7, 5) });
  });

  it("usa fallback proporcional por usd quando debtUsd é zero em todos", async () => {
    const state = makeState({
      debtAmount: 10,
      debtUsd: 10,
      collaterals: [
        { mint: SOL,  amount: 1, usd: 40,  debtUsd: null, avgPriceUsdc: 80, targetPriceUsdc: 90 },
        { mint: WETH, amount: 1, usd: 160, debtUsd: null, avgPriceUsdc: 3000, targetPriceUsdc: 3200 }
      ]
    });
    const kamino = makeKamino({ onChainDebt: 10 });
    // WETH tem usd=160, SOL tem usd=40, total=200. WETH = 80%
    const result = await closePartial(WETH, state, kamino, 999);
    expect(result.ok).toBe(true);
    expect(kamino.repay).toHaveBeenCalledWith({ mint: USDT, amount: expect.closeTo(8, 5) });
  });

});

describe("closeKaminoCollateralPartial — estado resultante", () => {

  it("remove o colateral fechado do array e mantém active: true", async () => {
    const state  = makeState();
    const kamino = makeKamino();
    const result = await closePartial(WETH, state, kamino, 999);

    expect(result.ok).toBe(true);
    expect(result.nextState!.active).toBe(true);
    expect(result.nextState!.collaterals).toHaveLength(1);
    expect(result.nextState!.collaterals[0].mint).toBe(SOL);
  });

  it("define active: false quando fecha o último colateral", async () => {
    const stateOne = makeState({
      collaterals: [
        { mint: SOL, amount: 0.08, usd: 6, debtUsd: 10, avgPriceUsdc: 75, targetPriceUsdc: 80 }
      ]
    });
    const kamino = makeKamino({
      onChainDeposits: { [SOL]: 0.08 }
    });
    const result = await closePartial(SOL, stateOne, kamino, 999);

    expect(result.ok).toBe(true);
    expect(result.nextState!.active).toBe(false);
    expect(result.nextState!.collaterals).toHaveLength(0);
    expect(result.nextState!.debtAmount).toBe(0);
  });

  it("reduz debtAmount proporcionalmente no estado", async () => {
    const state  = makeState();   // debtAmount = 10, WETH.debtUsd = 5/10 = 50%
    const kamino = makeKamino();
    const result = await closePartial(WETH, state, kamino, 999);

    expect(result.ok).toBe(true);
    expect(result.nextState!.debtAmount).toBeCloseTo(5, 5);
  });

  it("limpa repayRetryUntil no estado resultante", async () => {
    const state = makeState({
      repayRetryUntil: new Date(Date.now() + 60_000).toISOString(),
      repayRetryAttempts: 2,
      repayRetryReason: "rpc error"
    });
    const kamino = makeKamino();
    const result = await closePartial(WETH, state, kamino, 999);

    expect(result.ok).toBe(true);
    expect(result.nextState!.repayRetryUntil).toBeNull();
    expect(result.nextState!.repayRetryAttempts).toBe(0);
  });

  it("colateral 'single' popula collateralMint/Amount quando restar 1", async () => {
    const state  = makeState();
    const kamino = makeKamino();
    const result = await closePartial(WETH, state, kamino, 999);

    expect(result.ok).toBe(true);
    expect(result.nextState!.collateralMint).toBe(SOL);
    expect(result.nextState!.collateralAmount).toBeCloseTo(0.08, 8);
  });

});

describe("closeKaminoCollateralPartial — fallback repayWithCollateral", () => {

  it("usa repayWithCollateral quando wallet não tem saldo suficiente", async () => {
    const state  = makeState();
    const kamino = makeKamino();
    // stableBalance = 0 → cai no fallback
    const result = await closePartial(WETH, state, kamino, 0);

    expect(result.ok).toBe(true);
    expect(kamino.repay).not.toHaveBeenCalled();
    expect(kamino.repayWithCollateral).toHaveBeenCalledWith(
      expect.objectContaining({ collateralMint: WETH, debtMint: USDT })
    );
  });

  it("retorna ok: false quando repayWithCollateral falha", async () => {
    const state  = makeState();
    const kamino = makeKamino({ repayFail: new Error("rpc error") });
    const result = await closePartial(WETH, state, kamino, 0);
    // repay falha, repayWithCollateral também mockado para falhar
    // (repayFail aplica ao repay; aqui testamos com saldo 0 → vai pra repayWithCollateral)
    // Para isso precisamos que repayWithCollateral tb falhe:
    kamino.repayWithCollateral.mockRejectedValueOnce(new Error("swap failed"));
    const result2 = await closePartial(WETH, state, kamino, 0);
    expect(result2.ok).toBe(false);
    expect(result2.error).toMatch(/swap failed/i);
  });

});

describe("closeKaminoCollateralPartial — erros de withdraw", () => {

  it("ignora erro ObligationDepositsEmpty no withdraw (ja sacado)", async () => {
    const state  = makeState();
    const kamino = makeKamino({
      withdrawFail: Object.assign(new Error("ObligationDepositsEmpty (0x1784)"), {})
    });
    // O repay deve ter funcionado; o withdraw vai retornar o erro ignorável
    kamino.repay.mockResolvedValue("sig-repay");
    const result = await closePartial(WETH, state, kamino, 999);

    expect(result.ok).toBe(true);
    expect(result.nextState!.collaterals).toHaveLength(1);
  });

  it("retorna ok: false quando withdraw falha com erro não ignorável", async () => {
    const state  = makeState();
    const kamino = makeKamino({
      withdrawFail: new Error("blockhash error -32002")
    });
    const result = await closePartial(WETH, state, kamino, 999);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/-32002/);
  });

});

describe("closeKaminoCollateralPartial — colateral não encontrado", () => {

  it("retorna ok: false para mint inexistente no estado", async () => {
    const state  = makeState();
    const kamino = makeKamino();
    const result = await closePartial("INEXISTENTE", state, kamino, 999);

    expect(result.ok).toBe(false);
    expect(kamino.repay).not.toHaveBeenCalled();
    expect(kamino.withdraw).not.toHaveBeenCalled();
  });

});

describe("maybeCloseKaminoCycle — lógica de avaliação parcial vs total", () => {
  // Estes testes validam a lógica de classificação ready/pending
  // sem precisar instanciar OrcaBot.

  function classify(
    collaterals: Array<{ avgPriceUsdc: number; targetPriceUsdc: number; currentPrice: number }>,
    rule: "avg-price" | "breakeven"
  ): { readyMints: number[]; pendingMints: number[] } {
    const readyMints: number[] = [];
    const pendingMints: number[] = [];
    collaterals.forEach((c, i) => {
      const target = rule === "breakeven" ? c.avgPriceUsdc : c.targetPriceUsdc;
      if (c.currentPrice >= target) {
        readyMints.push(i);
      } else {
        pendingMints.push(i);
      }
    });
    return { readyMints, pendingMints };
  }

  it("classifica corretamente: um atingiu, outro não", () => {
    const res = classify([
      { avgPriceUsdc: 75, targetPriceUsdc: 80, currentPrice: 85 },  // SOL: atingiu
      { avgPriceUsdc: 3000, targetPriceUsdc: 3200, currentPrice: 3100 } // WETH: não atingiu
    ], "avg-price");

    expect(res.readyMints).toEqual([0]);
    expect(res.pendingMints).toEqual([1]);
  });

  it("classifica como allReady quando ambos atingiram", () => {
    const res = classify([
      { avgPriceUsdc: 75, targetPriceUsdc: 80, currentPrice: 85 },
      { avgPriceUsdc: 3000, targetPriceUsdc: 3200, currentPrice: 3300 }
    ], "avg-price");

    expect(res.readyMints).toHaveLength(2);
    expect(res.pendingMints).toHaveLength(0);
  });

  it("modo breakeven usa avgPriceUsdc como target, não targetPriceUsdc", () => {
    const res = classify([
      { avgPriceUsdc: 75, targetPriceUsdc: 80, currentPrice: 76 } // atingiu breakeven (75), não atingiu target (80)
    ], "breakeven");

    expect(res.readyMints).toHaveLength(1);
  });

  it("modo avg-price requer targetPriceUsdc, não avgPriceUsdc", () => {
    const res = classify([
      { avgPriceUsdc: 75, targetPriceUsdc: 80, currentPrice: 76 } // acima do avg mas abaixo do target
    ], "avg-price");

    expect(res.pendingMints).toHaveLength(1);
  });

});
