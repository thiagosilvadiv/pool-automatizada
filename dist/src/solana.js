import fs from "fs";
import path from "path";
import bs58 from "bs58";
import { Connection, Keypair } from "@solana/web3.js";
export function loadKeypair() {
    const keypairPath = process.env.WALLET_KEYPAIR_PATH;
    const secretKey = process.env.WALLET_PRIVATE_KEY;
    if (keypairPath) {
        const resolved = path.resolve(process.cwd(), keypairPath);
        const raw = fs.readFileSync(resolved, "utf-8");
        const arr = JSON.parse(raw);
        return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
    if (!secretKey) {
        throw new Error("Missing WALLET_PRIVATE_KEY or WALLET_KEYPAIR_PATH");
    }
    try {
        const arr = JSON.parse(secretKey);
        return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
    catch {
        const decoded = bs58.decode(secretKey);
        return Keypair.fromSecretKey(decoded);
    }
}
export function buildWallet(keypair) {
    return {
        publicKey: keypair.publicKey,
        signTransaction: async (tx) => {
            if ("version" in tx) {
                tx.sign([keypair]);
                return tx;
            }
            tx.partialSign(keypair);
            return tx;
        },
        signAllTransactions: async (txs) => {
            return txs.map((tx) => {
                if ("version" in tx) {
                    tx.sign([keypair]);
                    return tx;
                }
                tx.partialSign(keypair);
                return tx;
            });
        }
    };
}
export function buildConnection(rpcUrl) {
    return new Connection(rpcUrl, { commitment: "confirmed" });
}
