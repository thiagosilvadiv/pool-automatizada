import { describe, expect, it, vi } from "vitest";

vi.mock("@orca-so/whirlpools-sdk", () => ({}));
vi.mock("@orca-so/common-sdk", () => ({}));

import { clampNativeFundingBalances, computeSpendableNativeSol } from "../src/orca.js";

describe("computeSpendableNativeSol", () => {
  it("reserva o minimo configurado e a gordura extra do swap", () => {
    expect(computeSpendableNativeSol(0.1, 0.02)).toBeCloseTo(0.075, 9);
  });

  it("retorna zero quando o saldo nao cobre a reserva total", () => {
    expect(computeSpendableNativeSol(0.024, 0.02)).toBe(0);
  });

  it("ignora entradas invalidas", () => {
    expect(computeSpendableNativeSol(Number.NaN, 0.02)).toBe(0);
    expect(computeSpendableNativeSol(0.1, Number.NaN)).toBeCloseTo(0.095, 9);
  });
});

describe("clampNativeFundingBalances", () => {
  it("limita o leg SOL ao saldo nativo realmente gastavel", () => {
    const result = clampNativeFundingBalances({
      tokenA: 0.744430566,
      tokenB: 0,
      isTokenASol: true,
      isTokenBSol: false,
      totalNativeSol: 0.403250755,
      minSolBalance: 0.02
    });

    expect(result.spendableNativeSol).toBeCloseTo(0.378250755, 9);
    expect(result.tokenA).toBeCloseTo(0.378250755, 9);
    expect(result.clampedA).toBe(true);
    expect(result.clampedB).toBe(false);
  });

  it("mantem saldos intactos quando a pool nao usa SOL nativo", () => {
    const result = clampNativeFundingBalances({
      tokenA: 12,
      tokenB: 34,
      isTokenASol: false,
      isTokenBSol: false,
      totalNativeSol: 0.4,
      minSolBalance: 0.02
    });

    expect(result.tokenA).toBe(12);
    expect(result.tokenB).toBe(34);
    expect(result.clampedA).toBe(false);
    expect(result.clampedB).toBe(false);
  });
});
