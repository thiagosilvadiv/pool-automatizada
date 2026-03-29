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
const perfMetrics = document.querySelector(".performance-metrics");
const perfFeesCumStat = document.getElementById("perfFeesCumStat");
const perfFeeYieldStat = document.getElementById("perfFeeYieldStat");
const perfCalcCapital = document.getElementById("perfCalcCapital");
const perfCalcDays = document.getElementById("perfCalcDays");
const perfCalcFees = document.getElementById("perfCalcFees");
const perfCalcRoi = document.getElementById("perfCalcRoi");

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
  "swap": "swap"
};

const actionTypeLabels = {
  "abertura": "Abertura",
  "fechamento": "Fechamento",
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
  trend: true,
  price: true,
  targetRange: true,
  mint: true,
  entryUsd: true,
  feesUsd: true,
  txFeeUsd: true,
  exitUsd: true,
  pnlUsd: true,
  hedgeSymbol: true,
  hedgeNotional: true,
  hedgeLeverage: true,
  hedgeFees: true,
  hedgePnl: true,
  hedgeDecision: true,
  hedgeDecisionReason: true,
  pnlTotal: true,
  pnlTotalNet: true
};

let analyticsColumnVisibility = loadAnalyticsColumnVisibility();
const analyticsTypeDefaults = {
  abertura: true,
  fechamento: true,
  monitorando: true,
  operacional: true
};
let analyticsTypeVisibility = loadAnalyticsTypeVisibility();
let analyticsRowLimit = loadAnalyticsRowLimit();

const perfMetricDefaults = {
  fees: true,
  feesCum: true,
  feeYieldPct: true,
  pnl: true,
  pnlNet: true,
  pnlTotal: true,
  pnlTotalNet: true,
  pnlCum: true,
  pnlNetCum: true
};

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
  pnl: "PnL",
  pnlNet: "PnL sem taxas",
  pnlTotal: "PnL com hedge e Taxas",
  pnlTotalNet: "PnL total com hedge sem taxas (USD)",
  pnlCum: "PnL acumulado",
  pnlNetCum: "PnL sem taxas acumulado"
};

const perfMetricTooltipLabels = {
  fees: "Taxas",
  feesCum: "Taxas acum.",
  feeYieldPct: "Rend. taxa (%)",
  pnl: "PnL",
  pnlNet: "PnL s/ taxas",
  pnlTotal: "PnL hedge + taxas",
  pnlTotalNet: "PnL hedge s/ taxas",
  pnlCum: "PnL acum.",
  pnlNetCum: "PnL s/ taxas acum."
};

const perfMetricColors = {
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

let perfGroup = loadPerfGroup();
let perfMetricVisibility = loadPerfMetricVisibility();
let perfChartPoints = [];
let perfChartMetrics = [];
let analyticsPoolSelection = loadAnalyticsPoolSelection();
let perfDailyYieldPct = null;

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

function formatTrendDirection(value) {
  if (value === "up") return "Alta";
  if (value === "down") return "Baixa";
  return "-";
}

function formatHedgeDecision(value) {
  if (value === "opened") return "Abriu";
  if (value === "skipped") return "Ignorado";
  if (value === "failed") return "Falhou";
  return value ?? "-";
}

function sumNumeric(items, key) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((acc, item) => acc + (Number(item?.[key]) || 0), 0);
}

function averageNumeric(items, key) {
  if (!Array.isArray(items)) return null;
  let sum = 0;
  let count = 0;
  items.forEach((item) => {
    const value = Number(item?.[key]);
    if (Number.isFinite(value) && value > 0) {
      sum += value;
      count += 1;
    }
  });
  return count > 0 ? sum / count : null;
}

function getPerfPeriodDays(items) {
  const start = startInput?.value ? new Date(startInput.value) : null;
  const end = endInput?.value ? new Date(endInput.value) : null;
  let diffMs = null;
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    diffMs = end.getTime() - start.getTime();
  }
  if (!(diffMs > 0)) {
    const times = (items || []).map((item) => Date.parse(item?.timestamp ?? "")).filter(Number.isFinite);
    if (times.length >= 2) {
      diffMs = Math.max(...times) - Math.min(...times);
    }
  }
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 1;
  return Math.max(1, diffMs / (24 * 60 * 60 * 1000));
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

function isPercentMetric(key) {
  return key === "feeYieldPct";
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

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + diff);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function labelForBucket(date, group) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  if (group === "week") {
    return `Sem ${day}/${month}`;
  }
  if (group === "month") {
    return `${month}/${year}`;
  }
  return `${day}/${month}`;
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
    historyBody.innerHTML = "<tr><td colspan=\"23\">Sem eventos ainda</td></tr>";
    return;
  }
  const limit = analyticsRowLimit ?? 30;
  const rows = items.slice(0, limit).map((item) => {
    const actionLabel = actionLabels[item.action] ?? item.action ?? "-";
    const typeLabel = actionTypeLabels[item.actionType] ?? item.actionType ?? "-";
    const pnlRaw = Number(item.positionPnlUsd);
    const hedgeRaw = Number(item.hedgePnlUsd);
    const hasPnl = Number.isFinite(pnlRaw);
    const hasHedge = Number.isFinite(hedgeRaw);
    const feesRaw = Number(item.positionFeesUsd);
    const fees = Number.isFinite(feesRaw) ? feesRaw : 0;
    const poolPnl = hasPnl ? pnlRaw : 0;
    const hedgePnl = hasHedge ? hedgeRaw : 0;
    const pnlTotal = hasPnl || hasHedge ? poolPnl + hedgePnl : null;
    const pnlTotalNet = hasPnl || hasHedge ? (hasPnl ? poolPnl - fees : 0) + hedgePnl : null;
    return `
      <tr>
        <td data-col="datetime">${formatTimestamp(item.timestamp)}</td>
        <td data-col="openAt">${formatTimestamp(item.positionOpenedAt)}</td>
        <td data-col="close">${formatCloseTimestamp(item)}</td>
        <td data-col="type">${typeLabel}</td>
        <td data-col="action">${actionLabel}</td>
        <td data-col="trend">${formatTrendDirection(item.trendDirection)}</td>
        <td data-col="price">${formatNumber(item.price, 8)}</td>
        <td data-col="targetRange">${formatRange(item.targetRange)}</td>
        <td data-col="mint">${item.positionMint ?? "-"}</td>
        <td data-col="entryUsd">${formatNumber(item.positionEntryUsd, 2)}</td>
        <td data-col="feesUsd">${formatNumber(item.positionFeesUsd, 2)}</td>
        <td data-col="txFeeUsd">${formatNumber(item.txFeeUsd, 6)}</td>
        <td data-col="exitUsd">${formatNumber(item.positionExitUsd, 2)}</td>
        <td data-col="pnlUsd">${formatNumber(item.positionPnlUsd, 2)}</td>
        <td data-col="hedgeSymbol">${item.hedgeSymbol ?? "-"}</td>
        <td data-col="hedgeNotional">${formatNumber(item.hedgeNotionalUsd, 2)}</td>
        <td data-col="hedgeLeverage">${formatNumber(item.hedgeLeverage, 2)}</td>
        <td data-col="hedgeFees">${formatNumber(item.hedgeFeesUsd, 2)}</td>
        <td data-col="hedgePnl">${formatNumber(item.hedgePnlUsd, 2)}</td>
        <td data-col="hedgeDecision">${formatHedgeDecision(item.hedgeDecision)}</td>
        <td data-col="hedgeDecisionReason">${item.hedgeDecisionReason ?? "-"}</td>
        <td data-col="pnlTotal">${formatNumber(pnlTotal, 2)}</td>
        <td data-col="pnlTotalNet">${formatNumber(pnlTotalNet, 2)}</td>
      </tr>
    `;
  });
  historyBody.innerHTML = rows.join("");
  applyAnalyticsColumnVisibility();
}

function updateSummary(items, options = {}) {
  const total = items.length;
  const opens = items.filter((i) => i.action === "open-position").length;
  const rebalances = items.filter((i) => i.action === "rebalanced").length;
  const closes = items.filter((i) => i.action === "close-position").length;

  const sum = (list, key) => list.reduce((acc, item) => acc + (Number(item[key]) || 0), 0);
  const inA = sum(items, "openTokenA");
  const inB = sum(items, "openTokenB");
  const outA = sum(items, "closeTokenA");
  const outB = sum(items, "closeTokenB");

  const pnlSolDelta = sum(items, "pnlDelta");
  const pnlUsdDelta = sum(items, "pnlDeltaUsd");

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
  summaryPnlSol.textContent = formatNumber(pnlSolDelta, 6);
  summaryPnlUsd.textContent = formatNumber(pnlUsdDelta, 2);
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
  if (!raw) return { ...perfMetricDefaults };
  try {
    const parsed = JSON.parse(raw);
    return { ...perfMetricDefaults, ...parsed };
  } catch {
    return { ...perfMetricDefaults };
  }
}

function savePerfMetricVisibility() {
  localStorage.setItem("perfMetricVisibility", JSON.stringify(perfMetricVisibility));
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

function getPerfBucketKey(date, group) {
  const d = group === "month" ? startOfMonth(date)
    : group === "week" ? startOfWeek(date)
      : startOfDay(date);
  return d.toISOString();
}

function aggregatePerformance(items, group) {
  const buckets = new Map();
  items.forEach((item) => {
    if (item?.action !== "close-position") return;
    if (!item?.timestamp) return;
    const date = new Date(item.timestamp);
    if (Number.isNaN(date.getTime())) return;
    const key = getPerfBucketKey(date, group);
    const bucket = buckets.get(key) ?? {
      date: group === "month" ? startOfMonth(date)
        : group === "week" ? startOfWeek(date)
          : startOfDay(date),
      entrySum: 0,
      entryCount: 0,
      fees: 0,
      pnl: 0,
      pnlNet: 0,
      pnlTotal: 0,
      pnlTotalNet: 0
    };
    const fees = Number(item.positionFeesUsd) || 0;
    const pnlRaw = Number(item.positionPnlUsd);
    const hedgeRaw = Number(item.hedgePnlUsd);
    const hasPnl = Number.isFinite(pnlRaw);
    const hasHedge = Number.isFinite(hedgeRaw);
    if (!hasPnl && !hasHedge) {
      return;
    }
    const pnl = hasPnl ? pnlRaw : 0;
    const hedgePnl = hasHedge ? hedgeRaw : 0;
    const entryUsd = Number(item.positionEntryUsd);
    bucket.fees += fees;
    if (Number.isFinite(entryUsd) && entryUsd > 0) {
      bucket.entrySum += entryUsd;
      bucket.entryCount += 1;
    }
    const pnlNet = pnl - fees;
    bucket.pnl += pnl;
    bucket.pnlNet += pnlNet;
    bucket.pnlTotal += pnl + hedgePnl;
    bucket.pnlTotalNet += pnlNet + hedgePnl;
    buckets.set(key, bucket);
  });
  const series = Array.from(buckets.values()).sort((a, b) => a.date - b.date);
  let runningPnl = 0;
  let runningNet = 0;
  let runningFees = 0;
  return series.map((entry) => {
    runningPnl += entry.pnl;
    runningNet += entry.pnlNet;
    runningFees += entry.fees;
    return {
      label: labelForBucket(entry.date, group),
      fees: entry.fees,
      feeYieldPct: entry.entryCount > 0 ? (entry.fees / (entry.entrySum / entry.entryCount)) * 100 : null,
      pnl: entry.pnl,
      pnlNet: entry.pnlNet,
      pnlTotal: entry.pnlTotal,
      pnlTotalNet: entry.pnlTotalNet,
      feesCum: runningFees,
      pnlCum: runningPnl,
      pnlNetCum: runningNet
    };
  });
}

function resizeCanvas(canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function drawPerformanceChart(canvas, series) {
  if (!canvas) return;
  const ctx = resizeCanvas(canvas);
  if (!ctx) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);

  if (!series.length) {
    perfChartPoints = [];
    perfChartMetrics = [];
    return;
  }

  const activeMetrics = perfMetricOrder.filter((key) => perfMetricVisibility[key] !== false);
  if (!activeMetrics.length) {
    perfChartPoints = [];
    perfChartMetrics = [];
    return;
  }
  const percentOnly = activeMetrics.length === 1 && isPercentMetric(activeMetrics[0]);

  const values = [];
  series.forEach((point) => {
    activeMetrics.forEach((key) => {
      const raw = point[key];
      const val = raw === null || raw === undefined ? NaN : Number(raw);
      if (Number.isFinite(val)) values.push(val);
    });
  });
  if (!values.length) return;

  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pad = range * 0.1;
  const minY = min - pad;
  const maxY = max + pad;
  const plotW = width - 80;
  const plotH = height - 48;
  const left = 56;
  const top = 16;

  const zeroY = top + (1 - (0 - minY) / (maxY - minY)) * plotH;

  const ticks = 5;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= ticks; i += 1) {
    const y = top + (i / ticks) * plotH;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + plotW, y);
    ctx.stroke();
    const value = maxY - (i / ticks) * (maxY - minY);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "11px IBM Plex Sans, Segoe UI, sans-serif";
    ctx.textAlign = "right";
    const label = percentOnly ? `${formatNumber(value, 2)}%` : formatNumber(value, 2);
    ctx.fillText(label, left - 8, y + 4);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.moveTo(left, zeroY);
  ctx.lineTo(left + plotW, zeroY);
  ctx.stroke();

  const pointCount = series.length;
  const stepX = plotW / Math.max(1, pointCount - 1);

  const points = series.map((point, idx) => ({
    x: left + idx * stepX,
    label: point.label,
    values: point
  }));
  perfChartPoints = points;
  perfChartMetrics = activeMetrics;

  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  activeMetrics.forEach((key) => {
    if (key === "pnlCum" || key === "pnlNetCum" || key === "feesCum") {
      ctx.setLineDash([6, 4]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    let started = false;
    points.forEach((pt) => {
      const raw = pt.values[key];
      const val = raw === null || raw === undefined ? NaN : Number(raw);
      if (!Number.isFinite(val)) {
        started = false;
        return;
      }
      const y = top + (1 - (val - minY) / (maxY - minY)) * plotH;
      if (!started) {
        ctx.moveTo(pt.x, y);
        started = true;
      } else {
        ctx.lineTo(pt.x, y);
      }
    });
    ctx.strokeStyle = perfMetricColors[key] || "#888";
    ctx.stroke();
    ctx.setLineDash([]);

    points.forEach((pt) => {
      const raw = pt.values[key];
      const val = raw === null || raw === undefined ? NaN : Number(raw);
      if (!Number.isFinite(val)) return;
      const y = top + (1 - (val - minY) / (maxY - minY)) * plotH;
      ctx.fillStyle = perfMetricColors[key] || "#888";
      ctx.beginPath();
      ctx.arc(pt.x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  points.forEach((pt, idx) => {
    if (pointCount <= 12 || idx % Math.ceil(pointCount / 12) === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "11px IBM Plex Sans, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(pt.label, pt.x, height - 12);
    }
  });
}

function showPerfTooltip(point, x, y) {
  if (!perfTooltip) return;
  const lines = perfChartMetrics.map((key) => {
    const val = point.values[key];
    const label = perfMetricTooltipLabels[key] ?? perfMetricLabels[key] ?? key;
    const formatted = formatMetricValue(key, val);
    return `<div class="line"><span>${label}</span><span>${formatted}</span></div>`;
  }).join("");
  perfTooltip.innerHTML = `<div class="title">${point.label}</div>${lines}`;
  perfTooltip.classList.remove("hidden");
  const canvasRect = perfCanvas?.getBoundingClientRect();
  if (canvasRect) {
    const tooltipRect = perfTooltip.getBoundingClientRect();
    const maxLeft = canvasRect.width - tooltipRect.width - 8;
    const maxTop = canvasRect.height - tooltipRect.height - 8;
    const clampedLeft = Math.min(maxLeft, Math.max(8, x));
    const clampedTop = Math.min(maxTop, Math.max(8, y));
    perfTooltip.style.left = `${clampedLeft}px`;
    perfTooltip.style.top = `${clampedTop}px`;
  } else {
    perfTooltip.style.left = `${x}px`;
    perfTooltip.style.top = `${y}px`;
  }
}

function hidePerfTooltip() {
  if (!perfTooltip) return;
  perfTooltip.classList.add("hidden");
}

function updatePerformanceStats(items) {
  const closeItems = Array.isArray(items)
    ? items.filter((item) => item?.action === "close-position")
    : [];
  const totalFeesUsd = sumNumeric(closeItems, "positionFeesUsd");
  const avgEntryUsd = averageNumeric(closeItems, "positionEntryUsd");
  const feeYieldPct = avgEntryUsd != null ? (totalFeesUsd / avgEntryUsd) * 100 : null;
  const periodDays = getPerfPeriodDays(closeItems);
  perfDailyYieldPct = feeYieldPct != null ? feeYieldPct / periodDays : null;

  if (perfFeesCumStat) {
    perfFeesCumStat.textContent = closeItems.length ? formatNumber(totalFeesUsd, 2) : "-";
  }
  if (perfFeeYieldStat) {
    perfFeeYieldStat.textContent = feeYieldPct != null ? `${formatNumber(feeYieldPct, 2)}%` : "-";
  }

  updatePerfCalculator();
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
  } catch (err) {
    errorBox.textContent = err instanceof Error ? err.message : String(err);
    errorBox.classList.remove("hidden");
  }
}

function updatePerformance(items) {
  if (!perfCanvas || !perfEmpty) return;
  updatePerformanceStats(items);
  const activeMetrics = perfMetricOrder.filter((key) => perfMetricVisibility[key] !== false);
  if (!activeMetrics.length) {
    perfEmpty.textContent = "Selecione ao menos uma metrica";
    perfEmpty.classList.remove("hidden");
    perfEmpty.style.display = "flex";
    const ctx = perfCanvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, perfCanvas.width, perfCanvas.height);
    perfChartPoints = [];
    perfChartMetrics = [];
    hidePerfTooltip();
    return;
  }
  const series = aggregatePerformance(items, perfGroup);
  if (!series.length) {
    perfEmpty.textContent = "Sem dados no periodo";
    perfEmpty.classList.remove("hidden");
    perfEmpty.style.display = "flex";
    const ctx = perfCanvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, perfCanvas.width, perfCanvas.height);
    perfChartPoints = [];
    perfChartMetrics = [];
    hidePerfTooltip();
    return;
  }
  perfEmpty.classList.add("hidden");
  perfEmpty.style.display = "none";
  drawPerformanceChart(perfCanvas, series);
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

if (perfCanvas) {
  perfCanvas.addEventListener("mousemove", (event) => {
    if (!perfChartPoints.length || !perfChartMetrics.length) {
      hidePerfTooltip();
      return;
    }
    const rect = perfCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let nearest = perfChartPoints[0];
    let bestDist = Math.abs(x - nearest.x);
    for (let i = 1; i < perfChartPoints.length; i += 1) {
      const dist = Math.abs(x - perfChartPoints[i].x);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = perfChartPoints[i];
      }
    }
    if (bestDist > 40) {
      hidePerfTooltip();
      return;
    }
    const tooltipX = nearest.x + 12;
    const tooltipY = y - 40;
    showPerfTooltip(nearest, tooltipX, tooltipY);
  });

  perfCanvas.addEventListener("mouseleave", () => {
    hidePerfTooltip();
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
