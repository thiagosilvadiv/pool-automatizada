import { describe, expect, it, vi } from "vitest";

vi.mock("@orca-so/whirlpools-sdk", () => ({}));
vi.mock("@orca-so/common-sdk", () => ({}));

import { computeSpendableNativeSol } from "../src/orca.js";

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
