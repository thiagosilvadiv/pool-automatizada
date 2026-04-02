import { Connection } from "@solana/web3.js";

import { Config } from "./config.js";
import { logger } from "./logger.js";
import { WalletLike } from "./solana.js";

export type KaminoClientContext = {
  connection: Connection;
  wallet: WalletLike;
  config: Config;
};

export type KaminoPositionState = {
  collateralMint: string | null;
  collateralAmount: number | null;
  debtMint: string | null;
  debtAmount: number | null;
  ltv: number | null;
};

export type KaminoClient = {
  ensureObligation(): Promise<void>;
  depositCollateral(input: { mint: string; amount: number }): Promise<void>;
  borrow(input: { mint: string; amount: number }): Promise<void>;
  repay(input: { mint: string; amount: number }): Promise<void>;
  withdraw(input: { mint: string; amount: number }): Promise<void>;
  getPositionState(): Promise<KaminoPositionState | null>;
  supportsCollateral(mint: string): Promise<boolean>;
};

class NoopKaminoClient implements KaminoClient {
  private allowNoop: boolean;
  private lastState: KaminoPositionState | null = null;

  constructor(options: { allowNoop: boolean }) {
    this.allowNoop = options.allowNoop;
  }

  private ensureEnabled(action: string): void {
    if (this.allowNoop) {
      return;
    }
    throw new Error(`Kamino SDK não configurado (${action})`);
  }

  async ensureObligation(): Promise<void> {
    this.ensureEnabled("ensure-obligation");
  }

  async depositCollateral(input: { mint: string; amount: number }): Promise<void> {
    this.ensureEnabled("deposit");
    this.lastState = {
      collateralMint: input.mint,
      collateralAmount: input.amount,
      debtMint: this.lastState?.debtMint ?? null,
      debtAmount: this.lastState?.debtAmount ?? null,
      ltv: this.lastState?.ltv ?? null
    };
  }

  async borrow(input: { mint: string; amount: number }): Promise<void> {
    this.ensureEnabled("borrow");
    this.lastState = {
      collateralMint: this.lastState?.collateralMint ?? null,
      collateralAmount: this.lastState?.collateralAmount ?? null,
      debtMint: input.mint,
      debtAmount: input.amount,
      ltv: this.lastState?.ltv ?? null
    };
  }

  async repay(input: { mint: string; amount: number }): Promise<void> {
    this.ensureEnabled("repay");
    this.lastState = {
      collateralMint: this.lastState?.collateralMint ?? null,
      collateralAmount: this.lastState?.collateralAmount ?? null,
      debtMint: input.mint,
      debtAmount: Math.max(0, (this.lastState?.debtAmount ?? 0) - input.amount),
      ltv: this.lastState?.ltv ?? null
    };
  }

  async withdraw(input: { mint: string; amount: number }): Promise<void> {
    this.ensureEnabled("withdraw");
    this.lastState = {
      collateralMint: input.mint,
      collateralAmount: Math.max(0, (this.lastState?.collateralAmount ?? 0) - input.amount),
      debtMint: this.lastState?.debtMint ?? null,
      debtAmount: this.lastState?.debtAmount ?? null,
      ltv: this.lastState?.ltv ?? null
    };
  }

  async getPositionState(): Promise<KaminoPositionState | null> {
    return this.lastState;
  }

  async supportsCollateral(_mint: string): Promise<boolean> {
    return true;
  }
}

export async function createKaminoClient(ctx: KaminoClientContext): Promise<KaminoClient> {
  const allowNoop = Boolean(ctx.config.dryRun || process.env.KAMINO_NOOP === "true");
  if (allowNoop) {
    logger.info("Kamino client em modo simulado (dry-run)");
    return new NoopKaminoClient({ allowNoop: true });
  }
  logger.warn("Kamino client nao configurado; habilite KAMINO_NOOP ou integre o SDK oficial.");
  return new NoopKaminoClient({ allowNoop: false });
}
