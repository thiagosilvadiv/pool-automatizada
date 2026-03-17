const poolSelect = document.getElementById("poolSelect");
const startInput = document.getElementById("startDate");
const endInput = document.getElementById("endDate");
const applyBtn = document.getElementById("applyFilter");
const errorBox = document.getElementById("analyticsError");
const historyBody = document.getElementById("historyBody");

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
  "resume-position": "monitorando posição existente",
  "reload-position": "recarregar posição",
  "out-of-range-wait": "aguardando confirmação fora da faixa",
  "swap": "swap"
};

function formatRange(range) {
  if (!range) return "-";
  return `${Number(range.lower).toFixed(6)} / ${Number(range.upper).toFixed(6)}`;
}

function formatNumber(value, digits = 6) {
  if (value === null || value === undefined) return "-";
  if (Number.isNaN(value)) return "-";
  return Number(value).toFixed(digits);
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
  const rows = items.slice(0, 100).map((item) => {
    const actionLabel = actionLabels[item.action] ?? item.action ?? "-";
    return `
      <tr>
        <td>${formatTimestamp(item.timestamp)}</td>
        <td>${actionLabel}</td>
        <td>${formatNumber(item.price, 8)}</td>
        <td>${formatRange(item.targetRange)}</td>
        <td>${item.positionMint ?? "-"}</td>
        <td>${formatNumber(item.openTokenA, 6)}</td>
        <td>${formatNumber(item.openTokenB, 6)}</td>
        <td>${formatNumber(item.closeTokenA, 6)}</td>
        <td>${formatNumber(item.closeTokenB, 6)}</td>
        <td>${formatNumber(item.portfolioValue, 6)}</td>
        <td>${formatNumber(item.pnl, 6)}</td>
        <td>${formatNumber(item.pnlDeltaUsd, 2)}</td>
      </tr>
    `;
  });
  historyBody.innerHTML = rows.join("");
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
    renderHistory(filtered);
    updateSummary(filtered);
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

const now = new Date();
const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
startInput.value = toDateInputValue(weekAgo);
endInput.value = toDateInputValue(now);

refresh();
