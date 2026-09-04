import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getLatestPriceUpdates = vi.fn();
const constructorCalls: Array<{ endpoint: string; config: any }> = [];

vi.mock("@pythnetwork/hermes-client", () => ({
  HermesClient: class {
    constructor(endpoint: string, config: any) {
      constructorCalls.push({ endpoint, config });
    }
    getLatestPriceUpdates(ids: string[]) {
      return getLatestPriceUpdates(ids);
    }
  }
}));

vi.mock("../src/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  stringifyError: (e: unknown) => String(e)
}));

const FEED = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

function priceUpdate(price = 9500000000, expo = -8, publishTime = Math.floor(Date.now() / 1000)) {
  return { parsed: [{ price: { price, expo, publishTime } }] };
}

// O modulo guarda cache em variaveis de modulo: recarrega a cada teste.
async function freshPyth() {
  vi.resetModules();
  return import("../src/pyth.js");
}

beforeEach(() => {
  getLatestPriceUpdates.mockReset();
  constructorCalls.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getSolUsdPrice", () => {
  it("usa o endpoint padrao quando nenhum e informado", async () => {
    const { getSolUsdPrice } = await freshPyth();
    getLatestPriceUpdates.mockResolvedValue(priceUpdate());
    await getSolUsdPrice(null, FEED, null, 0);
    expect(constructorCalls[0].endpoint).toBe("https://hermes.pyth.network");
    expect(constructorCalls[0].config.headers).toBeUndefined();
  });

  it("usa endpoint customizado e envia a chave como Bearer", async () => {
    const { getSolUsdPrice } = await freshPyth();
    getLatestPriceUpdates.mockResolvedValue(priceUpdate());
    await getSolUsdPrice(null, FEED, null, 0, {
      endpoint: "https://hermes.example.com",
      apiKey: "segredo"
    });
    expect(constructorCalls[0].endpoint).toBe("https://hermes.example.com");
    expect(constructorCalls[0].config.headers).toEqual({ Authorization: "Bearer segredo" });
  });

  it("converte preco e expoente corretamente", async () => {
    const { getSolUsdPrice } = await freshPyth();
    getLatestPriceUpdates.mockResolvedValue(priceUpdate(9512345678, -8));
    const result = await getSolUsdPrice(null, FEED, null, 0);
    expect(result.price).toBeCloseTo(95.12345678, 8);
  });

  it("explica o 401 em vez de repassar o erro cru", async () => {
    const { getSolUsdPrice } = await freshPyth();
    getLatestPriceUpdates.mockRejectedValue(new Error("HTTP error! status: 401, body: unauthorized"));
    await expect(getSolUsdPrice(null, FEED, null, 0)).rejects.toThrow(/PYTH_HERMES_API_KEY/);
    await expect(getSolUsdPrice(null, FEED, null, 0)).rejects.toThrow(/401/);
  });

  it("explica o 429 apontando para limite de requisicoes", async () => {
    const { getSolUsdPrice } = await freshPyth();
    getLatestPriceUpdates.mockRejectedValue(new Error("HTTP error! status: 429"));
    await expect(getSolUsdPrice(null, FEED, null, 0)).rejects.toThrow(/limitando/);
  });

  it("sem fallback configurado, o erro sobe (comportamento padrao)", async () => {
    const { getSolUsdPrice } = await freshPyth();
    getLatestPriceUpdates.mockResolvedValueOnce(priceUpdate());
    await getSolUsdPrice(null, FEED, null, 0);
    getLatestPriceUpdates.mockRejectedValue(new Error("HTTP error! status: 401, body: unauthorized"));
    await expect(getSolUsdPrice(null, FEED, null, 0)).rejects.toThrow();
  });

  it("com fallback, reaproveita o ultimo preco bom dentro da janela", async () => {
    const { getSolUsdPrice } = await freshPyth();
    getLatestPriceUpdates.mockResolvedValueOnce(priceUpdate(9500000000, -8));
    const first = await getSolUsdPrice(null, FEED, null, 0, { fallbackMaxAgeSec: 300 });
    getLatestPriceUpdates.mockRejectedValue(new Error("HTTP error! status: 401, body: unauthorized"));
    const second = await getSolUsdPrice(null, FEED, null, 0, { fallbackMaxAgeSec: 300 });
    expect(second.price).toBe(first.price);
  });

  it("nao reaproveita preco mais velho que a janela", async () => {
    vi.useFakeTimers();
    const { getSolUsdPrice } = await freshPyth();
    getLatestPriceUpdates.mockResolvedValueOnce(priceUpdate());
    await getSolUsdPrice(null, FEED, null, 0, { fallbackMaxAgeSec: 60 });
    vi.advanceTimersByTime(61_000);
    getLatestPriceUpdates.mockRejectedValue(new Error("boom"));
    await expect(getSolUsdPrice(null, FEED, null, 0, { fallbackMaxAgeSec: 60 })).rejects.toThrow();
  });

  it("rejeita preco velho demais segundo staleMaxSec", async () => {
    const { getSolUsdPrice } = await freshPyth();
    const old = Math.floor(Date.now() / 1000) - 600;
    getLatestPriceUpdates.mockResolvedValue(priceUpdate(9500000000, -8, old));
    await expect(getSolUsdPrice(null, FEED, 120, 0)).rejects.toThrow(/stale/);
  });

  it("rejeita feed id que nao seja hex", async () => {
    const { getSolUsdPrice } = await freshPyth();
    await expect(
      getSolUsdPrice(null, "So11111111111111111111111111111111111111112", null, 0)
    ).rejects.toThrow(/hex feed id/);
  });

  it("respeita o cache curto e nao chama o Hermes de novo", async () => {
    const { getSolUsdPrice } = await freshPyth();
    getLatestPriceUpdates.mockResolvedValue(priceUpdate());
    await getSolUsdPrice(null, FEED, null, 30000);
    await getSolUsdPrice(null, FEED, null, 30000);
    expect(getLatestPriceUpdates).toHaveBeenCalledTimes(1);
  });
});
