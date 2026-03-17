import fs from "fs";
import path from "path";
import bs58 from "bs58";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

export type WalletLike = {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
  signAllTransactions: (txs: (Transaction | VersionedTransaction)[]) => Promise<(Transaction | VersionedTransaction)[]>;
};

export function loadKeypair(): Keypair {
  const keypairPath = process.env.WALLET_KEYPAIR_PATH;
  const secretKey = process.env.WALLET_PRIVATE_KEY;

  if (keypairPath) {
    const resolved = path.resolve(process.cwd(), keypairPath);
    const raw = fs.readFileSync(resolved, "utf-8");
    const arr = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }

  if (!secretKey) {
    throw new Error("Missing WALLET_PRIVATE_KEY or WALLET_KEYPAIR_PATH");
  }

  try {
    const arr = JSON.parse(secretKey) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch {
    const decoded = bs58.decode(secretKey);
    return Keypair.fromSecretKey(decoded);
  }
}

export function buildWallet(keypair: Keypair): WalletLike {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async (tx) => {
      if ("version" in tx) {
        (tx as VersionedTransaction).sign([keypair]);
        return tx;
      }
      (tx as Transaction).partialSign(keypair);
      return tx;
    },
    signAllTransactions: async (txs) => {
      return txs.map((tx) => {
        if ("version" in tx) {
          (tx as VersionedTransaction).sign([keypair]);
          return tx;
        }
        (tx as Transaction).partialSign(keypair);
        return tx;
      });
    }
  };
}

export function buildConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, { commitment: "confirmed" });
}
