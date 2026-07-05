import { describe, it, expect, vi } from "vitest";
import { performSplitRepayWithCollateralHelper } from "../src/kamino-split-repay.js";

const mkLogger = () => vi.fn();
const mkKamino = () => {
  const withdraw = vi.fn().mockResolvedValue("sig-withdraw");
  const repay = vi.fn().mockResolvedValue("sig-repay");
  return { withdraw, repay };
};

describe("performSplitRepayWithCollateralHelper", () => {
  it("executes withdraw -> swap -> repay in order", async () => {
    const kamino = mkKamino();
    const swap = vi.fn().mockResolvedValue(2);
    const logger = mkLogger();
    const res = await performSplitRepayWithCollateralHelper({
      kamino,
      swapTokenToStable: swap,
      collMint: "COLL",
      collDecimals: 6,
      debtMint: "USD",
      debtDecimals: 6,
      repayUi: 2,
      capacityUi: 1,
      priceCollToDebt: 2, // 1 COLL -> 2 USD
      minWithdraw: 0.000001,
      logger: (payload, msg) => logger({ payload, msg }),
      isRetryable: () => false
    });
    expect(res.performed).toBe(true);
    expect(kamino.withdraw).toHaveBeenCalledTimes(1);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(kamino.repay).toHaveBeenCalledTimes(1);
  });

  it("fails when capacity insufficient", async () => {
    const kamino = mkKamino();
    const swap = vi.fn();
    const logger = mkLogger();
    const res = await performSplitRepayWithCollateralHelper({
      kamino,
      swapTokenToStable: swap,
      collMint: "COLL",
      collDecimals: 6,
      debtMint: "USD",
      debtDecimals: 6,
      repayUi: 10,
      capacityUi: 0.01,
      priceCollToDebt: 1,
      minWithdraw: 0.000001,
      logger: (payload, msg) => logger({ payload, msg }),
      isRetryable: () => false
    });
    expect(res.performed).toBe(false);
    expect(res.error).toMatch(/capacidade insuficiente/i);
    expect(kamino.withdraw).not.toHaveBeenCalled();
    expect(swap).not.toHaveBeenCalled();
  });

  it("propagates retryable errors", async () => {
    const kamino = mkKamino();
    kamino.withdraw.mockRejectedValueOnce(new Error("rpc -32002"));
    const swap = vi.fn();
    const logger = mkLogger();
    const res = await performSplitRepayWithCollateralHelper({
      kamino,
      swapTokenToStable: swap,
      collMint: "COLL",
      collDecimals: 6,
      debtMint: "USD",
      debtDecimals: 6,
      repayUi: 1,
      capacityUi: 1,
      priceCollToDebt: 1,
      minWithdraw: 0.000001,
      logger: (payload, msg) => logger({ payload, msg }),
      isRetryable: (msg) => msg.includes("-32002")
    });
    expect(res.retryable).toBe(true);
    expect(res.performed).toBe(false);
  });
});
