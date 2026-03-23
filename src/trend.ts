export type TrendTimeframe = "1m" | "5m" | "15m" | "30m" | "1h";
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

export type TrendSeries = {
  candles: Candle[];
  basis: number[];
  basisOpen: number[];
  basisClose: number[];
  upper: number[];
  lower: number[];
  signal: Array<TrendDirection | null>;
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

type TrendCacheEntry<T> = {
  fetchedAt: number;
  result: T | null;
  inFlight?: Promise<T | null>;
};

const trendCache = new Map<string, TrendCacheEntry<TrendSnapshot>>();
const trendSeriesCache = new Map<string, TrendCacheEntry<TrendSeries>>();

export function timeframeToSeconds(timeframe: TrendTimeframe): number {
  switch (timeframe) {
    case "1m":
      return 60;
    case "5m":
      return 300;
    case "15m":
      return 900;
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
    case "15m":
      return { path: "minute", aggregate: 15, seconds: 900 };
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
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
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

function smaSeries(values: number[], length: number): number[] {
  const result: number[] = [];
  if (length <= 1) {
    return values.map((value) => (Number.isFinite(value) ? value : Number.NaN));
  }
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
    if (i >= length) {
      const drop = values[i - length];
      if (Number.isFinite(drop)) {
        sum -= drop;
        count -= 1;
      }
    }
    if (i < length - 1 || count < length) {
      result.push(Number.NaN);
    } else {
      result.push(sum / length);
    }
  }
  return result;
}

function emaSeries(values: number[], length: number): number[] {
  const result: number[] = [];
  if (length <= 1) {
    return values.map((value) => (Number.isFinite(value) ? value : Number.NaN));
  }
  const k = 2 / (length + 1);
  const sma = smaSeries(values, length);
  let prev: number | null = null;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      result.push(Number.NaN);
      continue;
    }
    if (prev === null) {
      const seed = sma[result.length];
      if (Number.isFinite(seed)) {
        prev = seed;
        result.push(prev);
        continue;
      }
      result.push(Number.NaN);
      continue;
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

function rmaSeries(values: number[], length: number): number[] {
  const result: number[] = [];
  if (length <= 1) {
    return values.map((value) => (Number.isFinite(value) ? value : Number.NaN));
  }
  let prev: number | null = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) {
      result.push(Number.NaN);
      continue;
    }
    if (prev === null) {
      const seed = smaSeries(values.slice(0, i + 1), length).at(-1);
      if (Number.isFinite(seed ?? NaN)) {
        prev = seed as number;
        result.push(prev);
        continue;
      }
      result.push(Number.NaN);
      continue;
    }
    prev = (prev * (length - 1) + value) / length;
    result.push(prev);
  }
  return result;
}

function atrSeries(highs: number[], lows: number[], closes: number[], length: number): number[] {
  const result: number[] = [];
  const trValues: number[] = [];
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
    trValues.push(tr);
  }
  const rma = rmaSeries(trValues, length);
  for (const value of rma) {
    result.push(value);
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

function filterClosedCandles(candles: Candle[], timeframe: TrendTimeframe): Candle[] {
  if (!Array.isArray(candles) || candles.length === 0) {
    return [];
  }
  const tfMs = timeframeToSeconds(timeframe) * 1000;
  const last = candles[candles.length - 1];
  if (!last || !Number.isFinite(last.t)) {
    return candles;
  }
  const now = Date.now();
  const age = now - last.t;
  if (!Number.isFinite(age) || age < 0) {
    return candles.slice(0, -1);
  }
  // If the latest candle is very recent, treat it as in-progress and drop it.
  // This reduces false flips while still allowing near-real-time updates.
  if (age < tfMs * 0.2) {
    return candles.slice(0, -1);
  }
  return candles;
}

export function computeBOSWavesDirection(
  candles: Candle[],
  params?: Partial<TrendParams>
): TrendDirection | null {
  const series = computeBOSWavesSeries(candles, params);
  return series.direction;
}

export function computeBOSWavesSeries(
  candles: Candle[],
  params?: Partial<TrendParams>
): {
  basis: number[];
  basisOpen: number[];
  basisClose: number[];
  upper: number[];
  lower: number[];
  signal: Array<TrendDirection | null>;
  direction: TrendDirection | null;
} {
  const settings: TrendParams = { ...DEFAULT_PARAMS, ...(params ?? {}) };
  const minBars = Math.max(settings.len, settings.mfLen, settings.atrLen) + 5;
  if (!Array.isArray(candles) || candles.length < minBars) {
    return {
      basis: [],
      basisOpen: [],
      basisClose: [],
      upper: [],
      lower: [],
      signal: [],
      direction: null
    };
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
    if (i < settings.mfLen - 1 || !Number.isFinite(sumAbs)) {
      mf.push(Number.NaN);
    } else if (sumAbs === 0) {
      mf.push(0);
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
  const signalSeries: Array<TrendDirection | null> = [];

  for (let i = 0; i < closes.length; i += 1) {
    const close = closes[i];
    const basis = basisMain[i];
    const upper = upperBand[i];
    const lower = lowerBand[i];
    const prevClose = i > 0 ? closes[i - 1] : Number.NaN;
    const prevUpper = i > 0 ? upperBand[i - 1] : Number.NaN;
    const prevLower = i > 0 ? lowerBand[i - 1] : Number.NaN;
    const closeOk = Number.isFinite(close);
    const upperOk = Number.isFinite(upper);
    const lowerOk = Number.isFinite(lower);
    const basisOk = Number.isFinite(basis);
    const prevCloseOk = Number.isFinite(prevClose);
    const prevUpperOk = Number.isFinite(prevUpper);
    const prevLowerOk = Number.isFinite(prevLower);

    const longCond = closeOk
      && upperOk
      && prevCloseOk
      && prevUpperOk
      && prevClose <= prevUpper
      && close > upper;
    const shortCond = closeOk
      && lowerOk
      && prevCloseOk
      && prevLowerOk
      && prevClose >= prevLower
      && close < lower;

    let prevLS: number | null = lastSignal;
    if (prevLS === null) {
      if (closeOk && basisOk) {
        prevLS = close >= basis ? 1 : -1;
      } else {
        prevLS = null;
      }
    }

    if (longCond) {
      lastSignal = 1;
    } else if (shortCond) {
      lastSignal = -1;
    } else {
      lastSignal = prevLS;
    }

    if (lastSignal === 1) {
      signalSeries.push("up");
    } else if (lastSignal === -1) {
      signalSeries.push("down");
    } else {
      signalSeries.push(null);
    }
  }

  let direction: TrendDirection | null = null;
  if (lastSignal === 1) {
    direction = "up";
  } else if (lastSignal === -1) {
    direction = "down";
  }

  return {
    basis: basisMain,
    basisOpen,
    basisClose,
    upper: upperBand,
    lower: lowerBand,
    signal: signalSeries,
    direction
  };
}

export async function getTrendSnapshot(options: {
  networkId: string;
  poolAddress: string;
  timeframe: TrendTimeframe;
  staleSec: number;
  cacheSec?: number | null;
}): Promise<TrendSnapshot | null> {
  const { networkId, poolAddress, timeframe, staleSec, cacheSec } = options;
  if (!networkId || !poolAddress) {
    return null;
  }
  const key = `${networkId}:${poolAddress}:${timeframe}`;
  const now = Date.now();
  const cacheSeconds = Number.isFinite(cacheSec ?? NaN) ? Math.max(0, Number(cacheSec)) : timeframeToSeconds(timeframe);
  const ttlMs = cacheSeconds * 1000;
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
      const closed = filterClosedCandles(candles, timeframe);
      if (!closed.length) {
        return {
          direction: null,
          updatedAt: null,
          timeframe,
          lastCandleAt: null,
          stale: true
        };
      }
      const lastCandleAt = closed[closed.length - 1]?.t ?? null;
      const updatedAt = lastCandleAt ? new Date(lastCandleAt).toISOString() : null;
      const stale = lastCandleAt ? (now - lastCandleAt > staleSec * 1000) : true;
      const direction = stale ? null : computeBOSWavesDirection(closed);
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

export async function getTrendSeries(options: {
  networkId: string;
  poolAddress: string;
  timeframe: TrendTimeframe;
  staleSec: number;
  cacheSec?: number | null;
  bypassCache?: boolean;
  limit?: number;
}): Promise<TrendSeries | null> {
  const { networkId, poolAddress, timeframe, staleSec, cacheSec, limit, bypassCache } = options;
  if (!networkId || !poolAddress) {
    return null;
  }
  const key = `${networkId}:${poolAddress}:${timeframe}:series`;
  const now = Date.now();
  const cacheSeconds = Number.isFinite(cacheSec ?? NaN) ? Math.max(0, Number(cacheSec)) : timeframeToSeconds(timeframe);
  const ttlMs = cacheSeconds * 1000;
  const existing = trendSeriesCache.get(key);
  if (!bypassCache) {
    if (existing?.inFlight) {
      return existing.inFlight as Promise<TrendSeries | null>;
    }
    if (existing && now - existing.fetchedAt < ttlMs) {
      return existing.result as TrendSeries | null;
    }
  }

  const fetchPromise = (async (): Promise<TrendSeries | null> => {
    try {
      const allCandles = await fetchOhlcv(networkId, poolAddress, timeframe);
      const closedAll = filterClosedCandles(allCandles, timeframe);
      const candles = Number.isFinite(limit ?? NaN) && (limit ?? 0) > 0
        ? closedAll.slice(-Number(limit))
        : closedAll;
      if (!candles.length) {
        return {
          candles: [],
          basis: [],
          basisOpen: [],
        basisClose: [],
        upper: [],
        lower: [],
        signal: [],
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
      const series = computeBOSWavesSeries(candles);
      return {
        candles,
        basis: series.basis,
        basisOpen: series.basisOpen,
        basisClose: series.basisClose,
        upper: series.upper,
        lower: series.lower,
        signal: series.signal,
        direction: stale ? null : series.direction,
        updatedAt,
        timeframe,
        lastCandleAt,
        stale
      };
    } catch (err) {
      const previous = (existing?.result as TrendSeries | null) ?? null;
      const error = err instanceof Error ? err.message : String(err);
      if (previous) {
        return { ...previous, stale: true, error };
      }
      return {
        candles: [],
        basis: [],
        basisOpen: [],
        basisClose: [],
        upper: [],
        lower: [],
        signal: [],
        direction: null,
        updatedAt: null,
        timeframe,
        lastCandleAt: null,
        stale: true,
        error
      };
    }
  })();

  trendSeriesCache.set(key, { fetchedAt: now, result: existing?.result ?? null, inFlight: fetchPromise });
  const result = await fetchPromise;
  trendSeriesCache.set(key, { fetchedAt: Date.now(), result });
  return result;
}
