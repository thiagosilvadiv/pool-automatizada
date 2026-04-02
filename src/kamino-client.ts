import { Connection, PublicKey } from "@solana/web3.js";
import {
  address,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address
} from "@solana/kit";
import { createKeyPairSignerFromBytes, type TransactionSigner } from "@solana/signers";
import { getMint } from "@solana/spl-token";
import { KaminoAction, KaminoMarket, PROGRAM_ID, VanillaObligation } from "@kamino-finance/klend-sdk";

import { Config } from "./config.js";
import { logger } from "./logger.js";
import { loadKeypair, WalletLike } from "./solana.js";

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
  depositCollateral(input: { mint: string; amount: number }): Promise<string>;
  borrow(input: { mint: string; amount: number }): Promise<string>;
  repay(input: { mint: string; amount: number }): Promise<string>;
  withdraw(input: { mint: string; amount: number }): Promise<string>;
  getPositionState(): Promise<KaminoPositionState | null>;
  supportsCollateral(mint: string): Promise<boolean>;
  supportsBorrow(mint: string): Promise<{ ok: boolean; reason?: string }>;
};

const DEFAULT_KAMINO_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const DEFAULT_RECENT_SLOT_DURATION_MS = 400;
const MAX_U64 = 18_446_744_073_709_551_615n;

function isValidU64(value: bigint): boolean {
  return value > 0n && value <= MAX_U64;
}

function toRawAmount(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0n;
  }
  const factor = Math.pow(10, Math.max(0, decimals));
  return BigInt(Math.floor(amount * factor));
}

function deriveWsUrl(rpcUrl: string): string {
  const trimmed = rpcUrl.trim();
  if (trimmed.startsWith("https://")) {
    return `wss://${trimmed.slice("https://".length)}`;
  }
  if (trimmed.startsWith("http://")) {
    return `ws://${trimmed.slice("http://".length)}`;
  }
  return trimmed;
}

async function loadSignerFromEnv(wallet: WalletLike): Promise<TransactionSigner> {
  const keypair = loadKeypair();
  const signer = await createKeyPairSignerFromBytes(keypair.secretKey);
  const walletAddress = wallet.publicKey?.toBase58?.();
  if (walletAddress && signer.address !== walletAddress) {
    logger.warn(
      { signer: signer.address, wallet: walletAddress },
      "Kamino signer nÃ£o confere com a wallet atual"
    );
  }
  return signer;
}

class RealKaminoClient implements KaminoClient {
  private ctx: KaminoClientContext;
  private rpc: ReturnType<typeof createSolanaRpc>;
  private rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
  private signer: TransactionSigner;
  private marketAddress: Address;
  private obligationType: VanillaObligation;
  private marketPromise: Promise<KaminoMarket> | null = null;
  private sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>;

  constructor(options: {
    ctx: KaminoClientContext;
    rpc: ReturnType<typeof createSolanaRpc>;
    rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
    signer: TransactionSigner;
    marketAddress: Address;
  }) {
    this.ctx = options.ctx;
    this.rpc = options.rpc;
    this.rpcSubscriptions = options.rpcSubscriptions;
    this.signer = options.signer;
    this.marketAddress = options.marketAddress;
    this.obligationType = new VanillaObligation(PROGRAM_ID);
    this.sendAndConfirm = sendAndConfirmTransactionFactory({
      rpc: this.rpc as any,
      rpcSubscriptions: this.rpcSubscriptions as any
    });
  }

  private async loadMarket(): Promise<KaminoMarket> {
    if (!this.marketPromise) {
      this.marketPromise = (async () => {
        const market = await KaminoMarket.load(
          this.rpc as any,
          this.marketAddress,
          DEFAULT_RECENT_SLOT_DURATION_MS,
          PROGRAM_ID,
          true
        );
        if (!market) {
          throw new Error("Kamino market nÃ£o encontrado");
        }
        return market;
      })();
    }
    return this.marketPromise;
  }

  private async resolveDecimals(mint: string): Promise<number> {
    try {
      const market = await this.loadMarket();
      const reserve = market.getReserveByMint(address(mint));
      if (reserve) {
        return reserve.getMintDecimals();
      }
    } catch (err) {
      logger.warn({ err }, "falha ao buscar reserva Kamino");
    }
    try {
      const info = await getMint(this.ctx.connection, new PublicKey(mint));
      return Number(info.decimals ?? 6);
    } catch (err) {
      logger.warn({ err }, "falha ao buscar mint SPL para Kamino");
    }
    return 6;
  }

  private async toRawAmountString(mint: string, amountUi: number): Promise<string> {
    const decimals = await this.resolveDecimals(mint);
    const raw = toRawAmount(amountUi, decimals);
    if (!isValidU64(raw)) {
      throw new Error("Quantidade invÃ¡lida para Kamino");
    }
    return raw.toString();
  }

  private async sendAction(action: KaminoAction): Promise<string> {
    const ixs = KaminoAction.actionToIxs(action);
    if (!ixs.length) {
      throw new Error("Nenhuma instruÃ§Ã£o Kamino gerada");
    }
    const { value: latestBlockhash } = await (this.rpc as any)
      .getLatestBlockhash({ commitment: "finalized" })
      .send();
    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => appendTransactionMessageInstructions(ixs, tx),
      (tx) => setTransactionMessageFeePayerSigner(this.signer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx)
    );
    const signed = await signTransactionMessageWithSigners(txMessage);
    const signature = getSignatureFromTransaction(signed);
    await this.sendAndConfirm(signed as any, { commitment: "confirmed", skipPreflight: false });
    return signature;
  }

  private async buildActionWithFallback<T extends KaminoAction>(
    builder: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    try {
      return await builder();
    } catch (err) {
      if (fallback) {
        logger.warn({ err }, "Kamino action falhou com v2; tentando v1");
        return await fallback();
      }
      throw err;
    }
  }

  async ensureObligation(): Promise<void> {
    await this.loadMarket();
  }

  async supportsCollateral(mint: string): Promise<boolean> {
    const market = await this.loadMarket();
    return Boolean(market.getReserveByMint(address(mint)));
  }

  async supportsBorrow(mint: string): Promise<{ ok: boolean; reason?: string }> {
    const market = await this.loadMarket();
    const reserve = market.getReserveByMint(address(mint));
    if (!reserve) {
      return { ok: false, reason: "Reserve nÃ£o encontrada no market" };
    }
    const config = (reserve as any).state?.config ?? (reserve as any).config ?? (reserve as any).reserveConfig ?? null;
    if (config) {
      const borrowLimit = Number(config.borrowLimit ?? config.borrowLimitUsd ?? config.maxBorrow ?? NaN);
      if (Number.isFinite(borrowLimit) && borrowLimit <= 0) {
        return { ok: false, reason: "Borrow desativado para este ativo" };
      }
    }
    return { ok: true };
  }

  async depositCollateral(input: { mint: string; amount: number }): Promise<string> {
    const market = await this.loadMarket();
    const amountRaw = await this.toRawAmountString(input.mint, input.amount);
    const action = await this.buildActionWithFallback(
      () =>
        KaminoAction.buildDepositTxns(
          market,
          amountRaw,
          address(input.mint),
          this.signer,
          this.obligationType,
          true,
          undefined,
          undefined,
          true
        ),
      () =>
        KaminoAction.buildDepositTxns(
          market,
          amountRaw,
          address(input.mint),
          this.signer,
          this.obligationType,
          false,
          undefined,
          undefined,
          true
        )
    );
    const sig = await this.sendAction(action);
    logger.info(
      { sig, mint: input.mint, amount: input.amount },
      "kamino deposit concluÃ­do"
    );
    return sig;
  }

  async borrow(input: { mint: string; amount: number }): Promise<string> {
    const market = await this.loadMarket();
    const amountRaw = await this.toRawAmountString(input.mint, input.amount);
    const action = await this.buildActionWithFallback(
      () =>
        KaminoAction.buildBorrowTxns(
          market,
          amountRaw,
          address(input.mint),
          this.signer,
          this.obligationType,
          true,
          undefined,
          undefined,
          true
        ),
      () =>
        KaminoAction.buildBorrowTxns(
          market,
          amountRaw,
          address(input.mint),
          this.signer,
          this.obligationType,
          false,
          undefined,
          undefined,
          true
        )
    );
    const sig = await this.sendAction(action);
    logger.info(
      { sig, mint: input.mint, amount: input.amount },
      "kamino borrow concluÃ­do"
    );
    return sig;
  }

  async repay(input: { mint: string; amount: number }): Promise<string> {
    const market = await this.loadMarket();
    const amountRaw = await this.toRawAmountString(input.mint, input.amount);
    const currentSlot = await (this.rpc as any).getSlot({ commitment: "confirmed" }).send();
    const action = await this.buildActionWithFallback(
      () =>
        KaminoAction.buildRepayTxns(
          market,
          amountRaw,
          address(input.mint),
          this.signer,
          this.obligationType,
          true,
          undefined,
          currentSlot,
          undefined,
          undefined,
          true
        ),
      () =>
        KaminoAction.buildRepayTxns(
          market,
          amountRaw,
          address(input.mint),
          this.signer,
          this.obligationType,
          false,
          undefined,
          currentSlot,
          undefined,
          undefined,
          true
        )
    );
    const sig = await this.sendAction(action);
    logger.info(
      { sig, mint: input.mint, amount: input.amount },
      "kamino repay concluÃ­do"
    );
    return sig;
  }

  async withdraw(input: { mint: string; amount: number }): Promise<string> {
    const market = await this.loadMarket();
    const amountRaw = await this.toRawAmountString(input.mint, input.amount);
    const action = await this.buildActionWithFallback(
      () =>
        KaminoAction.buildWithdrawTxns(
          market,
          amountRaw,
          address(input.mint),
          this.signer,
          this.obligationType,
          true,
          undefined,
          undefined,
          true
        ),
      () =>
        KaminoAction.buildWithdrawTxns(
          market,
          amountRaw,
          address(input.mint),
          this.signer,
          this.obligationType,
          false,
          undefined,
          undefined,
          true
        )
    );
    const sig = await this.sendAction(action);
    logger.info(
      { sig, mint: input.mint, amount: input.amount },
      "kamino withdraw concluÃ­do"
    );
    return sig;
  }

  async getPositionState(): Promise<KaminoPositionState | null> {
    try {
      const market = await this.loadMarket();
      const obligation = await market.getObligationByWallet(
        this.signer.address,
        this.obligationType
      );
      if (!obligation) {
        return null;
      }
      const deposit = obligation.getDeposits()[0];
      const borrow = obligation.getBorrows()[0];
      const ltv = obligation.refreshedStats?.loanToValue?.toNumber?.();
      return {
        collateralMint: deposit?.mintAddress ?? null,
        collateralAmount: deposit?.amount ? Number(deposit.amount.toString()) : null,
        debtMint: borrow?.mintAddress ?? null,
        debtAmount: borrow?.amount ? Number(borrow.amount.toString()) : null,
        ltv: Number.isFinite(ltv) ? Number(ltv) : null
      };
    } catch (err) {
      logger.warn({ err }, "falha ao ler posiÃ§Ã£o Kamino");
      return null;
    }
  }
}

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

  async depositCollateral(input: { mint: string; amount: number }): Promise<string> {
    this.ensureEnabled("deposit");
    this.lastState = {
      collateralMint: input.mint,
      collateralAmount: input.amount,
      debtMint: this.lastState?.debtMint ?? null,
      debtAmount: this.lastState?.debtAmount ?? null,
      ltv: this.lastState?.ltv ?? null
    };
    return 'noop';
  }

  async borrow(input: { mint: string; amount: number }): Promise<string> {
    this.ensureEnabled("borrow");
    this.lastState = {
      collateralMint: this.lastState?.collateralMint ?? null,
      collateralAmount: this.lastState?.collateralAmount ?? null,
      debtMint: input.mint,
      debtAmount: input.amount,
      ltv: this.lastState?.ltv ?? null
    };
    return 'noop';
  }

  async repay(input: { mint: string; amount: number }): Promise<string> {
    this.ensureEnabled("repay");
    this.lastState = {
      collateralMint: this.lastState?.collateralMint ?? null,
      collateralAmount: this.lastState?.collateralAmount ?? null,
      debtMint: input.mint,
      debtAmount: Math.max(0, (this.lastState?.debtAmount ?? 0) - input.amount),
      ltv: this.lastState?.ltv ?? null
    };
    return 'noop';
  }

  async withdraw(input: { mint: string; amount: number }): Promise<string> {
    this.ensureEnabled("withdraw");
    this.lastState = {
      collateralMint: input.mint,
      collateralAmount: Math.max(0, (this.lastState?.collateralAmount ?? 0) - input.amount),
      debtMint: this.lastState?.debtMint ?? null,
      debtAmount: this.lastState?.debtAmount ?? null,
      ltv: this.lastState?.ltv ?? null
    };
    return 'noop';
  }

  async getPositionState(): Promise<KaminoPositionState | null> {
    return this.lastState;
  }

  async supportsCollateral(_mint: string): Promise<boolean> {
    return true;
  }

  async supportsBorrow(_mint: string): Promise<{ ok: boolean; reason?: string }> {
    return { ok: true };
  }
}

export async function createKaminoClient(ctx: KaminoClientContext): Promise<KaminoClient> {
  const allowNoop = Boolean(ctx.config.dryRun || process.env.KAMINO_NOOP === "true");
  if (allowNoop) {
    logger.info("Kamino client em modo simulado (dry-run)");
    return new NoopKaminoClient({ allowNoop: true });
  }
  const rpcUrl = ctx.config.rpcUrl;
  if (!rpcUrl) {
    throw new Error("RPC_URL nÃ£o configurado para Kamino");
  }
  const wsUrl =
    process.env.KAMINO_WS_URL ||
    process.env.RPC_WS_URL ||
    deriveWsUrl(rpcUrl);
  const marketRaw = process.env.KAMINO_MARKET || DEFAULT_KAMINO_MARKET;
  let marketAddress: Address;
  try {
    marketAddress = address(marketRaw);
  } catch (err) {
    throw new Error("KAMINO_MARKET invÃ¡lido");
  }
  const signer = await loadSignerFromEnv(ctx.wallet);
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  logger.info({ market: marketRaw }, "Kamino client configurado (modo real)");
  return new RealKaminoClient({
    ctx,
    rpc,
    rpcSubscriptions,
    signer,
    marketAddress
  });
}
