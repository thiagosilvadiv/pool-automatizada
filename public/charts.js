const poolSelect = document.getElementById("chartPoolSelect");
const chartFrame = document.getElementById("chartFrame");
const chartEmpty = document.getElementById("chartEmpty");
const chartTrendBadge = document.getElementById("chartTrendBadge");
const chartExternalLink = document.getElementById("chartExternalLink");
const indicatorCanvas = document.getElementById("indicatorCanvas");
const indicatorEmpty = document.getElementById("indicatorEmpty");
const indicatorMeta = document.getElementById("indicatorMeta");
const indicatorRefresh = document.getElementById("indicatorRefresh");

let cachedPools = [];
let cachedConfig = null;
let lastChartPoolId = null;
let lastChartEmbedUrl = null;
let lastIndicatorPoolId = null;

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

function formatIndicatorMeta(series) {
  if (!indicatorMeta) return;
  if (!series) {
    indicatorMeta.textContent = "IndisponÃ­vel";
    return;
  }
  const updatedAt = series.updatedAt ? new Date(series.updatedAt) : null;
  const updatedLabel = updatedAt && !Number.isNaN(updatedAt.getTime())
    ? updatedAt.toLocaleString("pt-BR")
    : "-";
  const timeframe = series.timeframe ? ` ${series.timeframe}` : "";
  const status = series.stale
    ? `Desatualizado${timeframe}`
    : series.direction === "up"
      ? `Alta${timeframe}`
      : series.direction === "down"
        ? `Baixa${timeframe}`
        : `IndisponÃ­vel${timeframe}`;
  indicatorMeta.textContent = `${status} Â· Ãšltima vela fechada: ${updatedLabel}`;
}

async function fetchTrendSeries(poolId, force = false) {
  const suffix = force ? "?force=1" : "";
  const res = await fetch(`/api/trend-series/${poolId}${suffix}`);
  if (!res.ok) {
    throw new Error("Falha ao carregar indicador");
  }
  const data = await res.json();
  return data?.series ?? null;
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

function drawLine(ctx, series, getter, color) {
  let started = false;
  ctx.beginPath();
  series.forEach((point, idx) => {
    const value = getter(point);
    if (!Number.isFinite(value)) {
      started = false;
      return;
    }
    if (!started) {
      ctx.moveTo(point.x, point.y(value));
      started = true;
    } else {
      ctx.lineTo(point.x, point.y(value));
    }
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function drawIndicator(canvas, series) {
  if (!canvas) return;
  const ctx = resizeCanvas(canvas);
  if (!ctx) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);

  const candles = series?.candles ?? [];
  if (!candles.length) {
    return;
  }
  const basis = series?.basis ?? [];
  const basisOpen = series?.basisOpen ?? [];
  const basisClose = series?.basisClose ?? [];
  const upper = series?.upper ?? [];
  const lower = series?.lower ?? [];

  const points = candles.map((c, i) => ({
    idx: i,
    close: Number(c.close),
    basis: Number(basis[i]),
    upper: Number(upper[i]),
    lower: Number(lower[i]),
    basisOpen: Number(basisOpen[i]),
    basisClose: Number(basisClose[i])
  }));

  const values = [];
  points.forEach((p) => {
    if (Number.isFinite(p.close)) values.push(p.close);
    if (Number.isFinite(p.basis)) values.push(p.basis);
    if (Number.isFinite(p.upper)) values.push(p.upper);
    if (Number.isFinite(p.lower)) values.push(p.lower);
    if (Number.isFinite(p.basisOpen)) values.push(p.basisOpen);
    if (Number.isFinite(p.basisClose)) values.push(p.basisClose);
  });
  if (!values.length) return;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.08 || 1;
  const minY = min - pad;
  const maxY = max + pad;
  const plotW = width - 32;
  const plotH = height - 32;

  const scaled = points.map((p) => ({
    ...p,
    x: 16 + (p.idx / Math.max(1, points.length - 1)) * plotW,
    y: (val) => 16 + (1 - (val - minY) / (maxY - minY)) * plotH
  }));

  // background grid
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = 16 + (i / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(16, y);
    ctx.lineTo(width - 16, y);
    ctx.stroke();
  }

  // band fill
  ctx.beginPath();
  let started = false;
  scaled.forEach((p) => {
    if (!Number.isFinite(p.upper)) {
      started = false;
      return;
    }
    if (!started) {
      ctx.moveTo(p.x, p.y(p.upper));
      started = true;
    } else {
      ctx.lineTo(p.x, p.y(p.upper));
    }
  });
  for (let i = scaled.length - 1; i >= 0; i -= 1) {
    const p = scaled[i];
    if (!Number.isFinite(p.lower)) {
      continue;
    }
    ctx.lineTo(p.x, p.y(p.lower));
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(52, 152, 219, 0.08)";
  ctx.fill();

  drawLine(ctx, scaled, (p) => p.upper, "rgba(52, 152, 219, 0.6)");
  drawLine(ctx, scaled, (p) => p.lower, "rgba(52, 152, 219, 0.6)");
  const cloudColor = series?.direction === "down"
    ? "rgba(231, 76, 60, 0.35)"
    : series?.direction === "up"
      ? "rgba(46, 204, 113, 0.35)"
      : "rgba(149, 165, 166, 0.25)";

  // basis cloud
  ctx.beginPath();
  let cloudStarted = false;
  scaled.forEach((p) => {
    if (!Number.isFinite(p.basisOpen)) {
      cloudStarted = false;
      return;
    }
    if (!cloudStarted) {
      ctx.moveTo(p.x, p.y(p.basisOpen));
      cloudStarted = true;
    } else {
      ctx.lineTo(p.x, p.y(p.basisOpen));
    }
  });
  for (let i = scaled.length - 1; i >= 0; i -= 1) {
    const p = scaled[i];
    if (!Number.isFinite(p.basisClose)) {
      continue;
    }
    ctx.lineTo(p.x, p.y(p.basisClose));
  }
  ctx.closePath();
  ctx.fillStyle = cloudColor;
  ctx.fill();

  drawLine(ctx, scaled, (p) => p.basisOpen, "rgba(46, 204, 113, 0.9)");
  drawLine(ctx, scaled, (p) => p.basisClose, "rgba(46, 204, 113, 0.9)");
  drawLine(ctx, scaled, (p) => p.close, "#f0f3f7");
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

async function updateIndicator(pool, force = false) {
  if (!indicatorCanvas || !indicatorEmpty) return;
  if (!pool?.id) {
    indicatorEmpty.classList.remove("hidden");
    indicatorEmpty.style.display = "flex";
    formatIndicatorMeta(null);
    return;
  }
  if (!force && pool.id === lastIndicatorPoolId) {
    return;
  }
  try {
    const series = await fetchTrendSeries(pool.id, force);
    lastIndicatorPoolId = pool.id;
    indicatorEmpty.classList.add("hidden");
    indicatorEmpty.style.display = "none";
    formatIndicatorMeta(series);
    drawIndicator(indicatorCanvas, series);
  } catch (err) {
    indicatorEmpty.classList.remove("hidden");
    indicatorEmpty.style.display = "flex";
    formatIndicatorMeta(null);
  }
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
    await updateIndicator(selectedPool, false);
  } catch (err) {
    updateChart(null);
    await updateIndicator(null, true);
  }
}

if (poolSelect) {
  poolSelect.addEventListener("change", () => {
    const selectedPool = getSelectedPool();
    updateChart(selectedPool);
    void updateIndicator(selectedPool, true);
  });
}

if (indicatorRefresh) {
  indicatorRefresh.addEventListener("click", () => {
    const selectedPool = getSelectedPool();
    void updateIndicator(selectedPool, true);
  });
}

window.addEventListener("resize", () => {
  const selectedPool = getSelectedPool();
  void updateIndicator(selectedPool, true);
});

refresh();
setInterval(refresh, 5000);
setInterval(() => {
  const selectedPool = getSelectedPool();
  void updateIndicator(selectedPool, true);
}, 60000);
