import { Connection, PublicKey } from "@solana/web3.js";
import {
  address,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  fetchAddressesForLookupTables,
  getSignatureFromTransaction,
  none,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address
} from "@solana/kit";
import { AccountRole, type Instruction } from "@solana/instructions";
import { compressTransactionMessageUsingAddressLookupTables } from "@solana/transaction-messages";
import { createKeyPairSignerFromBytes, type TransactionSigner } from "@solana/signers";
import { getMint } from "@solana/spl-token";
import {
  KaminoAction,
  KaminoMarket,
  PROGRAM_ID,
  VanillaObligation,
  calcMaxWithdrawCollateral,
  getRepayWithCollIxs,
  type SwapIxsProvider,
  type SwapQuoteProvider,
  type SwapQuote,
  type SwapInputs
} from "@kamino-finance/klend-sdk";
import DecimalJs from "decimal.js";
import type { Decimal as DecimalType } from "decimal.js";
import { getSolanaErrorFromJsonRpcError, SolanaError } from "@solana/errors";

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
  deposits?: { mint: string; amount: number }[];
  borrows?: { mint: string; amount: number }[];
};

export type KaminoWithdrawResult = {
  signature: string;
  requestedAmount: number;
  actualAmount: number;
  wasReduced: boolean;
  dustAmount: number;
};

export type KaminoClient = {
  ensureObligation(): Promise<void>;
  depositCollateral(input: { mint: string; amount: number }): Promise<string>;
  borrow(input: { mint: string; amount: number }): Promise<string>;
  repay(input: { mint: string; amount: number }): Promise<string>;
  repayWithCollateral(input: { collateralMint: string; debtMint: string; repayAmount: number; slippageBps?: number }): Promise<string>;
  withdraw(input: { mint: string; amount: number }): Promise<KaminoWithdrawResult>;
  getWithdrawCapacity(input: {
    collateralMint: string;
    debtMint: string;
    repayAmountUi: number;
    bufferPct?: number;
  }): Promise<{ capacityUi: number; slot: number; blockhash?: string }>;
  getPositionState(): Promise<KaminoPositionState | null>;
  invalidatePositionCache(): void;
  supportsCollateral(mint: string): Promise<boolean>;
  supportsBorrow(mint: string): Promise<{ ok: boolean; reason?: string }>;
};

const DEFAULT_KAMINO_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const DEFAULT_RECENT_SLOT_DURATION_MS = 400;
const MAX_U64 = 18_446_744_073_709_551_615n;
const Decimal: any = DecimalJs;

type JupiterInstruction = {
  programId: string;
  accounts?: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data?: string;
};

type JupiterSwapInstructionsResponse = {
  setupInstructions?: JupiterInstruction[];
  swapInstruction?: JupiterInstruction;
  cleanupInstruction?: JupiterInstruction;
  tokenLedgerInstruction?: JupiterInstruction;
  computeBudgetInstructions?: JupiterInstruction[];
  addressLookupTableAddresses?: string[];
};

function mapAccountRole(isSigner: boolean, isWritable: boolean): AccountRole {
  if (isSigner && isWritable) return AccountRole.WRITABLE_SIGNER;
  if (isSigner) return AccountRole.READONLY_SIGNER;
  if (isWritable) return AccountRole.WRITABLE;
  return AccountRole.READONLY;
}

function toKitInstruction(ix: JupiterInstruction): Instruction {
  return {
    programAddress: address(ix.programId),
    accounts: Array.isArray(ix.accounts)
      ? ix.accounts.map((account) => ({
        address: address(account.pubkey),
        role: mapAccountRole(Boolean(account.isSigner), Boolean(account.isWritable))
      }))
      : [],
    data: ix.data ? Buffer.from(ix.data, "base64") : new Uint8Array()
  };
}

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

export function lamportsToUi(lamports: DecimalType | null | undefined, decimals: number): number {
  if (!lamports || !(lamports as any).isFinite?.()) return 0;
  const divisor = Math.pow(10, Math.max(0, decimals));
  return (lamports as any).div(divisor).toNumber();
}

export function applyWithdrawBuffer(capacityUi: number, bufferPct: number): number {
  const pct = Math.max(0, Math.min(1, bufferPct));
  return Math.max(0, capacityUi * pct);
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

function isRateLimitError(err: any): boolean {
  if (!err) return false;
  const message = String(err?.message ?? err?.context?.message ?? err).toLowerCase();
  const status = err?.context?.statusCode ?? err?.statusCode;
  const code = err?.context?.__code ?? err?.__code ?? err?.code;
  return status === 429
    || String(code) === "8100002"
    || message.includes("too many requests")
    || message.includes("429");
}

function isInvalidAccountInputError(err: any): boolean {
  if (!err) return false;
  const message = String(err?.message ?? err).toLowerCase();
  return message.includes("0x1776")
    || message.includes("invalidaccountinput")
    || message.includes("invalid account input")
    || message.includes("6006")
    || message.includes("expected_remaining_accounts");
}

const KAMINO_ERROR_CODES: Record<string, string> = {
  "0x1776": "InvalidAccountInput - market com cache desatualizado",
  "0x17cc": "NetValueRemainingTooSmall - saque reduzido necessario",
  "0x1": "InsufficientFunds - saldo insuficiente",
  "6092": "NetValueRemainingTooSmall",
  "6006": "InvalidAccountInput",
  "0x1780": "BorrowingDisabled - borrow desativado para este ativo",
  "0x1785": "ObligationBorrowsEmpty - obligation nao tem borrows (divida ja quitada on-chain)",
  "6021":  "ObligationBorrowsEmpty - obligation nao tem borrows (divida ja quitada on-chain)",
  "0x1784": "ReserveStale - reserve desatualizado, reload necessario",
  "6020": "ReserveStale - reserve desatualizado, reload necessario",
  "0x178a": "UtilizationTooHigh - utilizacao do mercado muito alta"
};

function parseKaminoProtocolError(err: any): string | null {
  const msg = String(err?.message ?? err).toLowerCase();
  for (const [code, description] of Object.entries(KAMINO_ERROR_CODES)) {
    if (msg.includes(code.toLowerCase())) {
      return description;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeRpcError(err: any): { code?: number; name?: string; message: string; logs?: string[] } {
  try {
    if (err?.code != null && err?.message) {
      const solErr = getSolanaErrorFromJsonRpcError({
        code: Number(err.code),
        data: err.data,
        message: String(err.message)
      });
      return {
        code: Number(err.code),
        name: (solErr as SolanaError)?.name,
        message: solErr?.message ?? String(err.message),
        logs: (solErr as any)?.logs ?? err?.logs
      };
    }
  } catch {
    // ignore and fall back
  }
  const message = String(err?.message ?? err);
  return { code: err?.code, name: err?.name, message, logs: err?.logs };
}

export function buildRpcUrlList(primary: string, rawList?: string): string[] {
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    const trimmed = String(value).trim();
    if (!trimmed) return;
    seen.add(trimmed);
  };
  add(primary);
  if (rawList) {
    rawList
      .split(/[,;\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => add(item));
  }
  return Array.from(seen);
}

export function isBlockhashError(err: any): boolean {
  const msg = String(err?.message ?? err).toLowerCase();
  // Se for ObligationBorrowsEmpty, NÃO classificar como blockhash.
  // O erro chega com código -32002 mas a causa real é semântica (divida zerada).
  if (isObligationBorrowsEmptyError(err)) return false;
  return (
    msg.includes("blockhash not found") ||
    msg.includes("blockhash expired") ||
    msg.includes("-32002") ||
    // Erro #1 do @solana/kit: SOLANA_ERROR__TRANSACTION_EXPIRED_BLOCKHEIGHT_EXCEEDED
    msg.includes("error #1") ||
    msg.includes("blockheight exceeded") ||
    msg.includes("lastvalidblockheight") ||
    msg.includes("block height exceeded")
  );
}

/**
 * Verifica se o erro é ObligationBorrowsEmpty (código 6021 / 0x1785).
 * Isso ocorre quando se tenta repay numa obligation que não tem borrows ativos.
 * Deve ser tratado como "dívida já quitada on-chain", não como erro fatal nem blockhash.
 */
export function isObligationBorrowsEmptyError(err: any): boolean {
  const msg = String(err?.message ?? err).toLowerCase();
  const logs: string[] = (err as any)?.__originalErr?.context?.logs
    ?? (err as any)?.context?.logs
    ?? (err as any)?.logs
    ?? [];
  const logsText = logs.join(" ").toLowerCase();
  return (
    msg.includes("obligationborrowsempty") ||
    msg.includes("obligation borrows are empty") ||
    msg.includes("obligation has no borrows") ||
    msg.includes("0x1785") ||
    msg.includes("6021") ||
    logsText.includes("obligationborrowsempty") ||
    logsText.includes("obligation borrows are empty") ||
    logsText.includes("obligation has no borrows") ||
    logsText.includes("0x1785") ||
    logsText.includes("error code: 6021")
  );
}

/**
 * Verifica se um erro Solana contém "insufficient funds" (0x1) em qualquer
 * camada: mensagem principal, logs internos, ou payload codificado.
 * O erro de simulação retorna -32002 mas o motivo real está nos logs.
 */
export function isInsufficientFundsError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message ?? err).toLowerCase();
  // Verificação direta na mensagem principal
  if (
    msg.includes("insufficient funds") ||
    /custom program error: 0x1(?![0-9a-f])/i.test(msg) ||
    msg.includes("\"0x1\"") ||
    msg.includes("error: insufficient funds")
  ) {
    return true;
  }
  // Verificação nos logs internos do erro de simulação (SolanaError context)
  const context = err?.context ?? err?.cause ?? err?.__context;
  const logs: string[] = context?.logs ?? err?.logs ?? err?.data?.logs ?? [];
  if (Array.isArray(logs)) {
    for (const log of logs) {
      const l = String(log).toLowerCase();
      if (l.includes("insufficient funds") || /custom program error: 0x1(?![0-9a-f])/i.test(l)) {
        return true;
      }
    }
  }
  // Verificação no payload base64 decodificado do -32002 (heurística)
  // O payload contém a string "insufficient%20funds" codificada em URL dentro do base64
  const data = err?.data ?? context?.data;
  if (typeof data === "string" && data.length > 0) {
    try {
      const decoded = Buffer.from(data, "base64").toString("utf8");
      const decodedLower = decoded.toLowerCase();
      if (decodedLower.includes("insufficient%20funds") || decodedLower.includes("insufficient funds")) {
        return true;
      }
    } catch {
      // ignora falha de decode
    }
  }
  // Verificação recursiva na causa do erro
  if (err?.cause && err.cause !== err) {
    return isInsufficientFundsError(err.cause);
  }
  return false;
}

async function loadSignerFromEnv(wallet: WalletLike): Promise<TransactionSigner> {
  const keypair = loadKeypair();
  const signer = await createKeyPairSignerFromBytes(keypair.secretKey);
  const walletAddress = wallet.publicKey?.toBase58?.();
  if (walletAddress && signer.address !== walletAddress) {
    logger.warn(
      { signer: signer.address, wallet: walletAddress },
      "Kamino signer nao confere com a wallet atual"
    );
  }
  return signer;
}

class RealKaminoClient implements KaminoClient {
  private ctx: KaminoClientContext;
  private rpc: ReturnType<typeof createSolanaRpc>;
  private rpcRead: ReturnType<typeof createSolanaRpc>;
  private rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
  private signer: TransactionSigner;
  private marketAddress: Address;
  private obligationType: VanillaObligation;
  private marketPromise: Promise<KaminoMarket> | null = null;
  private marketLoadedAt: number | null = null;
  private readonly MARKET_TTL_MS = 45_000;
  private sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>;
  private lastState: KaminoPositionState | null = null;
  private lastStateAt: number = 0;
  private rpcUrls: string[];
  private readRpcUrls: string[];
  private rpcIndex = 0;
  private readRpcIndex = 0;

  constructor(options: {
    ctx: KaminoClientContext;
    rpc: ReturnType<typeof createSolanaRpc>;
    rpcRead: ReturnType<typeof createSolanaRpc>;
    rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
    signer: TransactionSigner;
    marketAddress: Address;
    rpcUrls?: string[];
    readRpcUrls?: string[];
  }) {
    this.ctx = options.ctx;
    this.rpc = options.rpc;
    this.rpcRead = options.rpcRead;
    this.rpcSubscriptions = options.rpcSubscriptions;
    this.signer = options.signer;
    this.marketAddress = options.marketAddress;
    this.rpcUrls = options.rpcUrls?.length ? [...options.rpcUrls] : [];
    this.readRpcUrls = options.readRpcUrls?.length ? [...options.readRpcUrls] : [];
    this.obligationType = new VanillaObligation(PROGRAM_ID);
    this.sendAndConfirm = sendAndConfirmTransactionFactory({
      rpc: this.rpc as any,
      rpcSubscriptions: this.rpcSubscriptions as any
    });
  }

  private shouldInvalidateMarket(): boolean {
    if (!this.marketLoadedAt) return false;
    return (Date.now() - this.marketLoadedAt) > this.MARKET_TTL_MS;
  }

  private rotateRpcEndpoint(reason: string): void {
    if (!this.rpcUrls.length) {
      return;
    }
    this.rpcIndex = (this.rpcIndex + 1) % this.rpcUrls.length;
    const nextRpcUrl = this.rpcUrls[this.rpcIndex];
    if (this.readRpcUrls.length) {
      this.readRpcIndex = (this.readRpcIndex + 1) % this.readRpcUrls.length;
    }
    const nextReadUrl = this.readRpcUrls[this.readRpcIndex] ?? nextRpcUrl;
    try {
      this.rpc = createSolanaRpc(nextRpcUrl);
      this.rpcRead = createSolanaRpc(nextReadUrl);
      const wsUrl = deriveWsUrl(nextRpcUrl);
      this.rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
      this.sendAndConfirm = sendAndConfirmTransactionFactory({
        rpc: this.rpc as any,
        rpcSubscriptions: this.rpcSubscriptions as any
      });
      this.invalidateMarket(true);
      logger.warn({ nextRpcUrl, nextReadUrl, reason }, "kamino rpc endpoint rotacionado");
    } catch (err) {
      logger.warn({ err, nextRpcUrl, reason }, "falha ao rotacionar rpc endpoint");
    }
  }

  private invalidateMarket(force = false): void {
    if (force || this.shouldInvalidateMarket()) {
      this.marketPromise = null;
    }
  }

  private async loadMarket(): Promise<KaminoMarket> {
    if (!this.marketPromise || this.shouldInvalidateMarket()) {
      this.marketPromise = (async () => {
        const market = await KaminoMarket.load(
          this.rpcRead as any,
          this.marketAddress,
          DEFAULT_RECENT_SLOT_DURATION_MS,
          PROGRAM_ID,
          true
        );
        if (!market) {
          throw new Error("Kamino market nao encontrado");
        }
        this.marketLoadedAt = Date.now();
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
      throw new Error("Quantidade invalida para Kamino");
    }
    return raw.toString();
  }

  private async sendAction(action: KaminoAction): Promise<string> {
    const ixs = KaminoAction.actionToIxs(action);
    if (!ixs.length) {
      throw new Error("Nenhuma instrucao Kamino gerada");
    }
    let attempt = 0;
    let lastErr: any;
    let lastSignature: string | null = null;
    while (attempt < 3) {
      attempt += 1;
      try {
        const { value: latestBlockhash } = await (this.rpc as any)
          .getLatestBlockhash({ commitment: "confirmed" })
          .send();
        const slot = await (this.rpc as any).getSlot({ commitment: "confirmed" }).send();
        const txMessage = pipe(
          createTransactionMessage({ version: 0 }),
          (tx) => appendTransactionMessageInstructions(ixs, tx),
          (tx) => setTransactionMessageFeePayerSigner(this.signer, tx),
          (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx)
        );
        const signed = await signTransactionMessageWithSigners(txMessage);
        const signature = getSignatureFromTransaction(signed);
        lastSignature = signature;
        await this.sendAndConfirmSafe(signed as any, signature, undefined, {
          blockhash: (latestBlockhash as any)?.blockhash ?? latestBlockhash,
          slot
        });
        logger.info({ sig: signature, slot, blockhash: (latestBlockhash as any)?.blockhash ?? latestBlockhash }, "kamino tx enviada");
        return signature;
      } catch (err) {
        lastErr = err;
        const attachAttempt = (error: any) => {
          if (error && typeof error === "object") {
            (error as any).__attempt = attempt;
          }
          return error;
        };
        attachAttempt(err);
        const decoded = decodeRpcError(err);
        const isBlockhash = isBlockhashError(err);
        const protocolError = parseKaminoProtocolError(err);
        const isObligationEmpty = isObligationBorrowsEmptyError(err);
        if (isInvalidAccountInputError(err)) {
          this.invalidateMarket(true);
        }
        logger.error({
          err: decoded,
          label: "sendAction",
          attempt,
          errorCode: decoded.code,
          errorName: decoded.name,
          logs: decoded.logs,
          protocolError,
          isRateLimit: isRateLimitError(err),
          isInsufficientFunds: isInsufficientFundsError(err),
          isBlockhash,
          isObligationBorrowsEmpty: isObligationEmpty
        }, "kamino sendAction falhou");
        // ObligationBorrowsEmpty: divida ja quitada on-chain; nao fazer retry.
        if (isObligationEmpty) {
          logger.warn({ err: decoded, attempt }, "kamino tx falhou: ObligationBorrowsEmpty — divida ja zerada on-chain; abortando sem retry");
          const cleanErr = new Error("ObligationBorrowsEmpty: obligation has no borrows — divida ja quitada on-chain");
          (cleanErr as any).__obligationBorrowsEmpty = true;
          (cleanErr as any).__originalErr = err;
          throw cleanErr;
        }
        // Detecta fundos insuficientes (0x1) incluindo logs internos de simulação.
        if (isInsufficientFundsError(err)) {
          logger.error({ err: decoded, attempt }, "kamino tx falhou por fundos insuficientes (0x1); abortando sem retry");
          throw err;
        }
        if (isRateLimitError(err)) {
          this.rotateRpcEndpoint("rate-limit");
        }
        const errMsg = String((err as any)?.message ?? err).toLowerCase();
        const isSimulation = isBlockhash && errMsg.includes("simulation failed");
        if (isBlockhash && lastSignature && !isSimulation) {
          try {
            await this.confirmSignatureWithRetry(lastSignature, 20_000, 1_000);
            logger.info({ sig: lastSignature }, "kamino tx confirmada apos erro de blockhash");
            return lastSignature;
          } catch (confirmErr) {
            logger.warn({ sig: lastSignature, err: decodeRpcError(confirmErr) }, "blockhash error; confirmacao falhou, retentando");
          }
        }
        if (isBlockhash) {
          if (attempt < 2) {
            logger.warn({ attempt, err: decoded, isSimulation }, "kamino tx blockhash erro; retentando");
            await sleep(isSimulation ? 500 : 2000);
            continue;
          }
          const retryable = new Error("blockhash not found/expired (-32002) - retryable");
          (retryable as any).__code = -32002;
          (retryable as any).__retryable = true;
          (retryable as any).__originalErr = lastErr;
          (retryable as any).cause = lastErr;
          (retryable as any).__attempt = attempt;
          logger.warn({ attempt, err: decoded }, "kamino tx blockhash erro; tentativas esgotadas, devolvendo para retry");
          throw retryable;
        }
        // Se temos uma signature, verificar se a tx confirmou antes de falhar
        if (lastSignature) {
          try {
            const statusResp = await (this.rpc as any)
              .getSignatureStatuses([lastSignature])
              .send();
            const info = statusResp?.value?.[0];
            if (info && !info.err &&
              (info.confirmationStatus === "confirmed" || info.confirmationStatus === "finalized")) {
              logger.info({ sig: lastSignature }, "tx confirmada apesar do erro RPC; usando como bem-sucedida");
              return lastSignature;
            }
          } catch {
            // ignora falha ao verificar status
          }
        }
        logger.error({ err: decoded }, "falha ao enviar Kamino tx");
        throw attachAttempt(err);
      }
    }
    throw lastErr ?? new Error("falha ao enviar Kamino tx");
  }

  private async sendInstructions(ixs: Instruction[], lookupTableAddresses: string[] = []): Promise<string> {
    if (!ixs.length) {
      throw new Error("Nenhuma instrucao Kamino gerada");
    }
    let attempt = 0;
    let lastErr: any;
    let lastSignature: string | null = null;
    while (attempt < 3) {
      attempt += 1;
      try {
        const { value: latestBlockhash } = await (this.rpc as any)
          .getLatestBlockhash({ commitment: "confirmed" })
          .send();
        const slot = await (this.rpc as any).getSlot({ commitment: "confirmed" }).send();
        let txMessage = pipe(
          createTransactionMessage({ version: 0 }),
          (tx) => appendTransactionMessageInstructions(ixs, tx),
          (tx) => setTransactionMessageFeePayerSigner(this.signer, tx),
          (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx)
        );
        if (lookupTableAddresses.length > 0) {
          try {
            const luts = lookupTableAddresses
              .map((item) => {
                try {
                  return address(item);
                } catch {
                  return null;
                }
              })
              .filter((item): item is Address => Boolean(item));
            if (luts.length > 0) {
              const addressesByTable = await fetchAddressesForLookupTables(luts, this.rpc as any);
              txMessage = compressTransactionMessageUsingAddressLookupTables(txMessage, addressesByTable);
            }
          } catch (err) {
            logger.warn({ err }, "falha ao carregar lookup tables Jupiter");
          }
        }
        const signed = await signTransactionMessageWithSigners(txMessage);
        const signature = getSignatureFromTransaction(signed);
        lastSignature = signature;
        await this.sendAndConfirmSafe(signed as any, signature, undefined, {
          blockhash: (latestBlockhash as any)?.blockhash ?? latestBlockhash,
          slot
        });
        logger.info(
          { sig: signature, slot, blockhash: (latestBlockhash as any)?.blockhash ?? latestBlockhash },
          "kamino instructions enviadas"
        );
        return signature;
      } catch (err) {
        lastErr = err;
        const attachAttempt = (error: any) => {
          if (error && typeof error === "object") {
            (error as any).__attempt = attempt;
          }
          return error;
        };
        attachAttempt(err);
        const decoded = decodeRpcError(err);
        const isBlockhash = isBlockhashError(err);
        const protocolError = parseKaminoProtocolError(err);
        if (isInvalidAccountInputError(err)) {
          this.invalidateMarket(true);
        }
        logger.error({
          err: decoded,
          label: "sendInstructions",
          attempt,
          errorCode: decoded.code,
          errorName: decoded.name,
          logs: decoded.logs,
          protocolError,
          isRateLimit: isRateLimitError(err),
          isInsufficientFunds: isInsufficientFundsError(err),
          isBlockhash
        }, "kamino sendInstructions falhou");
        // Detecta fundos insuficientes (0x1) incluindo logs internos de simulação.
        if (isInsufficientFundsError(err)) {
          logger.error({ err: decoded, attempt }, "kamino instructions falharam por fundos insuficientes (0x1); abortando sem retry");
          throw err;
        }
        if (isRateLimitError(err)) {
          this.rotateRpcEndpoint("rate-limit");
        }
        const errMsg = String((err as any)?.message ?? err).toLowerCase();
        const isSimulation = isBlockhash && errMsg.includes("simulation failed");
        if (isBlockhash && lastSignature && !isSimulation) {
          try {
            await this.confirmSignatureWithRetry(lastSignature, 20_000, 1_000);
            logger.info({ sig: lastSignature }, "kamino instructions confirmadas apos erro de blockhash");
            return lastSignature;
          } catch (confirmErr) {
            logger.warn({ sig: lastSignature, err: decodeRpcError(confirmErr) }, "blockhash error em instructions; confirmacao falhou, retentando");
          }
        }
        if (isBlockhash) {
          if (attempt < 2) {
            logger.warn({ attempt, err: decoded, isSimulation }, "kamino instructions blockhash erro; retentando");
            await sleep(isSimulation ? 500 : 2000);
            continue;
          }
          const retryable = new Error("blockhash not found/expired (-32002) - retryable");
          (retryable as any).__code = -32002;
          (retryable as any).__retryable = true;
          (retryable as any).__originalErr = lastErr;
          (retryable as any).cause = lastErr;
          (retryable as any).__attempt = attempt;
          logger.warn({ attempt, err: decoded }, "kamino instructions blockhash erro; tentativas esgotadas");
          throw retryable;
        }
        // Se temos uma signature, verificar se a tx confirmou antes de falhar
        if (lastSignature) {
          try {
            const statusResp = await (this.rpc as any)
              .getSignatureStatuses([lastSignature])
              .send();
            const info = statusResp?.value?.[0];
            if (info && !info.err &&
              (info.confirmationStatus === "confirmed" || info.confirmationStatus === "finalized")) {
              logger.info({ sig: lastSignature }, "tx confirmada apesar do erro RPC; usando como bem-sucedida");
              return lastSignature;
            }
          } catch {
            // ignora falha ao verificar status
          }
        }
        logger.error({ err: decoded }, "falha ao enviar instrucoes Kamino");
        throw attachAttempt(err);
      }
    }
    throw lastErr ?? new Error("falha ao enviar instrucoes Kamino");
  }

  private async sendAndConfirmSafe(
    signed: any,
    signature: string,
    opts: { commitment: "processed" | "confirmed" | "finalized"; skipPreflight?: boolean } = {
      commitment: "confirmed",
      skipPreflight: false
    },
    ctx?: { blockhash?: string; slot?: number }
  ): Promise<void> {
    const optsWithRetry = {
      ...opts,
      // Favor processed to reduce block RPC load; confirm manually below.
      commitment: "processed" as const,
      skipPreflight: false
    };
    try {
      await this.sendAndConfirm(signed, optsWithRetry);
      logger.info({ signature, blockhash: ctx?.blockhash, slot: ctx?.slot }, "kamino tx confirmada");
    } catch (err) {
      const decoded = decodeRpcError(err);
      const msg = String(decoded?.message ?? (err as any)?.message ?? err);
      if (msg.toLowerCase().includes("not confirmed")) {
        logger.warn({ signature, err: msg }, "tx not confirmed in time; polling status");
        await this.confirmSignatureWithRetry(signature);
        return;
      }
      logger.error({ signature, blockhash: ctx?.blockhash, slot: ctx?.slot, err: decoded }, "kamino tx falhou");
      throw err;
    }
  }

  private async confirmSignatureWithRetry(signature: string, timeoutMs = 60_000, pollMs = 1500): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const statusResp = await (this.rpc as any)
        .getSignatureStatuses([signature])
        .send();
      const info = statusResp?.value?.[0];
      if (info?.err) {
        throw new Error(`Transaction ${signature} failed: ${JSON.stringify(info.err)}`);
      }
      const conf = info?.confirmationStatus;
      if (conf === "confirmed" || conf === "finalized") {
        return;
      }
      await sleep(pollMs);
    }
    throw new Error(`Transaction ${signature} not confirmed after ${timeoutMs / 1000}s`);
  }

  private async jupiterRequest(url: string, init: RequestInit, retries = 4): Promise<{ res: Response; text: string }> {
    let attempt = 0;
    while (true) {
      const res = await fetch(url, init);
      const text = await res.text().catch(() => "");
      if (res.status === 429 && attempt < retries) {
        const baseWait = 1000;
        const jitter = Math.random() * 500;
        const waitMs = Math.min(baseWait * Math.pow(2, attempt) + jitter, 15000);
        attempt += 1;
        await sleep(waitMs);
        continue;
      }
      return { res, text };
    }
  }

  private async fetchJupiterQuote(inputMint: string, outputMint: string, amount: string, slippageBps: number): Promise<any> {
    if (!this.ctx.config.jupiterApiKey) {
      throw new Error("Jupiter API key ausente");
    }
    const base = this.ctx.config.jupiterApiUrl.replace(/\/+$/, "");
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      slippageBps: String(slippageBps),
      restrictIntermediateTokens: "true",
      maxAccounts: "24"
    });
    if (Array.isArray(this.ctx.config.jupiterExcludeDexes) && this.ctx.config.jupiterExcludeDexes.length > 0) {
      params.set("excludeDexes", this.ctx.config.jupiterExcludeDexes.join(","));
    }
    const { res, text } = await this.jupiterRequest(
      `${base}/swap/v1/quote?${params.toString()}`,
      { headers: { "x-api-key": this.ctx.config.jupiterApiKey ?? "" } }
    );
    if (!res.ok) {
      throw new Error(`Falha no quote Jupiter (HTTP ${res.status})`);
    }
    if (!text) {
      throw new Error("Resposta vazia do Jupiter");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Resposta invalida do Jupiter");
    }
  }

  private async fetchJupiterSwapInstructions(quoteResponse: any): Promise<{
    preActionIxs: Instruction[];
    swapIxs: Instruction[];
    lookupTableAddresses: string[];
  }> {
    if (!this.ctx.config.jupiterApiKey) {
      throw new Error("Jupiter API key ausente");
    }
    const base = this.ctx.config.jupiterApiUrl.replace(/\/+$/, "");
    const { res, text } = await this.jupiterRequest(
      `${base}/swap/v1/swap-instructions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.ctx.config.jupiterApiKey ?? ""
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: this.signer.address,
          wrapAndUnwrapSol: true
        })
      }
    );
    if (!res.ok) {
      throw new Error(`Falha ao solicitar swap-instructions (HTTP ${res.status})`);
    }
    if (!text) {
      throw new Error("Resposta vazia do Jupiter");
    }
    let payload: JupiterSwapInstructionsResponse | null = null;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("Resposta invalida do Jupiter");
    }
    if (!payload) {
      throw new Error("Resposta invalida do Jupiter");
    }
    const setup = Array.isArray(payload.setupInstructions) ? payload.setupInstructions : [];
    const swapInstruction = payload.swapInstruction ? [payload.swapInstruction] : [];
    const cleanup = payload.cleanupInstruction ? [payload.cleanupInstruction] : [];
    const tokenLedger = payload.tokenLedgerInstruction ? [payload.tokenLedgerInstruction] : [];
    const computeBudget = Array.isArray(payload.computeBudgetInstructions)
      ? payload.computeBudgetInstructions
      : [];
    const preActionIxs = [...setup, ...tokenLedger].map(toKitInstruction);
    const swapIxs = [...computeBudget, ...swapInstruction, ...cleanup].map(toKitInstruction);
    const lookupTableAddresses = Array.isArray(payload.addressLookupTableAddresses)
      ? payload.addressLookupTableAddresses.filter((item) => typeof item === "string" && item.trim().length > 0)
      : [];
    return { preActionIxs, swapIxs, lookupTableAddresses };
  }

  private async buildActionWithFallback<T extends KaminoAction>(
    builder: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    try {
      return await builder();
    } catch (err) {
      // Se e rate limit, NAO tentar fallback - apenas propagar
      if (isRateLimitError(err)) {
        throw err;
      }
      if (fallback) {
        logger.warn({ err }, "Kamino action falhou com v2; tentando v1");
        await sleep(500);
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
      return { ok: false, reason: "Reserve nao encontrada no market" };
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
    try {
      const sig = await this.sendAction(action);
      this.invalidatePositionCache();
      logger.info(
        { sig, mint: input.mint, amount: input.amount },
        "kamino deposit concluido"
      );
      return sig;
    } catch (err) {
      const decoded = decodeRpcError(err);
      const protocolError = parseKaminoProtocolError(err);
      const attempt = (err as any)?.__attempt;
      logger.error(
        {
          err: decoded,
          label: "depositCollateral",
          mint: input.mint,
          amount: input.amount,
          attempt,
          errorCode: decoded.code,
          errorName: decoded.name,
          logs: decoded.logs,
          protocolError
        },
        "kamino deposit falhou"
      );
      throw err;
    }
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
    try {
      const sig = await this.sendAction(action);
      this.invalidatePositionCache();
      logger.info(
        { sig, mint: input.mint, amount: input.amount },
        "kamino borrow concluido"
      );
      return sig;
    } catch (err) {
      const decoded = decodeRpcError(err);
      const protocolError = parseKaminoProtocolError(err);
      const attempt = (err as any)?.__attempt;
      logger.error(
        {
          err: decoded,
          label: "borrow",
          mint: input.mint,
          amount: input.amount,
          attempt,
          errorCode: decoded.code,
          errorName: decoded.name,
          logs: decoded.logs,
          protocolError
        },
        "kamino borrow falhou"
      );
      throw err;
    }
  }

  async repay(input: { mint: string; amount: number }): Promise<string> {
    const support = await this.supportsBorrow(input.mint);
    if (!support.ok) {
      const reason = support.reason ? `: ${support.reason}` : "";
      throw new Error(`Mint ${input.mint} nao suportado para repay${reason}`);
    }

    // Pré-validação: verificar dívida on-chain antes de construir a tx.
    // Evita o erro ObligationBorrowsEmpty quando o estado local está desatualizado.
    // Invalidar cache para forçar leitura fresca da obligation.
    this.invalidatePositionCache();
    try {
      const positionState = await this.getPositionState();
      const onChainDebt = positionState?.borrows?.find((b) => b.mint === input.mint)?.amount ?? 0;
      if (onChainDebt <= 0) {
        const noDebtErr = new Error("ObligationBorrowsEmpty: obligation has no borrows — divida ja quitada on-chain");
        (noDebtErr as any).__obligationBorrowsEmpty = true;
        logger.warn(
          { mint: input.mint, requestedAmount: input.amount, onChainDebt },
          "repay() abortado: dívida on-chain zerada antes de construir tx (ObligationBorrowsEmpty preventivo)"
        );
        throw noDebtErr;
      }
      // Se a dívida on-chain for menor que o valor solicitado, ajustar para evitar excesso.
      if (onChainDebt < input.amount) {
        logger.warn(
          { mint: input.mint, requestedAmount: input.amount, onChainDebt },
          "repay(): ajustando amount para dívida on-chain real (evita overpay)"
        );
        input = { ...input, amount: onChainDebt };
      }
    } catch (preCheckErr: any) {
      if ((preCheckErr as any).__obligationBorrowsEmpty) throw preCheckErr;
      // Falha ao ler posição: continuar mesmo assim (evitar bloqueio por RPC instável).
      logger.warn({ err: preCheckErr }, "repay(): falha ao ler estado on-chain para pré-validação; prosseguindo");
    }

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
    try {
      const sig = await this.sendAction(action);
      this.invalidatePositionCache();
      logger.info(
        { sig, mint: input.mint, amount: input.amount },
        "kamino repay concluido"
      );
      return sig;
    } catch (err) {
      const decoded = decodeRpcError(err);
      const protocolError = parseKaminoProtocolError(err);
      const attempt = (err as any)?.__attempt;
      logger.error(
        {
          err: decoded,
          label: "repay",
          mint: input.mint,
          amount: input.amount,
          attempt,
          errorCode: decoded.code,
          errorName: decoded.name,
          logs: decoded.logs,
          protocolError
        },
        "kamino repay falhou"
      );
      throw err;
    }
  }

  async repayWithCollateral(input: {
    collateralMint: string;
    debtMint: string;
    repayAmount: number;
    slippageBps?: number;
  }): Promise<string> {
    if (!Number.isFinite(input.repayAmount) || input.repayAmount <= 0) {
      throw new Error("Valor de repay invalido");
    }
    if (!this.ctx.config.jupiterApiKey) {
      throw new Error("Jupiter API key ausente");
    }
    const market = await this.loadMarket();
    // Tenta encontrar a obligation com retry para tolerar leitura transitória de RPC.
    let obligation = null;
    for (let attempt = 0; attempt < 3 && !obligation; attempt += 1) {
      obligation = await market.getObligationByWallet(
        this.signer.address,
        this.obligationType
      ).catch(() => null);
      if (!obligation && attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!obligation) {
      this.invalidateMarket();
      throw new Error("Posicao Kamino nao encontrada");
    }
    const currentSlot = await (this.rpc as any).getSlot({ commitment: "confirmed" }).send();
    const slippageBps = Number.isFinite(input.slippageBps)
      ? Math.max(1, Math.min(10_000, Number(input.slippageBps)))
      : Math.max(1, Math.min(10_000, Number(this.ctx.config.slippageBps ?? 50)));
    let lastLookupTables: string[] = [];

    const quoter: SwapQuoteProvider<any> = async (swapInputs: SwapInputs) => {
      const amountLamports = swapInputs.inputAmountLamports?.toFixed?.(0) ?? "0";
      const quoteResponse = await this.fetchJupiterQuote(
        String(swapInputs.inputMint),
        String(swapInputs.outputMint),
        amountLamports,
        slippageBps
      );
      const inAmount = new Decimal(quoteResponse?.inAmount ?? "0");
      const outAmount = new Decimal(quoteResponse?.outAmount ?? "0");
      const priceAInB = inAmount.gt(0) ? outAmount.div(inAmount) : new Decimal(0);
      const quote: SwapQuote<any> = {
        priceAInB,
        quoteResponse
      };
      return quote;
    };

    const swapper: SwapIxsProvider<any> = async (_swapInputs, _klendAccounts, quote) => {
      const quoteResponse = (quote as SwapQuote<any>)?.quoteResponse;
      if (!quoteResponse) {
        throw new Error("Quote Jupiter ausente");
      }
      const swapIxs = await this.fetchJupiterSwapInstructions(quoteResponse);
      lastLookupTables = swapIxs.lookupTableAddresses ?? [];
      return [
        {
          preActionIxs: swapIxs.preActionIxs,
          swapIxs: swapIxs.swapIxs,
          lookupTables: [],
          quote
        }
      ];
    };

    let responses: Awaited<ReturnType<typeof getRepayWithCollIxs>>;
    try {
      responses = await getRepayWithCollIxs({
        repayAmount: new Decimal(input.repayAmount),
        isClosingPosition: true,
        budgetAndPriorityFeeIxs: undefined,
        collTokenMint: address(input.collateralMint),
        debtTokenMint: address(input.debtMint),
        kaminoMarket: market,
        owner: this.signer,
        obligation,
        referrer: none(),
        currentSlot,
        scopeRefreshIx: [],
        useV2Ixs: true,
        quoter,
        swapper,
        logger: (msg: string, ...extra: any[]) => {
          logger.info({ msg, extra }, "kamino repay-with-collateral");
        }
      });
    } catch (err) {
      const msg = String((err as any)?.message ?? err);
      // Se o erro é "reserveAddress" ou "reserve nao encontrada", o market
      // está com cache desatualizado (ex: após troca de token de dívida).
      // Invalida o cache e tenta novamente com um market recarregado.
      if (msg.includes("reserveAddress") || msg.includes("reserve") || msg.includes("Reserve")) {
        logger.warn({ err }, "repayWithCollateral falhou por reserve ausente; recarregando market e tentando novamente");
        this.invalidateMarket(true);
        const freshMarket = await this.loadMarket();
        responses = await getRepayWithCollIxs({
          repayAmount: new Decimal(input.repayAmount),
          isClosingPosition: true,
          budgetAndPriorityFeeIxs: undefined,
          collTokenMint: address(input.collateralMint),
          debtTokenMint: address(input.debtMint),
          kaminoMarket: freshMarket,
          owner: this.signer,
          obligation,
          referrer: none(),
          currentSlot,
          scopeRefreshIx: [],
          useV2Ixs: true,
          quoter,
          swapper,
          logger: (msg: string, ...extra: any[]) => {
            logger.info({ msg, extra }, "kamino repay-with-collateral");
          }
        });
      } else {
        throw err;
      }
    }

    if (!responses.length) {
      throw new Error("Nenhuma instrucao para repay-with-collateral");
    }
    if (!responses[0].ixs || responses[0].ixs.length === 0) {
      throw new Error(
        "repay-with-collateral gerou 0 instrucoes - obligation em estado invalido ou divida ja zerada"
      );
    }
    logger.info(
      {
        ixCount: responses[0].ixs.length,
        collateral: input.collateralMint,
        debt: input.debtMint,
        repayAmount: input.repayAmount
      },
      "repay-with-collateral instrucoes prontas"
    );
    let signature: string;
    try {
      signature = await this.sendInstructions(responses[0].ixs, lastLookupTables);
    } catch (err) {
      const decoded = decodeRpcError(err);
      const protocolError = parseKaminoProtocolError(err);
      const attempt = (err as any)?.__attempt;
      logger.error(
        {
          err: decoded,
          label: "repayWithCollateral",
          collateral: input.collateralMint,
          debt: input.debtMint,
          repayAmount: input.repayAmount,
          attempt,
          errorCode: decoded.code,
          errorName: decoded.name,
          logs: decoded.logs,
          protocolError
        },
        "kamino repay-with-collateral falhou"
      );
      throw err;
    }
    // Invalida o cache do market para refletir o novo estado da obligation.
    this.invalidateMarket(true);
    this.invalidatePositionCache();
    logger.info(
      {
        sig: signature,
        collateral: input.collateralMint,
        debt: input.debtMint,
        amount: input.repayAmount
      },
      "kamino repay-with-collateral concluido"
    );
    return signature;
  }

  async getWithdrawCapacity(input: {
    collateralMint: string;
    debtMint: string;
    repayAmountUi: number;
    bufferPct?: number;
  }): Promise<{ capacityUi: number; slot: number; blockhash?: string }> {
    if (!Number.isFinite(input.repayAmountUi) || input.repayAmountUi <= 0) {
      throw new Error("Valor de repay invalido");
    }
    let market = await this.loadMarket();
    // Se o reserve do debtMint não está no market cacheado, força reload.
    if (!market.getReserveByMint(address(input.debtMint))) {
      this.invalidateMarket(true);
      market = await this.loadMarket();
    }
    let obligation = null;
    for (let attempt = 0; attempt < 3 && !obligation; attempt += 1) {
      obligation = await market.getObligationByWallet(
        this.signer.address,
        this.obligationType
      ).catch(() => null);
      if (!obligation && attempt < 2) {
        await sleep(2000);
      }
    }
    if (!obligation) {
      this.invalidateMarket();
      throw new Error("Posicao Kamino nao encontrada");
    }
    const slot = await (this.rpc as any).getSlot({ commitment: "confirmed" }).send();
    const debtDecimals = await this.resolveDecimals(input.debtMint);
    const collDecimals = await this.resolveDecimals(input.collateralMint);
    const repayLamports = new Decimal(toRawAmount(input.repayAmountUi, debtDecimals).toString());
    const debtReserve = market.getReserveByMint(address(input.debtMint));
    const bufferPct = Number.isFinite(input.bufferPct) ? Number(input.bufferPct) : 0.7;
    if (!debtReserve) {
      throw new Error("Reserva da divida nao encontrada");
    }
    let latestBlockhash: string | undefined;
    try {
      const bhResp = await (this.rpc as any).getLatestBlockhash({ commitment: "processed" }).send();
      latestBlockhash = bhResp?.value?.blockhash ?? bhResp?.blockhash ?? undefined;
    } catch {
      // ignore; capacity still useful
    }
    let maxWithdrawLamports: DecimalType;
    try {
      maxWithdrawLamports = obligation.getMaxWithdrawAmountWithRepay(
        market,
        address(input.collateralMint),
        slot,
        repayLamports,
        debtReserve.address
      );
    } catch (err) {
      const fallback = calcMaxWithdrawCollateral(
        market,
        obligation,
        address(input.collateralMint),
        debtReserve.address,
        repayLamports
      );
      maxWithdrawLamports = fallback?.maxWithdrawableCollLamports ?? new Decimal(0);
      logger.warn({ err, fallback }, "fallback calcMaxWithdrawCollateral usado para capacidade de saque");
    }
    const capacityUiRaw = lamportsToUi(maxWithdrawLamports, collDecimals);
    const capacityUi = applyWithdrawBuffer(capacityUiRaw, bufferPct);
    return { capacityUi, slot, blockhash: latestBlockhash };
  }

  async withdraw(input: { mint: string; amount: number }): Promise<KaminoWithdrawResult> {
    const supported = await this.supportsCollateral(input.mint);
    if (!supported) {
      throw new Error(`Mint ${input.mint} nao suportado como colateral no market ativo`);
    }
    const reductions = [1, 0.85, 0.70, 0.50, 0.30];
    for (let idx = 0; idx < reductions.length; idx += 1) {
      const factor = reductions[idx];
      let currentInput = idx === 0
        ? { ...input }
        : { ...input, amount: input.amount * factor };
      let staleRetried = false;
      while (true) {
        const market = await this.loadMarket();
        const amountRaw = await this.toRawAmountString(currentInput.mint, currentInput.amount);
        try {
          const action = await this.buildActionWithFallback(
            () =>
              KaminoAction.buildWithdrawTxns(
                market,
                amountRaw,
                address(currentInput.mint),
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
                address(currentInput.mint),
                this.signer,
                this.obligationType,
                false,
                undefined,
                undefined,
                true
              )
          );
          const sig = await this.sendAction(action);
          this.invalidateMarket(true);
          this.invalidatePositionCache();
          const wasReduced = currentInput.amount !== input.amount;
          if (wasReduced) {
            const dustAmount = Math.max(0, input.amount - currentInput.amount);
            logger.warn({ dustAmount, factor }, "withdraw parcial; dust registrado para proximo ciclo");
          }
          logger.info(
            {
              sig,
              mint: currentInput.mint,
              requestedAmount: input.amount,
              actualAmount: currentInput.amount,
              wasReduced
            },
            "kamino withdraw concluido"
          );
          return {
            signature: sig,
            requestedAmount: input.amount,
            actualAmount: currentInput.amount,
            wasReduced,
            dustAmount: wasReduced ? Math.max(0, input.amount - currentInput.amount) : 0
          };
        } catch (err) {
          const msg = String((err as any)?.message ?? err).toLowerCase();

          // Erro 1: market com cache desatualizado (0x1776 / InvalidAccountInput)
          const isStaleMarket =
            msg.includes("0x1776") ||
            msg.includes("invalidaccountinput") ||
            msg.includes("invalid account input") ||
            msg.includes("6006") ||
            msg.includes("expected_remaining_accounts");
          if (isStaleMarket && !staleRetried) {
            logger.warn({ err }, "withdraw falhou com market stale (0x1776); recarregando market e retentando");
            staleRetried = true;
            this.invalidateMarket(true);
            continue;
          }

          // Erro 2: NetValueRemainingTooSmall (0x17cc / 6092)
          const isNetValueTooSmall =
            msg.includes("0x17cc") ||
            msg.includes("netvalueremainingtoosmall") ||
            msg.includes("net value remaining too small") ||
            msg.includes("6092");
          if (isNetValueTooSmall) {
            logger.warn(
              { err, originalAmount: input.amount, reducedAmount: currentInput.amount, factor },
              "withdraw falhou com NetValueRemainingTooSmall (0x17cc); tentando fator menor"
            );
            break;
          }

          const decoded = decodeRpcError(err);
          const protocolError = parseKaminoProtocolError(err);
          const attempt = (err as any)?.__attempt;
          logger.error(
            {
              err: decoded,
              label: "withdraw",
              mint: currentInput.mint,
              amount: currentInput.amount,
              attempt,
              errorCode: decoded.code,
              errorName: decoded.name,
              logs: decoded.logs,
              protocolError
            },
            "kamino withdraw falhou"
          );
          throw err;
        }
      }
    }
    throw new Error("withdraw falhou apos multiplas tentativas");
  }

  public invalidatePositionCache(): void {
    this.lastState = null;
    this.lastStateAt = 0;
  }

  async getPositionState(): Promise<KaminoPositionState | null> {
    // Cache de curta duração: se leu com sucesso há menos de 12s, devolve o cache.
    // Isso evita travar o tick com 3 retries × 2s quando a RPC está lenta.
    const CACHE_TTL_MS = 12_000;
    if (this.lastState && (Date.now() - this.lastStateAt) < CACHE_TTL_MS) {
      return this.lastState;
    }
    try {
      const market = await this.loadMarket();
      const obligationTypes = (() => {
        const variants = [this.obligationType];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const maybeMultiply = (KaminoMarket as any)?.MultiplyObligation;
        if (maybeMultiply) {
          try {
            variants.push(new maybeMultiply(PROGRAM_ID));
          } catch (err) {
            logger.warn({ err: decodeRpcError(err) }, "falha ao instanciar MultiplyObligation; ignorando");
          }
        }
        return variants;
      })();

      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const OBLIGATION_TIMEOUT_MS = 8000;
      let obligation = null;
      for (let attempt = 0; attempt < 3 && !obligation; attempt += 1) {
        for (const obligationType of obligationTypes) {
          const timeoutPromise = new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error("getObligationByWallet timeout")), OBLIGATION_TIMEOUT_MS)
          );
          const result = await Promise.race([
            market.getObligationByWallet(this.signer.address, obligationType),
            timeoutPromise
          ]).catch((innerErr) => {
            logger.warn({ err: decodeRpcError(innerErr) }, "falha ao buscar obligation com tipo alternativo");
            return null;
          });
          if (result) {
            obligation = result;
            break;
          }
          if (obligation) break;
        }
        if (!obligation && attempt < 2) {
          await sleep(2000);
        }
      }
      // Se após 3 tentativas ainda não encontrou, invalida o cache do market
      // para forçar um reload na próxima chamada (market pode estar com dados antigos).
      if (!obligation) {
        this.invalidateMarket();
        return null;
      }
      const deposit = obligation.getDeposits()[0];
      const borrow = obligation.getBorrows()[0];
      const ltv = obligation.refreshedStats?.loanToValue?.toNumber?.();
      const depositsRaw = obligation.getDeposits() ?? [];
      const borrowsRaw = obligation.getBorrows() ?? [];
       const parseAmountToUi = async (mint: string, amountValue: any): Promise<number> => {
         if (amountValue == null) return 0;
         const decimals = await this.resolveDecimals(mint);
         const text = typeof amountValue === "string" ? amountValue : amountValue?.toString?.() ?? String(amountValue);
         if (!text) return 0;
         const dec = new Decimal(text);
         if (!dec.isFinite()) return 0;
         // Correção Bug 1: usar 10^decimals como threshold (não 10^(decimals-1)).
         // A heurística anterior com (decimals-1) falhava para saldos pequenos de SOL
         // (ex: 59.526.116 lamports < 100.000.000 threshold → tratado como UI em vez de raw).
         // Com 10^decimals: qualquer valor >= 1 unidade inteira em raw é corretamente dividido.
         const rawThreshold = Math.pow(10, Math.max(0, decimals));
         if (dec.greaterThanOrEqualTo(rawThreshold)) {
           return dec.div(Math.pow(10, Math.max(0, decimals))).toNumber();
         }
         return dec.toNumber();
       };

      const deposits = await Promise.all(depositsRaw.map(async (item) => {
        const mint = item?.mintAddress ?? "";
        if (!mint) return null;
        const amount = await parseAmountToUi(mint, item?.amount);
        return { mint, amount };
      })).then((items) => items.filter(Boolean) as { mint: string; amount: number }[]);
      const borrows = await Promise.all(borrowsRaw.map(async (item) => {
        const mint = item?.mintAddress ?? "";
        if (!mint) return null;
        const amount = await parseAmountToUi(mint, item?.amount);
        return { mint, amount };
      })).then((items) => items.filter(Boolean) as { mint: string; amount: number }[]);

      const collateralMint = deposits[0]?.mint ?? null;
      const debtMint = borrows[0]?.mint ?? null;
      const collateralAmount = deposits.length
        ? deposits.reduce((sum, item) => sum + (item.amount ?? 0), 0)
        : null;
      const debtAmount = borrows.length
        ? borrows.reduce((sum, item) => sum + (item.amount ?? 0), 0)
        : null;
      const state: KaminoPositionState = {
        collateralMint,
        collateralAmount,
        debtMint,
        debtAmount,
        ltv: Number.isFinite(ltv) ? Number(ltv) : null,
        deposits,
        borrows
      };
      this.lastState = state;
      this.lastStateAt = Date.now();
      return state;
    } catch (err) {
      if (isRateLimitError(err)) {
        logger.warn({ err }, "kamino rate limit ao ler posicao; usando cache");
        return this.lastState;
      }
      logger.warn({ err }, "falha ao ler posicao Kamino");
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
    throw new Error(`Kamino SDK nao configurado (${action})`);
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

  async repayWithCollateral(input: {
    collateralMint: string;
    debtMint: string;
    repayAmount: number;
    slippageBps?: number;
  }): Promise<string> {
    this.ensureEnabled("repay-with-collateral");
    this.lastState = {
      collateralMint: input.collateralMint,
      collateralAmount: this.lastState?.collateralAmount ?? null,
      debtMint: input.debtMint,
      debtAmount: Math.max(0, (this.lastState?.debtAmount ?? 0) - input.repayAmount),
      ltv: this.lastState?.ltv ?? null
    };
    return 'noop';
  }

  async getWithdrawCapacity(input: {
    collateralMint: string;
    debtMint: string;
    repayAmountUi: number;
    bufferPct?: number;
  }): Promise<{ capacityUi: number; slot: number; blockhash?: string }> {
    const currentDeposit = Math.max(0, this.lastState?.collateralAmount ?? input.repayAmountUi ?? 0);
    const capacityUi = applyWithdrawBuffer(Math.min(currentDeposit, Math.max(0, input.repayAmountUi)), input.bufferPct ?? 0.7);
    return { capacityUi, slot: 0 };
  }

  async withdraw(input: { mint: string; amount: number }): Promise<KaminoWithdrawResult> {
    this.ensureEnabled("withdraw");
    this.lastState = {
      collateralMint: input.mint,
      collateralAmount: Math.max(0, (this.lastState?.collateralAmount ?? 0) - input.amount),
      debtMint: this.lastState?.debtMint ?? null,
      debtAmount: this.lastState?.debtAmount ?? null,
      ltv: this.lastState?.ltv ?? null
    };
    return {
      signature: "noop",
      requestedAmount: input.amount,
      actualAmount: input.amount,
      wasReduced: false,
      dustAmount: 0
    };
  }

  async getPositionState(): Promise<KaminoPositionState | null> {
    return this.lastState;
  }

  invalidatePositionCache(): void {
    this.lastState = null;
  }

  async supportsCollateral(_mint: string): Promise<boolean> {
    return true;
  }

  async supportsBorrow(_mint: string): Promise<{ ok: boolean; reason?: string }> {
    return { ok: true };
  }
}

export async function createKaminoClient(
  ctx: KaminoClientContext,
  marketAddressOverride?: string | null
): Promise<KaminoClient> {
  const allowNoop = Boolean(ctx.config.dryRun || process.env.KAMINO_NOOP === "true");
  if (allowNoop) {
    logger.info("Kamino client em modo simulado (dry-run)");
    return new NoopKaminoClient({ allowNoop: true });
  }
  const rpcUrl = ctx.config.rpcUrl;
  if (!rpcUrl) {
    throw new Error("RPC_URL nao configurado para Kamino");
  }
  const readRpcUrl =
    process.env.KAMINO_READ_RPC_URL ||
    process.env.RPC_READ_URL ||
    rpcUrl;
  const rpcUrls = buildRpcUrlList(rpcUrl, process.env.KAMINO_RPC_URLS);
  const readRpcUrls = buildRpcUrlList(readRpcUrl, process.env.KAMINO_READ_RPC_URLS);
  const primaryRpcUrl = rpcUrls[0] ?? rpcUrl;
  const primaryReadRpcUrl = readRpcUrls[0] ?? readRpcUrl;
  const wsUrl =
    process.env.KAMINO_WS_URL ||
    process.env.RPC_WS_URL ||
    deriveWsUrl(primaryRpcUrl);
  const override = typeof marketAddressOverride === "string" ? marketAddressOverride.trim() : "";
  const marketRaw = override
    || ctx.config.kaminoMarketAddress
    || process.env.KAMINO_MARKET
    || process.env.KAMINO_MAIN_MARKET
    || DEFAULT_KAMINO_MARKET;
  let marketAddress: Address;
  try {
    marketAddress = address(marketRaw);
  } catch (err) {
    throw new Error("KAMINO_MARKET invalido");
  }
  const signer = await loadSignerFromEnv(ctx.wallet);
  const rpc = createSolanaRpc(primaryRpcUrl);
  const rpcRead = createSolanaRpc(primaryReadRpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  logger.info({ market: marketRaw }, "Kamino client configurado (modo real)");
  return new RealKaminoClient({
    ctx,
    rpc,
    rpcRead,
    rpcSubscriptions,
    signer,
    marketAddress,
    rpcUrls,
    readRpcUrls
  });
}
