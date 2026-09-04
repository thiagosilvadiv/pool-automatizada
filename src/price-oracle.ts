/**
 * Preco SOL/USD com varias fontes.
 *
 * Antes o preco vinha so do Pyth. Quando o Hermes passou a exigir chave e
 * respondeu 401/403, `tryGetSolUsdPrice` propagava o erro, o tick inteiro
 * morria e o ciclo do Kamino ficava parado ate o monitor acusar CICLO_PRESO.
 * Uma fonte fora do ar nao pode mais parar o bot.
 *
 * As fontes sao tentadas na ordem configurada. A primeira que responder um
 * valor plausivel vence. Fonte que falha seguidamente entra em cooldown, para
 * nao gastar uma requisicao condenada a cada tick.
 */
import { logger } from "./logger.js";
import { getSolUsdPrice as getPythPrice } from "./pyth.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;
const SOL_DECIMALS = 9;

export type SolPriceSourceName = "pyth" | "jupiter" | "geckoterminal" | "onchain";

export const ALL_SOL_PRICE_SOURCES: SolPriceSourceName[] = [
  "pyth",
  "jupiter",
  "geckoterminal",
  "onchain"
];

export function isSolPriceSource(value: unknown): value is SolPriceSourceName {
  return typeof value === "string" && (ALL_SOL_PRICE_SOURCES as string[]).includes(value);
}

export type SolPriceResult = {
  price: number;
  publishTime: number;
  source: SolPriceSourceName;
};

export type SolPriceOracleOptions = {
  sources: SolPriceSourceName[];
  pyth?: {
    feedId: string | null;
    endpoint?: string;
    apiKey?: string | null;
    staleMaxSec?: number | null;
    fallbackMaxAgeSec?: number;
  };
  jupiter?: {
    apiUrl: string;
    apiKey: string | null;
    slippageBps?: number;
  };
  geckoterminal?: {
    networkId?: string;
    baseUrl?: string;
  };
  /**
   * Leitura on-chain do preco (Whirlpool SOL/USDC). Vem como callback porque
   * exige o cliente da Orca, que vive no OrcaBot — assim o oraculo continua
   * testavel sem SDK nem RPC.
   */
  onchainReader?: (() => Promise<number | null>) | null;
  sanity?: {
    minUsd?: number;
    maxUsd?: number;
    maxDeviationPct?: number;
  };
  cooldownSec?: number;
  cacheMs?: number;
};

const DEFAULT_GECKO_BASE = "https://api.geckoterminal.com/api/v2";
const DEFAULT_SANITY = { minUsd: 1, maxUsd: 10000, maxDeviationPct: 25 };
const DEFAULT_COOLDOWN_SEC = 300;
const DEFAULT_CACHE_MS = 30000;
/** Acima disso o ultimo preco bom e velho demais para servir de referencia. */
const DEVIATION_REFERENCE_MAX_AGE_MS = 10 * 60 * 1000;
const FAILURES_BEFORE_COOLDOWN = 3;

type BreakerState = { failures: number; blockedUntil: number };

const breakers = new Map<SolPriceSourceName, BreakerState>();

let cached: { value: SolPriceResult; at: number } | null = null;
let lastGood: { price: number; at: number } | null = null;
let lastSourceUsed: SolPriceSourceName | null = null;

/** Zera cache, disjuntores e referencias. Usado nos testes. */
export function resetPriceOracle(): void {
  breakers.clear();
  cached = null;
  lastGood = null;
  lastSourceUsed = null;
}

export function getLastSolPriceSource(): SolPriceSourceName | null {
  return lastSourceUsed;
}

function isBlocked(source: SolPriceSourceName, now: number): boolean {
  const state = breakers.get(source);
  return Boolean(state && state.blockedUntil > now);
}

function recordFailure(source: SolPriceSourceName, now: number, cooldownMs: number): void {
  const state = breakers.get(source) ?? { failures: 0, blockedUntil: 0 };
  state.failures += 1;
  if (state.failures >= FAILURES_BEFORE_COOLDOWN) {
    state.blockedUntil = now + cooldownMs;
    state.failures = 0;
  }
  breakers.set(source, state);
}

function recordSuccess(source: SolPriceSourceName): void {
  breakers.delete(source);
}

/**
 * Descarta valor absurdo antes que ele dimensione uma posicao. Um parser errado
 * devolvendo 0.0001 seria pior que fonte nenhuma.
 */
function checkSanity(
  price: number,
  sanity: Required<NonNullable<SolPriceOracleOptions["sanity"]>>,
  now: number
): string | null {
  if (!Number.isFinite(price) || price <= 0) {
    return "preco nao numerico";
  }
  if (price < sanity.minUsd || price > sanity.maxUsd) {
    return `preco ${price} fora da faixa [${sanity.minUsd}, ${sanity.maxUsd}]`;
  }
  // So compara com a referencia se ela for recente: depois de horas, uma
  // variacao grande e movimento de mercado, nao erro de leitura.
  if (lastGood && now - lastGood.at <= DEVIATION_REFERENCE_MAX_AGE_MS && lastGood.price > 0) {
    const deviation = Math.abs(price - lastGood.price) / lastGood.price * 100;
    if (deviation > sanity.maxDeviationPct) {
      return `preco ${price} diverge ${deviation.toFixed(1)}% do ultimo conhecido (${lastGood.price})`;
    }
  }
  return null;
}

async function readPyth(options: SolPriceOracleOptions): Promise<number> {
  const cfg = options.pyth;
  if (!cfg?.feedId) {
    throw new Error("pythSolUsdFeedId nao configurado");
  }
  const result = await getPythPrice(null, cfg.feedId, cfg.staleMaxSec ?? null, 0, {
    endpoint: cfg.endpoint,
    apiKey: cfg.apiKey ?? null,
    fallbackMaxAgeSec: cfg.fallbackMaxAgeSec ?? 0
  });
  return result.price;
}

/**
 * Cota 1 SOL -> USDC. Mesmo endpoint e header (`x-api-key`) que o projeto ja
 * usa em kamino-client.fetchJupiterQuote, entao o formato da resposta e o
 * mesmo que roda em producao.
 */
async function readJupiter(options: SolPriceOracleOptions): Promise<number> {
  const cfg = options.jupiter;
  if (!cfg?.apiKey) {
    throw new Error("jupiterApiKey ausente");
  }
  const base = cfg.apiUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amount: String(10 ** SOL_DECIMALS),
    slippageBps: String(cfg.slippageBps ?? 50),
    restrictIntermediateTokens: "true"
  });
  const res = await fetch(`${base}/swap/v1/quote?${params.toString()}`, {
    headers: { "x-api-key": cfg.apiKey, accept: "application/json" }
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Jupiter respondeu HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("resposta invalida do Jupiter");
  }
  const outAmount = Number(data?.outAmount ?? data?.quote?.outAmount ?? 0);
  if (!Number.isFinite(outAmount) || outAmount <= 0) {
    throw new Error("Jupiter nao retornou outAmount");
  }
  return outAmount / 10 ** USDC_DECIMALS;
}

/**
 * GeckoTerminal, sem chave. O formato nao pode ser verificado no ambiente de
 * desenvolvimento (host bloqueado), entao o parser aceita as variacoes
 * conhecidas e falha com mensagem explicita em vez de devolver lixo.
 */
async function readGeckoTerminal(options: SolPriceOracleOptions): Promise<number> {
  const networkId = options.geckoterminal?.networkId || "solana";
  const base = (options.geckoterminal?.baseUrl || DEFAULT_GECKO_BASE).replace(/\/+$/, "");
  const url = `${base}/simple/networks/${networkId}/token_price/${SOL_MINT}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`GeckoTerminal respondeu HTTP ${res.status}`);
  }
  const data: any = await res.json().catch(() => null);
  const prices =
    data?.data?.attributes?.token_prices
    ?? data?.data?.attributes?.tokenPrices
    ?? data?.attributes?.token_prices
    ?? null;
  if (!prices || typeof prices !== "object") {
    throw new Error("GeckoTerminal: token_prices ausente na resposta");
  }
  // A chave costuma vir com o mint no mesmo caso, mas nao custa ser tolerante.
  const direct = prices[SOL_MINT] ?? prices[SOL_MINT.toLowerCase()];
  const raw = direct ?? Object.values(prices)[0];
  const price = Number(raw);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`GeckoTerminal: preco invalido (${String(raw)})`);
  }
  return price;
}

async function readOnchain(options: SolPriceOracleOptions): Promise<number> {
  if (!options.onchainReader) {
    throw new Error("fonte onchain sem SOL_USDC_WHIRLPOOL configurado");
  }
  const price = await options.onchainReader();
  if (price == null || !Number.isFinite(price) || price <= 0) {
    throw new Error("leitura on-chain nao retornou preco");
  }
  return price;
}

const READERS: Record<SolPriceSourceName, (o: SolPriceOracleOptions) => Promise<number>> = {
  pyth: readPyth,
  jupiter: readJupiter,
  geckoterminal: readGeckoTerminal,
  onchain: readOnchain
};

export type SourceProbe = {
  source: SolPriceSourceName;
  ok: boolean;
  price: number | null;
  latencyMs: number;
  error: string | null;
  skipped?: "cooldown";
};

/** Testa uma fonte isoladamente. Usado tambem pelo diagnostico da UI. */
export async function probeSource(
  source: SolPriceSourceName,
  options: SolPriceOracleOptions
): Promise<SourceProbe> {
  const startedAt = Date.now();
  try {
    const price = await READERS[source](options);
    return {
      source,
      ok: true,
      price,
      latencyMs: Date.now() - startedAt,
      error: null
    };
  } catch (err) {
    return {
      source,
      ok: false,
      price: null,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/** Testa todas as fontes, ignorando cooldown. Base do endpoint de diagnostico. */
export async function probeAllSources(options: SolPriceOracleOptions): Promise<SourceProbe[]> {
  const sources = options.sources.length ? options.sources : ALL_SOL_PRICE_SOURCES;
  return Promise.all(sources.map((source) => probeSource(source, options)));
}

export async function getSolUsdPriceMulti(
  options: SolPriceOracleOptions
): Promise<SolPriceResult> {
  const now = Date.now();
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  if (cached && now - cached.at < cacheMs) {
    return cached.value;
  }

  const sanity = {
    minUsd: options.sanity?.minUsd ?? DEFAULT_SANITY.minUsd,
    maxUsd: options.sanity?.maxUsd ?? DEFAULT_SANITY.maxUsd,
    maxDeviationPct: options.sanity?.maxDeviationPct ?? DEFAULT_SANITY.maxDeviationPct
  };
  const cooldownMs = (options.cooldownSec ?? DEFAULT_COOLDOWN_SEC) * 1000;
  const sources = options.sources.length ? options.sources : ALL_SOL_PRICE_SOURCES;

  const errors: string[] = [];
  for (const source of sources) {
    if (isBlocked(source, now)) {
      errors.push(`${source}: em cooldown apos falhas seguidas`);
      continue;
    }
    try {
      const price = await READERS[source](options);
      const problem = checkSanity(price, sanity, now);
      if (problem) {
        // Nao conta como falha de disponibilidade: a fonte respondeu, o valor e
        // que nao passou. Ainda assim seguimos para a proxima.
        errors.push(`${source}: ${problem}`);
        logger.warn({ source, price }, `preco rejeitado pela sanidade: ${problem}`);
        continue;
      }
      recordSuccess(source);
      if (lastSourceUsed !== source) {
        logger.info(
          { source, previous: lastSourceUsed, price },
          "fonte de preco SOL/USD em uso mudou"
        );
        lastSourceUsed = source;
      }
      const result: SolPriceResult = {
        price,
        publishTime: Math.floor(now / 1000),
        source
      };
      cached = { value: result, at: now };
      lastGood = { price, at: now };
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${source}: ${message}`);
      recordFailure(source, now, cooldownMs);
    }
  }

  throw new Error(`Nenhuma fonte de preco SOL/USD respondeu. ${errors.join(" | ")}`);
}
