const statusBadge = document.getElementById("statusBadge");
const runningEl = document.getElementById("running");
const lastTickEl = document.getElementById("lastTick");
const lastActionEl = document.getElementById("lastAction");
const lastErrorEl = document.getElementById("lastError");
const effectiveExitSideEl = document.getElementById("effectiveExitSide");
const priceEl = document.getElementById("price");
const priceTopEl = document.getElementById("priceTop");
const targetRangeEl = document.getElementById("targetRange");
const positionRangeEl = document.getElementById("positionRange");
const positionMintEl = document.getElementById("positionMint");
const solBalanceEl = document.getElementById("solBalance");
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
const kaminoStatusEl = document.getElementById("kaminoStatus");
const kaminoEnabledEl = document.getElementById("kaminoEnabled");
const kaminoLtvEl = document.getElementById("kaminoLtv");
const kaminoCollateralUsdEl = document.getElementById("kaminoCollateralUsd");
const kaminoDebtUsdEl = document.getElementById("kaminoDebtUsd");
const kaminoAvgPriceEl = document.getElementById("kaminoAvgPrice");
const kaminoTargetPriceEl = document.getElementById("kaminoTargetPrice");
const kaminoCycleCountEl = document.getElementById("kaminoCycleCount");
const kaminoSimulatedEl = document.getElementById("kaminoSimulated");
const kaminoLastErrorEl = document.getElementById("kaminoLastError");
const kaminoCollateralsEl = document.getElementById("kaminoCollaterals");
const kaminoPoolNameEl = document.getElementById("kaminoPoolName");
const kaminoOwnerPoolEl = document.getElementById("kaminoOwnerPool");
const kaminoAvgModeHintEl = document.getElementById("kaminoAvgModeHint");
const kaminoTestTokenSelect = document.getElementById("kaminoTestToken");
const kaminoTestMintInput = document.getElementById("kaminoTestMint");
const kaminoTestAmountInput = document.getElementById("kaminoTestAmount");
const kaminoTestBtn = document.getElementById("kaminoTestBtn");
const kaminoTestResult = document.getElementById("kaminoTestResult");
const historyBody = document.getElementById("historyBody");
const kaminoLogBody = document.getElementById("kaminoLogBody");
const kaminoLogModal = document.getElementById("kaminoLogModal");
const kaminoLogDetailTime = document.getElementById("kaminoLogDetailTime");
const kaminoLogDetailLevel = document.getElementById("kaminoLogDetailLevel");
const kaminoLogDetailAction = document.getElementById("kaminoLogDetailAction");
const kaminoLogDetailMarket = document.getElementById("kaminoLogDetailMarket");
const kaminoLogDetailMessage = document.getElementById("kaminoLogDetailMessage");
const poolNameLabel = document.getElementById("poolNameLabel");
const poolNameLabelTop = document.getElementById("poolNameLabelTop");

const poolNameInput = document.getElementById("poolName");
const poolAddressInput = document.getElementById("poolAddress");
const poolRangeInput = document.getElementById("poolRange");
const poolRangeAnchorInput = document.getElementById("poolRangeAnchor");
const poolExitBiasInput = document.getElementById("poolExitBias");
const poolBudgetInput = document.getElementById("poolBudget");
const poolAutoAddEnabledInput = document.getElementById("poolAutoAddEnabled");
const poolKaminoEnabledInput = document.getElementById("poolKaminoEnabled");
const poolKaminoDepositPctInput = document.getElementById("poolKaminoDepositPct");
const poolKaminoBorrowAssetInput = document.getElementById("poolKaminoBorrowAsset");
const poolKaminoMarketInput = document.getElementById("poolKaminoMarket");
const poolKaminoMaxLtvInput = document.getElementById("poolKaminoMaxLtv");
const poolKaminoCloseRuleInput = document.getElementById("poolKaminoCloseRule");
const poolKaminoPriceBufferInput = document.getElementById("poolKaminoPriceBuffer");
const poolKaminoCollateralModeInput = document.getElementById("poolKaminoCollateralMode");
const poolKaminoConvertInput = document.getElementById("poolKaminoConvert");
const poolKaminoAvgBasisInput = document.getElementById("poolKaminoAvgBasis");
const poolKaminoAvgModeInput = document.getElementById("poolKaminoAvgMode");
const poolKaminoAutoCloseInput = document.getElementById("poolKaminoAutoClose");
const addPoolBtn = document.getElementById("addPoolBtn");
const poolsBody = document.getElementById("poolsBody");
const openPositionsGrid = document.getElementById("openPositionsGrid");
const openPositionsCount = document.getElementById("openPositionsCount");
const poolError = document.getElementById("poolError");
const editPoolModal = document.getElementById("editPoolModal");
const editPoolForm = document.getElementById("editPoolForm");
const editPoolIdInput = document.getElementById("editPoolId");
const editPoolRangeInput = document.getElementById("editPoolRange");
const editPoolRangeAnchorInput = document.getElementById("editPoolRangeAnchor");
const editPoolExitBiasInput = document.getElementById("editPoolExitBias");
const editPoolBudgetInput = document.getElementById("editPoolBudget");
const editPoolAutoAddEnabledInput = document.getElementById("editPoolAutoAddEnabled");
const editPoolKaminoEnabledInput = document.getElementById("editPoolKaminoEnabled");
const editPoolKaminoDepositPctInput = document.getElementById("editPoolKaminoDepositPct");
const editPoolKaminoBorrowAssetInput = document.getElementById("editPoolKaminoBorrowAsset");
const editPoolKaminoMarketInput = document.getElementById("editPoolKaminoMarket");
const editPoolKaminoMaxLtvInput = document.getElementById("editPoolKaminoMaxLtv");
const editPoolKaminoCloseRuleInput = document.getElementById("editPoolKaminoCloseRule");
const editPoolKaminoPriceBufferInput = document.getElementById("editPoolKaminoPriceBuffer");
const editPoolKaminoCollateralModeInput = document.getElementById("editPoolKaminoCollateralMode");
const editPoolKaminoConvertInput = document.getElementById("editPoolKaminoConvert");
const editPoolKaminoAvgBasisInput = document.getElementById("editPoolKaminoAvgBasis");
const editPoolKaminoAvgModeInput = document.getElementById("editPoolKaminoAvgMode");
const editPoolKaminoAutoCloseInput = document.getElementById("editPoolKaminoAutoClose");
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
let cachedKaminoLogs = [];
let activeActionMenu = null;
let swapErrorDetails = [];
let historyEditState = null;
let historyEditPendingRender = false;
let cachedKaminoMarkets = [];
let kaminoMarketsLoaded = false;
let kaminoMarketsLoading = false;
let cachedStatus = null;
let cachedPoolsResponse = null;
let uiErrorCount = 0;
const UI_ERROR_LIMIT = 3;
const POOLS_CACHE_KEY = "orcaPoolsCacheV1";
let didAutoRestoreFromConfig = false;
let didAutoRestoreFromCache = false;

function loadPoolsCache() {
  try {
    const raw = window.localStorage.getItem(POOLS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.pools)) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function savePoolsCache(pools, selectedPoolId) {
  try {
    const payload = {
      pools,
      selectedPoolId: selectedPoolId ?? null,
      savedAt: new Date().toISOString()
    };
    window.localStorage.setItem(POOLS_CACHE_KEY, JSON.stringify(payload));
  } catch (err) {
    // ignore storage errors
  }
}

async function restorePoolsFromCache() {
  const cached = loadPoolsCache();
  if (!cached || !Array.isArray(cached.pools) || cached.pools.length === 0) {
    return;
  }
  for (const pool of cached.pools) {
    if (!pool?.whirlpoolAddress || !pool?.name) {
      continue;
    }
    try {
      const res = await fetch("/api/pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: pool.name,
          whirlpoolAddress: pool.whirlpoolAddress,
          overrides: pool.overrides ?? undefined
        })
      });
      const data = await res.json().catch(() => null);
      if (data?.error && String(data.error).toLowerCase().includes("exists")) {
        continue;
      }
    } catch (err) {
      // ignore and continue
    }
  }
  updateUI();
}

async function restorePoolFromConfig(config) {
  if (!config || !config.whirlpoolAddress) return;
  const name = config.poolName ?? "Pool selecionada";
  try {
    await fetch("/api/pools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        whirlpoolAddress: config.whirlpoolAddress,
        overrides: null
      })
    });
  } catch (err) {
    // ignore
  }
}

const cachedPoolsLocal = loadPoolsCache();
if (cachedPoolsLocal?.pools?.length) {
  cachedPools = cachedPoolsLocal.pools;
  cachedPoolsResponse = cachedPoolsLocal;
}

function normalizePoolsResponse(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return { pools: raw };
  if (Array.isArray(raw.pools)) {
    return {
      ...raw,
      pools: raw.pools
    };
  }
  return null;
}

function updateCachedPoolRunning(id, running) {
  if (!id) return;
  const normalized = normalizePoolsResponse(cachedPoolsResponse)
    ?? (Array.isArray(cachedPools) ? { pools: cachedPools } : null);
  if (!normalized) return;
  normalized.pools = normalized.pools.map((pool) =>
    pool.id === id ? { ...pool, running: Boolean(running) } : pool
  );
  cachedPoolsResponse = normalized;
  cachedPools = normalized.pools;
}

function applyStatusSnapshot(status) {
  if (!status) return;
  cachedStatus = status;
  const selectedId = cachedConfig?.selectedPoolId
    ?? cachedPoolsResponse?.selectedPoolId
    ?? null;
  if (selectedId) {
    updateCachedPoolRunning(selectedId, status.running);
  }
  const pools = normalizePoolsResponse(cachedPoolsResponse)
    ?? (Array.isArray(cachedPools) ? { pools: cachedPools } : null);
  if (cachedStatus && cachedConfig && pools) {
    renderUiSnapshot(cachedStatus, cachedConfig, cachedHistory, pools, cachedKaminoLogs);
  }
}

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const closeBtn = document.getElementById("closeBtn");
const closeStopBtn = document.getElementById("closeStopBtn");
const addLiquidityBtn = document.getElementById("addLiquidityBtn");
const topupBtn = document.getElementById("topupBtn");
const closeEmptyAccountsBtn = document.getElementById("closeEmptyAccountsBtn");
const testPriceBtn = document.getElementById("testPriceBtn");
const priceSourcesResult = document.getElementById("priceSourcesResult");
const solUsdSourceEl = document.getElementById("solUsdSource");
const swapToSolBtn = document.getElementById("swapToSolBtn");
const kaminoCloseTopBtn = document.getElementById("kaminoCloseTopBtn");
const kaminoCloseBtn = document.getElementById("kaminoCloseBtn");
const kaminoResetBtn = document.getElementById("kaminoResetBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const clearKaminoLogBtn = document.getElementById("clearKaminoLogBtn");
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
let historyColumnVisibility = loadHistoryColumnVisibility();
const historyTypeDefaults = {
  abertura: true,
  fechamento: true,
  "fechamento-emprestimo": true,
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
  "add-liquidity": "adicionar liquidez",
  "add-liquidity-failed": "falha ao adicionar liquidez",
  "resume-position": "monitorando posição existente",
  "close-failed": "fechamento falhou",
  "reload-position": "recarregar posição",
  "out-of-range-wait": "aguardando confirmação fora da faixa",
  "cooldown-wait": "aguardando cooldown",
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
  "fechamento-emprestimo": "Fechamento Empr\u00e9stimo",
  "fechamento + abertura": "Fechamento + abertura",
  "monitorando": "Monitorando",
  "operacional": "Operacional"
};

const HISTORY_EDITABLE_FIELDS = {
  price: { digits: 8, label: "Preco" },
  positionEntryUsd: { digits: 2, label: "Entrada (USD)" },
  positionFeesUsd: { digits: 2, label: "Taxas (USD)" },
  txFeeUsd: { digits: 6, label: "Taxa TX (USD)" },
  positionExitUsd: { digits: 2, label: "Saida (USD)" },
  positionPnlUsd: { digits: 2, label: "PnL liquido (USD)" }
};

const MAX_KAMINO_LOG_ROWS = 20;

const kaminoLogLevelLabels = {
  "info": "Info",
  "warn": "Aviso",
  "error": "Erro"
};

function isVisualPriceAxisInverted(info) {
  return Boolean(info?.isTokenASol && !info?.isTokenBSol);
}

function normalizeDisplayPrice(value, info) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (!isVisualPriceAxisInverted(info) || num === 0) {
    return num;
  }
  return 1 / num;
}

function normalizeDisplayRange(range, info) {
  if (!range) return null;
  const lower = Number(range.lower);
  const upper = Number(range.upper);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower <= 0 || upper <= 0) {
    return null;
  }
  if (!isVisualPriceAxisInverted(info)) {
    return { lower, upper };
  }
  return {
    lower: 1 / upper,
    upper: 1 / lower
  };
}

function formatRange(range, info) {
  const displayRange = normalizeDisplayRange(range, info);
  if (!displayRange) return "-";
  return `${Number(displayRange.lower).toFixed(6)} / ${Number(displayRange.upper).toFixed(6)}`;
}

const numberFormatters = {};
const MAX_USD_SANITY = 1000000000;

function formatNumber(value, digits = 6) {
  if (value === null || value === undefined) return "-";
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  if (Math.abs(num) > MAX_USD_SANITY) return "-";
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

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getLoanClosePnlMetrics(item) {
  const entryUsd = toFiniteNumber(item?.positionEntryUsd);
  const collateralUsd = toFiniteNumber(item?.kaminoCollateralUsd);
  const exitUsd = toFiniteNumber(item?.positionExitUsd);
  const debtUsd = toFiniteNumber(item?.kaminoDebtUsd);
  const txFeeUsd = toFiniteNumber(item?.txFeeUsd) ?? 0;
  const storedNetPnl = toFiniteNumber(item?.kaminoLoanPnlUsd ?? item?.positionPnlUsd);
  let grossPnl = null;
  if (entryUsd != null && collateralUsd != null) {
    grossPnl = collateralUsd - entryUsd;
  } else if (entryUsd != null && exitUsd != null && (debtUsd == null || Math.abs(debtUsd) <= 1e-9)) {
    grossPnl = exitUsd - entryUsd;
  } else if (storedNetPnl != null) {
    grossPnl = storedNetPnl + txFeeUsd;
  }
  const netPnl = grossPnl != null ? grossPnl - txFeeUsd : storedNetPnl;
  return { grossPnl, netPnl };
}

function applyStatusTone(el, value) {
  if (!el) return;
  el.classList.remove("status-ok", "status-warn", "status-bad");
  const text = String(value ?? "").toLowerCase();
  if (!text || text === "-" || text === "na") return;
  if (text.includes("sim") || text.includes("ativo") || text.includes("rodando")) {
    el.classList.add("status-ok");
    return;
  }
  if (text.includes("parado") || text.includes("erro") || text.includes("falha") || text.includes("inativo") || text.includes("nao")) {
    el.classList.add("status-bad");
    return;
  }
  if (text.includes("aguardando") || text.includes("nao encontrada") || text.includes("nao encontrado") || text.includes("cooldown")) {
    el.classList.add("status-warn");
  }
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

function renderKaminoCollaterals(items, active) {
  if (!kaminoCollateralsEl) return;
  const list = Array.isArray(items) ? items : [];
  if (!active) {
    kaminoCollateralsEl.innerHTML = "<div class=\"kv\"><span>Kamino</span><span>Sem ciclo Kamino ativo nesta pool.</span></div>";
    return;
  }
  if (list.length === 0) {
    kaminoCollateralsEl.innerHTML = "<div class=\"kv\"><span>Tokens</span><span>-</span></div>";
    return;
  }
  const rows = list.map((entry) => {
    const label = formatMintLabel(entry?.mint) || shortMint(entry?.mint ?? "");
    const depositUsd = formatNumber(entry?.usd, 2);
    const currentUsd = formatNumber(entry?.currentUsd, 2);
    const pnlUsd = formatNumber(entry?.pnlUsd, 2);
    const avg = formatNumber(entry?.avgPriceUsdc, 6);
    const target = formatNumber(entry?.targetPriceUsdc, 6);
    const current = formatNumber(entry?.currentPriceUsdc, 6);
    const gapPct = entry?.gapToTargetPct != null ? `${formatNumber(entry.gapToTargetPct * 100, 2)}%` : "-";
    const text = `Depósito ${depositUsd} / Atual ${currentUsd} / PnL ${pnlUsd} / Media ${avg} / Alvo ${target} / Preco ${current} / Falta ${gapPct}`;
    return `<div class="kv"><span>${escapeHtml(label)}</span><span>${escapeHtml(text)}</span></div>`;
  });
  kaminoCollateralsEl.innerHTML = rows.join("");
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

function formatKaminoCollateralModeLabel(mode, info) {
  if (mode === "exit") return "Token da saida";
  if (mode === "max-value") return "Maior valor USD";
  if (mode === "both") return "Ambos (dual)";
  if (mode === "tokenA") return describeToken("tokenA", info);
  if (mode === "tokenB") return describeToken("tokenB", info);
  return mode ?? "-";
}

function updateKaminoTestTokenHints(info) {
  if (!(kaminoTestTokenSelect instanceof HTMLSelectElement)) return;
  const optionAuto = kaminoTestTokenSelect.querySelector("option[value=\"auto\"]");
  const optionA = kaminoTestTokenSelect.querySelector("option[value=\"tokenA\"]");
  const optionB = kaminoTestTokenSelect.querySelector("option[value=\"tokenB\"]");
  if (optionAuto) {
    const mode = getEffectiveKaminoCollateralMode();
    optionAuto.textContent = `Colateral da pool (${formatKaminoCollateralModeLabel(mode, info)})`;
  }
  if (optionA) optionA.textContent = describeToken("tokenA", info);
  if (optionB) optionB.textContent = describeToken("tokenB", info);
}

function getSelectedCachedPool() {
  const selectedId = cachedConfig?.selectedPoolId
    ?? cachedPoolsResponse?.selectedPoolId
    ?? null;
  const pools = normalizePoolsResponse(cachedPoolsResponse)?.pools
    ?? (Array.isArray(cachedPools) ? cachedPools : []);
  if (selectedId) {
    return pools.find((pool) => pool.id === selectedId) ?? null;
  }
  return pools.find((pool) => pool.selected) ?? null;
}

function getEffectiveKaminoCollateralMode() {
  const selectedPool = getSelectedCachedPool();
  return selectedPool?.overrides?.kaminoCollateralMode
    ?? cachedConfig?.kaminoCollateralMode
    ?? "max-value";
}

function resolveKaminoTestCollateral(info) {
  const choice = kaminoTestTokenSelect instanceof HTMLSelectElement
    ? kaminoTestTokenSelect.value
    : "auto";
  if (choice === "tokenA") {
    return { mint: info?.tokenAMint ?? null, side: "tokenA", label: describeToken("tokenA", info) };
  }
  if (choice === "tokenB") {
    return { mint: info?.tokenBMint ?? null, side: "tokenB", label: describeToken("tokenB", info) };
  }

  const activeCollaterals = Array.isArray(cachedStatus?.kaminoCollaterals)
    ? cachedStatus.kaminoCollaterals.filter((entry) => entry?.mint)
    : [];
  if (activeCollaterals.length === 1) {
    const mint = activeCollaterals[0].mint;
    return { mint, side: null, label: formatMintLabel(mint) };
  }

  const mode = getEffectiveKaminoCollateralMode();
  if (mode === "tokenA") {
    return { mint: info?.tokenAMint ?? null, side: "tokenA", label: describeToken("tokenA", info) };
  }
  if (mode === "tokenB") {
    return { mint: info?.tokenBMint ?? null, side: "tokenB", label: describeToken("tokenB", info) };
  }

  const effectiveSide = cachedStatus?.effectiveExitToken ?? cachedStatus?.effectiveValueToken ?? null;
  if (effectiveSide === "tokenA") {
    return { mint: info?.tokenAMint ?? null, side: "tokenA", label: describeToken("tokenA", info) };
  }
  if (effectiveSide === "tokenB") {
    return { mint: info?.tokenBMint ?? null, side: "tokenB", label: describeToken("tokenB", info) };
  }

  if (mode === "both" || activeCollaterals.length > 1) {
    return {
      mint: null,
      side: null,
      label: "",
      error: "A pool esta em colateral dual; selecione Token A ou Token B."
    };
  }

  return {
    mint: null,
    side: null,
    label: "",
    error: "Nao consegui inferir o colateral da pool. Selecione Token A ou Token B."
  };
}

function syncKaminoTestMint(info) {
  if (!(kaminoTestMintInput instanceof HTMLInputElement)) return;
  const resolved = resolveKaminoTestCollateral(info);
  kaminoTestMintInput.disabled = true;
  if (resolved.mint) {
    kaminoTestMintInput.value = `${resolved.label || "Colateral"} - ${resolved.mint}`;
  } else if (resolved.label) {
    kaminoTestMintInput.value = `${resolved.label} (aguardando mint)`;
  } else {
    kaminoTestMintInput.value = "";
  }
}

function setKaminoTestResult(message, isError) {
  if (!kaminoTestResult) return;
  kaminoTestResult.textContent = message || "";
  if (isError) {
    kaminoTestResult.classList.add("is-error");
  } else {
    kaminoTestResult.classList.remove("is-error");
  }
}

function normalizeKaminoTestMessage(message) {
  const text = String(message ?? "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  const looksLikeSolanaDecode = lower.includes("decode this error by running")
    || lower.includes("error #-32002")
    || lower.includes("transaction simulation failed");
  const looksLikeLowSol = lower.includes("insufficient lamports")
    || lower.includes("insufficient%20lamports")
    || lower.includes("custom program error: 0x1")
    || lower.includes("insufficient funds");
  if (looksLikeSolanaDecode && looksLikeLowSol) {
    return "Saldo SOL insuficiente para concluir a conversao final. Adicione SOL de rede e tente novamente.";
  }
  return text;
}

function formatExitToken(value, info) {
  if (value === "tokenA") return describeToken("tokenA", info);
  if (value === "tokenB") return describeToken("tokenB", info);
  return "-";
}

function formatExitDirection(value) {
  if (value === "up") return "Alta";
  if (value === "down") return "Baixa";
  return "-";
}

function formatExitSide(value, info) {
  if (value !== "upper" && value !== "lower") return "-";
  const visualValue = isVisualPriceAxisInverted(info)
    ? (value === "upper" ? "lower" : "upper")
    : value;
  if (visualValue === "upper") return `Alta (${value})`;
  if (visualValue === "lower") return `Baixa (${value})`;
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

function getCurrentTokenInfo() {
  const statusInfo = getTokenInfo(cachedStatus);
  const configInfo = getTokenInfo(cachedConfig);
  if (!statusInfo && !configInfo) return null;
  return {
    tokenAMint: statusInfo?.tokenAMint ?? configInfo?.tokenAMint ?? null,
    tokenBMint: statusInfo?.tokenBMint ?? configInfo?.tokenBMint ?? null,
    isTokenASol: statusInfo?.isTokenASol ?? configInfo?.isTokenASol ?? null,
    isTokenBSol: statusInfo?.isTokenBSol ?? configInfo?.isTokenBSol ?? null
  };
}

function updateExitTokenSelectHints(selectEl, info) {
  if (!(selectEl instanceof HTMLSelectElement)) return;
  const optionA = selectEl.querySelector("option[value=\"tokenA\"]");
  const optionB = selectEl.querySelector("option[value=\"tokenB\"]");
  if (optionA) optionA.textContent = describeToken("tokenA", info);
  if (optionB) optionB.textContent = describeToken("tokenB", info);
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
    "Acao",
    "Preco",
    "Faixa alvo",
    "Mint posicao",
    "Entrada (USD)",
    "Taxas (USD)",
    "Taxa TX (USD)",
    "Saida (USD)",
    "PnL liquido (USD)",
    "PnL total (USD)",
    "PnL total sem taxas (USD)"
  ];
  const rows = items.map((item) => {
    const actionLabel = actionLabels[item.action] ?? item.action ?? "-";
    const typeLabel = actionTypeLabels[item.actionType] ?? item.actionType ?? "-";
    const isLoanClose = item.actionType === "fechamento-emprestimo";
    const loanPnl = isLoanClose ? getLoanClosePnlMetrics(item) : null;
    const pnlRaw = toFiniteNumber(isLoanClose ? loanPnl?.netPnl : item.positionPnlUsd);
    const hasPnl = pnlRaw != null;
    const fees = toFiniteNumber(item.positionFeesUsd) ?? 0;
    const poolPnl = hasPnl ? pnlRaw : 0;
    const pnlTotal = isLoanClose ? (loanPnl?.grossPnl ?? (hasPnl ? poolPnl : null)) : (hasPnl ? poolPnl : null);
    const pnlTotalNet = isLoanClose ? (loanPnl?.grossPnl ?? (hasPnl ? poolPnl : null)) : (hasPnl ? poolPnl - fees : null);
    return [
      formatTimestamp(item.timestamp),
      formatTimestamp(item.positionOpenedAt),
      formatCloseTimestamp(item),
      typeLabel,
      actionLabel,
      formatNumber(normalizeDisplayPrice(item.price, getTokenInfo(cachedConfig)), 8),
      formatRange(item.targetRange, getTokenInfo(cachedConfig)),
      item.positionMint ?? "-",
      formatNumber(item.positionEntryUsd, 2),
      formatNumber(item.positionFeesUsd, 2),
      formatNumber(item.txFeeUsd, 6),
      formatNumber(item.positionExitUsd, 2),
      formatNumber(isLoanClose ? loanPnl?.netPnl : item.positionPnlUsd, 2),
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

async function fetchKaminoLogs() {
  const res = await fetch("/api/kamino-logs");
  return res.json();
}

async function fetchPools() {
  const res = await fetch("/api/pools");
  return res.json();
}

async function fetchKaminoMarkets() {
  const res = await fetch("/api/kamino/markets");
  return res.json();
}

function formatMarketAddress(address) {
  const value = String(address ?? "").trim();
  if (!value) return "-";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function getKaminoMarketPlaceholderLabel(config) {
  const addr = config?.kaminoMarketAddress ?? "";
  if (!addr) return "Padrão (KAMINO_MARKET)";
  return `Padrão (${formatMarketAddress(addr)})`;
}

function renderKaminoMarketOptions() {
  const selects = [poolKaminoMarketInput, editPoolKaminoMarketInput].filter((el) => el instanceof HTMLSelectElement);
  if (!selects.length) return;
  const options = cachedKaminoMarkets.map((entry) => {
    const name = entry?.name ?? "Market";
    const address = entry?.address ?? "";
    const label = address ? `${name} (${formatMarketAddress(address)})` : name;
    return `<option value="${escapeHtml(address)}">${escapeHtml(label)}</option>`;
  }).join("");
  selects.forEach((select) => {
    const current = select.value;
    select.innerHTML = `<option value="">${escapeHtml(getKaminoMarketPlaceholderLabel(cachedConfig))}</option>${options}`;
    if (current && cachedKaminoMarkets.some((entry) => entry.address === current)) {
      select.value = current;
    } else {
      select.value = "";
    }
  });
}

function updateKaminoMarketPlaceholder(config) {
  const label = getKaminoMarketPlaceholderLabel(config);
  setSelectPlaceholder(poolKaminoMarketInput, label);
  setSelectPlaceholder(editPoolKaminoMarketInput, label);
}

async function ensureKaminoMarketsLoaded() {
  if (kaminoMarketsLoaded || kaminoMarketsLoading) {
    return;
  }
  kaminoMarketsLoading = true;
  try {
    const data = await fetchKaminoMarkets().catch(() => null);
    cachedKaminoMarkets = Array.isArray(data?.markets) ? data.markets : [];
    kaminoMarketsLoaded = true;
    renderKaminoMarketOptions();
  } finally {
    kaminoMarketsLoading = false;
  }
}

function parseOptionalNumber(value) {
  if (value == null) return undefined;
  let trimmed = String(value).trim();
  if (!trimmed) return undefined;
  if (trimmed.includes(",")) {
    const hasDot = trimmed.includes(".");
    if (hasDot && /^\d{1,3}(\.\d{3})*,\d+$/.test(trimmed)) {
      trimmed = trimmed.replace(/\./g, "").replace(",", ".");
    } else if (!hasDot) {
      trimmed = trimmed.replace(",", ".");
    }
  }
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

function parseExitDirectionInput(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "down") return "down";
  if (trimmed === "up") return "up";
  return null;
}

function parseRangeAnchorInput(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "lower") return "lower";
  if (trimmed === "middle") return "middle";
  if (trimmed === "upper") return "upper";
  return null;
}

function formatRangeAnchor(value) {
  if (value === "lower") return "Mais perto do limite superior";
  if (value === "middle") return "No meio";
  if (value === "upper") return "Mais perto do limite inferior";
  return "-";
}

function formatRangeAnchorPlaceholder(value) {
  const label = formatRangeAnchor(value);
  return label === "-" ? "Sem âncora" : label;
}

function formatAnchorFromExitSide(exitSide, info) {
  if (exitSide !== "lower" && exitSide !== "upper") {
    return formatRangeAnchor("middle");
  }
  let anchor = exitSide;
  if (isVisualPriceAxisInverted(info)) {
    anchor = anchor === "lower" ? "upper" : "lower";
  }
  return formatRangeAnchor(anchor);
}

function parseBooleanInput(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return undefined;
  if (["1", "true", "yes", "on", "sim"].includes(trimmed)) return true;
  if (["0", "false", "no", "off", "nao"].includes(trimmed)) return false;
  return null;
}

function parseKaminoBorrowAssetInput(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return undefined;
  if (["usdc", "usdt", "auto"].includes(trimmed)) return trimmed;
  return null;
}

function parseKaminoCloseRuleInput(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return undefined;
  if (["avg-price", "breakeven", "manual"].includes(trimmed)) return trimmed;
  return null;
}

function parseKaminoCollateralModeInput(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "exit") return "exit";
  if (trimmed === "max-value") return "max-value";
  if (trimmed === "both" || trimmed === "dual") return "both";
  if (trimmed === "tokena" || trimmed === "token_a") return "tokenA";
  if (trimmed === "tokenb" || trimmed === "token_b") return "tokenB";
  return null;
}

function parseKaminoAvgBasisInput(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "deposit") return "deposit";
  if (trimmed === "debt") return "debt";
  return null;
}

function parseKaminoAvgModeInput(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "cumulative") return "cumulative";
  if (trimmed === "reset") return "reset";
  return null;
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
      return "Ja  SOL";
    case "non-fungible":
      return "Token sem decimais (NFT)";
    case "excluded":
      return "Excluido";
    case "invalid-amount":
      return "Quantidade invalida";
    case "no-quote":
      return "Sem rota";
    case "below-min":
      return "Abaixo do minimo";
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
      return "Falhas durante a conversao";
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
  return `${text.slice(0, max - 1)}...`;
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
  const defaultExitBias = cachedConfig?.rangeExitBiasPct ?? "-";
  const defaultRangeAnchor = cachedConfig?.rangeAnchor ?? null;
  const defaultAutoAddEnabled = cachedConfig?.autoAddLiquidityEnabled ?? false;
  const defaultKaminoEnabled = cachedConfig?.kaminoRebalanceEnabled ?? false;
  const defaultKaminoDepositPct = cachedConfig?.kaminoDepositPct ?? "-";
  const defaultKaminoBorrowAsset = cachedConfig?.kaminoBorrowAsset ?? "usdc";
  const defaultKaminoMaxLtv = cachedConfig?.kaminoMaxLtv ?? "-";
  const defaultKaminoCloseRule = cachedConfig?.kaminoCloseRule ?? "avg-price";
  const defaultKaminoPriceBuffer = cachedConfig?.kaminoPriceBufferPct ?? "-";
  const defaultKaminoCollateralMode = cachedConfig?.kaminoCollateralMode ?? "max-value";
  const defaultKaminoAutoClose = cachedConfig?.kaminoAutoCloseOnTokenChange ?? true;
  const defaultKaminoConvert = cachedConfig?.kaminoConvertToCollateral ?? false;
  const defaultKaminoAvgBasis = cachedConfig?.kaminoAvgPriceBasis ?? "deposit";
  const defaultKaminoAvgMode = cachedConfig?.kaminoAvgMode ?? "cumulative";
  const tokenInfo = getTokenInfo(pool) ?? getTokenInfo(cachedConfig);

  if (editPoolIdInput) editPoolIdInput.value = pool.id ?? "";
  if (editPoolRangeInput) {
    editPoolRangeInput.value = overrides.rangeWidthPct ?? "";
    editPoolRangeInput.placeholder = `Padrão (${defaultRange})`;
  }
  if (editPoolBudgetInput) {
    editPoolBudgetInput.value = overrides.budgetUsd ?? "";
    editPoolBudgetInput.placeholder = `Padrão (${defaultBudget})`;
  }
  if (editPoolAutoAddEnabledInput) {
    editPoolAutoAddEnabledInput.value = overrides.autoAddLiquidityEnabled === undefined ? "" : String(overrides.autoAddLiquidityEnabled);
    setSelectPlaceholder(editPoolAutoAddEnabledInput, `Padrão (${defaultAutoAddEnabled ? "Sim" : "Não"})`);
  }
  if (editPoolKaminoEnabledInput) {
    editPoolKaminoEnabledInput.value = overrides.kaminoRebalanceEnabled === undefined ? "" : String(overrides.kaminoRebalanceEnabled);
    setSelectPlaceholder(editPoolKaminoEnabledInput, `Padrão (${defaultKaminoEnabled ? "Sim" : "Não"})`);
  }
  if (editPoolKaminoDepositPctInput) {
    editPoolKaminoDepositPctInput.value = overrides.kaminoDepositPct ?? "";
    editPoolKaminoDepositPctInput.placeholder = `Padrão (${formatNumber(defaultKaminoDepositPct, 2)})`;
  }
  if (editPoolKaminoBorrowAssetInput) {
    editPoolKaminoBorrowAssetInput.value = overrides.kaminoBorrowAsset ?? "";
    setSelectPlaceholder(editPoolKaminoBorrowAssetInput, `Padrão (${defaultKaminoBorrowAsset.toUpperCase?.() ?? defaultKaminoBorrowAsset})`);
  }
  if (editPoolKaminoMarketInput) {
    editPoolKaminoMarketInput.value = overrides.kaminoMarketAddress ?? "";
    setSelectPlaceholder(editPoolKaminoMarketInput, getKaminoMarketPlaceholderLabel(cachedConfig));
  }
  if (editPoolKaminoMaxLtvInput) {
    editPoolKaminoMaxLtvInput.value = overrides.kaminoMaxLtv ?? "";
    editPoolKaminoMaxLtvInput.placeholder = `Padrão (${formatNumber(defaultKaminoMaxLtv, 2)})`;
  }
  if (editPoolKaminoCloseRuleInput) {
    editPoolKaminoCloseRuleInput.value = overrides.kaminoCloseRule ?? "";
    setSelectPlaceholder(editPoolKaminoCloseRuleInput, `Padrão (${defaultKaminoCloseRule})`);
  }
  if (editPoolKaminoPriceBufferInput) {
    editPoolKaminoPriceBufferInput.value = overrides.kaminoPriceBufferPct ?? "";
    editPoolKaminoPriceBufferInput.placeholder = `Padrão (${formatNumber(defaultKaminoPriceBuffer, 2)})`;
  }
  if (editPoolKaminoCollateralModeInput) {
    updateExitTokenSelectHints(editPoolKaminoCollateralModeInput, tokenInfo);
    editPoolKaminoCollateralModeInput.value = overrides.kaminoCollateralMode ?? "";
    const defaultLabel = formatKaminoCollateralModeLabel(defaultKaminoCollateralMode, tokenInfo);
    setSelectPlaceholder(editPoolKaminoCollateralModeInput, `Padrão (${defaultLabel})`);
  }
  if (editPoolKaminoConvertInput) {
    editPoolKaminoConvertInput.value = overrides.kaminoConvertToCollateral === undefined
      ? ""
      : String(overrides.kaminoConvertToCollateral);
    setSelectPlaceholder(editPoolKaminoConvertInput, `Padrão (${defaultKaminoConvert ? "Sim" : "Não"})`);
  }
  if (editPoolKaminoAvgBasisInput) {
    editPoolKaminoAvgBasisInput.value = overrides.kaminoAvgPriceBasis ?? "";
    const basisLabel = defaultKaminoAvgBasis === "debt" ? "Divida" : "Depósito";
    setSelectPlaceholder(editPoolKaminoAvgBasisInput, `Padrão (${basisLabel})`);
  }
  if (editPoolKaminoAvgModeInput) {
    editPoolKaminoAvgModeInput.value = overrides.kaminoAvgMode ?? "";
    const modeLabel = defaultKaminoAvgMode === "reset" ? "ultimo deposito" : "Cumulativa";
    setSelectPlaceholder(editPoolKaminoAvgModeInput, `Padrão (${modeLabel})`);
  }
  if (editPoolKaminoAutoCloseInput) {
    editPoolKaminoAutoCloseInput.value = overrides.kaminoAutoCloseOnTokenChange === undefined
      ? ""
      : String(overrides.kaminoAutoCloseOnTokenChange);
    setSelectPlaceholder(editPoolKaminoAutoCloseInput, `Padrão (${defaultKaminoAutoClose ? "Sim" : "Não"})`);
  }
  if (editPoolRangeAnchorInput) {
    editPoolRangeAnchorInput.value = overrides.rangeAnchor ?? "";
    const anchorLabel = formatRangeAnchorPlaceholder(defaultRangeAnchor);
    setSelectPlaceholder(editPoolRangeAnchorInput, `Padrão (${anchorLabel})`);
  }
  if (editPoolExitBiasInput) {
    editPoolExitBiasInput.value = overrides.rangeExitBiasPct ?? "";
    editPoolExitBiasInput.placeholder = `Padrão (${formatNumber(defaultExitBias, 2)})`;
  }
  openModal(editPoolModal);
}

function closeEditPoolModal() {
  closeModal(editPoolModal);
}

function getFiniteNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function renderEditableNumberCell(value, field, editId, displayValue = value) {
  const config = HISTORY_EDITABLE_FIELDS[field];
  if (!config) {
    return formatNumber(displayValue, 2);
  }
  const num = getFiniteNumber(displayValue);
  if (num != null) {
    return formatNumber(num, config.digits);
  }
  if (!editId) {
    return "-";
  }
  return `<button type="button" class="history-edit-btn" data-edit-id="${editId}" data-edit-field="${field}" aria-label="Editar ${config.label}" title="Editar ${config.label}">+</button>`;
}

function closeHistoryEdit(options = {}) {
  historyEditState = null;
  const shouldRender = options.rerender !== false;
  if (shouldRender) {
    renderHistory(cachedHistory);
    historyEditPendingRender = false;
    return;
  }
  if (historyEditPendingRender) {
    historyEditPendingRender = false;
    renderHistory(cachedHistory);
  }
}

async function commitHistoryEdit(id, field, inputEl) {
  const parsed = parseOptionalNumber(inputEl.value);
  if (parsed === undefined) {
    inputEl.classList.add("error");
    inputEl.focus();
    return;
  }
  inputEl.classList.remove("error");
  inputEl.disabled = true;
  inputEl.title = "";
  try {
    const res = await fetch("/api/history/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, field, value: parsed })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error ?? "Erro ao atualizar historico.");
    }
    const idx = cachedHistory.findIndex((item) => item?.id === id);
    if (idx >= 0) {
      cachedHistory[idx] = { ...cachedHistory[idx], [field]: parsed };
    }
    closeHistoryEdit({ rerender: true });
  } catch (err) {
    inputEl.disabled = false;
    inputEl.classList.add("error");
    inputEl.title = err instanceof Error ? err.message : String(err);
    inputEl.focus();
  }
}

function startHistoryEdit(button) {
  const editId = button.getAttribute("data-edit-id");
  const field = button.getAttribute("data-edit-field");
  if (!editId || !field) return;

  if (historyEditState && (historyEditState.id !== editId || historyEditState.field !== field)) {
    closeHistoryEdit({ rerender: true });
  }

  const cell = button.closest("td");
  if (!cell) return;

  historyEditState = { id: editId, field };
  cell.innerHTML = "";
  const input = document.createElement("input");
  input.type = "number";
  input.step = "any";
  input.className = "history-edit-input";
  input.setAttribute("data-edit-input", "true");
  cell.appendChild(input);
  input.focus();
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeHistoryEdit({ rerender: true });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void commitHistoryEdit(editId, field, input);
    }
  });
  input.addEventListener("blur", () => {
    if (historyEditState) {
      closeHistoryEdit({ rerender: true });
    }
  });
}

function renderHistory(items) {
  if (historyEditState) {
    historyEditState = null;
    historyEditPendingRender = false;
  }
  const filteredItems = applyHistoryTypeFilter(items);
  const historyTokenInfo = getTokenInfo(cachedConfig);
  if (!filteredItems || filteredItems.length === 0) {
    selectedHistoryIds.clear();
    historyBody.innerHTML = "<tr><td colspan=\"16\">Sem eventos ainda</td></tr>";
    updateHistorySelectionState();
    return;
  }
  const limit = historyRowLimit ?? 30;
  const currentIds = new Set();
  const rows = filteredItems.slice(0, limit).map((item, index) => {
    const actionLabel = actionLabels[item.action] ?? item.action ?? "-";
    const typeLabel = actionTypeLabels[item.actionType] ?? item.actionType ?? "-";
    const rawEventId = typeof item.id === "string" && item.id.trim().length > 0 ? item.id : null;
    const eventId = rawEventId ?? `legacy-${index}`;
    const editId = rawEventId;
    currentIds.add(eventId);
    const checked = selectedHistoryIds.has(eventId) ? "checked" : "";
    const isLoanClose = item.actionType === "fechamento-emprestimo";
    const loanPnl = isLoanClose ? getLoanClosePnlMetrics(item) : null;
    const pnlRaw = toFiniteNumber(isLoanClose ? loanPnl?.netPnl : item.positionPnlUsd);
    const hasPnl = pnlRaw != null;
    const fees = toFiniteNumber(item.positionFeesUsd) ?? 0;
    const poolPnl = hasPnl ? pnlRaw : 0;
    const pnlTotal = isLoanClose ? (loanPnl?.grossPnl ?? (hasPnl ? poolPnl : null)) : (hasPnl ? poolPnl : null);
    const pnlTotalNet = isLoanClose ? (loanPnl?.grossPnl ?? (hasPnl ? poolPnl : null)) : (hasPnl ? poolPnl - fees : null);
    const priceCell = renderEditableNumberCell(
      item.price,
      "price",
      editId,
      normalizeDisplayPrice(item.price, historyTokenInfo)
    );
    const entryCell = renderEditableNumberCell(item.positionEntryUsd, "positionEntryUsd", editId);
    const feesCell = renderEditableNumberCell(item.positionFeesUsd, "positionFeesUsd", editId);
    const txFeeCell = renderEditableNumberCell(item.txFeeUsd, "txFeeUsd", editId);
    const exitCell = renderEditableNumberCell(item.positionExitUsd, "positionExitUsd", editId);
    const loanTooltip = isLoanClose
      ? [
        `Colateral USD: ${formatNumber(item.kaminoCollateralUsd, 2)}`,
        `Dívida USD: ${formatNumber(item.kaminoDebtUsd, 2)}`,
        `Preço médio: ${formatNumber(item.kaminoCollateralAvgPriceUsdc, 2)}`,
        `Preço alvo: ${formatNumber(item.kaminoCollateralTargetPriceUsdc, 2)}`
      ].join(" | ")
      : "";
    const pnlCell = isLoanClose
      ? `<span class="history-loan-pnl" title="${escapeHtml(loanTooltip)}">${formatNumber(loanPnl?.netPnl, 2)}</span>`
      : renderEditableNumberCell(item.positionPnlUsd, "positionPnlUsd", editId);
    return `
      <tr>
        <td><input type="checkbox" class="history-select" data-id="${eventId}" ${checked}></td>
        <td data-col="datetime">${formatTimestamp(item.timestamp)}</td>
        <td data-col="openAt">${formatTimestamp(item.positionOpenedAt)}</td>
        <td data-col="close">${formatCloseTimestamp(item)}</td>
        <td data-col="type">${typeLabel}</td>
        <td data-col="action">${actionLabel}</td>
        <td data-col="price">${priceCell}</td>
        <td data-col="targetRange">${formatRange(item.targetRange, historyTokenInfo)}</td>
        <td data-col="mint">${item.positionMint ?? "-"}</td>
        <td data-col="entryUsd">${entryCell}</td>
        <td data-col="feesUsd">${feesCell}</td>
        <td data-col="txFeeUsd">${txFeeCell}</td>
        <td data-col="exitUsd">${exitCell}</td>
        <td data-col="pnlUsd">${pnlCell}</td>
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

function renderKaminoLogs(items) {
  if (!kaminoLogBody) {
    return;
  }
  const list = Array.isArray(items) ? items.slice(0, MAX_KAMINO_LOG_ROWS) : [];
  cachedKaminoLogs = list;
  if (list.length === 0) {
    kaminoLogBody.innerHTML = "<tr><td colspan=\"6\">Sem eventos ainda</td></tr>";
    return;
  }
  const rows = list.map((entry, idx) => {
    const level = kaminoLogLevelLabels[entry.level] ?? entry.level ?? "-";
    const market = entry.marketAddress ? shortMint(entry.marketAddress) : "-";
    const message = truncateText(entry.message ?? "-", 80);
    const rowClass = "";
    return `
      <tr class="${rowClass}">
        <td>${formatTimestamp(entry.timestamp)}</td>
        <td><span class="log-level ${escapeHtml(entry.level ?? "")}">${escapeHtml(level)}</span></td>
        <td>${escapeHtml(entry.action ?? "-")}</td>
        <td>${escapeHtml(market)}</td>
        <td>${escapeHtml(message)}</td>
        <td><button class="ghost tiny" data-kamino-log="${idx}">Ver</button></td>
      </tr>
    `;
  });
  kaminoLogBody.innerHTML = rows.join("");
}

function openKaminoLogModal(entry) {
  if (!kaminoLogModal || !entry) return;
  if (kaminoLogDetailTime) {
    kaminoLogDetailTime.textContent = formatTimestamp(entry.timestamp);
  }
  if (kaminoLogDetailLevel) {
    const level = kaminoLogLevelLabels[entry.level] ?? entry.level ?? "-";
    kaminoLogDetailLevel.textContent = level;
    applyStatusTone(kaminoLogDetailLevel, level);
  }
  if (kaminoLogDetailAction) {
    kaminoLogDetailAction.textContent = entry.action ?? "-";
  }
  if (kaminoLogDetailMarket) {
    kaminoLogDetailMarket.textContent = entry.marketAddress ?? "-";
  }
  if (kaminoLogDetailMessage) {
    kaminoLogDetailMessage.textContent = entry.message ?? "-";
  }
  kaminoLogModal.classList.remove("hidden");
}

function closeKaminoLogModal() {
  if (kaminoLogModal) {
    kaminoLogModal.classList.add("hidden");
  }
}

function formatElapsed(isoString) {
  if (!isoString) return "-";
  const startedAt = new Date(isoString).getTime();
  if (!Number.isFinite(startedAt)) return "-";
  const diffMs = Date.now() - startedAt;
  if (diffMs < 0) return "-";
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function shortenMint(mint) {
  const value = String(mint ?? "");
  if (value.length <= 14) return value || "-";
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function isPoolPositionOpen(pool) {
  if (pool?.positionMint) return true;
  const valueUsd = toFiniteNumber(pool?.positionValueUsd);
  return valueUsd !== null && valueUsd > 0;
}

function describeRangeStatus(pool) {
  // Compara em espaco bruto (antes de normalizeDisplayPrice) para nao inverter
  // a logica em pools com eixo de preco invertido.
  const range = pool?.positionRange ?? null;
  const price = toFiniteNumber(pool?.lastPrice);
  const lower = toFiniteNumber(range?.lower);
  const upper = toFiniteNumber(range?.upper);
  if (price === null || lower === null || upper === null) {
    return { label: "-", tone: "" };
  }
  const inRange = price >= Math.min(lower, upper) && price <= Math.max(lower, upper);
  return inRange
    ? { label: "Dentro da faixa", tone: "status-ok" }
    : { label: "Fora da faixa", tone: "status-warn" };
}

function renderOpenPositions(poolsList, config) {
  if (!openPositionsGrid) return;
  const pools = Array.isArray(poolsList) ? poolsList.filter(isPoolPositionOpen) : [];
  pools.sort((a, b) => (toFiniteNumber(b.positionValueUsd) ?? 0) - (toFiniteNumber(a.positionValueUsd) ?? 0));

  if (openPositionsCount) {
    openPositionsCount.textContent = pools.length ? `${pools.length} aberta(s)` : "Nenhuma";
  }

  if (!pools.length) {
    openPositionsGrid.innerHTML = "<p class=\"hint\">Nenhuma posição aberta.</p>";
    return;
  }

  openPositionsGrid.innerHTML = pools.map((pool) => {
    const info = getTokenInfo(pool) ?? (pool.selected ? getTokenInfo(config) : null);
    const entryUsd = toFiniteNumber(pool.positionEntryUsd);
    const feesUsd = toFiniteNumber(pool.positionFeesUsd);
    const valueUsd = toFiniteNumber(pool.positionValueUsd);
    const pnlUsd = toFiniteNumber(pool.positionPnlUsd);
    const pnlPct = pnlUsd !== null && entryUsd !== null && entryUsd > 0
      ? (pnlUsd / entryUsd) * 100
      : null;
    const pnlTone = pnlUsd === null ? "" : (pnlUsd >= 0 ? "status-ok" : "status-bad");
    const runningLabel = pool.running ? "Rodando" : "Parado";
    const runningTone = pool.running ? "status-ok" : "status-bad";
    const rangeStatus = describeRangeStatus(pool);
    const priceLabel = formatNumber(normalizeDisplayPrice(pool.lastPrice, info), 8);
    const mint = pool.positionMint ?? null;

    return `
      <div class="card compact">
        <h3>
          <span>${escapeHtml(pool.name ?? "Pool")}</span>
          <span class="${runningTone}">${runningLabel}</span>
        </h3>
        <div class="kv-grid">
          <div class="kv"><span>Entrada (USD)</span><span>${formatNumber(entryUsd, 2)}</span></div>
          <div class="kv"><span>Taxas geradas (USD)</span><span>${formatNumber(feesUsd, 4)}</span></div>
          <div class="kv"><span>Valor atual (USD)</span><span>${formatNumber(valueUsd, 2)}</span></div>
          <div class="kv"><span>PnL (USD)</span><span class="${pnlTone}">${formatNumber(pnlUsd, 2)}</span></div>
          <div class="kv"><span>PnL (%)</span><span class="${pnlTone}">${pnlPct === null ? "-" : `${formatNumber(pnlPct, 2)}%`}</span></div>
          <div class="kv"><span>Preço atual</span><span>${priceLabel}</span></div>
          <div class="kv"><span>Faixa da posição</span><span>${escapeHtml(formatRange(pool.positionRange, info))}</span></div>
          <div class="kv"><span>Status da faixa</span><span class="${rangeStatus.tone}">${rangeStatus.label}</span></div>
          <div class="kv"><span>Aberta há</span><span>${formatElapsed(pool.positionOpenedAt)}</span></div>
          <div class="kv"><span>Mint posição</span><span title="${escapeHtml(mint ?? "")}">${escapeHtml(shortenMint(mint))}</span></div>
        </div>
      </div>`;
  }).join("");
}

function renderPools(data, config) {
  closeActiveActionMenu();
  const hasError = Boolean(data && !Array.isArray(data) && data.error);
  const errorMsg = hasError ? String(data.error ?? "") : "";
  let pools = Array.isArray(data) ? data : (data?.pools ?? []);
  const cachedFallback = normalizePoolsResponse(cachedPoolsResponse)?.pools
    ?? (Array.isArray(cachedPools) ? cachedPools : []);
  let fromCache = false;
  const canUseConfigFallback = Boolean(config && (config.poolName || config.whirlpoolAddress));

  if (hasError && poolError) {
    poolError.textContent = errorMsg || "Falha ao carregar pools.";
    poolError.classList.remove("hidden");
  } else if (poolError) {
    poolError.textContent = "";
    poolError.classList.add("hidden");
  }

  // Se a API devolver lista vazia, preserva o cache anterior.
  if (pools.length === 0 && cachedFallback.length > 0) {
    pools = cachedFallback;
    fromCache = true;
    if (!didAutoRestoreFromCache) {
      didAutoRestoreFromCache = true;
      restorePoolsFromCache();
    }
  }

  // Fallback final: usar a pool selecionada do /api/config para nao zerar a tabela.
  if (!pools.length && canUseConfigFallback) {
    pools = [
      {
        id: config.selectedPoolId ?? "selected",
        name: config.poolName ?? "Pool selecionada",
        whirlpoolAddress: config.whirlpoolAddress ?? "-",
        createdAt: new Date().toISOString(),
        selected: true,
        running: cachedStatus?.running ?? false,
        lastAction: cachedStatus?.lastAction ?? null,
        lastError: cachedStatus?.lastError ?? null,
        positionPnlUsd: cachedStatus?.positionPnlUsd ?? null,
        overrides: null
      }
    ];
    fromCache = true;
    if (!didAutoRestoreFromConfig) {
      didAutoRestoreFromConfig = true;
      restorePoolFromConfig(config);
    }
  }

  if (pools.length > 0) {
    cachedPools = pools;
    savePoolsCache(pools, config?.selectedPoolId ?? cachedPoolsResponse?.selectedPoolId ?? null);
  }
  cachedConfig = config;
  if (!pools.length) {
    poolsBody.innerHTML = "<tr><td colspan=\"12\">Sem pools cadastradas</td></tr>";
    return;
  }
  if (fromCache && poolError) {
    poolError.innerHTML = "Pools carregadas do cache local. Servidor sem dados. "
      + "<button id=\"restorePoolsBtn\" class=\"ghost\">Restaurar no servidor</button>";
    poolError.classList.remove("hidden");
    const btn = document.getElementById("restorePoolsBtn");
    if (btn) {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        restorePoolsFromCache();
      });
    }
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
    const rangeAnchorDisplay = pool.overrides?.rangeAnchor ?? null;
    const exitBiasDisplay = pool.overrides?.rangeExitBiasPct ?? null;
    const defaultRange = config?.rangeWidthPct ?? "-";
    const defaultBudget = config?.budgetUsd ?? "-";
    const defaultRangeAnchor = config?.rangeAnchor ?? null;
    const defaultExitBias = config?.rangeExitBiasPct ?? "-";
    const rangeLabel = rangeDisplay == null ? `Padrão (${defaultRange})` : Number(rangeDisplay).toFixed(2);
    const budgetLabel = budgetDisplay == null ? `Padrão (${defaultBudget})` : Number(budgetDisplay).toFixed(2);
    const anchorDefaultLabel = formatRangeAnchorPlaceholder(defaultRangeAnchor);
    const rangeAnchorLabel = rangeAnchorDisplay == null
      ? `Padrão (${anchorDefaultLabel})`
      : formatRangeAnchor(rangeAnchorDisplay);
    const exitBiasLabel = exitBiasDisplay == null
      ? `Padrão (${formatNumber(defaultExitBias, 2)})`
      : formatNumber(exitBiasDisplay, 2);
    const createdAt = formatTimestamp(pool.createdAt);
    return `
      <tr>
        <td>${pool.name}</td>
        <td>${createdAt}</td>
        <td>${pool.whirlpoolAddress}</td>
        <td>${rangeLabel}</td>
        <td>${rangeAnchorLabel}</td>
        <td>${exitBiasLabel}</td>
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
              <button class="danger" data-action="close" data-id="${pool.id}">Rebalancear</button>
              <button class="ghost danger" data-action="close-stop" data-id="${pool.id}">Fechar e parar</button>
              <button class="ghost danger" data-action="remove" data-id="${pool.id}">Remover</button>
            </div>
          </details>
        </td>
      </tr>
    `;
  });
  poolsBody.innerHTML = rows.join("");
}

function setUiError(message) {
  const el = document.getElementById("uiError");
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.classList.remove("hidden");
  } else {
    el.textContent = "";
    el.classList.add("hidden");
  }
}

function renderUiSnapshot(status, config, history, pools, kaminoLogs) {
  cachedHistory = Array.isArray(history) ? history : [];
  if (status) cachedStatus = status;
  if (config) cachedConfig = config;
  const normalizedPools = normalizePoolsResponse(pools);
  if (normalizedPools && Array.isArray(normalizedPools.pools) && normalizedPools.pools.length > 0) {
    cachedPoolsResponse = normalizedPools;
    cachedPools = normalizedPools.pools;
  }
  if (Array.isArray(kaminoLogs)) {
    cachedKaminoLogs = kaminoLogs;
  }

  runningEl.textContent = status.running ? "Sim" : "Não";
  lastTickEl.textContent = formatTimestamp(status.lastTickAt);
  lastActionEl.textContent = status.lastAction ?? "-";
  lastErrorEl.textContent = status.lastError ?? "-";
  applyStatusTone(runningEl, runningEl.textContent);
  applyStatusTone(lastErrorEl, lastErrorEl.textContent);
  const tokenInfo = getTokenInfo(config);
  updateExitTokenSelectHints(poolKaminoCollateralModeInput, tokenInfo);
  updateExitTokenSelectHints(editPoolKaminoCollateralModeInput, tokenInfo);
  const poolsList = normalizedPools?.pools ?? [];
  renderOpenPositions(poolsList, config);
  const selectedPool = poolsList.find((item) => item.id === config.selectedPoolId) ?? null;
  const selectedOverrides = selectedPool?.overrides ?? {};

  const priceText = formatNumber(normalizeDisplayPrice(status.lastPrice, tokenInfo), 8);
  priceEl.textContent = priceText;
  if (priceTopEl) {
    priceTopEl.textContent = priceText;
  }
  targetRangeEl.textContent = formatRange(status.targetRange, tokenInfo);
  positionRangeEl.textContent = formatRange(status.positionRange, tokenInfo);
  positionMintEl.textContent = status.positionMint ?? "-";
  const solBalanceText = formatNumber(status.solBalance, 4);
  solBalanceEl.textContent = solBalanceText;

  solUsdEl.textContent = formatNumber(status.solUsdPrice, 4);
  budgetUsdEl.textContent = formatNumber(status.budgetUsd, 2);
  budgetSolEl.textContent = formatNumber(status.budgetSol, 4);
  portfolioUsdEl.textContent = formatNumber(status.portfolioUsd, 2);
  pnlUsdEl.textContent = formatNumber(status.pnlUsd, 2);

  networkEl.textContent = config.network ?? "-";
  whirlpoolEl.textContent = config.whirlpoolAddress ?? "-";
  poolNameLabel.textContent = config.poolName ?? "-";
  if (poolNameLabelTop) {
    poolNameLabelTop.textContent = config.poolName ?? "-";
  }
  if (kaminoPoolNameEl) {
    kaminoPoolNameEl.textContent = config.poolName ?? "-";
  }
  if (kaminoOwnerPoolEl) {
    const ownerName = status.kaminoOwnerPoolName ?? null;
    if (ownerName && config.poolName && ownerName !== config.poolName) {
      kaminoOwnerPoolEl.textContent = `${ownerName} (outro)`;
    } else {
      kaminoOwnerPoolEl.textContent = ownerName ?? "-";
    }
  }
  rangePctEl.textContent = config.rangeWidthPct ?? "-";
  slippageEl.textContent = config.slippageBps ?? "-";
  pollEl.textContent = config.pollIntervalMs ?? "-";
  confirmSecEl.textContent = config.outOfRangeConfirmSec ?? 0;
  cooldownSecEl.textContent = config.rebalanceCooldownSec ?? 0;
  dryRunEl.textContent = config.dryRun ? "Sim" : "Não";

  if (kaminoStatusEl) {
    kaminoStatusEl.textContent = status.kaminoActive ? "Ativo" : "Inativo";
    applyStatusTone(kaminoStatusEl, kaminoStatusEl.textContent);
  }
  if (kaminoEnabledEl) {
    const enabled = status.kaminoEnabled ?? config.kaminoRebalanceEnabled;
    kaminoEnabledEl.textContent = enabled ? "Sim" : "Não";
    applyStatusTone(kaminoEnabledEl, kaminoEnabledEl.textContent);
  }
  if (kaminoSimulatedEl) {
    kaminoSimulatedEl.textContent = status.kaminoSimulated ? "Sim" : "Não";
  }
  if (kaminoLtvEl) {
    kaminoLtvEl.textContent = status.kaminoLtv != null
      ? `${formatNumber(status.kaminoLtv * 100, 2)}%`
      : "-";
  }
  if (kaminoCollateralUsdEl) {
    kaminoCollateralUsdEl.textContent = formatNumber(status.kaminoCollateralUsd, 2);
  }
  if (kaminoDebtUsdEl) {
    kaminoDebtUsdEl.textContent = formatNumber(status.kaminoDebtUsd, 2);
  }
  if (kaminoAvgPriceEl) {
    kaminoAvgPriceEl.textContent = formatNumber(status.kaminoAvgPriceUsdc, 6);
  }
  if (kaminoTargetPriceEl) {
    kaminoTargetPriceEl.textContent = formatNumber(status.kaminoTargetPriceUsdc, 6);
  }
  if (kaminoAvgModeHintEl) {
    const mode = selectedOverrides.kaminoAvgMode ?? config.kaminoAvgMode ?? "cumulative";
    kaminoAvgModeHintEl.textContent = mode === "reset"
      ? "Preco medio (ultimo deposito)"
      : "Preco medio (cumulativo desde o inicio do ciclo)";
  }
  if (kaminoCycleCountEl) {
    kaminoCycleCountEl.textContent = status.kaminoCycleCount ?? "-";
  }
  if (kaminoLastErrorEl) {
    kaminoLastErrorEl.textContent = status.kaminoLastError ? String(status.kaminoLastError) : "-";
  }
  renderKaminoCollaterals(status.kaminoCollaterals, status.kaminoActive);
  if (addLiquidityBtn) {
    addLiquidityBtn.disabled = !status.positionMint;
  }
  if (kaminoCloseBtn) {
    kaminoCloseBtn.disabled = !status.kaminoActive;
  }
  if (kaminoCloseTopBtn) {
    kaminoCloseTopBtn.disabled = !status.kaminoActive;
  }
  const kaminoTestInfo = getCurrentTokenInfo() ?? tokenInfo;
  updateKaminoTestTokenHints(kaminoTestInfo);
  syncKaminoTestMint(kaminoTestInfo);

  statusBadge.textContent = status.running ? "Rodando" : "Parado";
  statusBadge.classList.toggle("running", status.running);
  statusBadge.classList.toggle("stopped", !status.running);

  if (solUsdSourceEl) {
    solUsdSourceEl.textContent = status.solUsdSource ?? "-";
  }
  if (effectiveExitSideEl) {
    effectiveExitSideEl.textContent = formatAnchorFromExitSide(status.effectiveExitSide, tokenInfo);
  }
  if (poolRangeAnchorInput) {
    const anchorLabel = formatRangeAnchorPlaceholder(config.rangeAnchor ?? null);
    setSelectPlaceholder(poolRangeAnchorInput, `Padrão (${anchorLabel})`);
  }
  if (poolAutoAddEnabledInput) {
    setSelectPlaceholder(poolAutoAddEnabledInput, `Padrão (${config.autoAddLiquidityEnabled ? "Sim" : "Não"})`);
  }
  if (poolKaminoEnabledInput) {
    setSelectPlaceholder(poolKaminoEnabledInput, `Padrão (${config.kaminoRebalanceEnabled ? "Sim" : "Não"})`);
  }
  if (poolKaminoBorrowAssetInput) {
    const label = (config.kaminoBorrowAsset ?? "usdc").toUpperCase?.() ?? config.kaminoBorrowAsset;
    setSelectPlaceholder(poolKaminoBorrowAssetInput, `Padrão (${label})`);
  }
  updateKaminoMarketPlaceholder(config);
  if (!kaminoMarketsLoaded) {
    void ensureKaminoMarketsLoaded();
  }
  if (poolKaminoCloseRuleInput) {
    setSelectPlaceholder(poolKaminoCloseRuleInput, `Padrão (${config.kaminoCloseRule ?? "avg-price"})`);
  }
  if (poolKaminoCollateralModeInput) {
    const defaultMode = config.kaminoCollateralMode ?? "max-value";
    const defaultLabel = formatKaminoCollateralModeLabel(defaultMode, tokenInfo);
    setSelectPlaceholder(poolKaminoCollateralModeInput, `Padrão (${defaultLabel})`);
  }
  if (poolKaminoConvertInput) {
    setSelectPlaceholder(
      poolKaminoConvertInput,
      `Padrão (${config.kaminoConvertToCollateral ? "Sim" : "Não"})`
    );
  }
  if (poolKaminoAvgBasisInput) {
    const basisLabel = (config.kaminoAvgPriceBasis ?? "deposit") === "debt" ? "Divida" : "Depósito";
    setSelectPlaceholder(poolKaminoAvgBasisInput, `Padrão (${basisLabel})`);
  }
  if (poolKaminoAvgModeInput) {
    const modeLabel = (config.kaminoAvgMode ?? "cumulative") === "reset" ? "ultimo deposito" : "Cumulativa";
    setSelectPlaceholder(poolKaminoAvgModeInput, `Padrão (${modeLabel})`);
  }
  if (poolKaminoAutoCloseInput) {
    setSelectPlaceholder(
      poolKaminoAutoCloseInput,
      `Padrão (${config.kaminoAutoCloseOnTokenChange ? "Sim" : "Não"})`
    );
  }
  if (poolKaminoDepositPctInput) {
    poolKaminoDepositPctInput.placeholder = `Padrão (${formatNumber(config.kaminoDepositPct, 2)})`;
  }
  if (poolKaminoMaxLtvInput) {
    poolKaminoMaxLtvInput.placeholder = `Padrão (${formatNumber(config.kaminoMaxLtv, 2)})`;
  }
  if (poolKaminoPriceBufferInput) {
    poolKaminoPriceBufferInput.placeholder = `Padrão (${formatNumber(config.kaminoPriceBufferPct, 2)})`;
  }
  if (historyEditState) {
    historyEditPendingRender = true;
  } else {
    renderHistory(cachedHistory);
  }
  try {
    renderKaminoLogs(kaminoLogs);
  } catch (err) {
    console.error("Falha ao renderizar logs Kamino", err);
  }
  renderPools(normalizedPools ?? poolsList, config);
}

async function updateUI() {
  const results = await Promise.allSettled([
    fetchStatus(),
    fetchConfig(),
    fetchHistory(),
    fetchPools(),
    fetchKaminoLogs()
  ]);
  const [statusResult, configResult, historyResult, poolsResult, kaminoLogsResult] = results;
  const hasError = results.some((item) => item.status === "rejected");
  if (hasError) {
    uiErrorCount += 1;
    const message = `Falha temporaria ao atualizar (${uiErrorCount}/${UI_ERROR_LIMIT}).`;
    setUiError(message);
  } else {
    uiErrorCount = 0;
    setUiError("");
  }

  const status = statusResult.status === "fulfilled" ? statusResult.value : cachedStatus;
  const config = configResult.status === "fulfilled" ? configResult.value : cachedConfig;
  const history = historyResult.status === "fulfilled" ? historyResult.value : cachedHistory;
  const poolsRaw = poolsResult.status === "fulfilled"
    ? poolsResult.value
    : (cachedPoolsResponse ?? (Array.isArray(cachedPools) ? { pools: cachedPools } : null));
  const pools = normalizePoolsResponse(poolsRaw)
    ?? (Array.isArray(cachedPools) ? { pools: cachedPools } : null);
  const kaminoLogs = kaminoLogsResult.status === "fulfilled" ? kaminoLogsResult.value : cachedKaminoLogs;

  if (pools && Array.isArray(pools.pools) && pools.pools.length > 0) {
    cachedPoolsResponse = pools;
    cachedPools = pools.pools;
  }

  const poolsForRender = pools
    ?? (config && (config.poolName || config.whirlpoolAddress) ? { pools: [] } : null);

  if (status && config && poolsForRender) {
    renderUiSnapshot(status, config, history, poolsForRender, kaminoLogs);
  } else if (poolsForRender) {
    renderPools(poolsForRender, config ?? cachedConfig ?? {});
  } else if (config) {
    renderPools([], config);
  }

  if (uiErrorCount >= UI_ERROR_LIMIT) {
    statusBadge.textContent = "Erro";
    statusBadge.classList.remove("running");
    statusBadge.classList.add("stopped");
  }
}

startBtn.addEventListener("click", async () => {
  const res = await fetch("/api/start", { method: "POST" });
  const data = await res.json().catch(() => null);
  if (data?.status) {
    applyStatusSnapshot(data.status);
  }
  updateUI();
});

stopBtn.addEventListener("click", async () => {
  const res = await fetch("/api/stop", { method: "POST" });
  const data = await res.json().catch(() => null);
  if (data?.status) {
    applyStatusSnapshot(data.status);
  }
  updateUI();
});

closeBtn.addEventListener("click", async () => {
  const ok = window.confirm("Rebalancear a posicao agora? O bot vai fechar a pool atual e seguir o fluxo normal de reabertura/Kamino, sem parar o processo.");
  if (!ok) return;
  const res = await fetch("/api/rebalance-position", { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    window.alert(data?.error ?? data?.reason ?? "Falha ao rebalancear a pool.");
  } else if (data?.status) {
    applyStatusSnapshot(data.status);
  }
  updateUI();
});

if (closeStopBtn) {
  closeStopBtn.addEventListener("click", async () => {
    const ok = window.confirm("Fechar e parar a pool selecionada? Isso fecha apenas a posicao da pool, sem mexer no hedge e sem fechar o emprestimo Kamino.");
    if (!ok) return;
    const res = await fetch("/api/close-and-stop", { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      window.alert(data?.error ?? data?.reason ?? "Falha ao fechar e parar a pool.");
    } else if (data?.status) {
      applyStatusSnapshot(data.status);
    }
    updateUI();
  });
}

if (addLiquidityBtn) {
  addLiquidityBtn.addEventListener("click", async () => {
    const res = await fetch("/api/add-liquidity", { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const msg = data?.error ?? data?.reason ?? "Falha ao adicionar liquidez.";
      window.alert(msg);
    }
    updateUI();
  });
}

if (kaminoCloseBtn) {
  kaminoCloseBtn.addEventListener("click", async () => {
    const ok = window.confirm("Fechar ciclo Kamino e liquidar o emprestimo?");
    if (!ok) return;
    const res = await fetch("/api/kamino/close", { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const msg = data?.error ?? data?.reason ?? "Falha ao fechar ciclo Kamino.";
      window.alert(msg);
    }
    updateUI();
  });
}

if (kaminoCloseTopBtn) {
  kaminoCloseTopBtn.addEventListener("click", async () => {
    const ok = window.confirm("Fechar ciclo Kamino e liquidar o emprestimo?");
    if (!ok) return;
    const res = await fetch("/api/kamino/close", { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const msg = data?.error ?? data?.reason ?? "Falha ao fechar ciclo Kamino.";
      window.alert(msg);
    }
    updateUI();
  });
}

if (kaminoTestTokenSelect) {
  kaminoTestTokenSelect.addEventListener("change", () => {
    syncKaminoTestMint(getCurrentTokenInfo());
  });
}

if (kaminoTestBtn) {
  kaminoTestBtn.addEventListener("click", async () => {
    const info = getCurrentTokenInfo();
    const resolved = resolveKaminoTestCollateral(info);
    const mint = resolved.mint;
    const side = resolved.side ?? "auto";
    const amountRaw = kaminoTestAmountInput?.value ?? "";
    const amount = Number(amountRaw);

    if (!mint && !resolved.side) {
      setKaminoTestResult(resolved.error ?? "Selecione um colateral valido.", true);
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setKaminoTestResult("Informe a meta total do colateral.", true);
      return;
    }

    setKaminoTestResult("Reconstruindo colateral no Kamino...", false);
    if (kaminoTestBtn) kaminoTestBtn.disabled = true;
    try {
      const res = await fetch("/api/kamino/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collateralMint: mint ?? "",
          collateralSide: side,
          targetCollateralAmount: amount
        })
      });
      const data = await res.json().catch(() => null);
      const isError = !res.ok || !data?.ok;
      const parts = [];
      const msg = normalizeKaminoTestMessage(data?.error ?? data?.reason ?? "");
      if (msg) parts.push(msg);
      if (data?.summary) parts.push(String(data.summary));
      if (data?.depositSig) parts.push(`Ultimo deposito: ${data.depositSig}`);
      if (data?.borrowSig) parts.push(`Ultimo emprestimo: ${data.borrowSig}`);
      if (!parts.length) {
        parts.push(isError ? "Falha ao executar teste Kamino." : "Reconstrucao enviada.");
      }
      setKaminoTestResult(parts.join(" | "), isError);
    } catch (err) {
      setKaminoTestResult(err instanceof Error ? err.message : String(err), true);
    } finally {
      if (kaminoTestBtn) kaminoTestBtn.disabled = false;
      updateUI();
    }
  });
}

if (kaminoResetBtn) {
  kaminoResetBtn.addEventListener("click", async () => {
    const ok = window.confirm("Resetar o ciclo Kamino local? Isso nao fecha o emprestimo on-chain.");
    if (!ok) return;
    const res = await fetch("/api/kamino/reset", { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const msg = data?.error ?? data?.reason ?? "Falha ao resetar ciclo Kamino.";
      alert(msg);
      return;
    }
    updateUI();
  });
}

topupBtn.addEventListener("click", async () => {
  const res = await fetch("/api/sol-topup", { method: "POST" });
  const data = await res.json();
  if (!data.ok) {
    const msg = data.error ?? data.reason ?? "Top-up falhou";
    window.alert(msg);
  }
  updateUI();
});

if (testPriceBtn && priceSourcesResult) {
  testPriceBtn.addEventListener("click", async () => {
    testPriceBtn.disabled = true;
    priceSourcesResult.classList.remove("hidden", "is-error");
    priceSourcesResult.textContent = "Testando fontes de preço...";
    try {
      const res = await fetch("/api/price/sol-usd?debug=1");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const lines = (data.sources ?? []).map((item) => {
        const status = item.ok
          ? `OK  ${formatNumber(item.price, 4)} USD`
          : `FALHOU  ${item.error ?? "erro desconhecido"}`;
        return `${item.source.padEnd(14)} ${status}  (${item.latencyMs}ms)`;
      });
      lines.unshift(
        `Fontes configuradas: ${(data.configuredSources ?? []).join(", ") || "(nenhuma)"}`,
        `Fonte em uso: ${data.activeSource ?? "(nenhuma respondeu)"}`,
        ""
      );
      priceSourcesResult.textContent = lines.join("\n");
      priceSourcesResult.classList.toggle("is-error", !data.ok);
    } catch (err) {
      priceSourcesResult.textContent = err instanceof Error ? err.message : String(err);
      priceSourcesResult.classList.add("is-error");
    } finally {
      testPriceBtn.disabled = false;
    }
  });
}

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

addPoolBtn.addEventListener("click", async () => {
  const name = poolNameInput.value.trim();
  const address = poolAddressInput.value.trim();
  const rangeWidthPct = parseOptionalNumber(poolRangeInput.value);
  const rangeExitBiasPct = parseOptionalNumber(poolExitBiasInput?.value);
  const rangeAnchorRaw = poolRangeAnchorInput?.value?.trim();
  const budgetUsd = parseOptionalNumber(poolBudgetInput.value);
  const autoAddRaw = poolAutoAddEnabledInput?.value ?? "";
  const kaminoEnabledRaw = poolKaminoEnabledInput?.value ?? "";
  const kaminoDepositPct = parseOptionalNumber(poolKaminoDepositPctInput?.value);
  const kaminoBorrowAssetRaw = poolKaminoBorrowAssetInput?.value ?? "";
  const kaminoMarketRaw = poolKaminoMarketInput?.value?.trim() ?? "";
  const kaminoMaxLtv = parseOptionalNumber(poolKaminoMaxLtvInput?.value);
  const kaminoCloseRuleRaw = poolKaminoCloseRuleInput?.value ?? "";
  const kaminoPriceBuffer = parseOptionalNumber(poolKaminoPriceBufferInput?.value);
  const kaminoCollateralModeRaw = poolKaminoCollateralModeInput?.value ?? "";
  const kaminoConvertRaw = poolKaminoConvertInput?.value ?? "";
  const kaminoAvgBasisRaw = poolKaminoAvgBasisInput?.value ?? "";
  const kaminoAvgModeRaw = poolKaminoAvgModeInput?.value ?? "";
  const kaminoAutoCloseRaw = poolKaminoAutoCloseInput?.value ?? "";
  poolError.classList.add("hidden");
  try {
    const overrides = {};
    if (rangeWidthPct !== undefined) {
      overrides.rangeWidthPct = rangeWidthPct;
    }
    if (rangeExitBiasPct !== undefined) {
      overrides.rangeExitBiasPct = rangeExitBiasPct;
    }
    if (rangeAnchorRaw) {
      const parsed = parseRangeAnchorInput(rangeAnchorRaw);
      if (!parsed) {
        throw new Error("Âncora do range inválida. Use inferior, meio ou superior.");
      }
      overrides.rangeAnchor = parsed;
    }
    if (budgetUsd !== undefined) {
      overrides.budgetUsd = budgetUsd;
    }
    if (autoAddRaw) {
      const parsed = parseBooleanInput(autoAddRaw);
      if (parsed === null) {
        throw new Error("Auto adicionar liquidez invalido. Use Sim ou Nao.");
      }
      overrides.autoAddLiquidityEnabled = parsed;
    }
    if (kaminoEnabledRaw) {
      const parsed = parseBooleanInput(kaminoEnabledRaw);
      if (parsed === null) {
        throw new Error("Kamino rebalance invalido. Use Sim ou Nao.");
      }
      overrides.kaminoRebalanceEnabled = parsed;
    }
    if (kaminoDepositPct !== undefined) {
      overrides.kaminoDepositPct = kaminoDepositPct;
    }
    if (kaminoBorrowAssetRaw) {
      const parsed = parseKaminoBorrowAssetInput(kaminoBorrowAssetRaw);
      if (!parsed) {
        throw new Error("Kamino emprestimo invalido.");
      }
      overrides.kaminoBorrowAsset = parsed;
    }
    if (kaminoMarketRaw) {
      overrides.kaminoMarketAddress = kaminoMarketRaw;
    }
    if (kaminoMaxLtv !== undefined) {
      overrides.kaminoMaxLtv = kaminoMaxLtv;
    }
    if (kaminoCloseRuleRaw) {
      const parsed = parseKaminoCloseRuleInput(kaminoCloseRuleRaw);
      if (!parsed) {
        throw new Error("Kamino regra de fechamento invalida.");
      }
      overrides.kaminoCloseRule = parsed;
    }
    if (kaminoPriceBuffer !== undefined) {
      overrides.kaminoPriceBufferPct = kaminoPriceBuffer;
    }
    if (kaminoCollateralModeRaw) {
      const parsed = parseKaminoCollateralModeInput(kaminoCollateralModeRaw);
      if (!parsed) {
        throw new Error("Kamino colateral invalido.");
      }
      overrides.kaminoCollateralMode = parsed;
    }
    if (kaminoConvertRaw) {
      const parsed = parseBooleanInput(kaminoConvertRaw);
      if (parsed === null) {
        throw new Error("Converter para colateral fixo invalido. Use Sim ou Nao.");
      }
      overrides.kaminoConvertToCollateral = parsed;
    }
    if (kaminoAvgBasisRaw) {
      const parsed = parseKaminoAvgBasisInput(kaminoAvgBasisRaw);
      if (!parsed) {
        throw new Error("Kamino base do preco medio invalida.");
      }
      overrides.kaminoAvgPriceBasis = parsed;
    }
    if (kaminoAvgModeRaw) {
      const parsed = parseKaminoAvgModeInput(kaminoAvgModeRaw);
      if (!parsed) {
        throw new Error("Kamino modo da mdia invalido.");
      }
      overrides.kaminoAvgMode = parsed;
    }
    if (kaminoAutoCloseRaw) {
      const parsed = parseBooleanInput(kaminoAutoCloseRaw);
      if (parsed === null) {
        throw new Error("Auto-fechar Kamino invalido. Use Sim ou Nao.");
      }
      overrides.kaminoAutoCloseOnTokenChange = parsed;
    }
    const res = await fetch("/api/pools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, whirlpoolAddress: address, overrides })
    });
    let data = null;
    let rawText = "";
    try {
      data = await res.json();
    } catch {
      try {
        rawText = await res.text();
      } catch {
        rawText = "";
      }
    }
    if (!res.ok || !data?.ok) {
      const serverMsg = [
        data?.error,
        data?.reason,
        data?.message,
        rawText
      ]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .find((value) => value.length > 0);
      throw new Error(serverMsg ?? `Erro ao adicionar pool (HTTP ${res.status})`);
    }
    poolNameInput.value = "";
    poolAddressInput.value = "";
    poolRangeInput.value = "";
    if (poolRangeAnchorInput) poolRangeAnchorInput.value = "";
    if (poolExitBiasInput) poolExitBiasInput.value = "";
    poolBudgetInput.value = "";
    if (poolAutoAddEnabledInput) poolAutoAddEnabledInput.value = "";
    if (poolKaminoEnabledInput) poolKaminoEnabledInput.value = "";
    if (poolKaminoDepositPctInput) poolKaminoDepositPctInput.value = "";
    if (poolKaminoBorrowAssetInput) poolKaminoBorrowAssetInput.value = "";
    if (poolKaminoMarketInput) poolKaminoMarketInput.value = "";
    if (poolKaminoMaxLtvInput) poolKaminoMaxLtvInput.value = "";
    if (poolKaminoCloseRuleInput) poolKaminoCloseRuleInput.value = "";
    if (poolKaminoPriceBufferInput) poolKaminoPriceBufferInput.value = "";
    if (poolKaminoCollateralModeInput) poolKaminoCollateralModeInput.value = "";
    if (poolKaminoConvertInput) poolKaminoConvertInput.value = "";
    if (poolKaminoAvgBasisInput) poolKaminoAvgBasisInput.value = "";
    if (poolKaminoAvgModeInput) poolKaminoAvgModeInput.value = "";
    if (poolKaminoAutoCloseInput) poolKaminoAutoCloseInput.value = "";
    updateUI();
  } catch (err) {
    const fallback = "Erro ao adicionar pool. Verifique os campos e tente novamente.";
    const message = err instanceof Error
      ? (err.message?.trim() || fallback)
      : (String(err).trim() || fallback);
    poolError.textContent = message;
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
          editPoolError.textContent = "Range % invalido.";
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
          editPoolError.textContent = "Budget USD invalido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.budgetUsd = parsed;
    }

    const autoAddRaw = editPoolAutoAddEnabledInput?.value ?? "";
    if (!autoAddRaw) {
      overrides.autoAddLiquidityEnabled = null;
    } else {
      const parsed = parseBooleanInput(autoAddRaw);
      if (parsed === null) {
        if (editPoolError) {
          editPoolError.textContent = "Auto adicionar liquidez invalido. Use Sim ou Nao.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.autoAddLiquidityEnabled = parsed;
    }

    const kaminoEnabledRaw = editPoolKaminoEnabledInput?.value ?? "";
    if (!kaminoEnabledRaw) {
      overrides.kaminoRebalanceEnabled = null;
    } else {
      const parsed = parseBooleanInput(kaminoEnabledRaw);
      if (parsed === null) {
        if (editPoolError) {
          editPoolError.textContent = "Kamino rebalance invalido. Use Sim ou Nao.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.kaminoRebalanceEnabled = parsed;
    }

    const kaminoDepositRaw = editPoolKaminoDepositPctInput?.value?.trim() ?? "";
    if (!kaminoDepositRaw) {
      overrides.kaminoDepositPct = null;
    } else {
      const parsed = parseOptionalNumber(kaminoDepositRaw);
      if (parsed === undefined) {
        if (editPoolError) {
          editPoolError.textContent = "Kamino depsito % invalido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.kaminoDepositPct = parsed;
    }

    const kaminoBorrowRaw = editPoolKaminoBorrowAssetInput?.value ?? "";
    if (!kaminoBorrowRaw) {
      overrides.kaminoBorrowAsset = null;
    } else {
      const parsed = parseKaminoBorrowAssetInput(kaminoBorrowRaw);
      if (!parsed) {
        if (editPoolError) {
          editPoolError.textContent = "Kamino emprestimo invalido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.kaminoBorrowAsset = parsed;
    }

    const kaminoMarketRaw = editPoolKaminoMarketInput?.value?.trim() ?? "";
    if (!kaminoMarketRaw) {
      overrides.kaminoMarketAddress = null;
    } else {
      overrides.kaminoMarketAddress = kaminoMarketRaw;
    }

    const kaminoMaxLtvRaw = editPoolKaminoMaxLtvInput?.value?.trim() ?? "";
    if (!kaminoMaxLtvRaw) {
      overrides.kaminoMaxLtv = null;
    } else {
      const parsed = parseOptionalNumber(kaminoMaxLtvRaw);
      if (parsed === undefined) {
        if (editPoolError) {
          editPoolError.textContent = "Kamino LTV invalido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.kaminoMaxLtv = parsed;
    }

    const kaminoCloseRuleRaw = editPoolKaminoCloseRuleInput?.value ?? "";
    if (!kaminoCloseRuleRaw) {
      overrides.kaminoCloseRule = null;
    } else {
      const parsed = parseKaminoCloseRuleInput(kaminoCloseRuleRaw);
      if (!parsed) {
        if (editPoolError) {
          editPoolError.textContent = "Kamino regra de fechamento invalida.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.kaminoCloseRule = parsed;
    }

    const kaminoBufferRaw = editPoolKaminoPriceBufferInput?.value?.trim() ?? "";
    if (!kaminoBufferRaw) {
      overrides.kaminoPriceBufferPct = null;
    } else {
      const parsed = parseOptionalNumber(kaminoBufferRaw);
      if (parsed === undefined) {
        if (editPoolError) {
          editPoolError.textContent = "Kamino buffer % invalido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.kaminoPriceBufferPct = parsed;
    }

    const kaminoCollateralModeRaw = editPoolKaminoCollateralModeInput?.value ?? "";
    if (!kaminoCollateralModeRaw) {
      overrides.kaminoCollateralMode = null;
    } else {
      const parsed = parseKaminoCollateralModeInput(kaminoCollateralModeRaw);
      if (!parsed) {
        if (editPoolError) {
          editPoolError.textContent = "Kamino colateral invalido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.kaminoCollateralMode = parsed;
    }

    const kaminoConvertRaw = editPoolKaminoConvertInput?.value ?? "";
    if (!kaminoConvertRaw) {
      overrides.kaminoConvertToCollateral = null;
    } else {
      const parsed = parseBooleanInput(kaminoConvertRaw);
      if (parsed === null) {
        if (editPoolError) {
          editPoolError.textContent = "Converter para colateral fixo invalido. Use Sim ou Nao.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.kaminoConvertToCollateral = parsed;
    }

    const kaminoAvgBasisRaw = editPoolKaminoAvgBasisInput?.value ?? "";
    if (!kaminoAvgBasisRaw) {
      overrides.kaminoAvgPriceBasis = null;
    } else {
      const parsed = parseKaminoAvgBasisInput(kaminoAvgBasisRaw);
      if (!parsed) {
        if (editPoolError) {
          editPoolError.textContent = "Kamino base do preco medio invalida.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.kaminoAvgPriceBasis = parsed;
    }

    const kaminoAvgModeRaw = editPoolKaminoAvgModeInput?.value ?? "";
    if (!kaminoAvgModeRaw) {
      overrides.kaminoAvgMode = null;
    } else {
      const parsed = parseKaminoAvgModeInput(kaminoAvgModeRaw);
      if (!parsed) {
        if (editPoolError) {
          editPoolError.textContent = "Kamino modo da mdia invalido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.kaminoAvgMode = parsed;
    }

    const kaminoAutoCloseRaw = editPoolKaminoAutoCloseInput?.value ?? "";
    if (!kaminoAutoCloseRaw) {
      overrides.kaminoAutoCloseOnTokenChange = null;
    } else {
      const parsed = parseBooleanInput(kaminoAutoCloseRaw);
      if (parsed === null) {
        if (editPoolError) {
          editPoolError.textContent = "Auto-fechar Kamino invalido. Use Sim ou Nao.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.kaminoAutoCloseOnTokenChange = parsed;
    }

    const rangeAnchorRaw = editPoolRangeAnchorInput?.value?.trim() ?? "";
    if (!rangeAnchorRaw) {
      overrides.rangeAnchor = null;
    } else {
      const parsed = parseRangeAnchorInput(rangeAnchorRaw);
      if (!parsed) {
        if (editPoolError) {
          editPoolError.textContent = "Âncora do range inválida. Use inferior, meio ou superior.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.rangeAnchor = parsed;
    }

    const exitBiasRaw = editPoolExitBiasInput?.value?.trim() ?? "";
    if (!exitBiasRaw) {
      overrides.rangeExitBiasPct = null;
    } else {
      const parsed = parseOptionalNumber(exitBiasRaw);
      if (parsed === undefined) {
        if (editPoolError) {
          editPoolError.textContent = "Bias % invalido.";
          editPoolError.classList.remove("hidden");
        }
        return;
      }
      overrides.rangeExitBiasPct = parsed;
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
    updateCachedPoolRunning(id, true);
    if (cachedConfig?.selectedPoolId === id && cachedStatus) {
      cachedStatus = { ...cachedStatus, running: true };
    }
    updateUI();
    return;
  }

  if (action === "stop") {
    await fetch(`/api/pools/${id}/stop`, { method: "POST" });
    updateCachedPoolRunning(id, false);
    if (cachedConfig?.selectedPoolId === id && cachedStatus) {
      cachedStatus = { ...cachedStatus, running: false };
    }
    updateUI();
    return;
  }

  if (action === "close") {
    const ok = window.confirm("Rebalancear a posicao dessa pool? O bot vai fechar a pool atual e seguir o fluxo normal de reabertura/Kamino, sem parar o processo.");
    if (!ok) return;
    const res = await fetch(`/api/pools/${id}/rebalance`, { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      window.alert(data?.error ?? "Falha ao rebalancear a pool.");
    }
    updateUI();
    return;
  }

  if (action === "close-stop") {
    const ok = window.confirm("Fechar e parar essa pool? Isso fecha apenas a posicao da pool, sem mexer no hedge e sem fechar o emprestimo Kamino.");
    if (!ok) return;
    const res = await fetch(`/api/pools/${id}/close-and-stop`, { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      window.alert(data?.error ?? "Falha ao fechar e parar a pool.");
    } else if (data?.status) {
      updateCachedPoolRunning(id, Boolean(data.status.running));
      if (cachedConfig?.selectedPoolId === id && cachedStatus) {
        cachedStatus = { ...cachedStatus, running: Boolean(data.status.running) };
      }
    }
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
  } else if (closeType === "kamino-log") {
    closeKaminoLogModal();
  }
});

if (kaminoLogBody) {
  kaminoLogBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("[data-kamino-log]");
    if (!button) return;
    const index = Number(button.getAttribute("data-kamino-log"));
    const entry = Number.isFinite(index) ? cachedKaminoLogs[index] : null;
    if (entry) {
      openKaminoLogModal(entry);
    }
  });
}

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

historyBody.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest(".history-edit-btn");
  if (!(button instanceof HTMLElement)) return;
  event.preventDefault();
  startHistoryEdit(button);
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
  const ok = window.confirm("Limpar o historico? Essa acao nao pode ser desfeita.");
  if (!ok) return;
  await fetch("/api/history/clear", { method: "POST" });
  updateUI();
});

if (clearKaminoLogBtn) {
  clearKaminoLogBtn.addEventListener("click", async () => {
    const ok = window.confirm("Limpar o log do Kamino? Essa acao nao pode ser desfeita.");
    if (!ok) return;
    await fetch("/api/kamino-logs/clear", { method: "POST" });
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
ensureKaminoMarketsLoaded();
applyHistoryColumnVisibility();
syncHistoryTypeControls();
syncHistoryRowLimit();
setInterval(updateUI, 5000);

