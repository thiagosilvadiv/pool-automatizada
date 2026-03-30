const modelSelect = document.getElementById("aiModelSelect");
const customModelField = document.getElementById("aiCustomModelField");
const customModelInput = document.getElementById("aiCustomModelInput");
const saveModelBtn = document.getElementById("aiSaveModelBtn");
const scopeSelect = document.getElementById("aiScopeSelect");
const poolSelect = document.getElementById("aiPoolSelect");
const riskSelect = document.getElementById("aiRiskSelect");
const boundsSelect = document.getElementById("aiBoundsSelect");
const runBtn = document.getElementById("aiRunBtn");
const statusBox = document.getElementById("aiStatusBox");
const errorBox = document.getElementById("aiErrorBox");
const metaBadge = document.getElementById("aiMetaBadge");
const executiveSummaryEl = document.getElementById("aiExecutiveSummary");
const confidenceScoreEl = document.getElementById("aiConfidenceScore");
const confidenceTextEl = document.getElementById("aiConfidenceText");
const findingsList = document.getElementById("aiFindingsList");
const warningsList = document.getElementById("aiWarningsList");
const riskBody = document.getElementById("aiRiskBody");
const recoBody = document.getElementById("aiRecoBody");
const historyBody = document.getElementById("aiHistoryBody");
const actionList = document.getElementById("aiActionList");
const chatContextBadge = document.getElementById("aiChatContext");
const chatUpdatedAt = document.getElementById("aiChatUpdatedAt");
const chatMessages = document.getElementById("aiChatMessages");
const chatInput = document.getElementById("aiChatInput");
const chatSendBtn = document.getElementById("aiChatSendBtn");

const MODEL_CUSTOM_VALUE = "__custom__";
const LOCAL_MODEL_KEY = "aiStrategyDefaultModel";

let modelSettings = null;
let poolsCache = [];
let latestAnalysis = null;
let activeAnalysisId = null;
let currentChatThread = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function withBreaks(value) {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function setStatus(message, isError = false) {
  if (statusBox) {
    statusBox.textContent = message || "";
  }
  if (!errorBox) return;
  if (isError && message) {
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
  } else {
    errorBox.textContent = "";
    errorBox.classList.add("hidden");
  }
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(digits);
}

function formatPercent(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${num.toFixed(digits)}%`;
}

function formatCellValue(value) {
  if (value == null) return "-";
  if (typeof value === "boolean") return value ? "Sim" : "Nao";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "-";
    if (Math.abs(value) >= 1000) return value.toFixed(0);
    if (Math.abs(value) >= 10) return value.toFixed(2);
    return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }
  return String(value);
}

function valuesEquivalent(a, b) {
  if (a == null && b == null) return true;
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) {
      return String(a ?? "") === String(b ?? "");
    }
    return Math.abs(na - nb) <= 1e-6;
  }
  return String(a ?? "") === String(b ?? "");
}

function getScopeLabel(value) {
  if (value === "all") return "Todas";
  if (value === "selected") return "Selecionada";
  if (value === "pool") return "Especifica";
  return value || "-";
}

function readDefaultModel() {
  return localStorage.getItem(LOCAL_MODEL_KEY);
}

function saveDefaultModel(value) {
  if (!value) {
    localStorage.removeItem(LOCAL_MODEL_KEY);
    return;
  }
  localStorage.setItem(LOCAL_MODEL_KEY, value);
}

function toggleCustomModelField() {
  if (!modelSettings || !modelSelect || !customModelField) return;
  const show = modelSelect.value === MODEL_CUSTOM_VALUE && modelSettings.allowCustomModel;
  customModelField.classList.toggle("hidden", !show);
}

function buildModelOptions() {
  if (!modelSelect || !modelSettings) return;
  const options = modelSettings.recommendedModels.map((model) => {
    const selected = model === modelSettings.defaultModel ? "selected" : "";
    return `<option value="${escapeHtml(model)}" ${selected}>${escapeHtml(model)}</option>`;
  });
  if (modelSettings.allowCustomModel) {
    options.push(`<option value="${MODEL_CUSTOM_VALUE}">Custom</option>`);
  }
  modelSelect.innerHTML = options.join("");
  const stored = readDefaultModel();
  if (stored) {
    if (modelSettings.recommendedModels.includes(stored)) {
      modelSelect.value = stored;
    } else if (modelSettings.allowCustomModel) {
      modelSelect.value = MODEL_CUSTOM_VALUE;
      if (customModelInput) {
        customModelInput.value = stored;
      }
    }
  }
  toggleCustomModelField();
}

function getSelectedModel() {
  if (!modelSelect) return null;
  if (modelSelect.value !== MODEL_CUSTOM_VALUE) {
    return modelSelect.value;
  }
  const custom = customModelInput?.value?.trim() ?? "";
  return custom || null;
}

function updatePoolSelectorState() {
  if (!scopeSelect || !poolSelect) return;
  poolSelect.disabled = scopeSelect.value !== "pool";
}

async function fetchModels() {
  const res = await fetch("/api/ai/models");
  if (!res.ok) {
    throw new Error("Falha ao carregar modelos de IA.");
  }
  return res.json();
}

async function fetchPools() {
  const res = await fetch("/api/pools");
  if (!res.ok) {
    throw new Error("Falha ao carregar pools.");
  }
  return res.json();
}

async function fetchHistory() {
  const res = await fetch("/api/ai/analysis/history");
  if (!res.ok) {
    throw new Error("Falha ao carregar historico de analises.");
  }
  return res.json();
}

async function fetchHistoryItem(id) {
  const res = await fetch(`/api/ai/analysis/history/${id}`);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Falha ao carregar analise.");
  }
  return res.json();
}

async function runAnalysisRequest(payload) {
  const res = await fetch("/api/ai/analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    const message = data?.error ?? "Falha ao executar analise.";
    const suggested = data?.suggestedModel ? ` Sugestao: ${data.suggestedModel}.` : "";
    throw new Error(`${message}${suggested}`);
  }
  return data.result;
}

async function fetchChatThread(analysisId) {
  const res = await fetch(`/api/ai/analysis/${analysisId}/chat`);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error ?? "Falha ao carregar chat da analise.");
  }
  return data.thread;
}

async function sendChatMessageRequest(payload) {
  const res = await fetch("/api/ai/analysis/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    const message = data?.error ?? "Falha ao enviar pergunta para IA.";
    const suggested = data?.suggestedModel ? ` Sugestao: ${data.suggestedModel}.` : "";
    throw new Error(`${message}${suggested}`);
  }
  return data.thread;
}

function renderPools(data) {
  poolsCache = Array.isArray(data?.pools) ? data.pools : [];
  if (!poolSelect) return;
  if (!poolsCache.length) {
    poolSelect.innerHTML = "<option value=\"\">Sem pools</option>";
    poolSelect.disabled = true;
    return;
  }
  poolSelect.disabled = false;
  const selectedPoolId = data?.selectedPoolId ?? poolsCache[0]?.id ?? "";
  poolSelect.innerHTML = poolsCache
    .map((pool) => {
      const selected = pool.id === selectedPoolId ? "selected" : "";
      return `<option value="${escapeHtml(pool.id)}" ${selected}>${escapeHtml(pool.name)}</option>`;
    })
    .join("");
}

function renderTextList(target, items, emptyText) {
  if (!target) return;
  if (!Array.isArray(items) || items.length === 0) {
    target.innerHTML = `<li>${escapeHtml(emptyText)}</li>`;
    return;
  }
  target.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderRisks(items) {
  if (!riskBody) return;
  if (!Array.isArray(items) || items.length === 0) {
    riskBody.innerHTML = "<tr><td colspan=\"9\">Sem dados</td></tr>";
    return;
  }
  riskBody.innerHTML = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.poolName ?? "-")}</td>
      <td>${formatNumber(item.riskScore, 2)}</td>
      <td>${escapeHtml(item.riskLevel ?? "-")}</td>
      <td>${formatPercent((item.confidence ?? 0) * 100, 1)}</td>
      <td>${formatPercent(item.metrics?.winRatePct, 1)}</td>
      <td>${formatPercent(item.metrics?.drawdownProxyPct, 1)}</td>
      <td>${formatPercent(item.metrics?.volatilityProxyPct, 2)}</td>
      <td>${formatNumber(item.metrics?.rebalancePerDay, 2)}</td>
      <td>${escapeHtml(item.headline ?? "-")}</td>
    </tr>
  `).join("");
}

function renderRecommendations(items) {
  if (!recoBody) return;
  if (!Array.isArray(items) || items.length === 0) {
    recoBody.innerHTML = "<tr><td colspan=\"9\">Sem recomendacoes</td></tr>";
    return;
  }
  recoBody.innerHTML = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.priority)}</td>
      <td>${escapeHtml(item.poolName ?? item.poolId ?? "-")}</td>
      <td>${escapeHtml(item.parameter ?? "-")}</td>
      <td>${escapeHtml(formatCellValue(item.currentValue))}</td>
      <td>${escapeHtml(formatCellValue(item.suggestedValue))}</td>
      <td>${escapeHtml(item.riskLevel ?? "-")}</td>
      <td>${formatPercent((item.confidence ?? 0) * 100, 1)}</td>
      <td>${escapeHtml(item.rationale ?? "-")}</td>
      <td>${escapeHtml(item.expectedEffect ?? "-")}</td>
    </tr>
  `).join("");
}

function buildActionItems(recommendations) {
  if (!Array.isArray(recommendations) || !recommendations.length) {
    return [];
  }
  const changed = recommendations
    .filter((item) => !valuesEquivalent(item.currentValue, item.suggestedValue))
    .sort((a, b) => {
      if ((a.priority ?? 9) !== (b.priority ?? 9)) {
        return (a.priority ?? 9) - (b.priority ?? 9);
      }
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });
  const target = changed.length ? changed.slice(0, 8) : recommendations.slice(0, 5);
  return target.map((item) => {
    const fromValue = formatCellValue(item.currentValue);
    const toValue = formatCellValue(item.suggestedValue);
    return `[P${item.priority}] ${item.poolName}: ${item.parameter} ${fromValue} -> ${toValue}. ${item.rationale}`;
  });
}

function renderActions(recommendations) {
  if (!actionList) return;
  const actions = buildActionItems(recommendations);
  if (!actions.length) {
    actionList.innerHTML = "<li>Sem acoes imediatas. Continue monitorando e rode nova analise com mais fechamentos.</li>";
    return;
  }
  actionList.innerHTML = actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderAnalysis(result) {
  latestAnalysis = result;
  activeAnalysisId = result?.id ?? null;

  if (metaBadge) {
    const model = result?.modelUsed ?? "deterministico";
    const mode = result?.fallbackUsed ? "fallback" : "ia";
    metaBadge.textContent = `${mode.toUpperCase()} | ${model}`;
  }
  if (executiveSummaryEl) {
    executiveSummaryEl.textContent = result?.executiveSummary ?? "Sem resumo.";
  }
  if (confidenceScoreEl) {
    confidenceScoreEl.textContent = formatPercent((result?.confidence?.score ?? 0) * 100, 1);
  }
  if (confidenceTextEl) {
    confidenceTextEl.textContent = result?.confidence?.rationale ?? "-";
  }
  renderTextList(findingsList, result?.keyFindings, "Sem achados.");
  renderTextList(warningsList, result?.warnings, "Nenhum aviso.");
  renderRisks(result?.poolRisks ?? []);
  renderRecommendations(result?.recommendations ?? []);
  renderActions(result?.recommendations ?? []);

  if (chatContextBadge) {
    chatContextBadge.textContent = activeAnalysisId
      ? `Analise ${String(activeAnalysisId).slice(-10)}`
      : "Sem analise selecionada";
  }
}

function renderHistory(rows) {
  if (!historyBody) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    historyBody.innerHTML = "<tr><td colspan=\"9\">Sem historico</td></tr>";
    return;
  }
  historyBody.innerHTML = rows.map((item) => `
    <tr>
      <td>${formatDate(item.createdAt)}</td>
      <td>${escapeHtml(getScopeLabel(item.scope))}</td>
      <td>${escapeHtml(item.riskProfile ?? "-")}</td>
      <td>${escapeHtml(item.modelUsed ?? "-")}</td>
      <td>${item.fallbackUsed ? "Sim" : "Nao"}</td>
      <td>${escapeHtml(item.poolCount ?? "-")}</td>
      <td>${escapeHtml(item.recommendationCount ?? "-")}</td>
      <td>${escapeHtml(item.summary ?? "-")}</td>
      <td><button class="mini-btn ghost" data-history-id="${escapeHtml(item.id)}">Abrir</button></td>
    </tr>
  `).join("");
}

function renderChatThread(thread) {
  currentChatThread = thread;
  if (chatUpdatedAt) {
    const updated = thread?.updatedAt ? formatDate(thread.updatedAt) : "-";
    chatUpdatedAt.textContent = thread?.analysisId
      ? `Conversa vinculada a analise ${String(thread.analysisId).slice(-10)}. Ultima atualizacao: ${updated}.`
      : "Abra uma analise para iniciar a conversa.";
  }
  if (!chatMessages) return;

  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  if (!turns.length) {
    chatMessages.innerHTML = "<div class=\"ai-chat-empty\">Sem conversa ainda.</div>";
    return;
  }

  chatMessages.innerHTML = turns.map((turn) => {
    const roleLabel = turn.role === "assistant" ? "IA" : "Voce";
    const modelText = turn.role === "assistant"
      ? (turn.modelUsed ?? "deterministico")
      : (turn.requestedModel ?? "padrao");
    const template = turn.responseTemplate && turn.role === "assistant"
      ? `
        <div class="ai-chat-template">
          <div class="ai-chat-template-title">Plano defensivo</div>
          <div><strong>O que mudar:</strong></div>
          <ul>
            ${(Array.isArray(turn.responseTemplate.whatToChange) && turn.responseTemplate.whatToChange.length
              ? turn.responseTemplate.whatToChange
              : ["Sem mudanca imediata."])
                .map((item) => `<li>${escapeHtml(item)}</li>`)
                .join("")}
          </ul>
          <div><strong>Por que:</strong> ${escapeHtml(turn.responseTemplate.why ?? "-")}</div>
          <div><strong>Risco:</strong> ${escapeHtml(turn.responseTemplate.risk ?? "-")}</div>
          <div><strong>Impacto esperado:</strong> ${escapeHtml(turn.responseTemplate.expectedImpact ?? "-")}</div>
          <div><strong>Limites de seguranca:</strong></div>
          <ul>
            ${(Array.isArray(turn.responseTemplate.safetyLimits) && turn.responseTemplate.safetyLimits.length
              ? turn.responseTemplate.safetyLimits
              : ["Aplicar com cautela e validar com novos dados."])
                .map((item) => `<li>${escapeHtml(item)}</li>`)
                .join("")}
          </ul>
        </div>
      `
      : "";
    const fallback = turn.role === "assistant" && turn.fallbackUsed && turn.fallbackReason
      ? `<div class="ai-chat-fallback">${escapeHtml(turn.fallbackReason)}</div>`
      : "";

    return `
      <article class="ai-chat-msg ${turn.role === "assistant" ? "ai-chat-assistant" : "ai-chat-user"}">
        <div class="ai-chat-head">
          <span>${roleLabel}</span>
          <span>${formatDate(turn.createdAt)} | ${escapeHtml(modelText)}</span>
        </div>
        <div class="ai-chat-text">${withBreaks(turn.message ?? "")}</div>
        ${template}
        ${fallback}
      </article>
    `;
  }).join("");

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setChatBusy(isBusy) {
  if (chatSendBtn) {
    chatSendBtn.disabled = isBusy || !activeAnalysisId;
  }
  if (chatInput) {
    chatInput.disabled = isBusy || !activeAnalysisId;
  }
}

async function loadChatForAnalysis(analysisId) {
  if (!analysisId) {
    activeAnalysisId = null;
    renderChatThread({ analysisId: null, turns: [], updatedAt: null });
    setChatBusy(false);
    return;
  }
  try {
    setChatBusy(true);
    const thread = await fetchChatThread(analysisId);
    activeAnalysisId = analysisId;
    renderChatThread(thread);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
    renderChatThread({ analysisId, turns: [], updatedAt: null });
  } finally {
    setChatBusy(false);
  }
}

async function runAnalysis() {
  const model = getSelectedModel();
  if (!model) {
    setStatus("Selecione um modelo valido para analisar.", true);
    return;
  }
  if (!scopeSelect || !riskSelect || !boundsSelect) {
    return;
  }
  const scope = scopeSelect.value;
  const payload = {
    scope,
    poolId: scope === "pool" ? (poolSelect?.value || null) : null,
    riskProfile: riskSelect.value,
    changeBounds: boundsSelect.value,
    model
  };

  try {
    setStatus("Executando analise...");
    runBtn.disabled = true;
    const result = await runAnalysisRequest(payload);
    renderAnalysis(result);
    const [historyData] = await Promise.all([fetchHistory(), loadChatForAnalysis(result.id)]);
    renderHistory(historyData?.analyses ?? []);
    setStatus(`Analise concluida em ${formatDate(result.createdAt)}.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    runBtn.disabled = false;
  }
}

async function submitChatMessage() {
  if (!activeAnalysisId) {
    setStatus("Abra uma analise antes de enviar perguntas.", true);
    return;
  }
  const message = chatInput?.value?.trim() ?? "";
  if (!message) {
    setStatus("Digite uma pergunta para a IA.", true);
    return;
  }
  const model = getSelectedModel();
  if (!model) {
    setStatus("Selecione um modelo valido antes de perguntar.", true);
    return;
  }

  try {
    setStatus("Consultando IA sobre a analise...");
    setChatBusy(true);
    const thread = await sendChatMessageRequest({
      analysisId: activeAnalysisId,
      message,
      model
    });
    renderChatThread(thread);
    if (chatInput) {
      chatInput.value = "";
    }
    setStatus("Resposta da IA recebida.");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    setChatBusy(false);
  }
}

async function openHistoryAnalysis(id) {
  try {
    setStatus("Carregando analise do historico...");
    const result = await fetchHistoryItem(id);
    renderAnalysis(result);
    await loadChatForAnalysis(result.id);
    setStatus(`Analise carregada: ${formatDate(result.createdAt)}.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

async function loadInitialData() {
  setStatus("Carregando dados...");
  try {
    const [modelsData, poolsData, historyData] = await Promise.all([
      fetchModels(),
      fetchPools(),
      fetchHistory()
    ]);
    modelSettings = modelsData;
    buildModelOptions();
    renderPools(poolsData);
    renderHistory(historyData?.analyses ?? []);
    updatePoolSelectorState();

    const latest = Array.isArray(historyData?.analyses) ? historyData.analyses[0] : null;
    if (latest?.id) {
      const full = await fetchHistoryItem(latest.id);
      renderAnalysis(full);
      await loadChatForAnalysis(full.id);
    } else {
      renderActions([]);
      renderChatThread({ analysisId: null, turns: [], updatedAt: null });
      setChatBusy(false);
    }

    setStatus("Pronto para analisar.");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

if (modelSelect) {
  modelSelect.addEventListener("change", () => {
    toggleCustomModelField();
  });
}

if (scopeSelect) {
  scopeSelect.addEventListener("change", () => {
    updatePoolSelectorState();
  });
}

if (saveModelBtn) {
  saveModelBtn.addEventListener("click", () => {
    const model = getSelectedModel();
    if (!model) {
      setStatus("Escolha um modelo antes de salvar.", true);
      return;
    }
    saveDefaultModel(model);
    setStatus(`Modelo padrao salvo: ${model}.`);
  });
}

if (runBtn) {
  runBtn.addEventListener("click", () => {
    runAnalysis();
  });
}

if (chatSendBtn) {
  chatSendBtn.addEventListener("click", () => {
    submitChatMessage();
  });
}

if (chatInput) {
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submitChatMessage();
    }
  });
}

if (historyBody) {
  historyBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("[data-history-id]");
    if (!(button instanceof HTMLElement)) return;
    const id = button.getAttribute("data-history-id");
    if (!id) return;
    openHistoryAnalysis(id);
  });
}

loadInitialData();
