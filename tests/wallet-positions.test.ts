import { describe, expect, it, vi } from "vitest";
import { collectPositionMintCandidates } from "../src/pool-manager.js";

vi.mock("@orca-so/whirlpools-sdk", () => ({}));

function account(mint: string, amount: string, decimals: number) {
  return { account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } } };
}

describe("collectPositionMintCandidates", () => {
  it("keeps NFT-like accounts", () => {
    const accounts = { value: [account("mint-a", "1", 0)] };
    expect(collectPositionMintCandidates(accounts)).toEqual(["mint-a"]);
  });

  it("drops fungible balances", () => {
    // USDC e SOL wrapped moram na mesma carteira; buscar conta de posicao para
    // cada um deles seria RPC jogado fora.
    const accounts = { value: [account("usdc", "1000000", 6), account("wsol", "50000", 9)] };
    expect(collectPositionMintCandidates(accounts)).toEqual([]);
  });

  it("drops emptied position accounts", () => {
    // Saldo zero e conta orfa de posicao ja fechada.
    const accounts = { value: [account("mint-old", "0", 0)] };
    expect(collectPositionMintCandidates(accounts)).toEqual([]);
  });

  it("drops entries without a mint", () => {
    const accounts = { value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: "1", decimals: 0 } } } } } }] };
    expect(collectPositionMintCandidates(accounts)).toEqual([]);
  });

  it("survives a malformed response", () => {
    expect(collectPositionMintCandidates(null)).toEqual([]);
    expect(collectPositionMintCandidates({})).toEqual([]);
    expect(collectPositionMintCandidates({ value: [null, undefined, {}] })).toEqual([]);
  });

  it("picks only the NFTs out of a mixed wallet", () => {
    const accounts = {
      value: [
        account("usdc", "1000000", 6),
        account("pos-1", "1", 0),
        account("pos-old", "0", 0),
        account("pos-2", "1", 0)
      ]
    };
    expect(collectPositionMintCandidates(accounts)).toEqual(["pos-1", "pos-2"]);
  });
});
