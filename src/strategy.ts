export type Range = {
  lower: number;
  upper: number;
};

export type ExitSide = "lower" | "upper";
export type ValueToken = "tokenA" | "tokenB";
export type PreferredExitDirection = "down" | "up";

export type RangeOptions = {
  exitBiasPct?: number;
  exitSide?: ExitSide;
  valueToken?: ValueToken;
};

export type ExitPreference = {
  exitSide: ExitSide;
  valueToken: ValueToken;
};

export function resolveDirectionalExitPreference(
  preferredExitToken: ValueToken | null,
  preferredExitDirection: PreferredExitDirection = "down"
): ExitPreference | null {
  if (!preferredExitToken) {
    return null;
  }
  if (preferredExitDirection === "up") {
    return preferredExitToken === "tokenA"
      ? { exitSide: "upper", valueToken: "tokenA" }
      : { exitSide: "lower", valueToken: "tokenB" };
  }
  return preferredExitToken === "tokenA"
    ? { exitSide: "lower", valueToken: "tokenA" }
    : { exitSide: "upper", valueToken: "tokenB" };
}

export function calculateRange(
  price: number,
  rangeWidthPct: number,
  options?: RangeOptions
): Range {
  const width = rangeWidthPct / 100;
  const biasPct = Number(options?.exitBiasPct ?? 0);
  const bias = Number.isFinite(biasPct)
    ? Math.max(0, Math.min(0.999, biasPct / 100))
    : 0;
  const exitSide = options?.exitSide;
  const legacyValueToken = exitSide === "upper"
    ? "tokenB"
    : exitSide === "lower"
      ? "tokenA"
      : undefined;
  const valueToken = options?.valueToken ?? legacyValueToken;

  const symmetric = {
    lower: price * (1 - width),
    upper: price * (1 + width)
  };

  if (!Number.isFinite(price) || price <= 0) {
    return symmetric;
  }

  if (exitSide === "upper") {
    const upper = symmetric.upper;
    const lower = solveLowerByPnl(price, upper, bias, valueToken ?? "tokenB");
    if (lower != null && lower > 0 && lower < price) {
      return { lower, upper };
    }
    const fallbackLower = directionalFallbackLower(price, width, bias);
    if (fallbackLower > 0 && fallbackLower < price) {
      return { lower: fallbackLower, upper };
    }
    return symmetric;
  }

  if (exitSide === "lower") {
    const lower = symmetric.lower;
    const upper = solveUpperByPnl(price, lower, bias, width, valueToken ?? "tokenA");
    if (upper != null && upper > price) {
      return { lower, upper };
    }
    const fallbackUpper = directionalFallbackUpper(price, width, bias);
    if (fallbackUpper > price) {
      return { lower, upper: fallbackUpper };
    }
    return symmetric;
  }

  return symmetric;
}

function directionalFallbackLower(price: number, width: number, bias: number): number {
  const sideWidth = width * Math.max(1 - bias, 0.001);
  return price * (1 - sideWidth);
}

function directionalFallbackUpper(price: number, width: number, bias: number): number {
  const sideWidth = width * Math.max(1 - bias, 0.001);
  return price * (1 + sideWidth);
}

export function isPriceOutOfRange(price: number, range: Range): boolean {
  return price < range.lower || price > range.upper;
}

type RangeValues = {
  currentA: number;
  currentB: number;
  upperA: number;
  upperB: number;
  lowerA: number;
  lowerB: number;
};

function computeRangeValues(price: number, lower: number, upper: number): RangeValues | null {
  if (!Number.isFinite(price) || !Number.isFinite(lower) || !Number.isFinite(upper)) {
    return null;
  }
  if (price <= 0 || lower <= 0 || upper <= 0) {
    return null;
  }
  if (lower >= price || upper <= price || lower >= upper) {
    return null;
  }

  const s = Math.sqrt(price);
  const sa = Math.sqrt(lower);
  const sb = Math.sqrt(upper);
  if (!Number.isFinite(s) || !Number.isFinite(sa) || !Number.isFinite(sb)) {
    return null;
  }

  const amount0 = (sb - s) / (s * sb); // tokenA
  const amount1 = s - sa; // tokenB
  const currentB = amount0 * price + amount1;
  const currentA = amount0 + amount1 / price;
  const upperB = sb - sa;
  const upperA = upperB / (sb * sb);
  const lowerA = (sb - sa) / (sa * sb);
  const lowerB = lowerA * sa * sa;
  if (!Number.isFinite(currentA) || !Number.isFinite(currentB)
    || !Number.isFinite(upperA) || !Number.isFinite(upperB)
    || !Number.isFinite(lowerA) || !Number.isFinite(lowerB)) {
    return null;
  }

  return { currentA, currentB, upperA, upperB, lowerA, lowerB };
}

function pnlSymmetryError(
  price: number,
  lower: number,
  upper: number,
  bias: number,
  valueToken: "tokenA" | "tokenB"
): number {
  const values = computeRangeValues(price, lower, upper);
  if (!values) {
    return Number.NaN;
  }
  const current = valueToken === "tokenA" ? values.currentA : values.currentB;
  const upperValue = valueToken === "tokenA" ? values.upperA : values.upperB;
  const lowerValue = valueToken === "tokenA" ? values.lowerA : values.lowerB;
  const pnlUp = upperValue - current;
  const pnlDown = current - lowerValue;
  const targetFactor = 1 - bias;
  return pnlDown - pnlUp * targetFactor;
}

function findBracket(
  f: (x: number) => number,
  low: number,
  high: number,
  steps = 48
): { low: number; high: number; fLow: number; fHigh: number } | null {
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= low) {
    return null;
  }
  let prevX = low;
  let prevF = f(prevX);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = low * Math.pow(high / low, t);
    const fx = f(x);
    if (!Number.isFinite(fx)) {
      continue;
    }
    if (Number.isFinite(prevF) && Math.sign(prevF) !== Math.sign(fx)) {
      return { low: prevX, high: x, fLow: prevF, fHigh: fx };
    }
    prevX = x;
    prevF = fx;
  }
  return null;
}

function solveBisection(
  f: (x: number) => number,
  low: number,
  high: number,
  maxIter = 80
): number | null {
  const bracket = findBracket(f, low, high);
  if (!bracket) {
    return null;
  }
  let { low: a, high: b, fLow: fa, fHigh: fb } = bracket;
  for (let i = 0; i < maxIter; i += 1) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (!Number.isFinite(fm)) {
      return null;
    }
    if (Math.abs(fm) < 1e-10) {
      return mid;
    }
    if (Math.sign(fa) === Math.sign(fm)) {
      a = mid;
      fa = fm;
    } else {
      b = mid;
      fb = fm;
    }
  }
  return (a + b) / 2;
}

function solveLowerByPnl(
  price: number,
  upper: number,
  bias: number,
  valueToken: "tokenA" | "tokenB"
): number | null {
  const minLower = price * 1e-9;
  const maxLower = price * (1 - 1e-9);
  const f = (lower: number) => pnlSymmetryError(price, lower, upper, bias, valueToken);
  return solveBisection(f, minLower, maxLower);
}

function solveUpperByPnl(
  price: number,
  lower: number,
  bias: number,
  width: number,
  valueToken: "tokenA" | "tokenB"
): number | null {
  const minUpper = price * (1 + 1e-9);
  let maxUpper = Math.max(price * (1 + width), minUpper * 1.0001);
  const f = (upper: number) => pnlSymmetryError(price, lower, upper, bias, valueToken);

  for (let i = 0; i < 20; i += 1) {
    const candidate = solveBisection(f, minUpper, maxUpper);
    if (candidate != null && candidate > price) {
      return candidate;
    }
    maxUpper *= 1.6;
    if (!Number.isFinite(maxUpper) || maxUpper / price > 1e6) {
      break;
    }
  }
  return null;
}
