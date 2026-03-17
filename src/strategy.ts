export type Range = {
  lower: number;
  upper: number;
};

export function calculateRange(price: number, rangeWidthPct: number): Range {
  const width = rangeWidthPct / 100;
  const lower = price * (1 - width);
  const upper = price * (1 + width);
  return { lower, upper };
}

export function isPriceOutOfRange(price: number, range: Range): boolean {
  return price < range.lower || price > range.upper;
}
