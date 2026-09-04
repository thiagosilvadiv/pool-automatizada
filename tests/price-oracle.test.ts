import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPythPrice = vi.fn();

vi.mock("../src/pyth.js", () => ({
  getSolUsdPrice: (...args: unknown[]) => getPythPrice(...args)
}));

vi.mock("../src/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  stringifyError: (e: unknown) => String(e)
}));

import {
  getSolUsdPriceMulti,
  probeAllSources,
  resetPriceOracle,
  getLastSolPriceSource,
  SOL_MINT,
  type SolPriceOracleOptions
} from "../src/price-oracle.js";

const fetchMock = vi.fn();

function baseOptions(overrides: Partial<SolPriceOracleOptions> = {}): SolPriceOracleOptions {
  return {
    sources: ["pyth", "jupiter", "geckoterminal"],
    pyth: { feedId: "0x" + "a".repeat(64) },
    jupiter: { apiUrl: "https://api.jup.ag", apiKey: "chave" },
    geckoterminal: { networkId: "solana" },
    cacheMs: 0,
    ...overrides
  };
}

function jupiterOk(outAmount: string) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ outAmount })
  };
}

function geckoOk(price: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { attributes: { token_prices: { [SOL_MINT]: price } } } })
  };
}

beforeEach(() => {
  resetPriceOracle();
  getPythPrice.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ordem das fontes", () => {
  it("usa a primeira fonte que responder", async () => {
    getPythPrice.mockResolvedValue({ price: 95.5, publishTime: 1 });
    const result = await getSolUsdPriceMulti(baseOptions());
    expect(result.source).toBe("pyth");
    expect(result.price).toBe(95.5);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cai para o Jupiter quando o Pyth falha", async () => {
    getPythPrice.mockRejectedValue(new Error("403 Not entitled"));
    fetchMock.mockResolvedValue(jupiterOk("95500000"));
    const result = await getSolUsdPriceMulti(baseOptions());
    expect(result.source).toBe("jupiter");
    expect(result.price).toBeCloseTo(95.5, 6);
  });

  it("cai para o GeckoTerminal quando Pyth e Jupiter falham", async () => {
    getPythPrice.mockRejectedValue(new Error("403"));
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "erro" })
      .mockResolvedValueOnce(geckoOk("94.25"));
    const result = await getSolUsdPriceMulti(baseOptions());
    expect(result.source).toBe("geckoterminal");
    expect(result.price).toBeCloseTo(94.25, 6);
  });

  it("erro final lista o motivo de cada fonte", async () => {
    getPythPrice.mockRejectedValue(new Error("sem chave"));
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "", json: async () => ({}) });
    await expect(getSolUsdPriceMulti(baseOptions())).rejects.toThrow(/pyth:.*jupiter:.*geckoterminal:/s);
  });

  it("pula o Jupiter quando nao ha chave configurada", async () => {
    getPythPrice.mockRejectedValue(new Error("403"));
    fetchMock.mockResolvedValue(geckoOk("90"));
    const result = await getSolUsdPriceMulti(
      baseOptions({ jupiter: { apiUrl: "https://api.jup.ag", apiKey: null } })
    );
    expect(result.source).toBe("geckoterminal");
  });

  it("registra a fonte em uso", async () => {
    getPythPrice.mockRejectedValue(new Error("403"));
    fetchMock.mockResolvedValue(jupiterOk("95500000"));
    await getSolUsdPriceMulti(baseOptions());
    expect(getLastSolPriceSource()).toBe("jupiter");
  });
});

describe("faixa de sanidade", () => {
  it("rejeita preco abaixo do minimo e tenta a proxima fonte", async () => {
    getPythPrice.mockResolvedValue({ price: 0.0001, publishTime: 1 });
    fetchMock.mockResolvedValue(jupiterOk("95000000"));
    const result = await getSolUsdPriceMulti(baseOptions());
    expect(result.source).toBe("jupiter");
  });

  it("rejeita preco acima do maximo", async () => {
    getPythPrice.mockResolvedValue({ price: 999999, publishTime: 1 });
    fetchMock.mockResolvedValue(jupiterOk("95000000"));
    const result = await getSolUsdPriceMulti(baseOptions());
    expect(result.source).toBe("jupiter");
  });

  it("rejeita divergencia grande em relacao ao ultimo preco conhecido", async () => {
    getPythPrice.mockResolvedValueOnce({ price: 95, publishTime: 1 });
    const first = await getSolUsdPriceMulti(baseOptions());
    expect(first.price).toBe(95);

    // Pyth volta com metade do valor: deve ser rejeitado e cair para o Jupiter.
    getPythPrice.mockResolvedValueOnce({ price: 45, publishTime: 2 });
    fetchMock.mockResolvedValue(jupiterOk("96000000"));
    const second = await getSolUsdPriceMulti(baseOptions());
    expect(second.source).toBe("jupiter");
    expect(second.price).toBeCloseTo(96, 6);
  });

  it("aceita variacao dentro do limite", async () => {
    getPythPrice.mockResolvedValueOnce({ price: 95, publishTime: 1 });
    await getSolUsdPriceMulti(baseOptions());
    getPythPrice.mockResolvedValueOnce({ price: 100, publishTime: 2 });
    const second = await getSolUsdPriceMulti(baseOptions());
    expect(second.source).toBe("pyth");
    expect(second.price).toBe(100);
  });

  it("respeita limites customizados", async () => {
    getPythPrice.mockResolvedValue({ price: 5, publishTime: 1 });
    fetchMock.mockResolvedValue(jupiterOk("95000000"));
    const result = await getSolUsdPriceMulti(
      baseOptions({ sanity: { minUsd: 10, maxUsd: 1000, maxDeviationPct: 25 } })
    );
    expect(result.source).toBe("jupiter");
  });
});

describe("disjuntor", () => {
  it("pula a fonte apos 3 falhas seguidas", async () => {
    getPythPrice.mockRejectedValue(new Error("403"));
    fetchMock.mockResolvedValue(jupiterOk("95000000"));
    const options = baseOptions({ cooldownSec: 300 });

    for (let i = 0; i < 3; i += 1) {
      await getSolUsdPriceMulti(options);
    }
    expect(getPythPrice).toHaveBeenCalledTimes(3);

    // A quarta chamada nem tenta o Pyth: ele esta em cooldown.
    await getSolUsdPriceMulti(options);
    expect(getPythPrice).toHaveBeenCalledTimes(3);
  });

  it("volta a tentar depois do cooldown", async () => {
    vi.useFakeTimers();
    getPythPrice.mockRejectedValue(new Error("403"));
    fetchMock.mockResolvedValue(jupiterOk("95000000"));
    const options = baseOptions({ cooldownSec: 60 });

    for (let i = 0; i < 3; i += 1) {
      await getSolUsdPriceMulti(options);
    }
    expect(getPythPrice).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(61_000);
    getPythPrice.mockResolvedValue({ price: 95, publishTime: 1 });
    const result = await getSolUsdPriceMulti(options);
    expect(result.source).toBe("pyth");
  });

  it("sucesso zera a contagem de falhas", async () => {
    const options = baseOptions({ cooldownSec: 300 });
    getPythPrice.mockRejectedValueOnce(new Error("falha"));
    getPythPrice.mockRejectedValueOnce(new Error("falha"));
    fetchMock.mockResolvedValue(jupiterOk("95000000"));
    await getSolUsdPriceMulti(options);
    await getSolUsdPriceMulti(options);

    getPythPrice.mockResolvedValueOnce({ price: 95, publishTime: 1 });
    await getSolUsdPriceMulti(options);

    getPythPrice.mockRejectedValue(new Error("falha"));
    await getSolUsdPriceMulti(options);
    await getSolUsdPriceMulti(options);
    // Se a contagem nao tivesse zerado, o Pyth ja estaria em cooldown aqui.
    expect(getPythPrice).toHaveBeenCalledTimes(5);
  });
});

describe("parsers", () => {
  it("Jupiter: converte outAmount de 6 casas para preco", async () => {
    getPythPrice.mockRejectedValue(new Error("403"));
    fetchMock.mockResolvedValue(jupiterOk("123456789"));
    const result = await getSolUsdPriceMulti(baseOptions({ sanity: { maxUsd: 100000 } }));
    expect(result.price).toBeCloseTo(123.456789, 6);
  });

  it("Jupiter: aceita outAmount aninhado em quote", async () => {
    getPythPrice.mockRejectedValue(new Error("403"));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ quote: { outAmount: "95000000" } })
    });
    const result = await getSolUsdPriceMulti(baseOptions());
    expect(result.price).toBeCloseTo(95, 6);
  });

  it("GeckoTerminal: aceita o formato alternativo tokenPrices", async () => {
    getPythPrice.mockRejectedValue(new Error("403"));
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { attributes: { tokenPrices: { [SOL_MINT]: "93.7" } } } })
      });
    const result = await getSolUsdPriceMulti(baseOptions());
    expect(result.price).toBeCloseTo(93.7, 6);
  });

  it("GeckoTerminal: erro explicito quando token_prices nao vem", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {} }) });
    const probes = await probeAllSources(baseOptions({ sources: ["geckoterminal"] }));
    expect(probes[0].ok).toBe(false);
    expect(probes[0].error).toMatch(/token_prices/);
  });

  it("GeckoTerminal: rejeita preco nao numerico em vez de devolver lixo", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { attributes: { token_prices: { [SOL_MINT]: "nao-e-numero" } } } })
    });
    const probes = await probeAllSources(baseOptions({ sources: ["geckoterminal"] }));
    expect(probes[0].ok).toBe(false);
    expect(probes[0].error).toMatch(/preco invalido/);
  });
});

describe("cache", () => {
  it("nao consulta de novo dentro da janela de cache", async () => {
    getPythPrice.mockResolvedValue({ price: 95, publishTime: 1 });
    const options = baseOptions({ cacheMs: 30000 });
    await getSolUsdPriceMulti(options);
    await getSolUsdPriceMulti(options);
    expect(getPythPrice).toHaveBeenCalledTimes(1);
  });
});

describe("probeAllSources", () => {
  it("testa todas as fontes e reporta erro individual", async () => {
    getPythPrice.mockRejectedValue(new Error("403 Not entitled"));
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "", json: async () => ({}) });
    const probes = await probeAllSources(baseOptions({ sources: ["pyth", "jupiter", "onchain"] }));
    expect(probes.map((p) => p.source)).toEqual(["pyth", "jupiter", "onchain"]);
    expect(probes.every((p) => !p.ok)).toBe(true);
    expect(probes[0].error).toMatch(/Not entitled/);
    expect(probes[2].error).toMatch(/SOL_USDC_WHIRLPOOL/);
  });

  it("usa o leitor on-chain quando fornecido", async () => {
    const probes = await probeAllSources(
      baseOptions({ sources: ["onchain"], onchainReader: async () => 97.5 })
    );
    expect(probes[0].ok).toBe(true);
    expect(probes[0].price).toBe(97.5);
  });
});
