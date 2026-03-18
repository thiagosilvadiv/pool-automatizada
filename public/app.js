const statusBadge = document.getElementById("statusBadge");
const runningEl = document.getElementById("running");
const lastTickEl = document.getElementById("lastTick");
const lastActionEl = document.getElementById("lastAction");
const lastErrorEl = document.getElementById("lastError");
const priceEl = document.getElementById("price");
const targetRangeEl = document.getElementById("targetRange");
const positionRangeEl = document.getElementById("positionRange");
const positionMintEl = document.getElementById("positionMint");
const solBalanceEl = document.getElementById("solBalance");
const walletAEl = document.getElementById("walletA");
const walletBEl = document.getElementById("walletB");
const positionAEl = document.getElementById("positionA");
const positionBEl = document.getElementById("positionB");
const portfolioEl = document.getElementById("portfolio");
const pnlEl = document.getElementById("pnl");
const solUsdEl = document.getElementById("solUsd");
const budgetUsdEl = document.getElementById("budgetUsd");
const budgetSolEl = document.getElementById("budgetSol");
const portfolioUsdEl = document.getElementById("portfolioUsd");
const pnlUsdEl = document.getElementById("pnlUsd");
const networkEl = document.getElementById("network");
const whirlpoolEl = document.getElementById("whirlpool");
const rangePctEl = document.getElementById("rangePct");
const slippageEl = document.getElementById("slippage");
const pollEl = document.getElementById("poll");
const confirmSecEl = document.getElementById("confirmSec");
const cooldownSecEl = document.getElementById("cooldownSec");
const dryRunEl = document.getElementById("dryRun");
const historyBody = document.getElementById("historyBody");
const poolNameLabel = document.getElementById("poolNameLabel");

const poolNameInput = document.getElementById("poolName");
const poolAddressInput = document.getElementById("poolAddress");
const poolRangeInput = document.getElementById("poolRange");
const poolBudgetInput = document.getElementById("poolBudget");
const addPoolBtn = document.getElementById("addPoolBtn");
const poolsBody = document.getElementById("poolsBody");
const poolError = document.getElementById("poolError");
const resultsBody = document.getElementById("resultsBody");
let cachedPools = [];
let cachedConfig = null;
let cachedHistory = [];
let activeActionMenu = null;

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const closeBtn = document.getElementById("closeBtn");
const topupBtn = document.getElementById("topupBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const exportHistoryBtn = document.getElementById("exportHistoryBtn");
const deleteHistoryBtn = document.getElementById("deleteHistoryBtn");
const selectAllHistory = document.getElementById("selectAllHistory");
const historyColumnFilters = document.getElementById("historyColumnFilters");

let selectedHistoryIds = new Set();
const historyColumnDefaults = {
  datetime: true,
  close: true,
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
let historyColumnVisibility = loadHistoryColumnVisibility();

const actionLabels = {
  "open-position": "abertura",
  "rebalanced": "re-range",
  "close-position": "fechamento",
  "auto-sol-topup": "top-up SOL",
  "manual-sol-topup": "top-up SOL (manual)",
  "resume-position": "monitorando posição existente",
  "reload-position": "recarregar posição",
  "out-of-range-wait": "aguardando confirmação fora da faixa",
  "cooldown-wait": "aguardando cooldown",
  "skip-low-sol": "SOL baixo",
  "skip-low-sol-position": "posição existente (SOL baixo)",
  "swap": "swap"
};

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
  if (item.action !== "close-position") return "-";
  return formatTimestamp(item.timestamp);
}

function toCsvValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/"/g, "\"\"");
  return `"${text}"`;
}

function buildHistoryCsv(items) {
  const header = [
    "Data/Hora",
    "Data fechamento",
    "Ação",
    "Preço",
    "Faixa alvo",
    "Mint posição",
    "Entrada (USD)",
    "Taxas (USD)",
    "Taxa TX (USD)",
    "Saída (USD)",
    "PnL líquido (USD)"
  ];
  const rows = items.map((item) => {
    const actionLabel = actionLabels[item.action] ?? item.action ?? "-";
    return [
      formatTimestamp(item.timestamp),
      formatCloseTimestamp(item),
      actionLabel,
      formatNumber(item.price, 8),
      formatRange(item.targetRange),
      item.positionMint ?? "-",
      formatNumber(item.positionEntryUsd, 2),
      formatNumber(item.positionFeesUsd, 2),
      formatNumber(item.txFeeUsd, 6),
      formatNumber(item.positionExitUsd, 2),
      formatNumber(item.positionPnlUsd, 2)
    ].map(toCsvValue).join(";");
  });
  return `\ufeff${header.map(toCsvValue).join(";")}\r\n${rows.join("\r\n")}`;
}

function downloadCsv(content, filename) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function fetchStatus() {
  const res = await fetch("/api/status");
  return res.json();
}

async function fetchConfig() {
  const res = await fetch("/api/config");
  return res.json();
}

async function fetchHistory() {
  const res = await fetch("/api/history");
  return res.json();
}

async function fetchPools() {
  const res = await fetch("/api/pools");
  return res.json();
}

function parseOptionalNumber(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : undefined;
}

function renderHistory(items) {
  if (!items || items.length === 0) {
    selectedHistoryIds.clear();
    historyBody.innerHTML = "<tr><td colspan=\"12\">Sem eventos ainda</td></tr>";
    updateHistorySelectionState();
    return;
  }
  const currentIds = new Set();
  const rows = items.slice(0, 50).map((item, index) => {
    const actionLabel = actionLabels[item.action] ?? item.action ?? "-";
    const eventId = item.id ?? `legacy-${index}`;
    currentIds.add(eventId);
    const checked = selectedHistoryIds.has(eventId) ? "checked" : "";
    return `
      <tr>
        <td><input type="checkbox" class="history-select" data-id="${eventId}" ${checked}></td>
        <td data-col="datetime">${formatTimestamp(item.timestamp)}</td>
        <td data-col="close">${formatCloseTimestamp(item)}</td>
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
  selectedHistoryIds = new Set(Array.from(selectedHistoryIds).filter((id) => currentIds.has(id)));
  applyHistoryColumnVisibility();
  updateHistorySelectionState();
}

function renderPools(data, config) {
  closeActiveActionMenu();
  const pools = data?.pools ?? [];
  cachedPools = pools;
  cachedConfig = config;
  if (!pools.length) {
    poolsBody.innerHTML = "<tr><td colspan=\"10\">Sem pools cadastradas</td></tr>";
    return;
  }
  const rows = pools.map((pool) => {
    const selected = pool.selected ? "Sim" : "Não";
    const statusLabel = pool.running ? "Rodando" : "Parado";
    const lastActionLabel = actionLabels[pool.lastAction] ?? pool.lastAction ?? "-";
    const startStopAction = pool.running
      ? "<button class=\"ghost\" data-action=\"stop\" data-id=\"" + pool.id + "\">Parar</button>"
      : "<button class=\"primary\" data-action=\"start\" data-id=\"" + pool.id + "\">Iniciar</button>";
    const rangeDisplay = pool.overrides?.rangeWidthPct ?? null;
    const budgetDisplay = pool.overrides?.budgetUsd ?? null;
    const defaultRange = config?.rangeWidthPct ?? "-";
    const defaultBudget = config?.budgetUsd ?? "-";
    const rangeLabel = rangeDisplay == null ? `Padrão (${defaultRange})` : Number(rangeDisplay).toFixed(2);
    const budgetLabel = budgetDisplay == null ? `Padrão (${defaultBudget})` : Number(budgetDisplay).toFixed(2);
    const createdAt = formatTimestamp(pool.createdAt);
    return `
      <tr>
        <td>${pool.name}</td>
        <td>${createdAt}</td>
        <td>${pool.whirlpoolAddress}</td>
        <td>${rangeLabel}</td>
        <td>${budgetLabel}</td>
        <td>${statusLabel}</td>
        <td>${lastActionLabel}</td>
        <td>${formatNumber(pool.positionPnlUsd, 2)}</td>
        <td>${selected}</td>
        <td>
          <details class="action-menu">
            <summary>Ações</summary>
            <div class="menu">
              <button class="ghost" data-action="select" data-id="${pool.id}">Selecionar</button>
              <button class="ghost" data-action="edit" data-id="${pool.id}">Editar</button>
              ${startStopAction}
              <button class="danger" data-action="close" data-id="${pool.id}">Fechar</button>
              <button class="ghost danger" data-action="remove" data-id="${pool.id}">Remover</button>
            </div>
          </details>
        </td>
      </tr>
    `;
  });
  poolsBody.innerHTML = rows.join("");
}

function renderResults(data) {
  const pools = data?.pools ?? [];
  if (!pools.length) {
    resultsBody.innerHTML = "<tr><td colspan=\"7\">Sem dados ainda</td></tr>";
    return;
  }
  const rows = pools.map((pool) => {
    const statusLabel = pool.running ? "Rodando" : "Parado";
    return `
      <tr>
        <td>${pool.name}</td>
        <td>${statusLabel}</td>
        <td>${pool.lastAction ?? "-"}</td>
        <td>${formatNumber(pool.lastPrice, 8)}</td>
        <td>${formatNumber(pool.positionValueUsd, 2)}</td>
        <td>${formatNumber(pool.positionPnlUsd, 2)}</td>
        <td>${formatNumber(pool.positionPnlSol, 6)}</td>
      </tr>
    `;
  });
  resultsBody.innerHTML = rows.join("");
}

async function updateUI() {
  try {
    const [status, config, history, pools] = await Promise.all([
      fetchStatus(),
      fetchConfig(),
      fetchHistory(),
      fetchPools()
    ]);
    cachedHistory = Array.isArray(history) ? history : [];

    runningEl.textContent = status.running ? "Sim" : "Não";
    lastTickEl.textContent = formatTimestamp(status.lastTickAt);
    lastActionEl.textContent = status.lastAction ?? "-";
    lastErrorEl.textContent = status.lastError ?? "-";
    priceEl.textContent = formatNumber(status.lastPrice, 8);
    targetRangeEl.textContent = formatRange(status.targetRange);
    positionRangeEl.textContent = formatRange(status.positionRange);
    positionMintEl.textContent = status.positionMint ?? "-";
    solBalanceEl.textContent = formatNumber(status.solBalance, 4);

    walletAEl.textContent = formatNumber(status.tokenABalance, 6);
    walletBEl.textContent = formatNumber(status.tokenBBalance, 6);
    positionAEl.textContent = formatNumber(status.positionTokenA, 6);
    positionBEl.textContent = formatNumber(status.positionTokenB, 6);
    portfolioEl.textContent = formatNumber(status.portfolioValue, 6);
    pnlEl.textContent = formatNumber(status.pnl, 6);

    solUsdEl.textContent = formatNumber(status.solUsdPrice, 4);
    budgetUsdEl.textContent = formatNumber(status.budgetUsd, 2);
    budgetSolEl.textContent = formatNumber(status.budgetSol, 4);
    portfolioUsdEl.textContent = formatNumber(status.portfolioUsd, 2);
    pnlUsdEl.textContent = formatNumber(status.pnlUsd, 2);

    networkEl.textContent = config.network ?? "-";
    whirlpoolEl.textContent = config.whirlpoolAddress ?? "-";
    poolNameLabel.textContent = config.poolName ?? "-";
    rangePctEl.textContent = config.rangeWidthPct ?? "-";
    slippageEl.textContent = config.slippageBps ?? "-";
    pollEl.textContent = config.pollIntervalMs ?? "-";
    confirmSecEl.textContent = config.outOfRangeConfirmSec ?? 0;
    cooldownSecEl.textContent = config.rebalanceCooldownSec ?? 0;
    dryRunEl.textContent = config.dryRun ? "Sim" : "Não";

    statusBadge.textContent = status.running ? "Rodando" : "Parado";
    statusBadge.classList.toggle("running", status.running);
    statusBadge.classList.toggle("stopped", !status.running);

    renderHistory(history);
    renderPools(pools, config);
    renderResults(pools);
  } catch (err) {
    statusBadge.textContent = "Erro";
    statusBadge.classList.remove("running");
    statusBadge.classList.add("stopped");
  }
}

startBtn.addEventListener("click", async () => {
  await fetch("/api/start", { method: "POST" });
  updateUI();
});

stopBtn.addEventListener("click", async () => {
  await fetch("/api/stop", { method: "POST" });
  updateUI();
});

closeBtn.addEventListener("click", async () => {
  const ok = window.confirm("Fechar a posição agora? Isso remove toda a liquidez.");
  if (!ok) return;
  await fetch("/api/close-position", { method: "POST" });
  updateUI();
});

topupBtn.addEventListener("click", async () => {
  const res = await fetch("/api/sol-topup", { method: "POST" });
  const data = await res.json();
  if (!data.ok) {
    const msg = data.error ?? data.reason ?? "Top-up falhou";
    window.alert(msg);
  }
  updateUI();
});

addPoolBtn.addEventListener("click", async () => {
  const name = poolNameInput.value.trim();
  const address = poolAddressInput.value.trim();
  const rangeWidthPct = parseOptionalNumber(poolRangeInput.value);
  const budgetUsd = parseOptionalNumber(poolBudgetInput.value);
  poolError.classList.add("hidden");
  try {
    const overrides = {};
    if (rangeWidthPct !== undefined) {
      overrides.rangeWidthPct = rangeWidthPct;
    }
    if (budgetUsd !== undefined) {
      overrides.budgetUsd = budgetUsd;
    }
    const res = await fetch("/api/pools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, whirlpoolAddress: address, overrides })
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error ?? "Erro ao adicionar pool");
    }
    poolNameInput.value = "";
    poolAddressInput.value = "";
    poolRangeInput.value = "";
    poolBudgetInput.value = "";
    updateUI();
  } catch (err) {
    poolError.textContent = err instanceof Error ? err.message : String(err);
    poolError.classList.remove("hidden");
  }
});

async function handlePoolAction(action, id) {
  if (action === "select") {
    await fetch(`/api/pools/${id}/select`, { method: "POST" });
    updateUI();
    return;
  }

  if (action === "start") {
    await fetch(`/api/pools/${id}/start`, { method: "POST" });
    updateUI();
    return;
  }

  if (action === "stop") {
    await fetch(`/api/pools/${id}/stop`, { method: "POST" });
    updateUI();
    return;
  }

  if (action === "close") {
    const ok = window.confirm("Fechar a posição dessa pool? Isso remove toda a liquidez.");
    if (!ok) return;
    await fetch(`/api/pools/${id}/close`, { method: "POST" });
    updateUI();
    return;
  }

  if (action === "remove") {
    const ok = window.confirm("Remover essa pool da lista?");
    if (!ok) return;
    await fetch(`/api/pools/${id}`, { method: "DELETE" });
    updateUI();
    return;
  }

  if (action === "edit") {
    const pool = cachedPools.find((item) => item.id === id);
    if (!pool) return;
    const currentRange = pool.overrides?.rangeWidthPct ?? "";
    const currentBudget = pool.overrides?.budgetUsd ?? "";
    const defaultRange = cachedConfig?.rangeWidthPct ?? "-";
    const defaultBudget = cachedConfig?.budgetUsd ?? "-";
    const rangeInput = window.prompt(
      `Range % (vazio = manter, "default" = usar padrão ${defaultRange})`,
      String(currentRange)
    );
    if (rangeInput === null) return;
    const budgetInput = window.prompt(
      `Budget USD (vazio = manter, "default" = usar padrão ${defaultBudget}, 0 = desativar)`,
      String(currentBudget)
    );
    if (budgetInput === null) return;

    const overrides = {};
    if (rangeInput.trim().toLowerCase() === "default") {
      overrides.rangeWidthPct = null;
    } else if (rangeInput.trim() !== "") {
      overrides.rangeWidthPct = parseOptionalNumber(rangeInput);
    }

    if (budgetInput.trim().toLowerCase() === "default") {
      overrides.budgetUsd = null;
    } else if (budgetInput.trim() !== "") {
      overrides.budgetUsd = parseOptionalNumber(budgetInput);
    }

    await fetch(`/api/pools/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overrides })
    });
    updateUI();
  }
}

function closeActiveActionMenu() {
  if (!activeActionMenu) return;
  const { details, menu } = activeActionMenu;
  if (menu instanceof HTMLElement) {
    menu.classList.remove("action-menu-popup");
    menu.classList.remove("is-open");
    menu.style.left = "";
    menu.style.top = "";
    menu.style.visibility = "";
    if (details instanceof HTMLElement) {
      details.appendChild(menu);
    }
  }
  if (details instanceof HTMLDetailsElement) {
    details.open = false;
  }
  activeActionMenu = null;
}

function positionActionMenu(menu, summary) {
  if (!(menu instanceof HTMLElement) || !(summary instanceof HTMLElement)) return;

  menu.style.left = "0px";
  menu.style.top = "0px";

  const triggerRect = summary.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const padding = 8;
  let left = triggerRect.right - menuRect.width;
  if (left < padding) {
    left = padding;
  }
  if (left + menuRect.width > window.innerWidth - padding) {
    left = Math.max(padding, window.innerWidth - menuRect.width - padding);
  }

  let top = triggerRect.bottom + padding;
  if (top + menuRect.height > window.innerHeight - padding) {
    top = Math.max(padding, triggerRect.top - menuRect.height - padding);
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function openActionMenu(details) {
  if (!(details instanceof HTMLDetailsElement)) return;
  const summary = details.querySelector("summary");
  const menu = details.querySelector(".menu");
  if (!(summary instanceof HTMLElement) || !(menu instanceof HTMLElement)) return;

  if (activeActionMenu && activeActionMenu.details !== details) {
    closeActiveActionMenu();
  }

  activeActionMenu = { details, menu, summary };
  menu.classList.add("action-menu-popup");
  menu.classList.remove("is-open");
  document.body.appendChild(menu);
  positionActionMenu(menu, summary);
  menu.classList.add("is-open");
}

poolsBody.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const summary = target.closest("summary");
  if (!summary) return;
  const details = summary.closest("details.action-menu");
  if (!(details instanceof HTMLDetailsElement)) return;
  setTimeout(() => {
    if (details.open) {
      openActionMenu(details);
    } else {
      closeActiveActionMenu();
    }
  }, 0);
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const actionButton = target.closest("[data-action][data-id]");
  if (actionButton instanceof HTMLElement) {
    const action = actionButton.getAttribute("data-action");
    const id = actionButton.getAttribute("data-id");
    if (action && id) {
      event.preventDefault();
      closeActiveActionMenu();
      await handlePoolAction(action, id);
      return;
    }
  }

  if (target.closest(".action-menu-popup")) return;
  if (target.closest("details.action-menu")) return;
  closeActiveActionMenu();
});

window.addEventListener("resize", () => {
  closeActiveActionMenu();
});

window.addEventListener("scroll", () => {
  closeActiveActionMenu();
}, true);

function updateHistorySelectionState() {
  if (!selectAllHistory) return;
  const total = historyBody.querySelectorAll("input.history-select").length;
  const selected = selectedHistoryIds.size;
  selectAllHistory.checked = total > 0 && selected === total;
  selectAllHistory.indeterminate = selected > 0 && selected < total;
}

function loadHistoryColumnVisibility() {
  const raw = localStorage.getItem("historyColumnVisibility");
  if (!raw) return { ...historyColumnDefaults };
  try {
    const parsed = JSON.parse(raw);
    return { ...historyColumnDefaults, ...parsed };
  } catch {
    return { ...historyColumnDefaults };
  }
}

function saveHistoryColumnVisibility() {
  localStorage.setItem("historyColumnVisibility", JSON.stringify(historyColumnVisibility));
}

function applyHistoryColumnVisibility() {
  if (!historyColumnVisibility) return;
  Object.entries(historyColumnVisibility).forEach(([col, visible]) => {
    document.querySelectorAll(`[data-col="${col}"]`).forEach((el) => {
      el.classList.toggle("col-hidden", !visible);
    });
  });
  syncHistoryColumnControls();
}

function syncHistoryColumnControls() {
  if (!historyColumnFilters) return;
  historyColumnFilters.querySelectorAll("input[data-col]").forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    const col = input.getAttribute("data-col");
    if (!col) return;
    input.checked = historyColumnVisibility[col] !== false;
  });
}

historyBody.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!target.classList.contains("history-select")) return;
  const id = target.getAttribute("data-id");
  if (!id) return;
  if (target.checked) {
    selectedHistoryIds.add(id);
  } else {
    selectedHistoryIds.delete(id);
  }
  updateHistorySelectionState();
});

if (selectAllHistory) {
  selectAllHistory.addEventListener("change", () => {
    const shouldSelectAll = selectAllHistory.checked;
    selectedHistoryIds.clear();
    historyBody.querySelectorAll("input.history-select").forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      input.checked = shouldSelectAll;
      const id = input.getAttribute("data-id");
      if (shouldSelectAll && id) {
        selectedHistoryIds.add(id);
      }
    });
    updateHistorySelectionState();
  });
}

if (historyColumnFilters) {
  historyColumnFilters.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const col = target.getAttribute("data-col");
    if (!col) return;
    historyColumnVisibility = { ...historyColumnVisibility, [col]: target.checked };
    saveHistoryColumnVisibility();
    applyHistoryColumnVisibility();
  });
}

clearHistoryBtn.addEventListener("click", async () => {
  const ok = window.confirm("Limpar o histórico? Essa ação não pode ser desfeita.");
  if (!ok) return;
  await fetch("/api/history/clear", { method: "POST" });
  updateUI();
});

if (deleteHistoryBtn) {
  deleteHistoryBtn.addEventListener("click", async () => {
    if (selectedHistoryIds.size === 0) {
      window.alert("Selecione pelo menos um registro.");
      return;
    }
    const count = selectedHistoryIds.size;
    const ok = window.confirm(`Excluir ${count} registro(s) selecionado(s)?`);
    if (!ok) return;
    const res = await fetch("/api/history/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selectedHistoryIds) })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const msg = data?.error ?? "Falha ao excluir registros.";
      window.alert(msg);
      return;
    }
    selectedHistoryIds.clear();
    updateUI();
  });
}

if (exportHistoryBtn) {
  exportHistoryBtn.addEventListener("click", async () => {
    const history = cachedHistory?.length ? cachedHistory : await fetchHistory();
    if (!history || history.length === 0) {
      window.alert("Sem eventos para exportar.");
      return;
    }
    const poolName = poolNameLabel?.textContent?.trim() || "pool";
    const date = new Date().toISOString().slice(0, 10);
    const csv = buildHistoryCsv(history);
    downloadCsv(csv, `historico-${poolName}-${date}.csv`);
  });
}

updateUI();
applyHistoryColumnVisibility();
setInterval(updateUI, 5000);
