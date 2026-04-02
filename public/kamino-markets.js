const marketIdInput = document.getElementById("marketId");
const marketNameInput = document.getElementById("marketName");
const marketAddressInput = document.getElementById("marketAddress");
const marketSaveBtn = document.getElementById("marketSave");
const marketCancelBtn = document.getElementById("marketCancel");
const marketStatusEl = document.getElementById("marketStatus");
const marketDefaultEl = document.getElementById("marketDefault");
const marketsBody = document.getElementById("marketsBody");
const marketsCount = document.getElementById("marketsCount");

let cachedMarkets = [];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatAddress(value) {
  const address = String(value ?? "");
  if (!address) return "-";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function fetchMarkets() {
  const res = await fetch("/api/kamino/markets");
  return res.json();
}

async function fetchConfig() {
  const res = await fetch("/api/config");
  return res.json();
}

function setStatus(message, isError) {
  if (!marketStatusEl) return;
  marketStatusEl.textContent = message || "";
  marketStatusEl.classList.toggle("error", Boolean(isError));
}

function resetForm() {
  if (marketIdInput) marketIdInput.value = "";
  if (marketNameInput) marketNameInput.value = "";
  if (marketAddressInput) marketAddressInput.value = "";
  if (marketSaveBtn) marketSaveBtn.textContent = "Salvar";
  if (marketCancelBtn) marketCancelBtn.classList.add("hidden");
}

function populateForm(entry) {
  if (marketIdInput) marketIdInput.value = entry.id ?? "";
  if (marketNameInput) marketNameInput.value = entry.name ?? "";
  if (marketAddressInput) marketAddressInput.value = entry.address ?? "";
  if (marketSaveBtn) marketSaveBtn.textContent = "Atualizar";
  if (marketCancelBtn) marketCancelBtn.classList.remove("hidden");
}

function renderMarkets() {
  if (!marketsBody) return;
  if (!Array.isArray(cachedMarkets) || cachedMarkets.length === 0) {
    marketsBody.innerHTML = "<tr><td colspan=\"3\">Sem markets cadastrados</td></tr>";
    if (marketsCount) marketsCount.textContent = "0";
    return;
  }
  const rows = cachedMarkets.map((entry) => {
    const name = escapeHtml(entry.name ?? "-");
    const address = escapeHtml(entry.address ?? "-");
    const shortAddress = escapeHtml(formatAddress(entry.address));
    return `
      <tr data-id="${escapeHtml(entry.id)}">
        <td>${name}</td>
        <td title="${address}">${shortAddress}</td>
        <td>
          <button class="ghost" data-action="edit">Editar</button>
          <button class="danger" data-action="delete">Remover</button>
        </td>
      </tr>
    `;
  });
  marketsBody.innerHTML = rows.join("");
  if (marketsCount) marketsCount.textContent = String(cachedMarkets.length);
}

async function loadMarkets() {
  const data = await fetchMarkets().catch(() => null);
  cachedMarkets = Array.isArray(data?.markets) ? data.markets : [];
  renderMarkets();
}

async function loadDefaultMarket() {
  if (!marketDefaultEl) return;
  const config = await fetchConfig().catch(() => null);
  const addr = config?.kaminoMarketAddress ?? "";
  marketDefaultEl.textContent = addr
    ? `Padrao do env: ${addr}`
    : "Padrao do env: (nao configurado)";
}

if (marketSaveBtn) {
  marketSaveBtn.addEventListener("click", async () => {
    const id = marketIdInput?.value?.trim();
    const name = marketNameInput?.value?.trim();
    const address = marketAddressInput?.value?.trim();
    setStatus("", false);
    if (!name || !address) {
      setStatus("Nome e endereco sao obrigatorios.", true);
      return;
    }
    const payload = { name, marketAddress: address };
    const url = id ? `/api/kamino/markets/${id}` : "/api/kamino/markets";
    const method = id ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const msg = data?.error ?? "Falha ao salvar market.";
      setStatus(msg, true);
      return;
    }
    setStatus("Market salvo.", false);
    resetForm();
    await loadMarkets();
  });
}

if (marketCancelBtn) {
  marketCancelBtn.addEventListener("click", () => {
    resetForm();
    setStatus("", false);
  });
}

if (marketsBody) {
  marketsBody.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.getAttribute("data-action");
    if (!action) return;
    const row = target.closest("tr");
    const id = row?.getAttribute("data-id");
    if (!id) return;
    const entry = cachedMarkets.find((item) => item.id === id);
    if (!entry) return;
    if (action === "edit") {
      populateForm(entry);
      return;
    }
    if (action === "delete") {
      const ok = window.confirm("Remover este market?");
      if (!ok) return;
      const res = await fetch(`/api/kamino/markets/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const msg = data?.error ?? "Falha ao remover market.";
        setStatus(msg, true);
        return;
      }
      setStatus("Market removido.", false);
      resetForm();
      await loadMarkets();
    }
  });
}

loadMarkets();
loadDefaultMarket();
