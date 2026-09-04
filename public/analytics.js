import {
  aggregatePerformance,
  getHistoryEventMetrics,
  isPerformanceCloseEvent,
  isPercentMetric,
  summarizePerformance
} from "./analytics-metrics.js";
import {
  createCategoryChart,
  createTimeChart,
  seriesColor,
  snapshotColumns,
  splitOnPositionChange
} from "./charts.js";
const poolSelect = document.getElementById("poolSelect");
const startInput = document.getElementById("startDate");
const endInput = document.getElementById("endDate");
const applyBtn = document.getElementById("applyFilter");
const errorBox = document.getElementById("analyticsError");
const historyBody = document.getElementById("historyBody");
const analyticsColumnFilters = document.getElementById("analyticsColumnFilters");
const analyticsTypeFilters = document.getElementById("analyticsTypeFilters");
const analyticsRowLimitSelect = document.getElementById("analyticsRowLimit");
const perfGroupSelect = document.getElementById("perfGroup");
const perfCanvas = document.getElementById("perfCanvas");
const perfEmpty = document.getElementById("perfEmpty");
const perfTooltip = document.getElementById("perfTooltip");
const perfChartNotice = document.getElementById("perfChartNotice");
const perfMetrics = document.querySelector(".performance-metrics");
const perfFeesCumStat = document.getElementById("perfFeesCumStat");
const perfFeeYieldStat = document.getElementById("perfFeeYieldStat");
const perfCalcCapital = document.getElementById("perfCalcCapital");
const perfCalcDays = document.getElementById("perfCalcDays");
const perfCalcFees = document.getElementById("perfCalcFees");
const perfCalcRoi = document.getElementById("perfCalcRoi");
const snapshotBucketSelect = document.getElementById("snapshotBucket");
const snapshotMeta = document.getElementById("snapshotMeta");
const equityChartEl = document.getElementById("equityChart");
const equityEmpty = document.getElementById("equityEmpty");
const equityTooltip = document.getElementById("equityTooltip");
const rangeChartEl = document.getElementById("rangeChart");
const rangeEmpty = document.getElementById("rangeEmpty");
const rangeTooltip = document.getElementById("rangeTooltip");
const ltvChartEl = document.getElementById("ltvChart");
const ltvEmpty = document.getElementById("ltvEmpty");
const ltvTooltip = document.getElementById("ltvTooltip");
const ltvBlock = document.getElementById("ltvBlock");

const ALL_POOLS_ID = "__all__";

const summaryEvents = document.getElementById("summaryEvents");
const summaryOpens = document.getElementById("summaryOpens");
const summaryRebalances = document.getElementById("summaryRebalances");
const summaryCloses = document.getElementById("summaryCloses");
const summaryPnlSol = document.getElementById("summaryPnlSol");
const summaryPnlUsd = document.getElementById("summaryPnlUsd");
const summaryNetSol = document.getElementById("summaryNetSol");
const summaryNetUsd = document.getElementById("summaryNetUsd");
const summaryInA = document.getElementById("summaryInA");
const summaryInB = document.getElementById("summaryInB");
const summaryOutA = document.getElementById("summaryOutA");
const summaryOutB = document.getElementById("summaryOutB");

const actionLabels = {
  "open-position": "abertura",
  "rebalanced": "re-range",
  "close-position": "fechamento",
  "auto-sol-topup": "top-up SOL",
  "manual-sol-topup": "top-up SOL (manual)",
  "manual-swap-to-sol": "converter tokens para SOL",
  "add-liquidity": "adicionar liquidez",
  "add-liquidity-failed": "falha adicionar liquidez",
  "close-failed": "fechamento falhou",
  "resume-position": "monitorando posição existente",
  "reload-position": "recarregar posição",
  "out-of-range-wait": "aguardando confirmação fora da faixa",
  "skip-low-sol": "SOL baixo",
  "skip-low-sol-position": "posição existente (SOL baixo)",
  "swap": "swap",
  "kamino-rebalanced": "re-range (Kamino)",
  "kamino-rebalance-failed": "falha Kamino",
  "kamino-deposit": "Kamino: depositar colateral",
  "kamino-borrow": "Kamino: empréstimo",
  "kamino-reopen": "Kamino: reabrir pool",
  "kamino-repay": "Kamino: pagar dívida",
  "kamino-withdraw": "Kamino: retirar colateral",
  "kamino-close": "Pago Empréstimo",
  "kamino-wait-funds": "Kamino: aguardando saldo"
};

const actionTypeLabels = {
  "abertura": "Abertura",
  "fechamento": "Fechamento",
  "fechamento-emprestimo": "Fechamento Empréstimo",
  "fechamento + abertura": "Fechamento + abertura",
  "monitorando": "Monitorando",
  "operacional": "Operacional"
};

const analyticsColumnDefaults = {
  datetime: true,
  openAt: true,
  close: true,
  type: true,
  action: true,
  price: true,
  targetRange: true,
  mint: true,
  entryUsd: true,
  feesUsd: true,
  txFeeUsd: true,
  exitUsd: true,
  pnlUsd: true,
  pnlTotal: true,
  pnlTotalNet: true
};

let analyticsColumnVisibility = loadAnalyticsColumnVisibility();
const analyticsTypeDefaults = {
  abertura: true,
  fechamento: true,
  "fechamento-emprestimo": true,
  monitorando: true,
  operacional: true
};
let analyticsTypeVisibility = loadAnalyticsTypeVisibility();
let analyticsRowLimit = loadAnalyticsRowLimit();

const perfMetricDefaults = {
  fees: true,
  feesCum: true,
  feeYieldPct: false,
  pnl: true,
  pnlNet: true,
  pnlTotal: false,
  pnlTotalNet: false,
  pnlCum: true,
  pnlNetCum: true
};

const PERF_METRIC_VISIBILITY_VERSION = "2";

const perfMetricOrder = [
  "fees",
  "feesCum",
  "feeYieldPct",
  "pnl",
  "pnlNet",
  "pnlTotal",
  "pnlTotalNet",
  "pnlCum",
  "pnlNetCum"
];

const perfMetricLabels = {
  fees: "Taxas",
  feesCum: "Taxas acumuladas",
  feeYieldPct: "Rendimento da taxa (%)",
  pnl: "PnL realizado (USD)",
  pnlNet: "PnL sem taxas coletadas (USD)",
  pnlTotal: "PnL realizado total (USD)",
  pnlTotalNet: "PnL total sem taxas coletadas (USD)",
  pnlCum: "PnL realizado acumulado",
  pnlNetCum: "PnL sem taxas acumulado"
};

const perfMetricTooltipLabels = {
  fees: "Taxas",
  feesCum: "Taxas acum.",
  feeYieldPct: "Rend. taxa (%)",
  pnl: "PnL realizado (USD)",
  pnlNet: "PnL s/ taxas coletadas",
  pnlTotal: "PnL total",
  pnlTotalNet: "PnL total s/ taxas coletadas",
  pnlCum: "PnL acum.",
  pnlNetCum: "PnL s/ taxas coletadas acum."
};

/**
 * Cores das series. Os valores aqui sao apenas fallback: a cor efetiva vem do
 * token CSS --series-<metrica>, o mesmo consumido pelos quadradinhos da legenda.
 */
const perfMetricFallbackColors = {
  fees: "#f6c343",
  feesCum: "rgba(246, 195, 67, 0.65)",
  feeYieldPct: "#f97316",
  pnl: "#36d399",
  pnlNet: "#4ea1ff",
  pnlTotal: "#f472b6",
  pnlTotalNet: "#fb7185",
  pnlCum: "#36d399",
  pnlNetCum: "#4ea1ff"
};

function perfMetricColor(key) {
  return seriesColor(key, perfMetricFallbackColors[key] || "#888");
}

/** Series acumuladas sao tracejadas, para distinguir do valor do periodo. */
const PERF_DASHED_METRICS = new Set(["pnlCum", "pnlNetCum", "feesCum"]);

let perfGroup = loadPerfGroup();
let perfMetricVisibility = loadPerfMetricVisibility();
let perfChartPoints = [];
let perfChartMetrics = [];
let analyticsPoolSelection = loadAnalyticsPoolSelection();
let perfDailyYieldPct = null;
let perfOutlierCount = 0;

function formatRange(range) {
  if (!range) return "-";
  return `${Number(range.lower).toFixed(6)} / ${Number(range.upper).toFixed(6)}`;
}

const numberFormatters = {};

function formatNumber(value, digits = 6) {
  if (value === null || value === undefined) return "-";
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  const key = String(digits);
  let formatter = numberFormatters[key];
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: false
    });
    numberFormatters[key] = formatter;
  }
  return formatter.format(num);
}

function formatTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const day = parts.find((p) => p.type === "day")?.value ?? "--";
  const month = parts.find((p) => p.type === "month")?.value ?? "--";
  const year = parts.find((p) => p.type === "year")?.value ?? "----";
  const hour = parts.find((p) => p.type === "hour")?.value ?? "--";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "--";
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

function formatCloseTimestamp(item) {
  if (!item) return "-";
  if (!item.positionClosedAt) return "-";
  return formatTimestamp(item.positionClosedAt);
}

function sumNumeric(items, key) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((acc, item) => acc + (Number(item?.[key]) || 0), 0);
}

function setMetricToggleState(input) {
  const label = input?.closest("label");
  if (label) {
    label.classList.toggle("is-checked", input.checked);
  }
}

function updatePerfCalculator() {
  if (!perfCalcFees || !perfCalcRoi) return;
  const capital = perfCalcCapital ? Number(perfCalcCapital.value) : NaN;
  const days = perfCalcDays ? Number(perfCalcDays.value) : NaN;
  if (!Number.isFinite(capital) || capital <= 0 || !Number.isFinite(days) || days <= 0) {
    perfCalcFees.textContent = "-";
    perfCalcRoi.textContent = "-";
    return;
  }
  if (!Number.isFinite(perfDailyYieldPct ?? NaN)) {
    perfCalcFees.textContent = "-";
    perfCalcRoi.textContent = "-";
    return;
  }
  const roi = perfDailyYieldPct * days;
  const fees = capital * (roi / 100);
  perfCalcFees.textContent = formatNumber(fees, 2);
  perfCalcRoi.textContent = `${formatNumber(roi, 2)}%`;
}

function formatMetricValue(key, value) {
  if (value === null || value === undefined) return "-";
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  const formatted = formatNumber(num, 2);
  if (formatted === "-") return formatted;
  return isPercentMetric(key) ? `${formatted}%` : formatted;
}

function toDateInputValue(date) {
  const tzOffset = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - tzOffset);
  return local.toISOString().slice(0, 16);
}

async function fetchPools() {
  const res = await fetch("/api/pools");
  return res.json();
}

async function fetchHistory(poolId) {
  const res = await fetch(`/api/history/${poolId}`);
  if (!res.ok) {
    throw new Error("Falha ao carregar histórico");
  }
  return res.json();
}

function renderHistory(items) {
  if (!items || items.length === 0) {
    historyBody.innerHTML = "<tr><td colspan=\"15\">Sem eventos ainda</td></tr>";
    return;
  }
  const limit = analyticsRowLimit ?? 30;
  const rows = items.slice(0, limit).map((item) => {
    const actionLabel = actionLabels[item.action] ?? item.action ?? "-";
    const typeLabel = actionTypeLabels[item.actionType] ?? item.actionType ?? "-";
    const metrics = getHistoryEventMetrics(item);
    return `
      <tr>
        <td data-col="datetime">${formatTimestamp(item.timestamp)}</td>
        <td data-col="openAt">${formatTimestamp(item.positionOpenedAt)}</td>
        <td data-col="close">${formatCloseTimestamp(item)}</td>
        <td data-col="type">${typeLabel}</td>
        <td data-col="action">${actionLabel}</td>
        <td data-col="price">${formatNumber(item.price, 8)}</td>
        <td data-col="targetRange">${formatRange(item.targetRange)}</td>
        <td data-col="mint">${item.positionMint ?? "-"}</td>
        <td data-col="entryUsd">${formatNumber(item.positionEntryUsd, 2)}</td>
        <td data-col="feesUsd">${formatNumber(item.positionFeesUsd, 2)}</td>
        <td data-col="txFeeUsd">${formatNumber(item.txFeeUsd, 6)}</td>
        <td data-col="exitUsd">${formatNumber(item.positionExitUsd, 2)}</td>
        <td data-col="pnlUsd">${formatNumber(metrics.pnl, 2)}</td>
        <td data-col="pnlTotal">${formatNumber(metrics.pnlTotal, 2)}</td>
        <td data-col="pnlTotalNet">${formatNumber(metrics.pnlTotalNet, 2)}</td>
      </tr>
    `;
  });
  historyBody.innerHTML = rows.join("");
  applyAnalyticsColumnVisibility();
}

function updateSummary(items, options = {}) {
  const total = items.length;
  const opens = items.filter((i) => i.action === "open-position").length;
  const rebalances = items.filter((i) => i.action === "rebalanced" || i.action === "kamino-rebalanced").length;
  const closes = items.filter((i) => isPerformanceCloseEvent(i)).length;

  const sum = (list, key) => list.reduce((acc, item) => acc + (Number(item[key]) || 0), 0);
  const inA = sum(items, "openTokenA");
  const inB = sum(items, "openTokenB");
  const outA = sum(items, "closeTokenA");
  const outB = sum(items, "closeTokenB");

  const performance = summarizePerformance(items, {
    start: startInput?.value,
    end: endInput?.value
  });

  let netSol = null;
  let netUsd = null;
  if (!options.aggregate && items.length > 1) {
    const first = items[items.length - 1];
    const last = items[0];
    if (first?.portfolioValue != null && last?.portfolioValue != null) {
      netSol = Number(last.portfolioValue) - Number(first.portfolioValue);
    }
    if (first?.portfolioUsd != null && last?.portfolioUsd != null) {
      netUsd = Number(last.portfolioUsd) - Number(first.portfolioUsd);
    }
  }

  summaryEvents.textContent = String(total);
  summaryOpens.textContent = String(opens);
  summaryRebalances.textContent = String(rebalances);
  summaryCloses.textContent = String(closes);
  summaryPnlSol.textContent = performance.pnlSol != null ? formatNumber(performance.pnlSol, 6) : "-";
  summaryPnlUsd.textContent = performance.pnlUsd != null ? formatNumber(performance.pnlUsd, 2) : "-";
  summaryNetSol.textContent = formatNumber(netSol, 6);
  summaryNetUsd.textContent = formatNumber(netUsd, 2);
  summaryInA.textContent = formatNumber(inA, 6);
  summaryInB.textContent = formatNumber(inB, 6);
  summaryOutA.textContent = formatNumber(outA, 6);
  summaryOutB.textContent = formatNumber(outB, 6);
}

function loadAnalyticsColumnVisibility() {
  const raw = localStorage.getItem("analyticsColumnVisibility");
  if (!raw) return { ...analyticsColumnDefaults };
  try {
    const parsed = JSON.parse(raw);
    return { ...analyticsColumnDefaults, ...parsed };
  } catch {
    return { ...analyticsColumnDefaults };
  }
}

function loadAnalyticsPoolSelection() {
  const raw = localStorage.getItem("analyticsPoolSelection");
  if (!raw) return null;
  return raw;
}

function saveAnalyticsPoolSelection() {
  if (!analyticsPoolSelection) {
    localStorage.removeItem("analyticsPoolSelection");
    return;
  }
  localStorage.setItem("analyticsPoolSelection", analyticsPoolSelection);
}

function loadAnalyticsTypeVisibility() {
  const raw = localStorage.getItem("analyticsTypeFilters");
  if (!raw) return { ...analyticsTypeDefaults };
  try {
    const parsed = JSON.parse(raw);
    return { ...analyticsTypeDefaults, ...parsed };
  } catch {
    return { ...analyticsTypeDefaults };
  }
}

function saveAnalyticsColumnVisibility() {
  localStorage.setItem("analyticsColumnVisibility", JSON.stringify(analyticsColumnVisibility));
}

function saveAnalyticsTypeVisibility() {
  localStorage.setItem("analyticsTypeFilters", JSON.stringify(analyticsTypeVisibility));
}

function applyAnalyticsColumnVisibility() {
  if (!analyticsColumnVisibility) return;
  Object.entries(analyticsColumnVisibility).forEach(([col, visible]) => {
    document.querySelectorAll(`[data-col="${col}"]`).forEach((el) => {
      el.classList.toggle("col-hidden", !visible);
    });
  });
  syncAnalyticsColumnControls();
}

function syncAnalyticsTypeControls() {
  if (!analyticsTypeFilters) return;
  analyticsTypeFilters.querySelectorAll("input[data-type]").forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    const type = input.getAttribute("data-type");
    if (!type) return;
    input.checked = analyticsTypeVisibility[type] !== false;
  });
}

function syncAnalyticsColumnControls() {
  if (!analyticsColumnFilters) return;
  analyticsColumnFilters.querySelectorAll("input[data-col]").forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    const col = input.getAttribute("data-col");
    if (!col) return;
    input.checked = analyticsColumnVisibility[col] !== false;
  });
}

function normalizeAnalyticsActionType(value) {
  if (!value) return "operacional";
  if (value === "fechamento + abertura") return value;
  if (Object.prototype.hasOwnProperty.call(analyticsTypeDefaults, value)) {
    return value;
  }
  return "operacional";
}

function getAnalyticsEventTypes(item) {
  const raw = normalizeAnalyticsActionType(item?.actionType);
  if (raw === "fechamento + abertura") {
    return ["fechamento", "abertura"];
  }
  return [raw];
}

function applyAnalyticsTypeFilter(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    const types = getAnalyticsEventTypes(item);
    return types.some((type) => analyticsTypeVisibility[type] !== false);
  });
}

function loadAnalyticsRowLimit() {
  const raw = localStorage.getItem("analyticsRowLimit");
  if (!raw) return 30;
  const parsed = Number(raw);
  return [10, 20, 30].includes(parsed) ? parsed : 30;
}

function saveAnalyticsRowLimit() {
  localStorage.setItem("analyticsRowLimit", String(analyticsRowLimit));
}

function syncAnalyticsRowLimit() {
  if (!analyticsRowLimitSelect) return;
  analyticsRowLimitSelect.value = String(analyticsRowLimit ?? 30);
}

function loadPerfGroup() {
  const raw = localStorage.getItem("perfGroup");
  return ["day", "week", "month"].includes(raw) ? raw : "day";
}

function savePerfGroup() {
  localStorage.setItem("perfGroup", perfGroup);
}

function loadPerfMetricVisibility() {
  const raw = localStorage.getItem("perfMetricVisibility");
  const version = localStorage.getItem("perfMetricVisibilityVersion");
  if (!raw || version !== PERF_METRIC_VISIBILITY_VERSION) {
    const defaults = { ...perfMetricDefaults };
    localStorage.setItem("perfMetricVisibility", JSON.stringify(defaults));
    localStorage.setItem("perfMetricVisibilityVersion", PERF_METRIC_VISIBILITY_VERSION);
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw);
    return { ...perfMetricDefaults, ...parsed };
  } catch {
    return { ...perfMetricDefaults };
  }
}

function savePerfMetricVisibility() {
  localStorage.setItem("perfMetricVisibility", JSON.stringify(perfMetricVisibility));
  localStorage.setItem("perfMetricVisibilityVersion", PERF_METRIC_VISIBILITY_VERSION);
}

function syncPerfControls() {
  if (perfGroupSelect) {
    perfGroupSelect.value = perfGroup;
  }
  if (perfMetrics) {
    perfMetrics.querySelectorAll("input[data-series]").forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      const key = input.getAttribute("data-series");
      if (!key) return;
      input.checked = perfMetricVisibility[key] !== false;
      setMetricToggleState(input);
    });
  }
}

async function selectPoolOnServer(poolId) {
  const res = await fetch(`/api/pools/${poolId}/select`, { method: "POST" });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Falha ao selecionar pool");
  }
  return res.json();
}

let perfChart = null;

function ensurePerfChart() {
  if (perfChart || !perfCanvas) {
    return perfChart;
  }
  perfChart = createCategoryChart(perfCanvas, {
    height: 300,
    tooltipEl: perfTooltip,
    formatValue: (value) => formatNumber(value, 2),
    renderTooltip: (idx, label, seriesDefs) => {
      const point = perfChartPoints[idx];
      if (!point) return "";
      const lines = seriesDefs
        .map((def) => {
          const value = point[def.key];
          const text = perfMetricTooltipLabels[def.key] ?? perfMetricLabels[def.key] ?? def.key;
          return `<div class="line"><span>${text}</span><span>${formatMetricValue(def.key, value)}</span></div>`;
        })
        .join("");
      return `<div class="title">${label}</div>${lines}`;
    }
  });
  return perfChart;
}

function clearPerformanceChart() {
  perfChartPoints = [];
  perfChartMetrics = [];
  if (perfChart) {
    perfChart.destroy();
  }
  hidePerfTooltip();
}

/**
 * Desenha as metricas selecionadas.
 *
 * Metricas em % passaram a usar um eixo proprio a direita, entao convivem no
 * mesmo grafico com as metricas em USD — antes uma excluia a outra.
 */
function drawPerformanceChart(series) {
  const chart = ensurePerfChart();
  if (!chart) return;
  if (!series.length) {
    clearPerformanceChart();
    return;
  }

  const drawableMetrics = perfMetricOrder.filter((key) => perfMetricVisibility[key] !== false);
  if (!drawableMetrics.length) {
    clearPerformanceChart();
    setPerfChartNotice(null);
    return;
  }

  perfChartPoints = series;
  perfChartMetrics = drawableMetrics;
  setPerfChartNotice({ percentMetrics: drawableMetrics.filter((key) => isPercentMetric(key)) });

  const labels = series.map((point) => point.label);
  const seriesDefs = drawableMetrics.map((key) => ({
    key,
    label: perfMetricLabels[key] ?? key,
    color: perfMetricColor(key),
    dash: PERF_DASHED_METRICS.has(key),
    scale: isPercentMetric(key) ? "pct" : "val"
  }));
  const columns = {};
  for (const key of drawableMetrics) {
    columns[key] = series.map((point) => {
      const raw = point[key];
      const value = raw === null || raw === undefined ? Number.NaN : Number(raw);
      return Number.isFinite(value) ? value : null;
    });
  }
  chart.update(labels, seriesDefs, columns);
}

function hidePerfTooltip() {
  if (!perfTooltip) return;
  perfTooltip.classList.add("hidden");
}

function setPerfChartNotice(selection) {
  if (!perfChartNotice) return;
  const messages = [];
  // Metricas em % agora convivem com as em USD usando o eixo da direita, entao
  // nao ha mais metrica "oculta" — so precisamos avisar onde ler o valor.
  if (selection?.percentMetrics?.length) {
    const labels = selection.percentMetrics
      .map((key) => perfMetricLabels[key] ?? key)
      .join(", ");
    messages.push(`${labels} usa o eixo percentual à direita.`);
  }
  if (perfOutlierCount > 0) {
    messages.push(`${perfOutlierCount} evento(s) com PnL fora da faixa esperada foram ignorados no gráfico/resumo. Confira a tabela para ajustar entrada, saída ou PnL se necessário.`);
  }
  if (messages.length) {
    perfChartNotice.textContent = messages.join(" ");
    perfChartNotice.classList.remove("hidden");
    return;
  }
  perfChartNotice.textContent = "";
  perfChartNotice.classList.add("hidden");
}

function updatePerformanceStats(items) {
  const stats = summarizePerformance(items, {
    start: startInput?.value,
    end: endInput?.value
  });
  perfDailyYieldPct = stats.dailyFeeYieldPct;
  perfOutlierCount = stats.outlierCount ?? 0;
  if (perfFeesCumStat) {
    perfFeesCumStat.textContent = stats.closeCount ? formatNumber(stats.totalFeesUsd, 2) : "-";
  }
  if (perfFeeYieldStat) {
    perfFeeYieldStat.textContent = stats.feeYieldPct != null ? `${formatNumber(stats.feeYieldPct, 2)}%` : "-";
  }

  updatePerfCalculator();
}

/* ==========================================================================
   Graficos de serie temporal (/api/snapshots)
   ========================================================================== */

let equityChart = null;
let rangeChart = null;
let ltvChart = null;
let snapshotPoints = [];

function formatSnapshotTime(seconds) {
  return new Date(seconds * 1000).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function snapshotTooltip(idx, xSeconds, defs, columns) {
  const lines = defs
    .map((def) => {
      const value = columns[def.key]?.[idx];
      const text =
        value == null
          ? "-"
          : def.scale === "pct"
            ? `${Number(value).toFixed(2)}%`
            : formatNumber(value, def.digits ?? 4);
      return `<div class="line"><span>${def.label}</span><span>${text}</span></div>`;
    })
    .join("");
  return `<div class="title">${formatSnapshotTime(xSeconds)}</div>${lines}`;
}

function toggleChartEmpty(el, empty, message) {
  if (!el) return;
  if (message) {
    el.textContent = message;
  }
  el.classList.toggle("hidden", !empty);
}

async function fetchSnapshots(poolId, bucket) {
  const params = new URLSearchParams();
  if (startInput.value) params.set("from", new Date(startInput.value).getTime());
  if (endInput.value) params.set("to", new Date(endInput.value).getTime());
  if (bucket) params.set("bucket", bucket);
  const res = await fetch(`/api/snapshots/${poolId}?${params.toString()}`);
  if (!res.ok) {
    return { points: [] };
  }
  return res.json();
}

function renderEquityChart(points) {
  if (!equityChartEl) return;
  const keys = ["posValueUsd", "posPnlUsd", "posFeesUsd"];
  const { xs, columns } = snapshotColumns(points, [...keys, "portfolioUsd"]);
  // Taxas e valor zeram quando a posicao troca: quebrar a linha evita
  // desenhar uma queda que parece prejuizo.
  const split = splitOnPositionChange(points, columns, keys);
  const defs = [
    { key: "posValueUsd", label: "Valor da posição", color: seriesColor("equity", "#36d399"), digits: 2 },
    { key: "posPnlUsd", label: "PnL da posição", color: seriesColor("pnlNet", "#4ea1ff"), digits: 4 },
    { key: "posFeesUsd", label: "Taxas acumuladas", color: seriesColor("feesCum", "#f6c343"), digits: 4 }
  ];
  const hasData = defs.some((def) => split[def.key].some((v) => v != null));
  toggleChartEmpty(equityEmpty, !hasData);
  if (!hasData) {
    equityChart?.destroy();
    return;
  }
  if (!equityChart) {
    equityChart = createTimeChart(equityChartEl, {
      height: 260,
      tooltipEl: equityTooltip,
      formatValue: (v) => formatNumber(v, 2),
      renderTooltip: (idx, x, defsIn) => snapshotTooltip(idx, x, defsIn, split)
    });
  }
  equityChart.update(xs, defs, split);
}

function renderRangeChart(points) {
  if (!rangeChartEl) return;
  const keys = ["price", "posLower", "posUpper", "rangeLower", "rangeUpper"];
  const { xs, columns } = snapshotColumns(points, keys);
  const bandColor = seriesColor("equity", "#36d399");
  const defs = [
    {
      key: "posUpper",
      label: "Topo da posição",
      color: "rgba(54, 211, 153, 0.35)",
      width: 1,
      dash: true,
      bandWith: "posLower",
      bandFill: "rgba(54, 211, 153, 0.10)"
    },
    { key: "posLower", label: "Base da posição", color: "rgba(54, 211, 153, 0.35)", width: 1, dash: true },
    { key: "price", label: "Preço", color: seriesColor("price", "#4ea1ff"), width: 2, digits: 6 }
  ];
  const hasData = columns.price.some((v) => v != null);
  toggleChartEmpty(rangeEmpty, !hasData);
  if (!hasData) {
    rangeChart?.destroy();
    return;
  }
  if (!rangeChart) {
    rangeChart = createTimeChart(rangeChartEl, {
      height: 240,
      axisSize: 92,
      tooltipEl: rangeTooltip,
      formatValue: (v) => formatNumber(v, 6),
      renderTooltip: (idx, x, defsIn) => snapshotTooltip(idx, x, defsIn, columns)
    });
  }
  rangeChart.update(xs, defs, columns);
  void bandColor;
}

function renderLtvChart(points) {
  if (!ltvChartEl) return;
  const { xs, columns } = snapshotColumns(points, ["kLtv", "kDebtUsd", "kCollatUsd"]);
  const hasLoan = columns.kDebtUsd.some((v) => v != null) || columns.kLtv.some((v) => v != null);
  if (ltvBlock) {
    // Sem emprestimo no periodo o bloco inteiro sai da pagina, em vez de
    // ocupar espaco com um grafico vazio.
    ltvBlock.classList.toggle("hidden", !hasLoan);
  }
  toggleChartEmpty(ltvEmpty, !hasLoan);
  if (!hasLoan) {
    ltvChart?.destroy();
    return;
  }
  // O LTV vem em fracao (0-1) e e mostrado em %, no eixo da direita.
  const pctColumns = { ...columns, kLtv: columns.kLtv.map((v) => (v == null ? null : v * 100)) };
  const defs = [
    { key: "kCollatUsd", label: "Colateral (USD)", color: seriesColor("equity", "#36d399"), digits: 2 },
    { key: "kDebtUsd", label: "Dívida (USD)", color: seriesColor("pnlTotal", "#f472b6"), digits: 2 },
    { key: "kLtv", label: "LTV", color: seriesColor("ltv", "#f6c343"), scale: "pct", digits: 2 }
  ];
  if (!ltvChart) {
    ltvChart = createTimeChart(ltvChartEl, {
      height: 240,
      tooltipEl: ltvTooltip,
      formatValue: (v) => formatNumber(v, 2),
      renderTooltip: (idx, x, defsIn) => snapshotTooltip(idx, x, defsIn, pctColumns)
    });
  }
  ltvChart.update(xs, defs, pctColumns);
}

function renderSnapshotCharts(points) {
  snapshotPoints = points;
  if (snapshotMeta) {
    snapshotMeta.textContent = points.length
      ? `${points.length} amostra(s) no período.`
      : "Nenhuma amostra registrada no período. As amostras começam a ser gravadas quando a pool roda.";
  }
  renderEquityChart(points);
  renderRangeChart(points);
  renderLtvChart(points);
}

async function updateSnapshotCharts(poolId) {
  if (!equityChartEl) return;
  // "Todas as pools" nao faz sentido aqui: as series sao por pool.
  if (!poolId || poolId === ALL_POOLS_ID) {
    renderSnapshotCharts([]);
    if (snapshotMeta) {
      snapshotMeta.textContent = "Selecione uma pool específica para ver a evolução no tempo.";
    }
    return;
  }
  try {
    const data = await fetchSnapshots(poolId, snapshotBucketSelect?.value ?? "15m");
    renderSnapshotCharts(Array.isArray(data?.points) ? data.points : []);
  } catch {
    renderSnapshotCharts([]);
  }
}

if (snapshotBucketSelect) {
  snapshotBucketSelect.addEventListener("change", () => {
    void updateSnapshotCharts(poolSelect.value);
  });
}

async function refresh() {
  try {
    errorBox.classList.add("hidden");
    const poolsData = await fetchPools();
    const pools = poolsData?.pools ?? [];
    const options = [`<option value="${ALL_POOLS_ID}">Todas as pools</option>`].concat(
      pools.map((pool) => `<option value="${pool.id}">${pool.name}</option>`)
    );
    poolSelect.innerHTML = options.join("");

    if (!pools.length) {
      renderHistory([]);
      updateSummary([], { aggregate: false });
      renderSnapshotCharts([]);
      return;
    }

    let selectedId = analyticsPoolSelection || poolsData.selectedPoolId || pools[0].id;
    if (selectedId !== ALL_POOLS_ID && !pools.find((pool) => pool.id === selectedId)) {
      selectedId = poolsData.selectedPoolId || pools[0].id;
    }
    poolSelect.value = selectedId;
    analyticsPoolSelection = selectedId;
    saveAnalyticsPoolSelection();
    let history = [];
    if (selectedId === ALL_POOLS_ID) {
      const histories = await Promise.all(
        pools.map(async (pool) => {
          const items = await fetchHistory(pool.id);
          return items.map((item) => ({ ...item, poolId: pool.id, poolName: pool.name }));
        })
      );
      history = histories.flat().sort((a, b) => {
        const at = Date.parse(a.timestamp ?? "");
        const bt = Date.parse(b.timestamp ?? "");
        if (!Number.isFinite(at) && !Number.isFinite(bt)) return 0;
        if (!Number.isFinite(at)) return 1;
        if (!Number.isFinite(bt)) return -1;
        return bt - at;
      });
    } else {
      history = await fetchHistory(selectedId);
    }
    const start = startInput.value ? new Date(startInput.value) : null;
    const end = endInput.value ? new Date(endInput.value) : null;
    const filtered = history.filter((item) => {
      if (!item.timestamp) return false;
      const date = new Date(item.timestamp);
      if (Number.isNaN(date.getTime())) return false;
      if (start && date < start) return false;
      if (end && date > end) return false;
      return true;
    });
    const typeFiltered = applyAnalyticsTypeFilter(filtered);
    renderHistory(typeFiltered);
    updateSummary(typeFiltered, { aggregate: selectedId === ALL_POOLS_ID });
    updatePerformance(typeFiltered);
    await updateSnapshotCharts(selectedId);
  } catch (err) {
    errorBox.textContent = err instanceof Error ? err.message : String(err);
    errorBox.classList.remove("hidden");
  }
}

function showPerfEmpty(message) {
  perfEmpty.textContent = message;
  perfEmpty.classList.remove("hidden");
  perfEmpty.style.display = "flex";
  clearPerformanceChart();
  setPerfChartNotice(null);
}

function updatePerformance(items) {
  if (!perfCanvas || !perfEmpty) return;
  updatePerformanceStats(items);
  const activeMetrics = perfMetricOrder.filter((key) => perfMetricVisibility[key] !== false);
  if (!activeMetrics.length) {
    showPerfEmpty("Selecione ao menos uma métrica");
    return;
  }
  const series = aggregatePerformance(items, perfGroup);
  if (!series.length) {
    showPerfEmpty("Sem dados no período");
    return;
  }
  perfEmpty.classList.add("hidden");
  perfEmpty.style.display = "none";
  drawPerformanceChart(series);
}

applyBtn.addEventListener("click", () => {
  refresh();
});

poolSelect.addEventListener("change", () => {
  const selectedId = poolSelect.value;
  analyticsPoolSelection = selectedId;
  saveAnalyticsPoolSelection();
  if (selectedId === ALL_POOLS_ID) {
    refresh();
    return;
  }
  selectPoolOnServer(selectedId)
    .then(() => refresh())
    .catch((err) => {
      errorBox.textContent = err instanceof Error ? err.message : String(err);
      errorBox.classList.remove("hidden");
    });
});

if (analyticsColumnFilters) {
  analyticsColumnFilters.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const col = target.getAttribute("data-col");
    if (!col) return;
    analyticsColumnVisibility = { ...analyticsColumnVisibility, [col]: target.checked };
    saveAnalyticsColumnVisibility();
    applyAnalyticsColumnVisibility();
  });
}

if (analyticsTypeFilters) {
  analyticsTypeFilters.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const type = target.getAttribute("data-type");
    if (!type) return;
    analyticsTypeVisibility = { ...analyticsTypeVisibility, [type]: target.checked };
    saveAnalyticsTypeVisibility();
    refresh();
  });
}

if (analyticsRowLimitSelect) {
  analyticsRowLimitSelect.addEventListener("change", () => {
    const value = Number(analyticsRowLimitSelect.value);
    analyticsRowLimit = [10, 20, 30].includes(value) ? value : 30;
    saveAnalyticsRowLimit();
    refresh();
  });
}

if (perfGroupSelect) {
  perfGroupSelect.addEventListener("change", () => {
    perfGroup = perfGroupSelect.value;
    savePerfGroup();
    refresh();
  });
}

if (perfMetrics) {
  perfMetrics.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const key = target.getAttribute("data-series");
    if (!key) return;
    perfMetricVisibility = { ...perfMetricVisibility, [key]: target.checked };
    setMetricToggleState(target);
    savePerfMetricVisibility();
    refresh();
  });
}

if (perfCalcCapital) {
  perfCalcCapital.addEventListener("input", () => {
    updatePerfCalculator();
  });
}

if (perfCalcDays) {
  perfCalcDays.addEventListener("input", () => {
    updatePerfCalculator();
  });
}

const now = new Date();
const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
startInput.value = toDateInputValue(weekAgo);
endInput.value = toDateInputValue(now);

refresh();
applyAnalyticsColumnVisibility();
syncAnalyticsTypeControls();
syncAnalyticsRowLimit();
syncPerfControls();
