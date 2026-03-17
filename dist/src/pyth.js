import { HermesClient } from "@pythnetwork/hermes-client";
const cache = {
    value: null,
    updatedAt: 0,
    feedId: null
};
const hermes = new HermesClient("https://hermes.pyth.network");
function normalizeFeedId(id) {
    const trimmed = id.trim();
    if (trimmed.startsWith("0x")) {
        return trimmed.toLowerCase();
    }
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return `0x${trimmed.toLowerCase()}`;
    }
    throw new Error("pythSolUsdFeedId must be a hex feed id (0x...) from Pyth, not a Solana address");
}
export async function getSolUsdPrice(_connection, feedId, staleMaxSec, cacheMs = 30000) {
    const now = Date.now();
    const normalized = normalizeFeedId(feedId);
    if (cache.value && cache.feedId === normalized && now - cache.updatedAt < cacheMs) {
        return cache.value;
    }
    const priceUpdates = await hermes.getLatestPriceUpdates([normalized]);
    const update = priceUpdates?.parsed?.[0];
    if (!update?.price) {
        throw new Error("Failed to fetch SOL/USD price from Hermes");
    }
    const priceValue = Number(update.price.price) * Math.pow(10, Number(update.price.expo));
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
        throw new Error("Invalid SOL/USD price from Hermes");
    }
    const publishTime = Number(update.price.publishTime ?? update.price.publish_time ?? update.publishTime ?? 0);
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
    return result;
}
