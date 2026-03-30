import type { Config } from "./config.js";
import type { PoolOverrides, PoolSummary } from "./pool-manager.js";
import { PoolManager } from "./pool-manager.js";
import { logger } from "./logger.js";
import type { HedgeLogEntry, HistoryEvent, RunnerStatus } from "./runner.js";
import { createAiAnalysisStore, type AiAnalysisStore } from "./storage.js";

const MAX_HISTORY_ITEMS = 100;

export type StrategyScope = "all" | "selected" | "pool";
export type StrategyRiskProfile = "defensivo" | "balanceado" | "agressivo";
export type StrategyChangeBounds = "conservative" | "moderate" | "open";
export type StrategyFormat = "full-report";

export type StrategyAnalysisRequest = {
  scope?: StrategyScope;
  poolId?: string | null;
  riskProfile?: StrategyRiskProfile;
  changeBounds?: StrategyChangeBounds;
  format?: StrategyFormat;
  model?: string | null;
};

export type StrategyModelSettings = {
  defaultModel: string;
  recommendedModels: string[];
  allowCustomModel: boolean;
};

export type PoolMetrics = {
  totalEvents: number;
  closeEvents: number;
  openEvents: number;
  rebalanceEvents: number;
  winRatePct: number | null;
  realizedPnlUsd: number;
  feesUsd: number;
  txFeesUsd: number;
  hedgePnlUsd: number;
  pnlTotalUsd: number;
  pnlTotalNetUsd: number;
  drawdownProxyPct: number;
  volatilityProxyPct: number;
  rebalancePerDay: number;
  hedgeCoveragePct: number;
  dataFreshnessHours: number | null;
  dataQualityScore: number;
};

export type PoolRiskSummary = {
  poolId: string;
  poolName: string;
  riskScore: number;
  riskLevel: "baixo" | "medio" | "alto";
  confidence: number;
  headline: string;
  metrics: PoolMetrics;
};

export type ConfigRecommendation = {
  id: string;
  priority: 1 | 2 | 3;
  poolId: string;
  poolName: string;
  parameter: string;
  currentValue: number | string | boolean | null;
  suggestedValue: number | string | boolean | null;
  rationale: string;
  expectedEffect: string;
  riskLevel: "low" | "medium" | "high";
  confidence: number;
};

export type StrategyAnalysisResult = {
  id: string;
  createdAt: string;
  scope: StrategyScope;
  poolId: string | null;
  riskProfile: StrategyRiskProfile;
  changeBounds: StrategyChangeBounds;
  format: StrategyFormat;
  requestedModel: string | null;
  modelUsed: string | null;
  aiUsed: boolean;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  executiveSummary: string;
  keyFindings: string[];
  poolRisks: PoolRiskSummary[];
  recommendations: ConfigRecommendation[];
  warnings: string[];
  limitations: string[];
  confidence: {
    score: number;
    rationale: string;
  };
};

export type AnalysisHistoryEntry = {
  id: string;
  createdAt: string;
  scope: StrategyScope;
  riskProfile: StrategyRiskProfile;
  modelUsed: string | null;
  fallbackUsed: boolean;
  summary: string;
  poolCount: number;
  recommendationCount: number;
};

type NormalizedStrategyRequest = {
  scope: StrategyScope;
  poolId: string | null;
  riskProfile: StrategyRiskProfile;
  changeBounds: StrategyChangeBounds;
  format: StrategyFormat;
  model: string | null;
};

type StrategyPoolContext = {
  id: string;
  name: string;
  summary: PoolSummary;
  status: RunnerStatus | null;
  config: Config | null;
  overrides: PoolOverrides | null;
  history: HistoryEvent[];
  hedgeLogs: HedgeLogEntry[];
  metrics: PoolMetrics;
  riskScore: number;
  riskLevel: "baixo" | "medio" | "alto";
  confidence: number;
};

type AiNarrativePatch = {
  executiveSummary?: string;
  keyFindings?: string[];
  warnings?: string[];
  recommendations?: Array<{
    poolId?: string;
    parameter?: string;
    rationale?: string;
    expectedEffect?: string;
    riskLevel?: "low" | "medium" | "high";
    confidence?: number;
  }>;
};

export class StrategyModelError extends Error {
  readonly code: "invalid_model" | "model_unavailable";
  readonly suggestedModel: string;
  readonly canUseDefault: boolean;

  constructor(
    code: "invalid_model" | "model_unavailable",
    message: string,
    suggestedModel: string
  ) {
    super(message);
    this.code = code;
    this.suggestedModel = suggestedModel;
    this.canUseDefault = true;
  }
}

function toFiniteNumber(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = avg(values);
  const variance = values.reduce((acc, value) => acc + (value - mean) * (value - mean), 0) / values.length;
  return Math.sqrt(variance);
}

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCloseAction(action: string | null): boolean {
  return action === "close-position" || action === "rebalanced";
}

function riskLevelFromScore(score: number): "baixo" | "medio" | "alto" {
  if (score >= 70) return "alto";
  if (score >= 45) return "medio";
  return "baixo";
}

function normalizeList(items: string[]): string[] {
  return Array.from(
    new Set(
      items
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    )
  );
}

function isValidModelId(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(model);
}

function normalizeRequest(input: StrategyAnalysisRequest | null | undefined): NormalizedStrategyRequest {
  const scopeRaw = String(input?.scope ?? "all").trim().toLowerCase();
  const scope: StrategyScope = scopeRaw === "selected" || scopeRaw === "pool" ? scopeRaw : "all";
  const riskRaw = String(input?.riskProfile ?? "defensivo").trim().toLowerCase();
  const riskProfile: StrategyRiskProfile =
    riskRaw === "balanceado" || riskRaw === "agressivo" ? riskRaw : "defensivo";
  const boundsRaw = String(input?.changeBounds ?? "conservative").trim().toLowerCase();
  const changeBounds: StrategyChangeBounds =
    boundsRaw === "moderate" || boundsRaw === "open" ? boundsRaw : "conservative";
  const format: StrategyFormat = "full-report";
  const poolId = typeof input?.poolId === "string" && input.poolId.trim()
    ? input.poolId.trim()
    : null;
  const model = typeof input?.model === "string" && input.model.trim()
    ? input.model.trim()
    : null;
  return { scope, poolId, riskProfile, changeBounds, format, model };
}

function buildModelSettings(config: Config): StrategyModelSettings {
  const recommended = normalizeList(config.openaiRecommendedModels ?? []);
  const fallbackModel = config.openaiDefaultModel?.trim() || recommended[0] || "gpt-5.4-mini";
  const merged = recommended.includes(fallbackModel)
    ? recommended
    : [fallbackModel, ...recommended];
  return {
    defaultModel: fallbackModel,
    recommendedModels: merged.length ? merged : [fallbackModel],
    allowCustomModel: Boolean(config.openaiAllowCustomModel)
  };
}

export function resolveModel(settings: StrategyModelSettings, requestedModel: string | null): string {
  const selected = requestedModel?.trim() ?? "";
  if (!selected) {
    return settings.defaultModel;
  }
  if (!isValidModelId(selected)) {
    throw new StrategyModelError(
      "invalid_model",
      `Modelo "${selected}" invalido. Use um id de modelo valido ou o padrao "${settings.defaultModel}".`,
      settings.defaultModel
    );
  }
  if (settings.recommendedModels.includes(selected)) {
    return selected;
  }
  if (settings.allowCustomModel) {
    return selected;
  }
  throw new StrategyModelError(
    "invalid_model",
    `Modelo "${selected}" nao permitido. Use um da lista recomendada ou o padrao "${settings.defaultModel}".`,
    settings.defaultModel
  );
}

function buildHistoryEntry(item: StrategyAnalysisResult): AnalysisHistoryEntry {
  return {
    id: item.id,
    createdAt: item.createdAt,
    scope: item.scope,
    riskProfile: item.riskProfile,
    modelUsed: item.modelUsed,
    fallbackUsed: item.fallbackUsed,
    summary: item.executiveSummary,
    poolCount: item.poolRisks.length,
    recommendationCount: item.recommendations.length
  };
}

function guardrailNumeric(
  parameter: string,
  current: number,
  proposed: number,
  mode: StrategyChangeBounds
): number {
  const deltaMap: Record<string, { conservative: number; moderate: number; open: number; min?: number; max?: number }> = {
    rangeWidthPct: { conservative: 0.25, moderate: 0.6, open: 2.0, min: 0.05 },
    rangeExitBiasPct: { conservative: 5, moderate: 12, open: 40, min: 0, max: 99.9 },
    outOfRangeConfirmSec: { conservative: 20, moderate: 60, open: 240, min: 0 },
    rebalanceCooldownSec: { conservative: 120, moderate: 300, open: 1200, min: 0 },
    pollIntervalMs: { conservative: 10_000, moderate: 30_000, open: 120_000, min: 1_000 },
    hedgePct: { conservative: 10, moderate: 25, open: 100, min: 0, max: 100 },
    hedgeLeverage: { conservative: 1, moderate: 2, open: 10, min: 1 },
    hedgeMarginPct: { conservative: 10, moderate: 20, open: 100, min: 0, max: 100 }
  };

  const rule = deltaMap[parameter];
  if (!rule) {
    return proposed;
  }
  const maxDelta = rule[mode];
  const bounded = clamp(proposed, current - maxDelta, current + maxDelta);
  if (rule.min != null && bounded < rule.min) {
    return rule.min;
  }
  if (rule.max != null && bounded > rule.max) {
    return rule.max;
  }
  return bounded;
}

export function computePoolMetrics(history: HistoryEvent[]): PoolMetrics {
  const events = [...history]
    .filter((item) => item && typeof item === "object")
    .sort((a, b) => {
      const ta = parseDate(a.timestamp) ?? 0;
      const tb = parseDate(b.timestamp) ?? 0;
      return ta - tb;
    });

  const totalEvents = events.length;
  const closeEvents = events.filter((item) => isCloseAction(item.action)).length;
  const openEvents = events.filter((item) => item.action === "open-position").length;
  const rebalanceEvents = events.filter((item) => item.action === "rebalanced").length;

  const closeItems = events.filter((item) => isCloseAction(item.action));
  const realizedPnlUsd = closeItems.reduce((acc, item) => acc + (toFiniteNumber(item.positionPnlUsd) ?? 0), 0);
  const feesUsd = closeItems.reduce((acc, item) => acc + (toFiniteNumber(item.positionFeesUsd) ?? 0), 0);
  const txFeesUsd = closeItems.reduce((acc, item) => acc + (toFiniteNumber(item.txFeeUsd) ?? 0), 0);
  const hedgePnlUsd = closeItems.reduce((acc, item) => acc + (toFiniteNumber(item.hedgePnlUsd) ?? 0), 0);
  const pnlTotalUsd = realizedPnlUsd + hedgePnlUsd;
  const pnlTotalNetUsd = realizedPnlUsd - feesUsd - txFeesUsd + hedgePnlUsd;

  const closeNetPnl = closeItems.map((item) => {
    const pnl = toFiniteNumber(item.positionPnlUsd) ?? 0;
    const fee = toFiniteNumber(item.positionFeesUsd) ?? 0;
    const tx = toFiniteNumber(item.txFeeUsd) ?? 0;
    const hedge = toFiniteNumber(item.hedgePnlUsd) ?? 0;
    return pnl - fee - tx + hedge;
  });

  let wins = 0;
  closeNetPnl.forEach((value) => {
    if (value > 0) {
      wins += 1;
    }
  });
  const winRatePct = closeEvents > 0 ? (wins / closeEvents) * 100 : null;

  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  closeNetPnl.forEach((value) => {
    cumulative += value;
    if (cumulative > peak) {
      peak = cumulative;
    }
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  });
  const drawdownDenominator = Math.max(Math.abs(peak), Math.abs(cumulative), 1);
  const drawdownProxyPct = clamp((maxDrawdown / drawdownDenominator) * 100, 0, 100);

  const prices = events
    .map((item) => toFiniteNumber(item.price))
    .filter((value): value is number => value != null && value > 0);
  const returns: number[] = [];
  for (let index = 1; index < prices.length; index += 1) {
    const prev = prices[index - 1];
    const current = prices[index];
    if (prev > 0) {
      returns.push((current - prev) / prev);
    }
  }
  const volatilityProxyPct = clamp(stdev(returns) * 100, 0, 100);

  const timestamps = events
    .map((item) => parseDate(item.timestamp))
    .filter((value): value is number => value != null);
  const spanMs = timestamps.length >= 2 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
  const spanDays = Math.max(1, spanMs / (24 * 60 * 60 * 1000));
  const rebalancePerDay = rebalanceEvents / spanDays;

  const hedgeOpened = events.filter((item) => item.hedgeDecision === "opened").length;
  const hedgeCoveragePct = openEvents > 0 ? (hedgeOpened / openEvents) * 100 : 0;

  const latest = timestamps.length ? Math.max(...timestamps) : null;
  const dataFreshnessHours = latest != null
    ? Math.max(0, (Date.now() - latest) / (60 * 60 * 1000))
    : null;

  const qualityFromSamples = clamp((Math.min(closeEvents, 20) / 20) * 70, 0, 70);
  const qualityFromRecency = dataFreshnessHours == null
    ? 10
    : clamp(30 - dataFreshnessHours, 0, 30);
  const dataQualityScore = clamp(qualityFromSamples + qualityFromRecency, 5, 100);

  return {
    totalEvents,
    closeEvents,
    openEvents,
    rebalanceEvents,
    winRatePct,
    realizedPnlUsd,
    feesUsd,
    txFeesUsd,
    hedgePnlUsd,
    pnlTotalUsd,
    pnlTotalNetUsd,
    drawdownProxyPct,
    volatilityProxyPct,
    rebalancePerDay,
    hedgeCoveragePct,
    dataFreshnessHours,
    dataQualityScore
  };
}

function computeRiskScore(metrics: PoolMetrics, riskProfile: StrategyRiskProfile): number {
  const drawdownRisk = clamp(metrics.drawdownProxyPct * 1.1, 0, 100);
  const volatilityRisk = clamp(metrics.volatilityProxyPct * 3.5, 0, 100);
  const rebalanceRisk = clamp(metrics.rebalancePerDay * 18, 0, 100);
  const lossRisk = metrics.winRatePct == null ? 60 : clamp(100 - metrics.winRatePct, 0, 100);
  const gross = Math.abs(metrics.realizedPnlUsd) + Math.abs(metrics.hedgePnlUsd) + 1;
  const costSharePct = ((metrics.feesUsd + metrics.txFeesUsd) / gross) * 100;
  const costRisk = clamp(costSharePct * 2.5, 0, 100);

  const weight =
    riskProfile === "agressivo"
      ? { drawdown: 0.2, vol: 0.2, rebalance: 0.15, loss: 0.3, cost: 0.15 }
      : riskProfile === "balanceado"
        ? { drawdown: 0.25, vol: 0.25, rebalance: 0.2, loss: 0.2, cost: 0.1 }
        : { drawdown: 0.32, vol: 0.25, rebalance: 0.18, loss: 0.15, cost: 0.1 };

  const score =
    drawdownRisk * weight.drawdown +
    volatilityRisk * weight.vol +
    rebalanceRisk * weight.rebalance +
    lossRisk * weight.loss +
    costRisk * weight.cost;
  return clamp(Number(score.toFixed(2)), 0, 100);
}

function buildRiskHeadline(context: StrategyPoolContext): string {
  const metrics = context.metrics;
  if (metrics.closeEvents === 0) {
    return "Poucos fechamentos para medir performance real.";
  }
  if (context.riskLevel === "alto") {
    return "Risco elevado por drawdown/volatilidade e frequencia de ajustes.";
  }
  if (context.riskLevel === "medio") {
    return "Risco moderado; ha pontos de otimizacao para estabilizar resultados.";
  }
  return "Risco baixo no periodo analisado, com espaco para ajustes finos.";
}

function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function buildDeterministicFindings(contexts: StrategyPoolContext[]): string[] {
  if (!contexts.length) return ["Sem pools disponiveis para analise."];
  const highestRisk = [...contexts].sort((a, b) => b.riskScore - a.riskScore)[0];
  const findings: string[] = [];
  findings.push(`Pool mais critica: ${highestRisk.name} (score ${formatNumber(highestRisk.riskScore)}).`);

  const avgWinRate = avg(
    contexts
      .map((context) => context.metrics.winRatePct)
      .filter((value): value is number => value != null && Number.isFinite(value))
  );
  if (Number.isFinite(avgWinRate) && avgWinRate > 0) {
    findings.push(`Win rate medio em fechamentos: ${formatPercent(avgWinRate)}.`);
  } else {
    findings.push("Sem amostra suficiente de fechamentos para win rate confiavel.");
  }

  const avgDrawdown = avg(contexts.map((context) => context.metrics.drawdownProxyPct));
  findings.push(`Drawdown proxy medio: ${formatPercent(avgDrawdown)}.`);

  const totalPnl = contexts.reduce((acc, context) => acc + context.metrics.pnlTotalNetUsd, 0);
  findings.push(`PnL total estimado (pool + hedge, sem taxas): ${formatNumber(totalPnl, 2)} USD.`);
  return findings;
}

function addRecommendation(
  list: ConfigRecommendation[],
  next: Omit<ConfigRecommendation, "id">
): void {
  const duplicate = list.find((item) =>
    item.poolId === next.poolId && item.parameter === next.parameter && item.suggestedValue === next.suggestedValue
  );
  if (duplicate) {
    return;
  }
  list.push({
    id: `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    ...next
  });
}

function buildRecommendations(
  contexts: StrategyPoolContext[],
  request: NormalizedStrategyRequest
): ConfigRecommendation[] {
  const recommendations: ConfigRecommendation[] = [];
  const mode = request.changeBounds;

  contexts.forEach((context) => {
    const config = context.config;
    if (!config) return;
    const metrics = context.metrics;

    if (metrics.volatilityProxyPct >= 1.2 || metrics.rebalancePerDay >= 1.8) {
      const current = Number(config.rangeWidthPct);
      let target = current * (mode === "conservative" ? 1.15 : mode === "moderate" ? 1.3 : 1.6);
      target = guardrailNumeric("rangeWidthPct", current, target, mode);
      addRecommendation(recommendations, {
        priority: 1,
        poolId: context.id,
        poolName: context.name,
        parameter: "rangeWidthPct",
        currentValue: current,
        suggestedValue: Number(target.toFixed(4)),
        rationale: "Faixa estreita aumenta chance de sair do range em mercado volatil.",
        expectedEffect: "Reduz rebalances e variacao brusca de resultado.",
        riskLevel: "low",
        confidence: clamp(context.confidence, 0.35, 0.9)
      });
    }

    if (metrics.rebalancePerDay >= 1.5) {
      const current = Number(config.rebalanceCooldownSec);
      const target = guardrailNumeric(
        "rebalanceCooldownSec",
        current,
        current + (mode === "conservative" ? 60 : mode === "moderate" ? 180 : 420),
        mode
      );
      addRecommendation(recommendations, {
        priority: 1,
        poolId: context.id,
        poolName: context.name,
        parameter: "rebalanceCooldownSec",
        currentValue: current,
        suggestedValue: Math.round(target),
        rationale: "Muitos rebalances aumentam custos e ruido operacional.",
        expectedEffect: "Diminui churn de operacoes e taxa acumulada.",
        riskLevel: "medium",
        confidence: clamp(context.confidence, 0.35, 0.92)
      });
    }

    if (metrics.rebalancePerDay >= 2.2 || metrics.volatilityProxyPct >= 1.8) {
      const current = Number(config.outOfRangeConfirmSec);
      const target = guardrailNumeric(
        "outOfRangeConfirmSec",
        current,
        current + (mode === "conservative" ? 12 : mode === "moderate" ? 30 : 90),
        mode
      );
      addRecommendation(recommendations, {
        priority: 2,
        poolId: context.id,
        poolName: context.name,
        parameter: "outOfRangeConfirmSec",
        currentValue: current,
        suggestedValue: Math.round(target),
        rationale: "Confirmacao curta pode reagir a ruido de preco intraperiodo.",
        expectedEffect: "Filtra rompimentos falsos e evita fechamentos desnecessarios.",
        riskLevel: "low",
        confidence: clamp(context.confidence, 0.3, 0.88)
      });
    }

    const txShare = Math.abs(metrics.txFeesUsd) / (Math.abs(metrics.pnlTotalUsd) + 1);
    if (txShare >= 0.12) {
      const current = Number(config.pollIntervalMs);
      const target = guardrailNumeric(
        "pollIntervalMs",
        current,
        current + (mode === "conservative" ? 5_000 : mode === "moderate" ? 15_000 : 40_000),
        mode
      );
      addRecommendation(recommendations, {
        priority: 2,
        poolId: context.id,
        poolName: context.name,
        parameter: "pollIntervalMs",
        currentValue: current,
        suggestedValue: Math.round(target),
        rationale: "Custo de transacao alto em relacao ao resultado liquido.",
        expectedEffect: "Reduz excesso de verificacoes e operacoes sem ganho proporcional.",
        riskLevel: "medium",
        confidence: clamp(context.confidence, 0.3, 0.85)
      });
    }

    if (context.riskScore >= 65 && !config.hedgeEnabled) {
      addRecommendation(recommendations, {
        priority: 1,
        poolId: context.id,
        poolName: context.name,
        parameter: "hedgeEnabled",
        currentValue: Boolean(config.hedgeEnabled),
        suggestedValue: true,
        rationale: "Pool com risco elevado e sem protecao ativa.",
        expectedEffect: "Reduz impacto de movimentos adversos extremos.",
        riskLevel: "high",
        confidence: clamp(context.confidence, 0.4, 0.82)
      });
      const basePct = toFiniteNumber(config.hedgePct) ?? 0;
      if (basePct <= 0) {
        addRecommendation(recommendations, {
          priority: 2,
          poolId: context.id,
          poolName: context.name,
          parameter: "hedgePct",
          currentValue: basePct,
          suggestedValue: mode === "conservative" ? 30 : mode === "moderate" ? 45 : 60,
          rationale: "Hedge sem percentual util nao protege drawdown.",
          expectedEffect: "Aumenta cobertura em cenario de queda.",
          riskLevel: "high",
          confidence: clamp(context.confidence, 0.35, 0.78)
        });
      }
    }

    if (config.hedgeEnabled && config.hedgeEntryMode === "off" && context.riskScore >= 55) {
      addRecommendation(recommendations, {
        priority: 2,
        poolId: context.id,
        poolName: context.name,
        parameter: "hedgeEntryMode",
        currentValue: config.hedgeEntryMode,
        suggestedValue: "trend-down",
        rationale: "Modo sempre ativo pode gerar hedge em contexto desfavoravel.",
        expectedEffect: "Tende a abrir protecao quando sinal de baixa e mais relevante.",
        riskLevel: "medium",
        confidence: clamp(context.confidence, 0.3, 0.8)
      });
    }

    if (context.riskScore >= 50 && !config.trendEnabled) {
      addRecommendation(recommendations, {
        priority: 3,
        poolId: context.id,
        poolName: context.name,
        parameter: "trendEnabled",
        currentValue: Boolean(config.trendEnabled),
        suggestedValue: true,
        rationale: "Leitura de tendencia pode melhorar filtro de entrada/saida.",
        expectedEffect: "Apoia decisoes mais defensivas em fases de mercado direcional.",
        riskLevel: "medium",
        confidence: clamp(context.confidence, 0.25, 0.72)
      });
    }
  });

  if (!recommendations.length && contexts.length) {
    const first = contexts[0];
    addRecommendation(recommendations, {
      priority: 3,
      poolId: first.id,
      poolName: first.name,
      parameter: "rangeWidthPct",
      currentValue: first.config?.rangeWidthPct ?? null,
      suggestedValue: first.config?.rangeWidthPct ?? null,
      rationale: "Configuracao atual esta estavel para o periodo analisado.",
      expectedEffect: "Manter monitoramento e validar novamente apos mais eventos de fechamento.",
      riskLevel: "low",
      confidence: clamp(first.confidence, 0.2, 0.7)
    });
  }

  return recommendations
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 20);
}

function buildExecutiveSummary(
  contexts: StrategyPoolContext[],
  request: NormalizedStrategyRequest
): string {
  if (!contexts.length) {
    return "Sem pools disponiveis para gerar analise.";
  }
  const ordered = [...contexts].sort((a, b) => b.riskScore - a.riskScore);
  const riskiest = ordered[0];
  const safer = ordered[ordered.length - 1];
  return [
    `Analise ${request.riskProfile} em ${contexts.length} pool(s), foco em reduzir volatilidade e drawdown.`,
    `Maior risco atual: ${riskiest.name} (score ${formatNumber(riskiest.riskScore)}).`,
    `Melhor estabilidade relativa: ${safer.name} (score ${formatNumber(safer.riskScore)}).`,
    "As sugestoes priorizam mudancas conservadoras por parametro."
  ].join(" ");
}

function buildConfidence(contexts: StrategyPoolContext[]): { score: number; rationale: string } {
  if (!contexts.length) {
    return { score: 0.1, rationale: "Sem dados para medir confianca." };
  }
  const weighted = contexts.map((context) => {
    const weight = Math.max(1, context.metrics.closeEvents);
    return { value: context.confidence * weight, weight };
  });
  const numerator = weighted.reduce((acc, item) => acc + item.value, 0);
  const denominator = weighted.reduce((acc, item) => acc + item.weight, 0);
  const score = denominator > 0 ? numerator / denominator : 0.2;
  const lowSamplePools = contexts.filter((context) => context.metrics.closeEvents < 4).length;
  const stalePools = contexts.filter((context) => (context.metrics.dataFreshnessHours ?? 999) > 48).length;
  const rationale = [
    `${lowSamplePools} pool(s) com baixa amostra de fechamentos.`,
    `${stalePools} pool(s) com dados potencialmente desatualizados.`,
    "Recomendacoes com score baixo devem ser confirmadas com mais historico."
  ].join(" ");
  return { score: clamp(Number(score.toFixed(2)), 0.05, 0.99), rationale };
}

function parseLooseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // no-op
  }
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    return JSON.parse(fenceMatch[1].trim());
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }
  return null;
}

function extractOutputText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  if (Array.isArray(payload?.output)) {
    const chunks: string[] = [];
    payload.output.forEach((entry: any) => {
      const content = Array.isArray(entry?.content) ? entry.content : [];
      content.forEach((item: any) => {
        if (typeof item?.text === "string") {
          chunks.push(item.text);
        } else if (typeof item?.output_text === "string") {
          chunks.push(item.output_text);
        }
      });
    });
    if (chunks.length) {
      return chunks.join("\n").trim();
    }
  }
  return "";
}

function parseAiNarrative(payload: unknown): AiNarrativePatch | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const source = payload as Record<string, unknown>;
  const patch: AiNarrativePatch = {};
  if (typeof source.executiveSummary === "string" && source.executiveSummary.trim()) {
    patch.executiveSummary = source.executiveSummary.trim();
  }
  if (Array.isArray(source.keyFindings)) {
    patch.keyFindings = source.keyFindings
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0)
      .slice(0, 12);
  }
  if (Array.isArray(source.warnings)) {
    patch.warnings = source.warnings
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0)
      .slice(0, 12);
  }
  if (Array.isArray(source.recommendations)) {
    patch.recommendations = source.recommendations
      .map((item) => (item && typeof item === "object" ? item as any : null))
      .filter((item): item is any => item != null)
      .slice(0, 30);
  }
  return patch;
}

function maybeModelError(status: number, message: string, selectedModel: string, defaultModel: string): StrategyModelError | null {
  const normalized = message.toLowerCase();
  const isModelProblem =
    normalized.includes("model")
    && (
      normalized.includes("not found")
      || normalized.includes("not available")
      || normalized.includes("does not exist")
      || normalized.includes("not have access")
      || normalized.includes("permission")
      || normalized.includes("unsupported")
    );
  if (!isModelProblem && status !== 404) {
    return null;
  }
  return new StrategyModelError(
    "model_unavailable",
    `Modelo "${selectedModel}" indisponivel para esta chave. Use o padrao "${defaultModel}".`,
    defaultModel
  );
}

export class AiStrategyService {
  private readonly poolManager: PoolManager;
  private readonly openaiApiKey: string | null;
  private readonly openaiTimeoutMs: number;
  private readonly models: StrategyModelSettings;
  private readonly storePromise: Promise<AiAnalysisStore>;
  private store: AiAnalysisStore | null = null;
  private analyses: StrategyAnalysisResult[] = [];

  constructor(poolManager: PoolManager, config: Config) {
    this.poolManager = poolManager;
    this.openaiApiKey = config.openaiApiKey?.trim() || null;
    this.openaiTimeoutMs = clamp(Math.floor(config.openaiTimeoutMs || 30000), 1_000, 120_000);
    this.models = buildModelSettings(config);
    this.storePromise = createAiAnalysisStore();
  }

  async init(): Promise<void> {
    this.store = await this.storePromise;
    try {
      const loaded = await this.store.load();
      const analyses = Array.isArray(loaded?.analyses) ? loaded?.analyses : [];
      this.analyses = analyses
        .map((item) => this.normalizeStoredAnalysis(item))
        .filter((item): item is StrategyAnalysisResult => item != null)
        .sort((a, b) => {
          const ta = parseDate(a.createdAt) ?? 0;
          const tb = parseDate(b.createdAt) ?? 0;
          return tb - ta;
        })
        .slice(0, MAX_HISTORY_ITEMS);
    } catch (err) {
      logger.warn({ err }, "failed to load ai analysis history");
      this.analyses = [];
    }
  }

  getModelSettings(): StrategyModelSettings {
    return {
      defaultModel: this.models.defaultModel,
      recommendedModels: [...this.models.recommendedModels],
      allowCustomModel: this.models.allowCustomModel
    };
  }

  listHistory(): AnalysisHistoryEntry[] {
    return this.analyses.map(buildHistoryEntry);
  }

  getHistoryById(id: string): StrategyAnalysisResult | null {
    const trimmed = id.trim();
    if (!trimmed) {
      return null;
    }
    return this.analyses.find((item) => item.id === trimmed) ?? null;
  }

  async runAnalysis(input: StrategyAnalysisRequest): Promise<StrategyAnalysisResult> {
    const request = normalizeRequest(input);
    const model = resolveModel(this.models, request.model);
    const contexts = await this.collectContexts(request);
    const recommendations = buildRecommendations(contexts, request);
    const confidence = buildConfidence(contexts);
    const nowIso = new Date().toISOString();

    let result: StrategyAnalysisResult = {
      id: this.createAnalysisId(nowIso),
      createdAt: nowIso,
      scope: request.scope,
      poolId: request.poolId,
      riskProfile: request.riskProfile,
      changeBounds: request.changeBounds,
      format: request.format,
      requestedModel: request.model,
      modelUsed: null,
      aiUsed: false,
      fallbackUsed: true,
      fallbackReason: this.openaiApiKey ? null : "OPENAI_API_KEY ausente; analise somente deterministica.",
      executiveSummary: buildExecutiveSummary(contexts, request),
      keyFindings: buildDeterministicFindings(contexts),
      poolRisks: contexts.map((context) => ({
        poolId: context.id,
        poolName: context.name,
        riskScore: context.riskScore,
        riskLevel: context.riskLevel,
        confidence: context.confidence,
        headline: buildRiskHeadline(context),
        metrics: context.metrics
      })),
      recommendations,
      warnings: this.openaiApiKey
        ? []
        : ["Configure OPENAI_API_KEY para enriquecer o diagnostico com linguagem natural."],
      limitations: [
        "Nao realiza execucao automatica das mudancas.",
        "Metrica de drawdown e volatilidade e proxy baseada no historico local.",
        "Sinais de tendencia dependem dos dados atualmente armazenados."
      ],
      confidence
    };

    if (this.openaiApiKey) {
      try {
        const patch = await this.requestAiNarrative(model, request, contexts, result);
        if (patch) {
          result = this.applyPatch(result, patch, model);
        } else {
          result.modelUsed = model;
          result.fallbackUsed = true;
          result.fallbackReason = "Resposta da IA sem JSON valido; mantendo analise deterministica.";
          result.warnings = [
            ...result.warnings,
            "A resposta da IA foi invalida e o sistema retornou para o modo deterministico."
          ];
        }
      } catch (err) {
        if (err instanceof StrategyModelError) {
          throw err;
        }
        result.modelUsed = model;
        result.fallbackUsed = true;
        result.fallbackReason = err instanceof Error ? err.message : String(err);
        result.warnings = [
          ...result.warnings,
          "Falha ao enriquecer analise via IA; exibindo apenas diagnostico deterministico."
        ];
        logger.warn({ err }, "ai narrative fallback activated");
      }
    }

    this.analyses = [result, ...this.analyses].slice(0, MAX_HISTORY_ITEMS);
    await this.persistHistory();
    return result;
  }

  private applyPatch(
    base: StrategyAnalysisResult,
    patch: AiNarrativePatch,
    model: string
  ): StrategyAnalysisResult {
    let recommendations = [...base.recommendations];
    if (Array.isArray(patch.recommendations) && patch.recommendations.length > 0) {
      recommendations = recommendations.map((current) => {
        const match = patch.recommendations?.find((item) =>
          String(item.poolId ?? "").trim() === current.poolId
          && String(item.parameter ?? "").trim() === current.parameter
        );
        if (!match) return current;
        return {
          ...current,
          rationale: typeof match.rationale === "string" && match.rationale.trim()
            ? match.rationale.trim()
            : current.rationale,
          expectedEffect: typeof match.expectedEffect === "string" && match.expectedEffect.trim()
            ? match.expectedEffect.trim()
            : current.expectedEffect,
          riskLevel: match.riskLevel === "low" || match.riskLevel === "medium" || match.riskLevel === "high"
            ? match.riskLevel
            : current.riskLevel,
          confidence: Number.isFinite(Number(match.confidence))
            ? clamp(Number(match.confidence), 0.05, 0.99)
            : current.confidence
        };
      });
    }

    return {
      ...base,
      modelUsed: model,
      aiUsed: true,
      fallbackUsed: false,
      fallbackReason: null,
      executiveSummary: patch.executiveSummary && patch.executiveSummary.trim()
        ? patch.executiveSummary.trim()
        : base.executiveSummary,
      keyFindings: Array.isArray(patch.keyFindings) && patch.keyFindings.length
        ? patch.keyFindings
        : base.keyFindings,
      warnings: Array.isArray(patch.warnings) && patch.warnings.length
        ? [...base.warnings, ...patch.warnings]
        : base.warnings,
      recommendations
    };
  }

  private async collectContexts(request: NormalizedStrategyRequest): Promise<StrategyPoolContext[]> {
    const [summaries, entries] = await Promise.all([
      this.poolManager.listSummaries(),
      Promise.resolve(this.poolManager.listPools())
    ]);

    const selectedPoolId = this.poolManager.getSelectedPoolId();
    const summaryById = new Map(summaries.map((summary) => [summary.id, summary]));
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));

    let targetIds: string[] = [];
    if (request.scope === "all") {
      targetIds = entries.map((entry) => entry.id);
    } else if (request.scope === "selected") {
      targetIds = selectedPoolId ? [selectedPoolId] : [];
    } else if (request.scope === "pool") {
      targetIds = request.poolId ? [request.poolId] : [];
    }
    if (!targetIds.length && request.poolId) {
      targetIds = [request.poolId];
    }
    targetIds = targetIds.filter((id, index) => id && targetIds.indexOf(id) === index);
    if (!targetIds.length) {
      throw new Error("Nao ha pool disponivel para analise.");
    }

    const contexts: StrategyPoolContext[] = targetIds.map((id) => {
      const summary = summaryById.get(id);
      if (!summary) {
        throw new Error(`Pool "${id}" nao encontrada.`);
      }
      const history = this.poolManager.getHistory(id);
      const metrics = computePoolMetrics(history);
      const riskScore = computeRiskScore(metrics, request.riskProfile);
      const confidence = clamp(
        (metrics.dataQualityScore / 100) * (metrics.closeEvents > 0 ? 1 : 0.65),
        0.1,
        0.99
      );
      const riskLevel = riskLevelFromScore(riskScore);
      const status = this.poolManager.getStatus(id);
      const config = this.poolManager.getPoolConfig(id);
      const entry = entryById.get(id) ?? null;
      return {
        id,
        name: summary.name,
        summary,
        status,
        config,
        overrides: entry?.overrides ?? null,
        history,
        hedgeLogs: this.poolManager.getHedgeLogs(id),
        metrics,
        riskScore,
        riskLevel,
        confidence
      };
    });

    return contexts.sort((a, b) => b.riskScore - a.riskScore);
  }

  private async requestAiNarrative(
    model: string,
    request: NormalizedStrategyRequest,
    contexts: StrategyPoolContext[],
    baseline: StrategyAnalysisResult
  ): Promise<AiNarrativePatch | null> {
    if (!this.openaiApiKey) {
      return null;
    }
    const payload = {
      scope: request.scope,
      riskProfile: request.riskProfile,
      changeBounds: request.changeBounds,
      pools: contexts.map((context) => ({
        id: context.id,
        name: context.name,
        riskScore: context.riskScore,
        riskLevel: context.riskLevel,
        confidence: context.confidence,
        metrics: context.metrics,
        config: context.config ? {
          rangeWidthPct: context.config.rangeWidthPct,
          rangeExitBiasPct: context.config.rangeExitBiasPct,
          preferredExitToken: context.config.preferredExitToken,
          outOfRangeConfirmSec: context.config.outOfRangeConfirmSec,
          rebalanceCooldownSec: context.config.rebalanceCooldownSec,
          pollIntervalMs: context.config.pollIntervalMs,
          trendEnabled: context.config.trendEnabled,
          trendTimeframe: context.config.trendTimeframe,
          hedgeEnabled: context.config.hedgeEnabled,
          hedgePct: context.config.hedgePct,
          hedgeLeverage: context.config.hedgeLeverage,
          hedgeEntryMode: context.config.hedgeEntryMode
        } : null,
        recentEvents: context.history.slice(0, 10).map((event) => ({
          timestamp: event.timestamp,
          action: event.action,
          actionType: event.actionType,
          price: event.price,
          positionPnlUsd: event.positionPnlUsd,
          positionFeesUsd: event.positionFeesUsd,
          hedgePnlUsd: event.hedgePnlUsd,
          trendDirection: event.trendDirection
        }))
      })),
      baseline: {
        executiveSummary: baseline.executiveSummary,
        keyFindings: baseline.keyFindings,
        recommendations: baseline.recommendations.map((item) => ({
          poolId: item.poolId,
          parameter: item.parameter,
          currentValue: item.currentValue,
          suggestedValue: item.suggestedValue,
          rationale: item.rationale,
          expectedEffect: item.expectedEffect,
          riskLevel: item.riskLevel,
          confidence: item.confidence
        }))
      }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.openaiTimeoutMs);
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.openaiApiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_output_tokens: 1800,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: [
                    "Voce e um analista quantitativo para pools de liquidez.",
                    "Responda SOMENTE JSON valido, sem markdown.",
                    "Nao invente dados ausentes.",
                    "Priorize reducao de volatilidade e drawdown.",
                    "Mantenha as sugestoes conservadoras.",
                    "Use este schema:",
                    "{",
                    "  \"executiveSummary\": string,",
                    "  \"keyFindings\": string[],",
                    "  \"warnings\": string[],",
                    "  \"recommendations\": [{",
                    "    \"poolId\": string,",
                    "    \"parameter\": string,",
                    "    \"rationale\": string,",
                    "    \"expectedEffect\": string,",
                    "    \"riskLevel\": \"low\"|\"medium\"|\"high\",",
                    "    \"confidence\": number",
                    "  }]",
                    "}"
                  ].join("\n")
                }
              ]
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: JSON.stringify(payload)
                }
              ]
            }
          ]
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const responsePayload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = typeof responsePayload?.error?.message === "string"
        ? responsePayload.error.message
        : `OpenAI request failed with status ${response.status}`;
      const modelError = maybeModelError(response.status, message, model, this.models.defaultModel);
      if (modelError) {
        throw modelError;
      }
      throw new Error(message);
    }

    const outputText = extractOutputText(responsePayload);
    const parsed = parseLooseJson(outputText);
    return parseAiNarrative(parsed);
  }

  private async persistHistory(): Promise<void> {
    if (!this.store) {
      return;
    }
    try {
      await this.store.save({
        analyses: this.analyses,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      logger.warn({ err }, "failed to persist ai analysis history");
    }
  }

  private normalizeStoredAnalysis(item: unknown): StrategyAnalysisResult | null {
    if (!item || typeof item !== "object") {
      return null;
    }
    const source = item as Record<string, unknown>;
    if (typeof source.id !== "string" || typeof source.createdAt !== "string") {
      return null;
    }
    const scopeRaw = String(source.scope ?? "all");
    const scope: StrategyScope = scopeRaw === "selected" || scopeRaw === "pool" ? scopeRaw : "all";
    const riskRaw = String(source.riskProfile ?? "defensivo");
    const riskProfile: StrategyRiskProfile = riskRaw === "balanceado" || riskRaw === "agressivo" ? riskRaw : "defensivo";
    const boundsRaw = String(source.changeBounds ?? "conservative");
    const changeBounds: StrategyChangeBounds =
      boundsRaw === "moderate" || boundsRaw === "open" ? boundsRaw : "conservative";
    const recommendations = Array.isArray(source.recommendations) ? source.recommendations as ConfigRecommendation[] : [];
    const poolRisks = Array.isArray(source.poolRisks) ? source.poolRisks as PoolRiskSummary[] : [];
    return {
      id: source.id,
      createdAt: source.createdAt,
      scope,
      poolId: typeof source.poolId === "string" ? source.poolId : null,
      riskProfile,
      changeBounds,
      format: "full-report",
      requestedModel: typeof source.requestedModel === "string" ? source.requestedModel : null,
      modelUsed: typeof source.modelUsed === "string" ? source.modelUsed : null,
      aiUsed: Boolean(source.aiUsed),
      fallbackUsed: Boolean(source.fallbackUsed),
      fallbackReason: typeof source.fallbackReason === "string" ? source.fallbackReason : null,
      executiveSummary: typeof source.executiveSummary === "string" ? source.executiveSummary : "",
      keyFindings: Array.isArray(source.keyFindings)
        ? source.keyFindings.map((entry) => String(entry))
        : [],
      poolRisks,
      recommendations,
      warnings: Array.isArray(source.warnings) ? source.warnings.map((entry) => String(entry)) : [],
      limitations: Array.isArray(source.limitations) ? source.limitations.map((entry) => String(entry)) : [],
      confidence: {
        score: Number.isFinite(Number((source as any).confidence?.score))
          ? clamp(Number((source as any).confidence.score), 0.05, 0.99)
          : 0.2,
        rationale: typeof (source as any).confidence?.rationale === "string"
          ? (source as any).confidence.rationale
          : "Sem informacoes."
      }
    };
  }

  private createAnalysisId(timestamp: string): string {
    const timePart = (parseDate(timestamp) ?? Date.now()).toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `analysis_${timePart}_${random}`;
  }
}
