import { BybitClient } from "./bybit.js";
import { logger } from "./logger.js";
import type { Config, HedgeEntryMode } from "./config.js";
import type { BotStatus } from "./orca.js";
import { getTrendSnapshot } from "./trend.js";

export type HedgeState = {
  active: boolean;
  symbol: string;
  qty: number;
  notionalUsd: number;
  leverage: number;
  openedAt: string;
  entryPrice: number;
  positionMint: string | null;
  openOrderId?: string | null;
};

export type HedgeCloseResult = {
  symbol: string;
  qty: number;
  notionalUsd: number;
  leverage: number;
  feesUsd: number | null;
  pnlUsd: number | null;
  closedAt: string;
};

export type HedgeOpenResult = {
  status: "opened" | "skipped" | "failed";
  error?: string;
  reason?: string;
};

const OPEN_COOLDOWN_MS = 60_000;

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function floorToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return value;
  }
  const factor = Math.floor(value / step);
  return Number((factor * step).toFixed(12));
}

export class HedgeManager {
  private config: Config;
  private client: BybitClient | null = null;
  private state: HedgeState | null = null;
  private lastOpenAttemptAt: number | null = null;
  private opening = false;
  private closing = false;
  private lastError: string | null = null;

  constructor(config: Config) {
    this.config = config;
    this.refreshClient();
  }

  updateConfig(config: Config): void {
    this.config = config;
    this.refreshClient();
  }

  hydrate(state: HedgeState | null | undefined): void {
    if (state && state.active && state.symbol && Number.isFinite(state.qty)) {
      this.state = {
        ...state,
        positionMint: state.positionMint ?? null
      };
    }
  }

  async syncFromBybit(): Promise<boolean> {
    if (this.state?.active) {
      return false;
    }
    if (!this.client) {
      return false;
    }
    const symbol = (this.config.hedgeSymbol ?? "").trim().toUpperCase();
    if (!symbol) {
      return false;
    }
    try {
      const position = await this.client.getPosition(symbol);
      const size = Number(position?.size ?? NaN);
      if (!Number.isFinite(size) || size <= 0) {
        return false;
      }
      if (position?.side !== "Sell") {
        return false;
      }
      const avgPrice = Number(position?.avgPrice ?? NaN);
      const positionValue = Number(position?.positionValue ?? NaN);
      const notionalUsd = Number.isFinite(positionValue) && positionValue > 0
        ? positionValue
        : Number.isFinite(avgPrice) && avgPrice > 0
          ? avgPrice * size
          : 0;
      const leverageRaw = Number(position?.leverage ?? NaN);
      const leverageFallback = clampNumber(Number(this.config.hedgeLeverage ?? 1), 1, 100);
      const leverage = Number.isFinite(leverageRaw) && leverageRaw > 0 ? leverageRaw : leverageFallback;
      this.state = {
        active: true,
        symbol,
        qty: size,
        notionalUsd,
        leverage,
        openedAt: new Date().toISOString(),
        entryPrice: Number.isFinite(avgPrice) ? avgPrice : 0,
        positionMint: null,
        openOrderId: null
      };
      this.setError(null);
      logger.info({ symbol, qty: size }, "hedge synced from bybit");
      return true;
    } catch (err) {
      logger.warn({ err }, "failed to sync hedge from bybit");
      return false;
    }
  }

  getState(): HedgeState | null {
    return this.state;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  private setError(message?: string | null): void {
    this.lastError = message ? String(message) : null;
  }

  private refreshClient(): void {
    const apiKey = (this.config.bybitApiKey ?? "").trim();
    const apiSecret = (this.config.bybitApiSecret ?? "").trim();
    if (!apiKey || !apiSecret) {
      this.client = null;
      return;
    }
    this.client = new BybitClient({
      apiKey,
      apiSecret,
      baseUrl: this.config.bybitBaseUrl,
      recvWindow: this.config.bybitRecvWindow
    });
  }

  private resolveBaseUsd(status: BotStatus): number | null {
    if (Number.isFinite(status.positionValueUsd ?? NaN) && (status.positionValueUsd ?? 0) > 0) {
      return Number(status.positionValueUsd);
    }
    if (Number.isFinite(this.config.budgetUsd ?? NaN) && (this.config.budgetUsd ?? 0) > 0) {
      return Number(this.config.budgetUsd);
    }
    return null;
  }

  async ensureOpen(status: BotStatus): Promise<HedgeOpenResult> {
    if (this.opening || this.closing) {
      return { status: "skipped" };
    }
    if (!this.config.hedgeEnabled) {
      this.setError(null);
      return { status: "skipped" };
    }
    if (this.state?.active) {
      return { status: "skipped" };
    }
    if (!status.positionMint) {
      return { status: "skipped" };
    }
    const now = Date.now();
    if (this.lastOpenAttemptAt && now - this.lastOpenAttemptAt < OPEN_COOLDOWN_MS) {
      return { status: "skipped" };
    }
    this.lastOpenAttemptAt = now;
    const symbol = (this.config.hedgeSymbol ?? "").trim().toUpperCase();
    if (!symbol) {
      const message = "hedgeSymbol ausente";
      logger.warn(message);
      this.setError(message);
      return { status: "failed", error: message };
    }
    const pct = Number(this.config.hedgePct ?? NaN);
    if (!Number.isFinite(pct) || pct <= 0) {
      const message = "hedgePct invalido";
      logger.warn({ hedgePct: this.config.hedgePct }, message);
      this.setError(message);
      return { status: "failed", error: message };
    }
    const leverage = clampNumber(Number(this.config.hedgeLeverage ?? 1), 1, 100);
    const marginPct = clampNumber(Number(this.config.hedgeMarginPct ?? 0), 0, 100);
    const baseUsd = this.resolveBaseUsd(status);
    if (!Number.isFinite(baseUsd ?? NaN) || (baseUsd ?? 0) <= 0) {
      const message = "Base USD indisponivel para hedge";
      logger.warn(message);
      this.setError(message);
      return { status: "failed", error: message };
    }

    const entryMode: HedgeEntryMode = this.config.hedgeEntryMode ?? "off";
    let openReason: string | null = null;
    if (entryMode === "trend-down" || entryMode === "trend-up" || entryMode === "trend-any") {
      if (!this.config.trendNetworkId || !this.config.trendNetworkId.trim()) {
        const message = "trendNetworkId ausente para hedgeEntryMode";
        logger.warn(message);
        this.setError(message);
        return { status: "failed", error: message };
      }
      try {
        const snapshot = await getTrendSnapshot({
          networkId: this.config.trendNetworkId,
          poolAddress: this.config.whirlpoolAddress,
          timeframe: this.config.trendTimeframe,
          staleSec: this.config.trendStaleSec,
          cacheSec: this.config.trendCacheSec
        });
        const direction = snapshot?.direction ?? null;
        const stale = snapshot?.stale ?? true;
        if (!direction || stale) {
          const reason = snapshot?.error
            ? `Tendência indisponível: ${snapshot.error}`
            : "Tendência indisponível";
          this.setError(null);
          return { status: "skipped", reason };
        }
        if (entryMode === "trend-down" && direction !== "down") {
          this.setError(null);
          return { status: "skipped", reason: "Ignorado: tendência alta" };
        }
        if (entryMode === "trend-up" && direction !== "up") {
          this.setError(null);
          return { status: "skipped", reason: "Ignorado: tendência baixa" };
        }
        if (entryMode === "trend-any" && direction !== "up" && direction !== "down") {
          this.setError(null);
          return { status: "skipped", reason: "Tendência indefinida" };
        }
        openReason = `Tendência ${direction === "down" ? "baixa" : "alta"} ${this.config.trendTimeframe ?? ""}`.trim();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, "failed to fetch hedge trend snapshot");
        this.setError(null);
        return { status: "skipped", reason: `Tendência indisponível: ${reason}` };
      }
    } else if (entryMode === "force-down") {
      openReason = "Modo sempre baixa";
    } else if (entryMode === "force-up") {
      openReason = "Modo sempre alta";
    } else if (entryMode === "off") {
      openReason = "Modo sempre";
    }

    if (!this.client) {
      const message = "Bybit nao configurado";
      logger.warn(message);
      this.setError(message);
      return { status: "failed", error: message };
    }
    this.opening = true;
    try {
      const [ticker, instrument] = await Promise.all([
        this.client.getTicker(symbol),
        this.client.getInstrumentInfo(symbol)
      ]);
      const notionalUsd = (baseUsd ?? 0) * (pct / 100);
      const rawQty = notionalUsd / ticker.lastPrice;
      const step = instrument.qtyStep;
      const minQty = instrument.minOrderQty;
      const qty = floorToStep(rawQty, step);
      if (!Number.isFinite(qty) || qty <= 0) {
        const message = "Quantidade do hedge invalida";
        logger.warn({ qty, rawQty, step }, message);
        this.setError(message);
        return { status: "failed", error: message };
      }
      if (minQty > 0 && qty < minQty) {
        const message = `Quantidade abaixo do minimo (${minQty})`;
        logger.warn({ qty, minQty }, message);
        this.setError(message);
        return { status: "failed", error: message };
      }
      await this.client.setLeverage(symbol, leverage);
      const openOrder = await this.client.placeOrder({ symbol, side: "Sell", qty, reduceOnly: false });
      const openedAt = new Date().toISOString();
      this.state = {
        active: true,
        symbol,
        qty,
        notionalUsd,
        leverage,
        openedAt,
        entryPrice: ticker.lastPrice,
        positionMint: status.positionMint ?? null,
        openOrderId: openOrder.orderId ?? null
      };
      this.setError(null);
      logger.info({ symbol, qty, notionalUsd, leverage }, "hedge opened");
      if (marginPct > 0 && this.client) {
        const marginUsd = (baseUsd ?? 0) * (marginPct / 100);
        if (Number.isFinite(marginUsd) && marginUsd > 0) {
          try {
            await this.client.addMargin(symbol, marginUsd);
            logger.info({ symbol, marginUsd }, "hedge margin added");
          } catch (err) {
            const message = err instanceof Error ? err.message : "Falha ao adicionar margem";
            logger.warn({ err }, "failed to add hedge margin");
            this.setError(message);
          }
        }
      }
      return { status: "opened", reason: openReason ?? undefined };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao abrir hedge";
      logger.warn({ err }, "failed to open hedge");
      this.setError(message);
      return { status: "failed", error: message };
    } finally {
      this.opening = false;
    }
  }

  async closeIfActive(): Promise<HedgeCloseResult | null> {
    if (this.closing || this.opening) {
      return null;
    }
    const state = this.state;
    if (!state?.active) {
      return null;
    }
    if (!this.client) {
      logger.warn("bybit client not configured");
      return null;
    }
    this.closing = true;
    try {
      let closeQty = state.qty;
      try {
        const position = await this.client.getPosition(state.symbol);
        const size = Number(position?.size ?? NaN);
        if (position?.side === "Buy") {
          const message = "Hedge esta comprado; abortando fechamento";
          logger.warn({ symbol: state.symbol }, message);
          this.setError(message);
          return null;
        }
        if (Number.isFinite(size) && size > 0) {
          closeQty = size;
        }
        if (Number.isFinite(size) && size <= 0) {
          this.state = null;
          return {
            symbol: state.symbol,
            qty: state.qty,
            notionalUsd: state.notionalUsd,
            leverage: state.leverage,
            feesUsd: null,
            pnlUsd: null,
            closedAt: new Date().toISOString()
          };
        }
      } catch (err) {
        logger.warn({ err }, "failed to read hedge position size");
      }
      const closeOrder = await this.client.placeOrder({ symbol: state.symbol, side: "Buy", qty: closeQty, reduceOnly: true });
      const openedAtMs = Date.parse(state.openedAt);
      const closeAtMs = Date.now();
      let pnlUsd: number | null = null;
      let feesUsd: number | null = null;
      let appliedFees = false;
      try {
        const closed = await this.client.getClosedPnl(state.symbol, {
          openedAfterMs: Number.isFinite(openedAtMs) ? openedAtMs : undefined,
          closeAtMs,
          closeQty,
          orderId: closeOrder.orderId ?? undefined
        });
        const closedPnl = closed?.pnlUsd ?? null;
        if (closedPnl != null && Number.isFinite(closedPnl)) {
          let feeTotal = 0;
          let hasFee = false;
          if (Number.isFinite(closed?.openFeeUsd ?? NaN)) {
            feeTotal += Number(closed?.openFeeUsd ?? 0);
            hasFee = true;
          }
          if (Number.isFinite(closed?.closeFeeUsd ?? NaN)) {
            feeTotal += Number(closed?.closeFeeUsd ?? 0);
            hasFee = true;
          }
          feesUsd = hasFee ? feeTotal : null;
          pnlUsd = closedPnl - (hasFee ? feeTotal : 0);
          appliedFees = hasFee;
        } else {
          pnlUsd = closedPnl;
        }
      } catch (err) {
        logger.warn({ err }, "failed to fetch closed pnl");
      }
      if (feesUsd == null) {
        try {
          let feeTotal = 0;
          let hasFee = false;
          if (state.openOrderId) {
            const openFee = await this.client.getExecutionFees(state.symbol, { orderId: state.openOrderId });
            if (openFee != null && Number.isFinite(openFee)) {
              feeTotal += openFee;
              hasFee = true;
            }
          }
          if (closeOrder.orderId) {
            const closeFee = await this.client.getExecutionFees(state.symbol, { orderId: closeOrder.orderId });
            if (closeFee != null && Number.isFinite(closeFee)) {
              feeTotal += closeFee;
              hasFee = true;
            }
          }
          if (hasFee) {
            feesUsd = feeTotal;
            if (pnlUsd != null && Number.isFinite(pnlUsd) && !appliedFees) {
              pnlUsd -= feeTotal;
              appliedFees = true;
            }
          }
        } catch (err) {
          logger.warn({ err }, "failed to fetch execution fees");
        }
      }
      if (pnlUsd == null) {
        try {
          const ticker = await this.client.getTicker(state.symbol);
          pnlUsd = (state.entryPrice - ticker.lastPrice) * state.qty;
        } catch (err) {
          logger.warn({ err }, "failed to estimate hedge pnl");
        }
      }
      if (pnlUsd != null && Number.isFinite(pnlUsd) && feesUsd != null && !appliedFees) {
        pnlUsd -= feesUsd;
        appliedFees = true;
      }
      const closedAt = new Date().toISOString();
      const result: HedgeCloseResult = {
        symbol: state.symbol,
        qty: closeQty,
        notionalUsd: state.notionalUsd,
        leverage: state.leverage,
        feesUsd,
        pnlUsd: pnlUsd != null && Number.isFinite(pnlUsd) ? pnlUsd : null,
        closedAt
      };
      this.state = null;
      this.setError(null);
      logger.info({ symbol: result.symbol, pnlUsd: result.pnlUsd }, "hedge closed");
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao fechar hedge";
      logger.warn({ err }, "failed to close hedge");
      this.setError(message);
      return null;
    } finally {
      this.closing = false;
    }
  }

  async closeIfOpen(options?: { expectedPositionMint?: string | null; allowUnowned?: boolean }): Promise<HedgeCloseResult | null> {
    const expectedPositionMint = options?.expectedPositionMint ?? null;
    const allowUnowned = options?.allowUnowned ?? false;
    if (this.state?.active) {
      if (!allowUnowned && expectedPositionMint) {
        if (!this.state.positionMint || this.state.positionMint !== expectedPositionMint) {
          return null;
        }
      }
      return this.closeIfActive();
    }
    if (!allowUnowned && expectedPositionMint) {
      return null;
    }
    const symbol = (this.config.hedgeSymbol ?? "").trim().toUpperCase();
    if (!symbol) {
      return null;
    }
    return this.closeBySymbolIfOpen(symbol);
  }

  private async closeBySymbolIfOpen(symbol: string): Promise<HedgeCloseResult | null> {
    if (this.closing || this.opening) {
      return null;
    }
    if (!this.client) {
      logger.warn("bybit client not configured");
      return null;
    }
    this.closing = true;
    try {
      const position = await this.client.getPosition(symbol);
      const size = Number(position?.size ?? NaN);
      if (!Number.isFinite(size) || size <= 0) {
        return null;
      }
      if (position?.side === "Buy") {
        const message = "Hedge esta comprado; abortando fechamento";
        logger.warn({ symbol }, message);
        this.setError(message);
        return null;
      }
      const closeOrder = await this.client.placeOrder({ symbol, side: "Buy", qty: size, reduceOnly: true });
      const closeAtMs = Date.now();
      let pnlUsd: number | null = null;
      let feesUsd: number | null = null;
      let appliedFees = false;
      try {
        const closed = await this.client.getClosedPnl(symbol, {
          closeAtMs,
          closeQty: size,
          orderId: closeOrder.orderId ?? undefined
        });
        const closedPnl = closed?.pnlUsd ?? null;
        if (closedPnl != null && Number.isFinite(closedPnl)) {
          let feeTotal = 0;
          let hasFee = false;
          if (Number.isFinite(closed?.openFeeUsd ?? NaN)) {
            feeTotal += Number(closed?.openFeeUsd ?? 0);
            hasFee = true;
          }
          if (Number.isFinite(closed?.closeFeeUsd ?? NaN)) {
            feeTotal += Number(closed?.closeFeeUsd ?? 0);
            hasFee = true;
          }
          feesUsd = hasFee ? feeTotal : null;
          pnlUsd = closedPnl - (hasFee ? feeTotal : 0);
          appliedFees = hasFee;
        } else {
          pnlUsd = closedPnl;
        }
      } catch (err) {
        logger.warn({ err }, "failed to fetch closed pnl");
      }
      if (feesUsd == null) {
        try {
          let feeTotal = 0;
          let hasFee = false;
          if (closeOrder.orderId) {
            const closeFee = await this.client.getExecutionFees(symbol, { orderId: closeOrder.orderId });
            if (closeFee != null && Number.isFinite(closeFee)) {
              feeTotal += closeFee;
              hasFee = true;
            }
          }
          if (hasFee) {
            feesUsd = feeTotal;
            if (pnlUsd != null && Number.isFinite(pnlUsd) && !appliedFees) {
              pnlUsd -= feeTotal;
              appliedFees = true;
            }
          }
        } catch (err) {
          logger.warn({ err }, "failed to fetch execution fees");
        }
      }
      if (pnlUsd == null) {
        try {
          const ticker = await this.client.getTicker(symbol);
          const avgPrice = Number(position?.avgPrice ?? NaN);
          if (Number.isFinite(avgPrice)) {
            pnlUsd = (avgPrice - ticker.lastPrice) * size;
          }
        } catch (err) {
          logger.warn({ err }, "failed to estimate hedge pnl");
        }
      }
      if (pnlUsd != null && Number.isFinite(pnlUsd) && feesUsd != null && !appliedFees) {
        pnlUsd -= feesUsd;
        appliedFees = true;
      }
      const positionValue = Number(position?.positionValue ?? NaN);
      const avgPrice = Number(position?.avgPrice ?? NaN);
      const notionalUsd = Number.isFinite(positionValue) && positionValue > 0
        ? positionValue
        : Number.isFinite(avgPrice) && avgPrice > 0
          ? avgPrice * size
          : 0;
      const leverageRaw = Number(position?.leverage ?? NaN);
      const leverageFallback = clampNumber(Number(this.config.hedgeLeverage ?? 1), 1, 100);
      const leverage = Number.isFinite(leverageRaw) && leverageRaw > 0 ? leverageRaw : leverageFallback;
      const result: HedgeCloseResult = {
        symbol,
        qty: size,
        notionalUsd,
        leverage,
        feesUsd,
        pnlUsd: pnlUsd != null && Number.isFinite(pnlUsd) ? pnlUsd : null,
        closedAt: new Date().toISOString()
      };
      this.state = null;
      this.setError(null);
      logger.info({ symbol: result.symbol, pnlUsd: result.pnlUsd }, "hedge closed (bybit scan)");
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao fechar hedge";
      logger.warn({ err }, "failed to close hedge");
      this.setError(message);
      return null;
    } finally {
      this.closing = false;
    }
  }
}

