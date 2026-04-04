/**
 * Envia mensagem de texto via Evolution API (WhatsApp).
 * Silencioso se as variáveis de ambiente não estiverem configuradas.
 */
export async function sendEvolutionMessage(params: {
  apiUrl: string;
  apiKey: string;
  instance: string;
  phone: string;
  message: string;
}): Promise<void> {
  const { apiUrl, apiKey, instance, phone, message } = params;
  const url = `${apiUrl.replace(/\/$/, "")}/message/sendText/${instance}`;
  const body = {
    number: phone,
    text: message
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": apiKey
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Evolution API error ${res.status}: ${text}`);
  }
}

/**
 * Envia alerta de fundos insuficientes para pagar dívida Kamino.
 * Não lança erro — falha silenciosa com log de aviso.
 */
export async function notifyKaminoFundsNeeded(params: {
  apiUrl: string | null;
  apiKey: string | null;
  instance: string | null;
  phone: string | null;
  walletAddress: string;
  debtAmount: number;
  debtMint: string;
  debtSymbol: string;
  minAmountNeeded: number;
}): Promise<void> {
  const { apiUrl, apiKey, instance, phone } = params;
  if (!apiUrl || !apiKey || !instance || !phone) return;

  const msg =
    `⚠️ *Pool Automatizada — Kamino: Fundos Necessários*\\n\\n` +
    `O ciclo Kamino não conseguiu pagar a dívida automaticamente.\\n\\n` +
    `*Wallet:* \`${params.walletAddress}\`\\n` +
    `*Dívida total:* ${params.debtAmount.toFixed(6)} ${params.debtSymbol}\\n` +
    `*Mínimo para enviar:* ${params.minAmountNeeded.toFixed(6)} ${params.debtSymbol}\\n` +
    `*Token (mint):* \`${params.debtMint}\`\\n\\n` +
    `Envie o valor acima para a wallet indicada.\\n` +
    `Assim que o saldo for detectado, o bot quitará a dívida automaticamente e registrará a devolução pendente na interface.`;

  try {
    await sendEvolutionMessage({ apiUrl, apiKey, instance, phone, message: msg });
  } catch (err) {
    console.warn("[evolution-notify] falha ao enviar alerta:", err);
  }
}
