const allowlistInput = document.getElementById("allowlistInput");
const allowlistSave = document.getElementById("allowlistSave");
const allowlistReload = document.getElementById("allowlistReload");
const allowlistCount = document.getElementById("allowlistCount");
const allowlistStatus = document.getElementById("allowlistStatus");

function normalizeList(text) {
  if (!text) return [];
  const items = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return Array.from(new Set(items));
}

function renderList(mints) {
  const list = Array.isArray(mints) ? mints : [];
  if (allowlistInput) {
    allowlistInput.value = list.join("\n");
  }
  if (allowlistCount) {
    allowlistCount.textContent = String(list.length);
  }
}

function setStatus(message, isError = false) {
  if (!allowlistStatus) return;
  allowlistStatus.textContent = message;
  allowlistStatus.classList.toggle("error", Boolean(isError));
}

async function fetchAllowlist() {
  const res = await fetch("/api/swap-allowlist");
  if (!res.ok) {
    throw new Error("Falha ao carregar allowlist");
  }
  return res.json();
}

async function saveAllowlist(mints) {
  const res = await fetch("/api/swap-allowlist", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mints })
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error ?? "Falha ao salvar allowlist");
  }
  return data;
}

async function load() {
  try {
    setStatus("");
    const data = await fetchAllowlist();
    renderList(data?.mints ?? []);
    setStatus("Lista carregada.");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

if (allowlistSave) {
  allowlistSave.addEventListener("click", async () => {
    try {
      const list = normalizeList(allowlistInput?.value ?? "");
      const data = await saveAllowlist(list);
      renderList(data?.mints ?? list);
      setStatus("Lista salva.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), true);
    }
  });
}

if (allowlistReload) {
  allowlistReload.addEventListener("click", () => {
    load();
  });
}

if (allowlistInput) {
  allowlistInput.addEventListener("input", () => {
    const list = normalizeList(allowlistInput.value);
    if (allowlistCount) {
      allowlistCount.textContent = String(list.length);
    }
  });
}

load();
