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
};

type BybitClosedPnl = {
  symbol: string;
  closedPnl?: string;
  updatedTime?: string;
};

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
      throw new Error(`Bybit error (${code}) on ${method} ${path}: ${msg}`);
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
    await this.request("POST", "/v5/position/set-leverage", {
      category: "linear",
      symbol,
      buyLeverage: String(leverage),
      sellLeverage: String(leverage)
    });
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

  async getPosition(symbol: string): Promise<BybitPosition | null> {
    const result = await this.request<{ list: BybitPosition[] }>("GET", "/v5/position/list", {
      category: "linear",
      symbol
    });
    const item = result.list?.[0];
    return item ?? null;
  }

  async getClosedPnl(symbol: string, openedAfterMs?: number): Promise<{ pnlUsd: number | null; updatedTime?: number } | null> {
    const result = await this.request<{ list: BybitClosedPnl[] }>("GET", "/v5/position/closed-pnl", {
      category: "linear",
      symbol,
      limit: 20
    });
    const list = Array.isArray(result.list) ? result.list : [];
    if (list.length === 0) {
      return null;
    }
    const normalized = list
      .map((item) => ({
        pnl: Number(item?.closedPnl ?? NaN),
        updatedTime: Number(item?.updatedTime ?? NaN)
      }))
      .filter((item) => Number.isFinite(item.updatedTime));
    let selected = normalized[0] ?? null;
    if (openedAfterMs != null && Number.isFinite(openedAfterMs)) {
      const match = normalized.find((item) => item.updatedTime >= openedAfterMs);
      if (match) {
        selected = match;
      }
    }
    if (!selected) {
      return null;
    }
    return {
      pnlUsd: Number.isFinite(selected.pnl) ? selected.pnl : null,
      updatedTime: selected.updatedTime
    };
  }
}
