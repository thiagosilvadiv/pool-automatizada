const statusBadge = document.getElementById("statusBadge");
const runningEl = document.getElementById("running");
const lastTickEl = document.getElementById("lastTick");
const lastActionEl = document.getElementById("lastAction");
const lastErrorEl = document.getElementById("lastError");
const hedgeStatusEl = document.getElementById("hedgeStatus");
const hedgeErrorEl = document.getElementById("hedgeError");
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
const hedgeLogBody = document.getElementById("hedgeLogBody");
const poolNameLabel = document.getElementById("poolNameLabel");
const hedgeSymbolsList = document.getElementById("hedgeSymbolsList");

const poolNameInput = document.getElementById("poolName");
const poolAddressInput = document.getElementById("poolAddress");
const poolRangeInput = document.getElementById("poolRange");
const poolExitTokenInput = document.getElementById("poolExitToken");
const poolExitBiasInput = document.getElementById("poolExitBias");
const poolTrendEnabledInput = document.getElementById("poolTrendEnabled");
const poolTrendTimeframeInput = document.getElementById("poolTrendTimeframe");
const poolTrendUpInput = document.getElementById("poolTrendUp");
const poolTrendDownInput = document.getElementById("poolTrendDown");
const poolBudgetInput = document.getElementById("poolBudget");
const poolHedgeEnabledInput = document.getElementById("poolHedgeEnabled");
const poolHedgePctInput = document.getElementById("poolHedgePct");
const poolHedgeMarginPctInput = document.getElementById("poolHedgeMarginPct");
const poolHedgeSymbolInput = document.getElementById("poolHedgeSymbol");
const poolHedgeLeverageInput = document.getElementById("poolHedgeLeverage");
const poolTrendHint = document.getElementById("poolTrendHint");
const addPoolBtn = document.getElementById("addPoolBtn");
const poolsBody = document.getElementById("poolsBody");
const poolError = document.getElementById("poolError");
const resultsBody = document.getElementById("resultsBody");
const editPoolModal = document.getElementById("editPoolModal");
const editPoolForm = document.getElementById("editPoolForm");
const editPoolIdInput = document.getElementById("editPoolId");
const editPoolRangeInput = document.getElementById("editPoolRange");
const editPoolExitTokenInput = document.getElementById("editPoolExitToken");
const editPoolExitBiasInput = document.getElementById("editPoolExitBias");
const editPoolTrendEnabledInput = document.getElementById("editPoolTrendEnabled");
const editPoolTrendTimeframeInput = document.getElementById("editPoolTrendTimeframe");
const editPoolTrendUpInput = document.getElementById("editPoolTrendUp");
const editPoolTrendDownInput = document.getElementById("editPoolTrendDown");
const editPoolBudgetInput = document.getElementById("editPoolBudget");
const editPoolHedgeEnabledInput = document.getElementById("editPoolHedgeEnabled");
const editPoolHedgePctInput = document.getElementById("editPoolHedgePct");
const editPoolHedgeMarginPctInput = document.getElementById("editPoolHedgeMarginPct");
const editPoolHedgeSymbolInput = document.getElementById("editPoolHedgeSymbol");
const editPoolHedgeLeverageInput = document.getElementById("editPoolHedgeLeverage");
const editPoolTrendHint = document.getElementById("editPoolTrendHint");
const editPoolError = document.getElementById("editPoolError");
const swapResultModal = document.getElementById("swapResultModal");
const swapResultSummary = document.getElementById("swapResultSummary");
const swapResultList = document.getElementById("swapResultList");
const swapErrorModal = document.getElementById("swapErrorModal");
const swapErrorText = document.getElementById("swapErrorText");
const swapErrorCopy = document.getElementById("swapErrorCopy");
let cachedPools = [];
let cachedConfig = null;
let cachedHistory = [];
let activeActionMenu = null;
let swapErrorDetails = [];

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const closeBtn = document.getElementById("closeBtn");
const topupBtn = document.getElementById("topupBtn");
const closeEmptyAccountsBtn = document.getElementById("closeEmptyAccountsBtn");
const swapToSolBtn = document.getElementById("swapToSolBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const clearHedgeLogBtn = document.getElementById("clearHedgeLogBtn");
const exportHistoryBtn = document.getElementById("exportHistoryBtn");
const deleteHistoryBtn = document.getElementById("deleteHistoryBtn");
const selectAllHistory = document.getElementById("selectAllHistory");
const historyColumnFilters = document.getElementById("historyColumnFilters");
const historyTypeFilters = document.getElementById("historyTypeFilters");
const historyRowLimitSelect = document.getElementById("historyRowLimit");

let selectedHistoryIds = new Set();
let historyRowLimit = loadHistoryRowLimit();
const historyColumnDefaults = {
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
  hedgePnl: true,
  pnlTotal: true,
  pnlTotalNet: true
};
let historyColumnVisibility = loadHistoryColumnVisibility();
const historyTypeDefaults = {
  abertura: true,
  fechamento: true,
  monitorando: true,
  operacional: true
};
let historyTypeVisibility = loadHistoryTypeVisibility();

const actionLabels = {
  "open-position": "abertura",
  "rebalanced": "re-range",
  "close-position": "fechamento",
  "auto-sol-topup": "top-up SOL",
  "manual-sol-topup": "top-up SOL (manual)",
  "manual-swap-to-sol": "converter tokens para SOL",
  "resume-position": "monitorando posição existente",
  "close-failed": "fechamento falhou",
  "reload-position": "recarregar posição",
  "out-of-range-wait": "aguardando confirmação fora da faixa",
  "cooldown-wait": "aguardando cooldown",
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

const MAX_HEDGE_LOG_ROWS = 80;

const hedgeLogActionLabels = {
  "open": "Abertura",
  "close": "Fechamento",
  "open-failed": "Falha abertura",
  "close-failed": "Falha fechamento"
};

const hedgeLogLevelLabels = {
  "info": "Info",
  "warn": "Aviso",
  "error": "Erro"
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

const KNOWN_MINT_LABELS = {
  "So11111111111111111111111111111111111111112": "SOL",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC"
};

function shortMint(mint) {
  if (!mint || typeof mint !== "string") return "";
  if (mint.length <= 8) return mint;
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function formatMintLabel(mint) {
  if (!mint || typeof mint !== "string") return "";
  return KNOWN_MINT_LABELS[mint] ?? shortMint(mint);
}

function describeToken(side, info) {
  const base = side === "tokenA" ? "Token A" : "Token B";
  if (!info) return base;
  const isSol = side === "tokenA" ? info.isTokenASol : info.isTokenBSol;
  if (isSol) return `${base} (SOL)`;
  const mint = side === "tokenA" ? info.tokenAMint : info.tokenBMint;
  if (mint) return `${base} (${formatMintLabel(mint)})`;
  return base;
}

function getOtherTokenLabel(info) {
  if (!info) return null;
  if (info.isTokenASol) {
    return info.tokenBMint ? formatMintLabel(info.tokenBMint) : null;
  }
  if (info.isTokenBSol) {
    return info.tokenAMint ? formatMintLabel(info.tokenAMint) : null;
  }
  return null;
}

function formatTrendTargetLabel(value, info) {
  if (!value) return "-";
  if (value === "sol") return "SOL";
  if (value === "other") {
    const label = getOtherTokenLabel(info);
    return label ? `Outro (${label})` : "Outro";
  }
  if (value === "tokenA" || value === "tokenB") {
    return describeToken(value, info);
  }
  return String(value);
}

function formatExitToken(value, info) {
  if (value === "tokenA") return describeToken("tokenA", info);
  if (value === "tokenB") return describeToken("tokenB", info);
  return "-";
}

function getTokenInfo(source) {
  if (!source) return null;
  return {
    tokenAMint: source.tokenAMint ?? null,
    tokenBMint: source.tokenBMint ?? null,
    isTokenASol: source.isTokenASol ?? null,
    isTokenBSol: source.isTokenBSol ?? null
  };
}

function updateExitTokenSelectHints(selectEl, info) {
  if (!(selectEl instanceof HTMLSelectElement)) return;
  const optionA = selectEl.querySelector("option[value=\"tokenA\"]");
  const optionB = selectEl.querySelector("option[value=\"tokenB\"]");
  if (optionA) optionA.textContent = describeToken("tokenA", info);
  if (optionB) optionB.textContent = describeToken("tokenB", info);
}

function updateTrendTargetSelectHints(selectEl, info) {
  if (!(selectEl instanceof HTMLSelectElement)) return;
  const optionSol = selectEl.querySelector("option[value=\"sol\"]");
  const optionOther = selectEl.querySelector("option[value=\"other\"]");
  const optionA = selectEl.querySelector("option[value=\"tokenA\"]");
  const optionB = selectEl.querySelector("option[value=\"tokenB\"]");
  if (optionSol) optionSol.textContent = "SOL";
  if (optionOther) optionOther.textContent = formatTrendTargetLabel("other", info);
  if (optionA) optionA.textContent = describeToken("tokenA", info);
  if (optionB) optionB.textContent = describeToken("tokenB", info);
}

function updateTrendHint(el, info) {
  if (!(el instanceof HTMLElement)) return;
  if (info && info.isTokenASol === false && info.isTokenBSol === false) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  const otherLabel = getOtherTokenLabel(info);
  if (otherLabel) {
    el.textContent = `Dica: para pools com SOL use Alta \u2192 Outro (${otherLabel}) e Baixa \u2192 SOL. Deixe em branco para usar o padrÃ£o global.`;
    el.classList.remove("hidden");
    return;
  }
  el.textContent = "Dica: para pools com SOL use Alta \u2192 Outro e Baixa \u2192 SOL. Deixe em branco para usar o padrÃ£o global.";
  el.classList.remove("hidden");
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

function toCsvValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/"/g, "\"\"");
  return `"${text}"`;
}

function buildHistoryCsv(items) {
  const header = [
    "Data/Hora",
    "Abertura",
    "Data fechamento",
    "Tipo",
    "Ação",
    "Tendência",
    "Preço",
    "Faixa alvo",
    "Mint posição",
    "Entrada (USD)",
    "Taxas (USD)",
    "Taxa TX (USD)",
    "Saída (USD)",
    "PnL líquido (USD)",
    "Hedge símbolo",
    "Hedge notional (USD)",
    "Hedge lev",
    "Hedge PnL (USD)",
    "PnL total (USD)",
    "PnL total sem taxas (USD)"
  ];
  const rows = items.map((item) => {
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
    return [
      formatTimestamp(item.timestamp),
      formatTimestamp(item.positionOpenedAt),
      formatCloseTimestamp(item),
      typeLabel,
      actionLabel,
      formatTrendDirection(item.trendDirection),
      formatNumber(item.price, 8),
      formatRange(item.targetRange),
      item.positionMint ?? "-",
      formatNumber(item.positionEntryUsd, 2),
      formatNumber(item.positionFeesUsd, 2),
      formatNumber(item.txFeeUsd, 6),
      formatNumber(item.positionExitUsd, 2),
      formatNumber(item.positionPnlUsd, 2),
      item.hedgeSymbol ?? "-",
      formatNumber(item.hedgeNotionalUsd, 2),
      formatNumber(item.hedgeLeverage, 2),
      formatNumber(item.hedgePnlUsd, 2),
      formatNumber(pnlTotal, 2),
      formatNumber(pnlTotalNet, 2)
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

async function fetchHedgeLogs() {
  const res = await fetch("/api/hedge-logs");
  return res.json();
}

async function fetchPools() {
  const res = await fetch("/api/pools");
  return res.json();
}

let hedgeSymbolsLoaded = false;
let hedgeSymbolsLoading = false;

function renderHedgeSymbols(symbols) {
  if (!hedgeSymbolsList) {
    return;
  }
  hedgeSymbolsList.innerHTML = symbols.map((symbol) => `<option value="${symbol}"></option>`).join("");
}

async function ensureHedgeSymbolsLoaded() {
  if (!hedgeSymbolsList || hedgeSymbolsLoaded || hedgeSymbolsLoading) {
    return;
  }
  hedgeSymbolsLoading = true;
  try {
    const res = await fetch("/api/hedge-symbols");
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok || !Array.isArray(data.symbols)) {
      return;
    }
    renderHedgeSymbols(data.symbols);
    hedgeSymbolsLoaded = true;
  } finally {
    hedgeSymbolsLoading = false;
  }
}

function parseOptionalNumber(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : undefined;
}

function parseExitTokenInput(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower === "tokena" || lower === "a" || lower === "token_a") return "tokenA";
  if (lower === "tokenb" || lower === "b" || lower === "token_b") return "tokenB";
  return null;
}

function parseTrendEnabledInput(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return undefined;
  if (["1", "true", "yes", "on", "sim"].includes(trimmed)) return true;
  if (["0", "false", "no", "off", "nao", "não"].includes(trimmed)) return false;
  return null;
}

function parseTrendTimeframeInput(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return undefined;
  if (["1m", "5m", "15m", "30m", "1h"].includes(trimmed)) return trimmed;
  return null;
}

function parseTrendTargetInput(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "sol" || trimmed === "other") return trimmed;
  if (trimmed === "tokena" || trimmed === "token_a") return "tokenA";
  if (trimmed === "tokenb" || trimmed === "token_b") return "tokenB";
  return null;
}

function formatTrendBadge(pool) {
  if (!pool?.trendEnabled) {
    return "<span class=\"trend-badge trend-off\">Desativado</span>";
  }
  const timeframe = pool?.trendTimeframe ? ` ${pool.trendTimeframe}` : "";
  if (pool?.trendStale) {
    return `<span class="trend-badge trend-unknown">Desatualizado${timeframe}</span>`;
  }
  if (pool?.trendDirection === "up") {
    return `<span class="trend-badge trend-up">Alta${timeframe}</span>`;
  }
  if (pool?.trendDirection === "down") {
    return `<span class="trend-badge trend-down">Baixa${timeframe}</span>`;
  }
  return `<span class="trend-badge trend-unknown">Indisponível${timeframe}</span>`;
}

function openModal(modal) {
  if (!(modal instanceof HTMLElement)) return;
  modal.classList.remove("hidden");
}

function closeModal(modal) {
  if (!(modal instanceof HTMLElement)) return;
  modal.classList.add("hidden");
}

function setSelectPlaceholder(selectEl, label) {
  if (!(selectEl instanceof HTMLSelectElement)) return;
  const option = selectEl.querySelector("option[value=\"\"]");
  if (option) option.textContent = label;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatSwapReason(reason) {
  switch (reason) {
    case "native-sol":
      return "Já é SOL";
    case "non-fungible":
      return "Token sem decimais (NFT)";
    case "excluded":
      return "Excluído";
    case "invalid-amount":
      return "Quantidade inválida";
    case "no-quote":
      return "Sem rota";
    case "below-min":
      return "Abaixo do mínimo";
    case "swap-failed":
      return "Falha na swap";
    case "api-error":
      return "Erro na API";
    case "not-allowed":
      return "Nao permitido";
    case "missing-api-key":
      return "Sem API key";
    case "no-route":
      return "Sem rota";
    case "no-tokens":
      return "Sem tokens";
    case "failed":
      return "Falhas durante a conversão";
    default:
      return reason ? String(reason) : "-";
  }
}

function formatSwapStatus(status) {
  if (status === "swapped") return "OK";
  if (status === "failed") return "Falhou";
  return "Ignorado";
}

function truncateText(value, max = 120) {
  if (!value) return "";
  const text = String(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatSwapDetailReasonShort(detail) {
  const base = formatSwapReason(detail?.reason);
  if (detail?.error) {
    return `${base} - ${truncateText(detail.error, 120)}`;
  }
  return base;
}

function formatSwapDetailReason(detail) {
  const base = formatSwapReason(detail?.reason);
  const extra = detail?.error ? ` - ${String(detail.error)}` : "";
  return `${base}${extra}`;
}

function showSwapResultModal(data) {
  if (!swapResultModal || !swapResultSummary || !swapResultList) return;
  swapErrorDetails = [];
  const swaps = Number(data?.swaps ?? 0);
  const failed = Number(data?.failed ?? 0);
  const totalSol = Number(data?.totalOutLamports ?? 0) / 1_000_000_000;
  const reasonLabel = data?.reason ? formatSwapReason(data.reason) : null;
  const summaryParts = [
    `Swaps: ${swaps}`,
    `Falhas: ${failed}`,
    `SOL estimado: ${formatNumber(totalSol, 6)}`
  ];
  if (reasonLabel) {
    summaryParts.push(`Motivo: ${reasonLabel}`);
  }
  if (data?.error) {
    summaryParts.push(`Erro: ${data.error}`);
  }
  swapResultSummary.textContent = summaryParts.join(" | ");

  const details = Array.isArray(data?.details) ? data.details : [];
  if (!details.length) {
    swapResultList.innerHTML = "<div class=\"subtitle\">Sem detalhes por token.</div>";
  } else {
    const rows = details.map((detail) => {
      const mint = escapeHtml(shortMint(detail.mint));
      const amount = formatNumber(detail.amountInUi ?? 0, 6);
      const statusLabel = escapeHtml(formatSwapStatus(detail.status));
      const reason = escapeHtml(formatSwapDetailReasonShort(detail));
      let action = "";
      if (detail?.error) {
        const idx = swapErrorDetails.push(String(detail.error)) - 1;
        action = ` <button type="button" class="ghost mini-btn" data-error-index="${idx}">Ver log</button>`;
      }
      return `
        <tr>
          <td>${mint}</td>
          <td>${amount}</td>
          <td>${statusLabel}</td>
          <td>${reason}${action}</td>
        </tr>
      `;
    }).join("");
    swapResultList.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Mint</th>
            <th>Qtd</th>
            <th>Status</th>
            <th>Motivo</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }
  openModal(swapResultModal);
}

function closeSwapResultModal() {
  closeModal(swapResultModal);
}

function openSwapErrorModal(text) {
  if (!swapErrorModal || !swapErrorText) return;
  swapErrorText.textContent = text || "-";
  openModal(swapErrorModal);
}

function closeSwapErrorModal() {
  closeModal(swapErrorModal);
}

async function copyErrorText(text) {
  const value = text || "";
  if (!value) return;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // fallback below
  }
  const temp = document.createElement("textarea");
  temp.value = value;
  document.body.appendChild(temp);
  temp.select();
  document.execCommand("copy");
  document.body.removeChild(temp);
}

function openEditPoolModal(pool) {
  if (!editPoolModal || !pool) return;
  if (editPoolError) {
    editPoolError.textContent = "";
    editPoolError.classList.add("hidden");
  }
  const overrides = pool.overrides ?? {};
  const defaultRange = cachedConfig?.rangeWidthPct ?? "-";
  const defaultBudget = cachedConfig?.budgetUsd ?? "-";
  const defaultExitToken = cachedConfig?.preferredExitToken ?? null;
  const defaultExitBias = cachedConfig?.rangeExitBiasPct ?? "-";
  const defaultTrendEnabled = cachedConfig?.trendEnabled ?? false;
  const defaultTrendTimeframe = cachedConfig?.trendTimeframe ?? "1m";
  const defaultTrendUp = cachedConfig?.trendTargetUp ?? "sol";
  const defaultTrendDown = cachedConfig?.trendTargetDown ?? "other";
  const defaultHedgeEnabled = cachedConfig?.hedgeEnabled ?? false;
  const defaultHedgePct = cachedConfig?.hedgePct ?? "-";
  const defaultHedgeMarginPct = cachedConfig?.hedgeMarginPct ?? "-";
  const defaultHedgeSymbol = cachedConfig?.hedgeSymbol ?? "-";
  const defaultHedgeLeverage = cachedConfig?.hedgeLeverage ?? "-";
  const tokenInfo = getTokenInfo(pool);

  if (editPoolIdInput) editPoolIdInput.value = pool.id ?? "";
  if (editPoolRangeInput) {
    editPoolRangeInput.value = overrides.rangeWidthPct ?? "";
    editPoolRangeInput.placeholder = `Padrão (${defaultRange})`;
  }
  if (editPoolBudgetInput) {
    editPoolBudgetInput.value = overrides.budgetUsd ?? "";
    editPoolBudgetInput.placeholder = `Padrão (${defaultBudget})`;
  }
  if (editPoolHedgeEnabledInput) {
    editPoolHedgeEnabledInput.value = overrides.hedgeEnabled === undefined ? "" : String(overrides.hedgeEnabled);
    setSelectPlaceholder(editPoolHedgeEnabledInput, `Padrão (${defaultHedgeEnabled ? "Sim" : "Não"})`);
  }
  if (editPoolHedgePctInput) {
    editPoolHedgePctInput.value = overrides.hedgePct ?? "";
    editPoolHedgePctInput.placeholder = `Padrão (${formatNumber(defaultHedgePct, 2)})`;
  }
  if (editPoolHedgeMarginPctInput) {
    editPoolHedgeMarginPctInput.value = overrides.hedgeMarginPct ?? "";
    editPoolHedgeMarginPctInput.placeholder = `Padrão (${formatNumber(defaultHedgeMarginPct, 2)})`;
  }
  if (editPoolHedgeSymbolInput) {
    editPoolHedgeSymbolInput.value = overrides.hedgeSymbol ?? "";
    editPoolHedgeSymbolInput.placeholder = `Padrão (${defaultHedgeSymbol || "-"})`;
  }
  if (editPoolHedgeLeverageInput) {
    editPoolHedgeLeverageInput.value = overrides.hedgeLeverage ?? "";
    editPoolHedgeLeverageInput.placeholder = `Padrão (${formatNumber(defaultHedgeLeverage, 2)})`;
  }
  if (editPoolExitTokenInput) {
    updateExitTokenSelectHints(editPoolExitTokenInput, tokenInfo);
    editPoolExitTokenInput.value = overrides.preferredExitToken ?? "";
    const exitLabel = formatExitToken(defaultExitToken, tokenInfo);
    setSelectPlaceholder(editPoolExitTokenInput, `Padrão (${exitLabel === "-" ? "Sem" : exitLabel})`);
  }
  if (editPoolExitBiasInput) {
    editPoolExitBiasInput.value = overrides.rangeExitBiasPct ?? "";
    editPoolExitBiasInput.placeholder = `Padrão (${formatNumber(defaultExitBias, 2)})`;
  }
  if (editPoolTrendEnabledInput) {
    editPoolTrendEnabledInput.value = overrides.trendEnabled === undefined ? "" : String(overrides.trendEnabled);
    setSelectPlaceholder(editPoolTrendEnabledInput, `Padrão (${defaultTrendEnabled ? "Sim" : "Não"})`);
  }
  if (editPoolTrendTimeframeInput) {
    editPoolTrendTimeframeInput.value = overrides.trendTimeframe ?? "";
    setSelectPlaceholder(editPoolTrendTimeframeInput, `Padrão (${defaultTrendTimeframe})`);
  }
  if (editPoolTrendUpInput) {
    updateTrendTargetSelectHints(editPoolTrendUpInput, tokenInfo);
    editPoolTrendUpInput.value = overrides.trendTargetUp ?? "";
    setSelectPlaceholder(editPoolTrendUpInput, `Padrão (${formatTrendTargetLabel(defaultTrendUp, tokenInfo)})`);
  }
  if (editPoolTrendDownInput) {
    updateTrendTargetSelectHints(editPoolTrendDownInput, tokenInfo);
    editPoolTrendDownInput.value = overrides.trendTargetDown ?? "";
    setSelectPlaceholder(editPoolTrendDownInput, `Padrão (${formatTrendTargetLabel(defaultTrendDown, tokenInfo)})`);
  }

  updateTrendHint(editPoolTrendHint, tokenInfo);

  openModal(editPoolModal);
}

function closeEditPoolModal() {
  closeModal(editPoolModal);
}

function renderHistory(items) {
  const filteredItems = applyHistoryTypeFilter(items);
  if (!filteredItems || filteredItems.length === 0) {
    selectedHistoryIds.clear();
    historyBody.innerHTML = "<tr><td colspan=\"21\">Sem eventos ainda</td></tr>";
    updateHistorySelectionState();
    return;
  }
  const limit = historyRowLimit ?? 30;
  const currentIds = new Set();
  const rows = filteredItems.slice(0, limit).map((item, index) => {
    const actionLabel = actionLabels[item.action] ?? item.action ?? "-";
    const typeLabel = actionTypeLabels[item.actionType] ?? item.actionType ?? "-";
    const eventId = item.id ?? `legacy-${index}`;
    currentIds.add(eventId);
    const checked = selectedHistoryIds.has(eventId) ? "checked" : "";
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
        <td><input type="checkbox" class="history-select" data-id="${eventId}" ${checked}></td>
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
        <td data-col="hedgePnl">${formatNumber(item.hedgePnlUsd, 2)}</td>
        <td data-col="pnlTotal">${formatNumber(pnlTotal, 2)}</td>
        <td data-col="pnlTotalNet">${formatNumber(pnlTotalNet, 2)}</td>
      </tr>
    `;
  });
  historyBody.innerHTML = rows.join("");
  selectedHistoryIds = new Set(Array.from(selectedHistoryIds).filter((id) => currentIds.has(id)));
  applyHistoryColumnVisibility();
  updateHistorySelectionState();
}

function renderHedgeLogs(items) {
  if (!hedgeLogBody) {
    return;
  }
  if (!Array.isArray(items) || items.length === 0) {
    hedgeLogBody.innerHTML = "<tr><td colspan=\"9\">Sem eventos ainda</td></tr>";
    return;
  }
  const rows = items.slice(0, MAX_HEDGE_LOG_ROWS).map((item) => {
    const levelLabel = hedgeLogLevelLabels[item.level] ?? item.level ?? "-";
    const actionLabel = hedgeLogActionLabels[item.action] ?? item.action ?? "-";
    const message = escapeHtml(item.message ?? "-");
    return `
      <tr class="hedge-log hedge-log-${item.level ?? "info"}">
        <td>${formatTimestamp(item.timestamp)}</td>
        <td>${levelLabel}</td>
        <td>${actionLabel}</td>
        <td>${escapeHtml(item.symbol ?? "-")}</td>
        <td>${formatNumber(item.qty, 4)}</td>
        <td>${formatNumber(item.notionalUsd, 2)}</td>
        <td>${formatNumber(item.leverage, 2)}</td>
        <td>${formatNumber(item.pnlUsd, 2)}</td>
        <td>${message}</td>
      </tr>
    `;
  });
  hedgeLogBody.innerHTML = rows.join("");
}

function renderPools(data, config) {
  closeActiveActionMenu();
  const pools = data?.pools ?? [];
  cachedPools = pools;
  cachedConfig = config;
  if (!pools.length) {
    poolsBody.innerHTML = "<tr><td colspan=\"16\">Sem pools cadastradas</td></tr>";
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
    const exitTokenDisplay = pool.overrides?.preferredExitToken ?? null;
    const exitBiasDisplay = pool.overrides?.rangeExitBiasPct ?? null;
    const hedgeEnabledDisplay = pool.overrides?.hedgeEnabled ?? null;
    const hedgePctDisplay = pool.overrides?.hedgePct ?? null;
    const hedgeSymbolDisplay = pool.overrides?.hedgeSymbol ?? null;
    const hedgeLeverageDisplay = pool.overrides?.hedgeLeverage ?? null;
    const defaultRange = config?.rangeWidthPct ?? "-";
    const defaultBudget = config?.budgetUsd ?? "-";
    const defaultExitToken = config?.preferredExitToken ?? null;
    const defaultExitBias = config?.rangeExitBiasPct ?? "-";
    const defaultHedgeEnabled = config?.hedgeEnabled ?? false;
    const defaultHedgePct = config?.hedgePct ?? "-";
    const defaultHedgeSymbol = config?.hedgeSymbol ?? "-";
    const defaultHedgeLeverage = config?.hedgeLeverage ?? "-";
    const poolTokenInfo = getTokenInfo(pool);
    const rangeLabel = rangeDisplay == null ? `Padrão (${defaultRange})` : Number(rangeDisplay).toFixed(2);
    const budgetLabel = budgetDisplay == null ? `Padrão (${defaultBudget})` : Number(budgetDisplay).toFixed(2);
    const exitTokenLabel = exitTokenDisplay == null
      ? `Padrão (${formatExitToken(defaultExitToken, poolTokenInfo)})`
      : formatExitToken(exitTokenDisplay, poolTokenInfo);
    const exitBiasLabel = exitBiasDisplay == null
      ? `Padrão (${formatNumber(defaultExitBias, 2)})`
      : formatNumber(exitBiasDisplay, 2);
    const hedgeEnabledValue = hedgeEnabledDisplay == null ? defaultHedgeEnabled : hedgeEnabledDisplay;
    const hedgePctLabel = hedgePctDisplay == null
      ? `Padrão (${formatNumber(defaultHedgePct, 2)})`
      : formatNumber(hedgePctDisplay, 2);
    const hedgeSymbolLabel = hedgeSymbolDisplay == null
      ? `Padrão (${defaultHedgeSymbol || "-"})`
      : hedgeSymbolDisplay;
    const hedgeLeverageLabel = hedgeLeverageDisplay == null
      ? `Padrão (${formatNumber(defaultHedgeLeverage, 2)})`
      : formatNumber(hedgeLeverageDisplay, 2);
    const createdAt = formatTimestamp(pool.createdAt);
    return `
      <tr>
        <td>${pool.name}</td>
        <td>${createdAt}</td>
        <td>${pool.whirlpoolAddress}</td>
        <td>${rangeLabel}</td>
        <td>${exitTokenLabel}</td>
        <td>${exitBiasLabel}</td>
        <td>${formatTrendBadge(pool)}</td>
        <td>${budgetLabel}</td>
        <td>${hedgeEnabledValue ? hedgePctLabel : "Desativado"}</td>
        <td>${hedgeEnabledValue ? hedgeSymbolLabel : "-"}</td>
        <td>${hedgeEnabledValue ? hedgeLeverageLabel : "-"}</td>
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
        <td>${formatNumber(pool.positionPnlSol, 4)}</td>
      </tr>
    `;
  });
  resultsBody.innerHTML = rows.join("");
}

async function updateUI() {
  try {
    const [status, config, history, pools, hedgeLogs] = await Promise.all([
      fetchStatus(),
      fetchConfig(),
      fetchHistory(),
      fetchPools(),
      fetchHedgeLogs()
    ]);
    cachedHistory = Array.isArray(history) ? history : [];

    runningEl.textContent = status.running ? "Sim" : "Não";
    lastTickEl.textContent = formatTimestamp(status.lastTickAt);
    lastActionEl.textContent = status.lastAction ?? "-";
    lastErrorEl.textContent = status.lastError ?? "-";
    if (hedgeStatusEl) {
      const hedgeLabel = status.hedgeActive
        ? `Ativo${status.hedgeSymbol ? " (" + status.hedgeSymbol + ")" : ""}`
        : "Parado";
      hedgeStatusEl.textContent = hedgeLabel;
    }
    if (hedgeErrorEl) {
      hedgeErrorEl.textContent = status.hedgeLastError ?? "-";
    }
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

    const tokenInfo = getTokenInfo(config);
    updateExitTokenSelectHints(poolExitTokenInput, tokenInfo);
    if (poolTrendUpInput) {
      updateTrendTargetSelectHints(poolTrendUpInput, tokenInfo);
      setSelectPlaceholder(poolTrendUpInput, `Padrão (${formatTrendTargetLabel(config.trendTargetUp, tokenInfo)})`);
    }
    if (poolTrendDownInput) {
      updateTrendTargetSelectHints(poolTrendDownInput, tokenInfo);
      setSelectPlaceholder(poolTrendDownInput, `Padrão (${formatTrendTargetLabel(config.trendTargetDown, tokenInfo)})`);
    }
    if (poolTrendEnabledInput) {
      setSelectPlaceholder(poolTrendEnabledInput, `Padrão (${config.trendEnabled ? "Sim" : "Não"})`);
    }
    if (poolTrendTimeframeInput) {
      setSelectPlaceholder(poolTrendTimeframeInput, `Padrão (${config.trendTimeframe ?? "1m"})`);
    }
    updateTrendHint(poolTrendHint, tokenInfo);

    renderHistory(history);
    renderHedgeLogs(hedgeLogs);
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

if (closeEmptyAccountsBtn) {
  closeEmptyAccountsBtn.addEventListener("click", async () => {
    const ok = window.confirm("Fechar contas SPL vazias e recolher SOL?");
    if (!ok) return;
    const res = await fetch("/api/close-empty-accounts", { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const msg = data?.error ?? "Falha ao fechar contas vazias.";
      window.alert(msg);
      return;
    }
    const reclaimedSol = Number(data.reclaimedLamports ?? 0) / 1_000_000_000;
    const message = [
      `Fechadas: ${data.closedCount ?? 0}`,
      `Falhas: ${data.failedCount ?? 0}`,
      `SOL recuperado: ${formatNumber(reclaimedSol, 6)}`
    ].join("\n");
    window.alert(message);
    updateUI();
  });
}

if (swapToSolBtn) {
  swapToSolBtn.addEventListener("click", async () => {
    const ok = window.confirm("Converter todos os tokens da wallet para SOL?");
    if (!ok) return;
    const res = await fetch("/api/swap-wallet-to-sol", { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const fallback = data?.error ?? "Falha ao converter tokens para SOL.";
      showSwapResultModal({ ...(data ?? {}), error: fallback });
      updateUI();
      return;
    }
    if (!data?.ok) {
      showSwapResultModal(data);
      updateUI();
      return;
    }
    showSwapResultModal(data);
    updateUI();
  });
}

const hedgeSymbolInputs = [poolHedgeSymbolInput, editPoolHedgeSymbolInput].filter(Boolean);
hedgeSymbolInputs.forEach((input) => {
  input.addEventListener("focus", () => {
    void ensureHedgeSymbolsLoaded();
  });
  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase();
  });
});

addPoolBtn.addEventListener("click", async () => {
  const name = poolNameInput.value.trim();
  const address = poolAddressInput.value.trim();
  const rangeWidthPct = parseOptionalNumber(poolRangeInput.value);
  const rangeExitBiasPct = parseOptionalNumber(poolExitBiasInput?.value);
  const preferredExitToken = poolExitTokenInput?.value?.trim();
  const trendEnabledRaw = poolTrendEnabledInput?.value ?? "";
  const trendTimeframeRaw = poolTrendTimeframeInput?.value ?? "";
  const trendTargetUpRaw = poolTrendUpInput?.value ?? "";
  const trendTargetDownRaw = poolTrendDownInput?.value ?? "";
  const budgetUsd = parseOptionalNumber(poolBudgetInput.value);
  const hedgeEnabledRaw = poolHedgeEnabledInput?.value ?? "";
  const hedgePct = parseOptionalNumber(poolHedgePctInput?.value);
  const hedgeMarginPct = parseOptionalNumber(poolHedgeMarginPctInput?.value);
  const hedgeSymbol = poolHedgeSymbolInput?.value?.trim();
  const hedgeLeverage = parseOptionalNumber(poolHedgeLeverageInput?.value);
  poolError.classList.add("hidden");
  try {
    const overrides = {};
    if (rangeWidthPct !== undefined) {
      overrides.rangeWidthPct = rangeWidthPct;
    }
    if (rangeExitBiasPct !== undefined) {
      overrides.rangeExitBiasPct = rangeExitBiasPct;
    }
    if (preferredExitToken) {
      overrides.preferredExitToken = preferredExitToken;
    }
    if (trendEnabledRaw) {
      const parsed = parseTrendEnabledInput(trendEnabledRaw);
      if (parsed === null) {
        throw new Error("Tendência inválida. Use Sim ou Não.");
      }
      overrides.trendEnabled = parsed;
    }
    if (trendTimeframeRaw) {
      const parsed = parseTrendTimeframeInput(trendTimeframeRaw);
      if (!parsed) {
        throw new Error("Timeframe de tendência inválido.");
      }
      overrides.trendTimeframe = parsed;
    }
    if (trendTargetUpRaw) {
      const parsed = parseTrendTargetInput(trendTargetUpRaw);
      if (!parsed) {
        throw new Error("Target de alta inválido.");
      }
      overrides.trendTargetUp = parsed;
    }
    if (trendTargetDownRaw) {
      const parsed = parseTrendTargetInput(trendTargetDownRaw);
      if (!parsed) {
        throw new Error("Target de baixa inválido.");
      }
      overrides.trendTargetDown = parsed;
    }
    if (budgetUsd !== undefined) {
      overrides.budgetUsd = budgetUsd;
    }
    if (hedgeEnabledRaw) {
      const parsed = parseTrendEnabledInput(hedgeEnabledRaw);
      if (parsed === null) {
        throw new Error("Proteção Bybit inválida. Use Sim ou Não.");
      }
      overrides.hedgeEnabled = parsed;
    }
    if (hedgePct !== undefined) {
      overrides.hedgePct = hedgePct;
    }
    if (hedgeMarginPct !== undefined) {
      overrides.hedgeMarginPct = hedgeMarginPct;
    }
    if (hedgeSymbol) {
      overrides.hedgeSymbol = hedgeSymbol;
    }
    if (hedgeLeverage !== undefined) {
      overrides.hedgeLeverage = hedgeLeverage;
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
    if (poolExitTokenInput) poolExitTokenInput.value = "";
    if (poolExitBiasInput) poolExitBiasInput.value = "";
    if (poolTrendEnabledInput) poolTrendEnabledInput.value = "";
    if (poolTrendTimeframeInput) poolTrendTimeframeInput.value = "";
    if (poolTrendUpInput) poolTrendUpInput.value = "";
    if (poolTrendDownInput) poolTrendDownInput.value = "";
    poolBudgetInput.value = "";
    if (poolHedgeEnabledInput) poolHedgeEnabledInput.value = "";
    if (poolHedgePctInput) poolHedgePctInput.value = "";
    if (poolHedgeMarginPctInput) poolHedgeMarginPctInput.value = "";
    if (poolHedgeSymbolInput) poolHedgeSymbolInput.value = "";
    if (poolHedgeLeverageInput) poolHedgeLeverageInput.value = "";
    updateUI();
  } catch (err) {
    poolError.textContent = err instanceof Error ? err.message : String(err);
    poolError.classList.remove("hidden");
  }
});

if (editPoolForm) {
  editPoolForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!editPoolIdInput) return;
    const id = editPoolIdInput.value;
    if (!id) return;
    if (editPoolError) {
      editPoolError.textContent = "";
      editPoolError.classList.add("hidden");
    }

    const overrides = {};

    const rangeRaw = editPoolRangeInput?.value?.trim() ?? "";
    if (!rangeRaw) {
      overrides.rangeWidthPct = null;
    } else {
      const parsed = parseOptionalNumber(rangeRaw);
      if (parsed === undefined) {
        if (editPoolError) {
          editPoolError.textContent = "Range % inválido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.rangeWidthPct = parsed;
    }

    const budgetRaw = editPoolBudgetInput?.value?.trim() ?? "";
    if (!budgetRaw) {
      overrides.budgetUsd = null;
    } else {
      const parsed = parseOptionalNumber(budgetRaw);
      if (parsed === undefined) {
        if (editPoolError) {
          editPoolError.textContent = "Budget USD inválido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.budgetUsd = parsed;
    }

    const exitTokenRaw = editPoolExitTokenInput?.value?.trim() ?? "";
    if (!exitTokenRaw) {
      overrides.preferredExitToken = null;
    } else {
      const parsed = parseExitTokenInput(exitTokenRaw);
      if (!parsed) {
        if (editPoolError) {
          editPoolError.textContent = "Saída preferida inválida. Use tokenA ou tokenB.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.preferredExitToken = parsed;
    }

    const exitBiasRaw = editPoolExitBiasInput?.value?.trim() ?? "";
    if (!exitBiasRaw) {
      overrides.rangeExitBiasPct = null;
    } else {
      const parsed = parseOptionalNumber(exitBiasRaw);
      if (parsed === undefined) {
        if (editPoolError) {
          editPoolError.textContent = "Bias % inválido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.rangeExitBiasPct = parsed;
    }

    const trendEnabledRaw = editPoolTrendEnabledInput?.value ?? "";
    if (!trendEnabledRaw) {
      overrides.trendEnabled = null;
    } else {
      const parsed = parseTrendEnabledInput(trendEnabledRaw);
      if (parsed === null) {
        if (editPoolError) {
          editPoolError.textContent = "Tendência inválida. Use Sim ou Não.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.trendEnabled = parsed;
    }

    const trendTimeframeRaw = editPoolTrendTimeframeInput?.value ?? "";
    if (!trendTimeframeRaw) {
      overrides.trendTimeframe = null;
    } else {
      const parsed = parseTrendTimeframeInput(trendTimeframeRaw);
      if (!parsed) {
        if (editPoolError) {
          editPoolError.textContent = "Timeframe de tendência inválido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.trendTimeframe = parsed;
    }

    const trendUpRaw = editPoolTrendUpInput?.value ?? "";
    if (!trendUpRaw) {
      overrides.trendTargetUp = null;
    } else {
      const parsed = parseTrendTargetInput(trendUpRaw);
      if (!parsed) {
        if (editPoolError) {
          editPoolError.textContent = "Target de alta inválido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.trendTargetUp = parsed;
    }

    const trendDownRaw = editPoolTrendDownInput?.value ?? "";
    if (!trendDownRaw) {
      overrides.trendTargetDown = null;
    } else {
      const parsed = parseTrendTargetInput(trendDownRaw);
      if (!parsed) {
        if (editPoolError) {
          editPoolError.textContent = "Target de baixa inválido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.trendTargetDown = parsed;
    }

    const hedgeEnabledRaw = editPoolHedgeEnabledInput?.value ?? "";
    if (!hedgeEnabledRaw) {
      overrides.hedgeEnabled = null;
    } else {
      const parsed = parseTrendEnabledInput(hedgeEnabledRaw);
      if (parsed === null) {
        if (editPoolError) {
          editPoolError.textContent = "Proteção Bybit inválida. Use Sim ou Não.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.hedgeEnabled = parsed;
    }

    const hedgePctRaw = editPoolHedgePctInput?.value?.trim() ?? "";
    if (!hedgePctRaw) {
      overrides.hedgePct = null;
    } else {
      const parsed = parseOptionalNumber(hedgePctRaw);
      if (parsed === undefined) {
        if (editPoolError) {
          editPoolError.textContent = "Hedge % inválido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.hedgePct = parsed;
    }

    const hedgeMarginRaw = editPoolHedgeMarginPctInput?.value?.trim() ?? "";
    if (!hedgeMarginRaw) {
      overrides.hedgeMarginPct = null;
    } else {
      const parsed = parseOptionalNumber(hedgeMarginRaw);
      if (parsed === undefined) {
        if (editPoolError) {
          editPoolError.textContent = "Hedge margem % inválida.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.hedgeMarginPct = parsed;
    }

    const hedgeSymbolRaw = editPoolHedgeSymbolInput?.value?.trim() ?? "";
    if (!hedgeSymbolRaw) {
      overrides.hedgeSymbol = null;
    } else {
      overrides.hedgeSymbol = hedgeSymbolRaw;
    }

    const hedgeLeverageRaw = editPoolHedgeLeverageInput?.value?.trim() ?? "";
    if (!hedgeLeverageRaw) {
      overrides.hedgeLeverage = null;
    } else {
      const parsed = parseOptionalNumber(hedgeLeverageRaw);
      if (parsed === undefined) {
        if (editPoolError) {
          editPoolError.textContent = "Alavancagem inválida.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.hedgeLeverage = parsed;
    }

    try {
      const res = await fetch(`/api/pools/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        if (editPoolError) {
          editPoolError.textContent = data?.error ?? "Erro ao atualizar pool.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      closeEditPoolModal();
      updateUI();
    } catch (err) {
      if (editPoolError) {
        editPoolError.textContent = err instanceof Error ? err.message : String(err);
        editPoolError.classList.remove("hidden");
      }
    }
  });
}

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
    openEditPoolModal(pool);
    return;
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

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const closeType = target.getAttribute("data-close");
  if (closeType === "edit") {
    closeEditPoolModal();
  } else if (closeType === "swap") {
    closeSwapResultModal();
  } else if (closeType === "swap-error") {
    closeSwapErrorModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeEditPoolModal();
    closeSwapResultModal();
    closeSwapErrorModal();
  }
});

if (swapResultList) {
  swapResultList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("[data-error-index]");
    if (!(button instanceof HTMLElement)) return;
    const raw = button.getAttribute("data-error-index");
    const idx = raw ? Number(raw) : Number.NaN;
    if (!Number.isFinite(idx)) return;
    const text = swapErrorDetails[idx] ?? "";
    openSwapErrorModal(text);
  });
}

if (swapErrorCopy) {
  swapErrorCopy.addEventListener("click", () => {
    copyErrorText(swapErrorText?.textContent ?? "");
  });
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

function loadHistoryTypeVisibility() {
  const raw = localStorage.getItem("historyTypeFilters");
  if (!raw) return { ...historyTypeDefaults };
  try {
    const parsed = JSON.parse(raw);
    return { ...historyTypeDefaults, ...parsed };
  } catch {
    return { ...historyTypeDefaults };
  }
}

function loadHistoryRowLimit() {
  const raw = localStorage.getItem("historyRowLimit");
  if (!raw) return 30;
  const parsed = Number(raw);
  return [10, 20, 30].includes(parsed) ? parsed : 30;
}

function saveHistoryRowLimit() {
  localStorage.setItem("historyRowLimit", String(historyRowLimit));
}

function saveHistoryColumnVisibility() {
  localStorage.setItem("historyColumnVisibility", JSON.stringify(historyColumnVisibility));
}

function saveHistoryTypeVisibility() {
  localStorage.setItem("historyTypeFilters", JSON.stringify(historyTypeVisibility));
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

function syncHistoryTypeControls() {
  if (!historyTypeFilters) return;
  historyTypeFilters.querySelectorAll("input[data-type]").forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    const type = input.getAttribute("data-type");
    if (!type) return;
    input.checked = historyTypeVisibility[type] !== false;
  });
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

function normalizeActionTypeValue(value) {
  if (!value) return "operacional";
  if (value === "fechamento + abertura") return value;
  if (Object.prototype.hasOwnProperty.call(historyTypeDefaults, value)) {
    return value;
  }
  return "operacional";
}

function getEventTypes(item) {
  const raw = normalizeActionTypeValue(item?.actionType);
  if (raw === "fechamento + abertura") {
    return ["fechamento", "abertura"];
  }
  return [raw];
}

function applyHistoryTypeFilter(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    const types = getEventTypes(item);
    return types.some((type) => historyTypeVisibility[type] !== false);
  });
}

function syncHistoryRowLimit() {
  if (!historyRowLimitSelect) return;
  historyRowLimitSelect.value = String(historyRowLimit ?? 30);
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

if (historyTypeFilters) {
  historyTypeFilters.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const type = target.getAttribute("data-type");
    if (!type) return;
    historyTypeVisibility = { ...historyTypeVisibility, [type]: target.checked };
    saveHistoryTypeVisibility();
    renderHistory(cachedHistory);
  });
}

if (historyRowLimitSelect) {
  historyRowLimitSelect.addEventListener("change", () => {
    const value = Number(historyRowLimitSelect.value);
    historyRowLimit = [10, 20, 30].includes(value) ? value : 30;
    saveHistoryRowLimit();
    renderHistory(cachedHistory);
  });
}

clearHistoryBtn.addEventListener("click", async () => {
  const ok = window.confirm("Limpar o histórico? Essa ação não pode ser desfeita.");
  if (!ok) return;
  await fetch("/api/history/clear", { method: "POST" });
  updateUI();
});

if (clearHedgeLogBtn) {
  clearHedgeLogBtn.addEventListener("click", async () => {
    const ok = window.confirm("Limpar o log do hedge? Essa ação não pode ser desfeita.");
    if (!ok) return;
    await fetch("/api/hedge-logs/clear", { method: "POST" });
    updateUI();
  });
}

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
syncHistoryTypeControls();
syncHistoryRowLimit();
setInterval(updateUI, 5000);
