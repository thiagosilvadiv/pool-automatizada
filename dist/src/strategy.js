export function calculateRange(price, rangeWidthPct) {
    const width = rangeWidthPct / 100;
    const lower = price * (1 - width);
    const upper = price * (1 + width);
    return { lower, upper };
}
export function isPriceOutOfRange(price, range) {
    return price < range.lower || price > range.upper;
}
