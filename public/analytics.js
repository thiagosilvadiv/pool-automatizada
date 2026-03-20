const poolSelect = document.getElementById("poolSelect");
const startInput = document.getElementById("startDate");
const endInput = document.getElementById("endDate");
const applyBtn = document.getElementById("applyFilter");
const errorBox = document.getElementById("analyticsError");
const historyBody = document.getElementById("historyBody");
const analyticsColumnFilters = document.getElementById("analyticsColumnFilters");
const analyticsTypeFilters = document.getElementById("analyticsTypeFilters");
const analyticsRowLimitSelect = document.getElementById("analyticsRowLimit");

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
  price: true,
  targetRange: true,
  mint: true,
  entryUsd: true,
  feesUsd: true,
  txFeeUsd: true,
  exitUsd: true,
  pnlUsd: true
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
    historyBody.innerHTML = "<tr><td colspan=\"12\">Sem eventos ainda</td></tr>";
    return;
  }
  const limit = analyticsRowLimit ?? 30;
  const rows = items.slice(0, limit).map((item) => {
    const actionLabel = actionLabels[item.action] ?? item.action ?? "-";
    const typeLabel = actionTypeLabels[item.actionType] ?? item.actionType ?? "-";
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
        <td data-col="pnlUsd">${formatNumber(item.positionPnlUsd, 2)}</td>
      </tr>
    `;
  });
  historyBody.innerHTML = rows.join("");
  applyAnalyticsColumnVisibility();
}

function updateSummary(items) {
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

  let netSol = 0;
  let netUsd = 0;
  if (items.length > 1) {
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

async function refresh() {
  try {
    errorBox.classList.add("hidden");
    const poolsData = await fetchPools();
    const pools = poolsData?.pools ?? [];
    poolSelect.innerHTML = pools.map((pool) => {
      const selected = pool.selected ? "selected" : "";
      return `<option value="${pool.id}" ${selected}>${pool.name}</option>`;
    }).join("");

    if (!pools.length) {
      renderHistory([]);
      updateSummary([]);
      return;
    }

    const selectedId = poolSelect.value || poolsData.selectedPoolId || pools[0].id;
    poolSelect.value = selectedId;
    const history = await fetchHistory(selectedId);
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
    updateSummary(typeFiltered);
  } catch (err) {
    errorBox.textContent = err instanceof Error ? err.message : String(err);
    errorBox.classList.remove("hidden");
  }
}

applyBtn.addEventListener("click", () => {
  refresh();
});

poolSelect.addEventListener("change", () => {
  refresh();
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

const now = new Date();
const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
startInput.value = toDateInputValue(weekAgo);
endInput.value = toDateInputValue(now);

refresh();
applyAnalyticsColumnVisibility();
syncAnalyticsTypeControls();
syncAnalyticsRowLimit();
