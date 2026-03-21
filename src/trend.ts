export type TrendTimeframe = "1m" | "5m" | "30m" | "1h";
export type TrendDirection = "up" | "down";
export type TrendTarget = "sol" | "other" | "tokenA" | "tokenB";
export type TrendFallback = "manual" | "neutral" | "last";

export type TrendSnapshot = {
  direction: TrendDirection | null;
  updatedAt: string | null;
  timeframe: TrendTimeframe;
  lastCandleAt: number | null;
  stale: boolean;
  error?: string;
};

type Candle = {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type TrendParams = {
  len: number;
  basisType: "EMA" | "ALMA";
  almaOffset: number;
  almaSigma: number;
  basisSmooth: number;
  mfLen: number;
  mfSmooth: number;
  mfPower: number;
  atrLen: number;
  minMult: number;
  maxMult: number;
};

const DEFAULT_PARAMS: TrendParams = {
  len: 34,
  basisType: "EMA",
  almaOffset: 0.85,
  almaSigma: 6.0,
  basisSmooth: 3,
  mfLen: 24,
  mfSmooth: 5,
  mfPower: 1.2,
  atrLen: 14,
  minMult: 0.9,
  maxMult: 2.2
};

const BASE_URL = "https://api.geckoterminal.com/api/v2";

type TrendCacheEntry = {
  fetchedAt: number;
  result: TrendSnapshot | null;
  inFlight?: Promise<TrendSnapshot | null>;
};

const trendCache = new Map<string, TrendCacheEntry>();

export function timeframeToSeconds(timeframe: TrendTimeframe): number {
  switch (timeframe) {
    case "1m":
      return 60;
    case "5m":
      return 300;
    case "30m":
      return 1800;
    case "1h":
      return 3600;
    default:
      return 60;
  }
}

function timeframeToApi(timeframe: TrendTimeframe): { path: "minute" | "hour"; aggregate: number; seconds: number } {
  switch (timeframe) {
    case "1m":
      return { path: "minute", aggregate: 1, seconds: 60 };
    case "5m":
      return { path: "minute", aggregate: 5, seconds: 300 };
    case "30m":
      return { path: "minute", aggregate: 30, seconds: 1800 };
    case "1h":
      return { path: "hour", aggregate: 1, seconds: 3600 };
    default:
      return { path: "minute", aggregate: 1, seconds: 60 };
  }
}

export async function fetchOhlcv(
  networkId: string,
  poolAddress: string,
  timeframe: TrendTimeframe
): Promise<Candle[]> {
  const { path, aggregate } = timeframeToApi(timeframe);
  const url = `${BASE_URL}/networks/${networkId}/pools/${poolAddress}/ohlcv/${path}?aggregate=${aggregate}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`trend fetch failed (${res.status})`);
  }
  const data = await res.json().catch(() => null);
  const list = data?.data?.attributes?.ohlcv_list ?? data?.data?.attributes?.ohlcv ?? null;
  return parseOhlcvList(list);
}

function normalizeTimestamp(raw: number): number {
  if (!Number.isFinite(raw)) {
    return Number.NaN;
  }
  if (raw < 1_000_000_000_000) {
    return raw * 1000;
  }
  return raw;
}

function isValidOhlc(open: number, high: number, low: number, close: number): boolean {
  if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
    return false;
  }
  if (high < Math.max(open, close, low)) {
    return false;
  }
  if (low > Math.min(open, close, high)) {
    return false;
  }
  return true;
}

function detectOhlcvOrder(rows: unknown[]): "ohlc" | "oclh" {
  let scoreOhlc = 0;
  let scoreOclh = 0;
  const sample = rows.slice(0, 20);
  for (const row of sample) {
    if (!Array.isArray(row) || row.length < 6) {
      continue;
    }
    const o = Number(row[1]);
    const h = Number(row[2]);
    const l = Number(row[3]);
    const c = Number(row[4]);
    if (isValidOhlc(o, h, l, c)) {
      scoreOhlc += 1;
    }
    const c2 = Number(row[2]);
    const h2 = Number(row[3]);
    const l2 = Number(row[4]);
    if (isValidOhlc(o, h2, l2, c2)) {
      scoreOclh += 1;
    }
  }
  if (scoreOclh > scoreOhlc) {
    return "oclh";
  }
  return "ohlc";
}

export function parseOhlcvList(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const order = detectOhlcvOrder(raw);
  const parsed: Candle[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) {
      continue;
    }
    const timestamp = normalizeTimestamp(Number(row[0]));
    const open = Number(row[1]);
    const volume = Number(row[5]);
    let high = Number.NaN;
    let low = Number.NaN;
    let close = Number.NaN;
    if (order === "ohlc") {
      high = Number(row[2]);
      low = Number(row[3]);
      close = Number(row[4]);
    } else {
      close = Number(row[2]);
      high = Number(row[3]);
      low = Number(row[4]);
    }
    if (!isValidOhlc(open, high, low, close) || !Number.isFinite(timestamp)) {
      continue;
    }
    parsed.push({
      t: timestamp,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0
    });
  }
  parsed.sort((a, b) => a.t - b.t);
  return parsed;
}

function emaSeries(values: number[], length: number): number[] {
  const result: number[] = [];
  if (length <= 1) {
    return values.map((value) => (Number.isFinite(value) ? value : Number.NaN));
  }
  const k = 2 / (length + 1);
  let prev: number | null = null;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      result.push(Number.NaN);
      continue;
    }
    if (prev === null) {
      prev = value;
    } else {
      prev = value * k + prev * (1 - k);
    }
    result.push(prev);
  }
  return result;
}

function almaSeries(values: number[], length: number, offset: number, sigma: number): number[] {
  const result: number[] = [];
  if (length <= 1) {
    return values.map((value) => (Number.isFinite(value) ? value : Number.NaN));
  }
  const m = offset * (length - 1);
  const s = length / sigma;
  const weights = Array.from({ length }, (_, i) => Math.exp(-((i - m) ** 2) / (2 * s * s)));
  const weightSum = weights.reduce((acc, w) => acc + w, 0);
  for (let i = 0; i < values.length; i += 1) {
    if (i < length - 1) {
      result.push(Number.NaN);
      continue;
    }
    let sum = 0;
    let ok = true;
    for (let j = 0; j < length; j += 1) {
      const v = values[i - length + 1 + j];
      if (!Number.isFinite(v)) {
        ok = false;
        break;
      }
      sum += v * weights[j];
    }
    if (!ok || !Number.isFinite(weightSum)) {
      result.push(Number.NaN);
      continue;
    }
    result.push(sum / weightSum);
  }
  return result;
}

function atrSeries(highs: number[], lows: number[], closes: number[], length: number): number[] {
  const result: number[] = [];
  let prevAtr: number | null = null;
  for (let i = 0; i < highs.length; i += 1) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = i > 0 ? closes[i - 1] : Number.NaN;
    if (!Number.isFinite(high) || !Number.isFinite(low)) {
      result.push(Number.NaN);
      continue;
    }
    const tr = Number.isFinite(prevClose)
      ? Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
      : (high - low);
    if (!Number.isFinite(tr)) {
      result.push(Number.NaN);
      continue;
    }
    if (prevAtr === null) {
      prevAtr = tr;
    } else if (i < length) {
      prevAtr = (prevAtr * i + tr) / (i + 1);
    } else {
      prevAtr = (prevAtr * (length - 1) + tr) / length;
    }
    result.push(prevAtr);
  }
  return result;
}

function basisFrom(
  values: number[],
  params: TrendParams
): number[] {
  const base = params.basisType === "ALMA"
    ? almaSeries(values, params.len, params.almaOffset, params.almaSigma)
    : emaSeries(values, params.len);
  if (params.basisSmooth <= 1) {
    return base;
  }
  return emaSeries(base, params.basisSmooth);
}

export function computeBOSWavesDirection(
  candles: Candle[],
  params?: Partial<TrendParams>
): TrendDirection | null {
  const settings: TrendParams = { ...DEFAULT_PARAMS, ...(params ?? {}) };
  const minBars = Math.max(settings.len, settings.mfLen, settings.atrLen) + 5;
  if (!Array.isArray(candles) || candles.length < minBars) {
    return null;
  }
  const opens = candles.map((c) => c.open);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const basisOpen = basisFrom(opens, settings);
  const basisClose = basisFrom(closes, settings);
  const basisMain = basisClose;
  const atr = atrSeries(highs, lows, closes, settings.atrLen);

  const raw: number[] = [];
  const mf: number[] = [];
  let sum = 0;
  let sumAbs = 0;
  for (let i = 0; i < closes.length; i += 1) {
    const high = highs[i];
    const low = lows[i];
    const close = closes[i];
    const volume = volumes[i];
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || !Number.isFinite(volume)) {
      raw.push(Number.NaN);
      mf.push(Number.NaN);
      continue;
    }
    const clv = high === low ? 0 : ((close - low) - (high - close)) / (high - low);
    const currentRaw = clv * volume;
    raw.push(currentRaw);
    sum += currentRaw;
    sumAbs += Math.abs(currentRaw);
    if (i >= settings.mfLen) {
      const drop = raw[i - settings.mfLen];
      if (Number.isFinite(drop)) {
        sum -= drop;
        sumAbs -= Math.abs(drop);
      }
    }
    if (i < settings.mfLen - 1 || !Number.isFinite(sumAbs) || sumAbs === 0) {
      mf.push(Number.NaN);
    } else {
      mf.push(sum / sumAbs);
    }
  }

  const mfSm = settings.mfSmooth > 1 ? emaSeries(mf, settings.mfSmooth) : mf;
  const upperBand: number[] = [];
  const lowerBand: number[] = [];
  for (let i = 0; i < closes.length; i += 1) {
    const basis = basisMain[i];
    const atrValue = atr[i];
    const mfValue = mfSm[i];
    if (!Number.isFinite(basis) || !Number.isFinite(atrValue) || !Number.isFinite(mfValue)) {
      upperBand.push(Number.NaN);
      lowerBand.push(Number.NaN);
      continue;
    }
    const strengthRaw = Math.pow(Math.abs(mfValue), settings.mfPower);
    const strength = Math.max(0, Math.min(1, strengthRaw));
    const mult = settings.minMult + (settings.maxMult - settings.minMult) * strength;
    upperBand.push(basis + atrValue * mult);
    lowerBand.push(basis - atrValue * mult);
  }

  let lastSignal: number | null = null;
  let prevClose: number | null = null;
  let prevUpper: number | null = null;
  let prevLower: number | null = null;

  for (let i = 0; i < closes.length; i += 1) {
    const close = closes[i];
    const basis = basisMain[i];
    const upper = upperBand[i];
    const lower = lowerBand[i];

    if (lastSignal === null && Number.isFinite(close) && Number.isFinite(basis)) {
      lastSignal = close >= basis ? 1 : -1;
    }

    if (
      Number.isFinite(close)
      && Number.isFinite(upper)
      && Number.isFinite(lower)
      && prevClose !== null
      && prevUpper !== null
      && prevLower !== null
    ) {
      const longCond = prevClose <= prevUpper && close > upper;
      const shortCond = prevClose >= prevLower && close < lower;
      if (longCond) {
        lastSignal = 1;
      } else if (shortCond) {
        lastSignal = -1;
      }
    }

    if (Number.isFinite(close)) {
      prevClose = close;
    }
    if (Number.isFinite(upper)) {
      prevUpper = upper;
    }
    if (Number.isFinite(lower)) {
      prevLower = lower;
    }
  }

  if (lastSignal === 1) {
    return "up";
  }
  if (lastSignal === -1) {
    return "down";
  }
  return null;
}

export async function getTrendSnapshot(options: {
  networkId: string;
  poolAddress: string;
  timeframe: TrendTimeframe;
  staleSec: number;
}): Promise<TrendSnapshot | null> {
  const { networkId, poolAddress, timeframe, staleSec } = options;
  if (!networkId || !poolAddress) {
    return null;
  }
  const key = `${networkId}:${poolAddress}:${timeframe}`;
  const now = Date.now();
  const ttlMs = timeframeToSeconds(timeframe) * 1000;
  const existing = trendCache.get(key);
  if (existing?.inFlight) {
    return existing.inFlight;
  }
  if (existing && now - existing.fetchedAt < ttlMs) {
    return existing.result;
  }

  const fetchPromise = (async (): Promise<TrendSnapshot | null> => {
    try {
      const candles = await fetchOhlcv(networkId, poolAddress, timeframe);
      if (!candles.length) {
        return {
          direction: null,
          updatedAt: null,
          timeframe,
          lastCandleAt: null,
          stale: true
        };
      }
      const lastCandleAt = candles[candles.length - 1]?.t ?? null;
      const updatedAt = lastCandleAt ? new Date(lastCandleAt).toISOString() : null;
      const stale = lastCandleAt ? (now - lastCandleAt > staleSec * 1000) : true;
      const direction = stale ? null : computeBOSWavesDirection(candles);
      return {
        direction,
        updatedAt,
        timeframe,
        lastCandleAt,
        stale
      };
    } catch (err) {
      const previous = existing?.result ?? null;
      const error = err instanceof Error ? err.message : String(err);
      if (previous) {
        return { ...previous, stale: true, error };
      }
      return {
        direction: null,
        updatedAt: null,
        timeframe,
        lastCandleAt: null,
        stale: true,
        error
      };
    }
  })();

  trendCache.set(key, { fetchedAt: now, result: existing?.result ?? null, inFlight: fetchPromise });
  const result = await fetchPromise;
  trendCache.set(key, { fetchedAt: Date.now(), result });
  return result;
}

