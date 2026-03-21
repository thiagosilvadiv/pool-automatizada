const poolSelect = document.getElementById("chartPoolSelect");
const chartFrame = document.getElementById("chartFrame");
const chartEmpty = document.getElementById("chartEmpty");
const chartTrendBadge = document.getElementById("chartTrendBadge");
const chartExternalLink = document.getElementById("chartExternalLink");

let cachedPools = [];
let cachedConfig = null;
let lastChartPoolId = null;
let lastChartEmbedUrl = null;

function formatTrendBadge(pool) {
  if (!chartTrendBadge) return;
  chartTrendBadge.className = "trend-badge";
  if (!pool) {
    chartTrendBadge.textContent = "Indisponível";
    chartTrendBadge.classList.add("trend-unknown");
    return;
  }
  if (!pool.trendEnabled) {
    chartTrendBadge.textContent = "Desativado";
    chartTrendBadge.classList.add("trend-off");
    return;
  }
  const timeframe = pool?.trendTimeframe ? ` ${pool.trendTimeframe}` : "";
  if (pool?.trendStale) {
    chartTrendBadge.textContent = `Desatualizado${timeframe}`;
    chartTrendBadge.classList.add("trend-unknown");
    return;
  }
  if (pool?.trendDirection === "up") {
    chartTrendBadge.textContent = `Alta${timeframe}`;
    chartTrendBadge.classList.add("trend-up");
    return;
  }
  if (pool?.trendDirection === "down") {
    chartTrendBadge.textContent = `Baixa${timeframe}`;
    chartTrendBadge.classList.add("trend-down");
    return;
  }
  chartTrendBadge.textContent = `Indisponível${timeframe}`;
  chartTrendBadge.classList.add("trend-unknown");
}

function buildGeckoUrl(networkId, poolAddress, embed) {
  const safeNetwork = networkId || "solana";
  const base = `https://www.geckoterminal.com/${safeNetwork}/pools/${poolAddress}`;
  if (!embed) return base;
  return `${base}?embed=1`;
}

function renderPoolsSelect(pools, selectedId) {
  if (!poolSelect) return;
  poolSelect.innerHTML = pools.map((pool) => {
    const selected = pool.id === selectedId ? "selected" : "";
    return `<option value="${pool.id}" ${selected}>${pool.name}</option>`;
  }).join("");
}

function getSelectedPool() {
  if (!poolSelect || cachedPools.length === 0) return null;
  const selectedId = poolSelect.value || cachedPools[0]?.id;
  return cachedPools.find((pool) => pool.id === selectedId) ?? cachedPools[0] ?? null;
}

function updateChart(pool) {
  if (!chartFrame || !chartExternalLink || !chartEmpty) return;
  if (!pool?.whirlpoolAddress) {
    chartFrame.src = "about:blank";
    chartExternalLink.href = "#";
    chartExternalLink.classList.add("disabled");
    chartEmpty.classList.remove("hidden");
    chartEmpty.style.display = "flex";
    formatTrendBadge(null);
    lastChartPoolId = null;
    lastChartEmbedUrl = null;
    return;
  }
  const networkId = cachedConfig?.trendNetworkId || "solana";
  const embedUrl = buildGeckoUrl(networkId, pool.whirlpoolAddress, true);
  const externalUrl = buildGeckoUrl(networkId, pool.whirlpoolAddress, false);
  if (pool.id !== lastChartPoolId || embedUrl !== lastChartEmbedUrl) {
    chartFrame.src = embedUrl;
    lastChartPoolId = pool.id;
    lastChartEmbedUrl = embedUrl;
  }
  chartExternalLink.href = externalUrl;
  chartExternalLink.classList.remove("disabled");
  chartEmpty.classList.add("hidden");
  chartEmpty.style.display = "none";
  formatTrendBadge(pool);
}

async function fetchPools() {
  const res = await fetch("/api/pools");
  return res.json();
}

async function fetchConfig() {
  const res = await fetch("/api/config");
  return res.json();
}

async function refresh() {
  try {
    const [poolsData, configData] = await Promise.all([fetchPools(), fetchConfig()]);
    cachedPools = poolsData?.pools ?? [];
    cachedConfig = configData ?? null;

    if (!cachedPools.length) {
      if (poolSelect) poolSelect.innerHTML = "";
      updateChart(null);
      return;
    }

    const selectedId = poolSelect?.value || poolsData?.selectedPoolId || cachedPools[0]?.id;
    renderPoolsSelect(cachedPools, selectedId);
    const selectedPool = getSelectedPool();
    updateChart(selectedPool);
  } catch (err) {
    updateChart(null);
  }
}

if (poolSelect) {
  poolSelect.addEventListener("change", () => {
    const selectedPool = getSelectedPool();
    updateChart(selectedPool);
  });
}

refresh();
setInterval(refresh, 5000);
