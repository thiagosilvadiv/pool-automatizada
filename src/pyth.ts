import { HermesClient } from "@pythnetwork/hermes-client";
import { logger } from "./logger.js";

export type PythPrice = {
  price: number;
  publishTime: number;
};

export type PythOptions = {
  /** Endpoint do Hermes. O publico deixou de aceitar requisicao sem chave em
   *  alguns deploys (responde 401), entao precisa ser configuravel. */
  endpoint?: string;
  /** Enviada como Authorization: Bearer <chave>, quando o endpoint exigir. */
  apiKey?: string | null;
  /**
   * Idade maxima (segundos) do ultimo preco bom para ser reaproveitado quando o
   * Hermes falha. 0 desliga o fallback e o erro sobe, como antes.
   */
  fallbackMaxAgeSec?: number;
};

type Cache = {
  value: PythPrice | null;
  updatedAt: number;
  feedId: string | null;
};

const cache: Cache = {
  value: null,
  updatedAt: 0,
  feedId: null
};

/** Ultimo preco lido com sucesso, guardado separado do cache curto. */
const lastGood: Cache = {
  value: null,
  updatedAt: 0,
  feedId: null
};

const DEFAULT_ENDPOINT = "https://hermes.pyth.network";

let client: HermesClient | null = null;
let clientKey = "";

/** Recria o cliente apenas quando endpoint ou chave mudam. */
function getClient(endpoint: string, apiKey: string | null): HermesClient {
  const key = `${endpoint}::${apiKey ?? ""}`;
  if (client && clientKey === key) {
    return client;
  }
  client = new HermesClient(endpoint, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
  });
  clientKey = key;
  return client;
}

function normalizeFeedId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.startsWith("0x")) {
    return trimmed.toLowerCase();
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return `0x${trimmed.toLowerCase()}`;
  }
  throw new Error("pythSolUsdFeedId must be a hex feed id (0x...) from Pyth, not a Solana address");
}

/**
 * Mensagem de erro acionavel. Um 401 cru nao diz ao operador o que fazer, e
 * essa falha derruba o tick inteiro quando budgetUsd esta definido.
 */
function describeError(err: unknown, endpoint: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/\b401\b|unauthorized/i.test(message)) {
    return `Hermes recusou a requisicao (401) em ${endpoint}. `
      + "O endpoint exige autenticacao: defina PYTH_HERMES_API_KEY, ou aponte "
      + "PYTH_HERMES_URL para um Hermes proprio/de provedor. "
      + `Detalhe: ${message}`;
  }
  if (/\b429\b|rate limit/i.test(message)) {
    return `Hermes esta limitando as requisicoes (429) em ${endpoint}. `
      + "Aumente o cache, use uma chave dedicada ou outro endpoint. "
      + `Detalhe: ${message}`;
  }
  return message;
}

export async function getSolUsdPrice(
  _connection: unknown,
  feedId: string,
  staleMaxSec: number | null,
  cacheMs = 30000,
  options: PythOptions = {}
): Promise<PythPrice> {
  const now = Date.now();
  const normalized = normalizeFeedId(feedId);
  const endpoint = options.endpoint?.trim() || DEFAULT_ENDPOINT;
  const apiKey = options.apiKey ?? null;
  const fallbackMaxAgeSec = Math.max(0, Number(options.fallbackMaxAgeSec ?? 0));

  if (cache.value && cache.feedId === normalized && now - cache.updatedAt < cacheMs) {
    return cache.value;
  }

  try {
    const priceUpdates = await getClient(endpoint, apiKey).getLatestPriceUpdates([normalized]);
    const update: any = priceUpdates?.parsed?.[0];
    if (!update?.price) {
      throw new Error("Failed to fetch SOL/USD price from Hermes");
    }

    const priceValue = Number(update.price.price) * Math.pow(10, Number(update.price.expo));
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      throw new Error("Invalid SOL/USD price from Hermes");
    }

    const publishTime = Number(
      update.price.publishTime ?? update.price.publish_time ?? update.publishTime ?? 0
    );
    if (staleMaxSec != null && staleMaxSec > 0 && publishTime > 0) {
      const age = Math.floor(now / 1000) - publishTime;
      if (age > staleMaxSec) {
        throw new Error(`Pyth price is stale (age ${age}s)`);
      }
    }

    const result = { price: priceValue, publishTime };
    cache.value = result;
    cache.updatedAt = now;
    cache.feedId = normalized;
    lastGood.value = result;
    lastGood.updatedAt = now;
    lastGood.feedId = normalized;
    return result;
  } catch (err) {
    // Sem fallback o erro sobe e, com budgetUsd definido, o tick inteiro morre:
    // o bot para de operar — inclusive de fechar posicao ou pagar emprestimo —
    // enquanto o Hermes estiver fora.
    if (fallbackMaxAgeSec > 0 && lastGood.value && lastGood.feedId === normalized) {
      const ageSec = (now - lastGood.updatedAt) / 1000;
      if (ageSec <= fallbackMaxAgeSec) {
        logger.warn(
          { err, ageSec: Math.round(ageSec), endpoint },
          "Hermes falhou; usando ultimo preco SOL/USD conhecido (fallback)"
        );
        return lastGood.value;
      }
    }
    throw new Error(describeError(err, endpoint));
  }
}
