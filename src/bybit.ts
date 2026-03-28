import crypto from "crypto";

export type BybitConfig = {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  recvWindow: number;
};

type BybitResponse<T> = {
  retCode: number;
  retMsg: string;
  result: T;
  time: number;
};

type BybitTicker = {
  symbol: string;
  lastPrice: string;
};

type BybitInstrument = {
  symbol: string;
  status?: string;
  lotSizeFilter?: {
    qtyStep?: string;
    minOrderQty?: string;
  };
};

type BybitPosition = {
  symbol: string;
  size: string;
  side: "Buy" | "Sell" | "None";
  avgPrice?: string;
  positionValue?: string;
  leverage?: string;
};

type BybitClosedPnl = {
  symbol: string;
  orderId?: string;
  closedSize?: string;
  closedPnl?: string;
  openFee?: string;
  closeFee?: string;
  cumEntryFee?: string;
  cumExitFee?: string;
  updatedTime?: string;
};

type BybitInstrumentPage = {
  list?: BybitInstrument[];
  nextPageCursor?: string;
};

class BybitError extends Error {
  code: number | string;
  method: string;
  path: string;

  constructor(code: number | string, method: string, path: string, message: string) {
    super(`Bybit error (${code}) on ${method} ${path}: ${message}`);
    this.code = code;
    this.method = method;
    this.path = path;
  }
}

function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [key, String(value)]);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}

function signPayload(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export async function listLinearSymbols(baseUrl: string, options?: { status?: string; limit?: number }): Promise<string[]> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const limit = Math.min(1000, Math.max(1, Math.floor(options?.limit ?? 1000)));
  const statusFilter = options?.status?.trim();
  const symbols = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const params: Record<string, string | number | boolean | undefined | null> = {
      category: "linear",
      limit
    };
    if (statusFilter) {
      params.status = statusFilter;
    }
    if (cursor) {
      params.cursor = cursor;
    }
    const query = buildQuery(params);
    const url = `${cleanBase}/v5/market/instruments-info${query ? `?${query}` : ""}`;
    const res = await fetch(url);
    const data = (await res.json()) as BybitResponse<BybitInstrumentPage>;
    if (!res.ok || data.retCode !== 0) {
      const msg = data?.retMsg || `HTTP ${res.status}`;
      const code = typeof data?.retCode === "number" ? data.retCode : "unknown";
      throw new Error(`Bybit error (${code}) on GET /v5/market/instruments-info: ${msg}`);
    }
    const list = Array.isArray(data.result?.list) ? data.result.list : [];
    for (const item of list) {
      const symbol = String(item?.symbol ?? "").trim();
      if (!symbol) {
        continue;
      }
      if (statusFilter && item?.status && item.status !== statusFilter) {
        continue;
      }
      symbols.add(symbol);
    }
    const next = data.result?.nextPageCursor;
    cursor = next ? String(next) : null;
    if (!cursor) {
      break;
    }
  }
  return Array.from(symbols).sort();
}

export class BybitClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private recvWindow: number;

  constructor(config: BybitConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.recvWindow = Math.max(1, Math.floor(config.recvWindow));
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    params?: Record<string, string | number | boolean | undefined | null>
  ): Promise<T> {
    const timestamp = Date.now().toString();
    const recvWindow = String(this.recvWindow);
    let payload = "";
    let url = `${this.baseUrl}${path}`;

    if (method === "GET") {
      const query = params ? buildQuery(params) : "";
      payload = query;
      if (query) {
        url += `?${query}`;
      }
    } else {
      payload = params ? JSON.stringify(params) : "";
    }

    const signature = signPayload(this.apiSecret, `${timestamp}${this.apiKey}${recvWindow}${payload}`);
    const headers: Record<string, string> = {
      "X-BAPI-API-KEY": this.apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
      "X-BAPI-SIGN": signature,
      "X-BAPI-SIGN-TYPE": "2"
    };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? payload : undefined
    });
    const data = (await res.json()) as BybitResponse<T>;
    if (!res.ok || data.retCode !== 0) {
      const msg = data?.retMsg || `HTTP ${res.status}`;
      const code = typeof data?.retCode === "number" ? data.retCode : "unknown";
      throw new BybitError(code, method, path, msg);
    }
    return data.result;
  }

  async getTicker(symbol: string): Promise<{ lastPrice: number }> {
    const result = await this.request<{ list: BybitTicker[] }>("GET", "/v5/market/tickers", {
      category: "linear",
      symbol
    });
    const item = result.list?.[0];
    const lastPrice = Number(item?.lastPrice ?? NaN);
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
      throw new Error(`Bybit ticker invalid for ${symbol}`);
    }
    return { lastPrice };
  }

  async getInstrumentInfo(symbol: string): Promise<{ qtyStep: number; minOrderQty: number }> {
    const result = await this.request<{ list: BybitInstrument[] }>("GET", "/v5/market/instruments-info", {
      category: "linear",
      symbol
    });
    const item = result.list?.[0];
    if (!item) {
      throw new Error(`Bybit instrument not found for ${symbol}`);
    }
    const qtyStep = Number(item?.lotSizeFilter?.qtyStep ?? NaN);
    const minOrderQty = Number(item?.lotSizeFilter?.minOrderQty ?? NaN);
    return {
      qtyStep: Number.isFinite(qtyStep) && qtyStep > 0 ? qtyStep : 0,
      minOrderQty: Number.isFinite(minOrderQty) && minOrderQty > 0 ? minOrderQty : 0
    };
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    try {
      await this.request("POST", "/v5/position/set-leverage", {
        category: "linear",
        symbol,
        buyLeverage: String(leverage),
        sellLeverage: String(leverage)
      });
    } catch (err) {
      if (err instanceof BybitError) {
        if (err.code === 110043 || err.message.toLowerCase().includes("leverage not modified")) {
          return;
        }
      }
      throw err;
    }
  }

  async placeOrder(options: {
    symbol: string;
    side: "Buy" | "Sell";
    qty: number;
    reduceOnly?: boolean;
  }): Promise<{ orderId: string | null }> {
    const result = await this.request<{ orderId?: string }>("POST", "/v5/order/create", {
      category: "linear",
      symbol: options.symbol,
      side: options.side,
      orderType: "Market",
      qty: String(options.qty),
      timeInForce: "IOC",
      reduceOnly: options.reduceOnly ?? false,
      positionIdx: 0
    });
    return { orderId: result.orderId ?? null };
  }

  async addMargin(symbol: string, marginUsd: number): Promise<void> {
    const raw = Number(marginUsd);
    if (!Number.isFinite(raw) || raw <= 0) {
      return;
    }
    const rounded = Math.floor(raw * 10_000) / 10_000;
    if (rounded <= 0) {
      return;
    }
    await this.request("POST", "/v5/position/add-margin", {
      category: "linear",
      symbol,
      margin: String(rounded),
      positionIdx: 0
    });
  }

  async getPosition(symbol: string): Promise<BybitPosition | null> {
    const result = await this.request<{ list: BybitPosition[] }>("GET", "/v5/position/list", {
      category: "linear",
      symbol
    });
    const item = result.list?.[0];
    return item ?? null;
  }

  async getClosedPnl(
    symbol: string,
    options?: { openedAfterMs?: number; closeAtMs?: number; closeQty?: number; orderId?: string }
  ): Promise<{ pnlUsd: number | null; updatedTime?: number; openFeeUsd?: number; closeFeeUsd?: number } | null> {
    const params: Record<string, string | number | boolean | undefined | null> = {
      category: "linear",
      symbol,
      limit: 100
    };
    if (options?.openedAfterMs != null && Number.isFinite(options.openedAfterMs)) {
      params.startTime = Math.max(0, Math.floor(options.openedAfterMs));
    }
    if (options?.closeAtMs != null && Number.isFinite(options.closeAtMs)) {
      params.endTime = Math.max(0, Math.floor(options.closeAtMs));
    }
    const result = await this.request<{ list: BybitClosedPnl[] }>("GET", "/v5/position/closed-pnl", params);
    const list = Array.isArray(result.list) ? result.list : [];
    if (list.length === 0) {
      return null;
    }
    const normalized = list
      .map((item) => {
        const openFeeRaw = item?.openFee ?? item?.cumEntryFee ?? null;
        const closeFeeRaw = item?.closeFee ?? item?.cumExitFee ?? null;
        return {
          orderId: item?.orderId ? String(item.orderId) : null,
          pnl: Number(item?.closedPnl ?? NaN),
          updatedTime: Number(item?.updatedTime ?? NaN),
          closedSize: Number(item?.closedSize ?? NaN),
          openFee: Number(openFeeRaw ?? NaN),
          closeFee: Number(closeFeeRaw ?? NaN)
        };
      })
      .filter((item) => Number.isFinite(item.updatedTime));
    if (!normalized.length) {
      return null;
    }
    if (options?.orderId) {
      const match = normalized.find((item) => item.orderId === options.orderId);
      if (match) {
        return {
          pnlUsd: Number.isFinite(match.pnl) ? match.pnl : null,
          updatedTime: match.updatedTime,
          openFeeUsd: Number.isFinite(match.openFee) ? match.openFee : undefined,
          closeFeeUsd: Number.isFinite(match.closeFee) ? match.closeFee : undefined
        };
      }
    }
    const closeAtMs = options?.closeAtMs;
    const closeQty = options?.closeQty;
    const score = (item: (typeof normalized)[number]) => {
      let scoreValue = 0;
      if (Number.isFinite(closeQty) && closeQty != null && closeQty > 0) {
        const sizeDiff = Math.abs(item.closedSize - closeQty);
        scoreValue += sizeDiff / closeQty;
      }
      if (Number.isFinite(closeAtMs ?? NaN)) {
        scoreValue += Math.abs(item.updatedTime - (closeAtMs ?? 0)) / (60 * 1000);
      }
      return scoreValue;
    };
    const candidates = normalized.slice().sort((a, b) => score(a) - score(b));
    const selected = candidates[0];
    return {
      pnlUsd: Number.isFinite(selected.pnl) ? selected.pnl : null,
      updatedTime: selected.updatedTime,
      openFeeUsd: Number.isFinite(selected.openFee) ? selected.openFee : undefined,
      closeFeeUsd: Number.isFinite(selected.closeFee) ? selected.closeFee : undefined
    };
  }
}
