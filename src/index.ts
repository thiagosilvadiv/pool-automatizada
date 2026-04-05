import "dotenv/config";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { buildConnection, buildWallet, loadKeypair } from "./solana.js";
import { OrcaBot } from "./orca.js";
import { withRetry } from "./retry.js";
import { startServer } from "./server.js";

// Correção Bug 3: capturar crashes não tratados para logar antes de morrer
process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaughtException:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] unhandledRejection:", reason);
  process.exit(1);
});

function parseArgs(argv: string[]): { configPath?: string; ui: boolean } {
  const args = argv.slice(2);
  const idx = args.findIndex((arg) => arg === "--config");
  const configPath = idx !== -1 ? args[idx + 1] : undefined;
  const ui = args.includes("--ui");
  if (!configPath && !process.env.CONFIG_JSON && !process.env.CONFIG_PATH && !ui) {
    throw new Error("Usage: node dist/index.js --config <path> (or set CONFIG_JSON/CONFIG_PATH)");
  }
  return { configPath, ui };
}

async function main(): Promise<void> {
  const { configPath, ui } = parseArgs(process.argv);
  const config = loadConfig(configPath, { allowMissingWhirlpool: ui });

  if (ui) {
    await startServer(config);
    return;
  }

  const connection = buildConnection(config.rpcUrl);
  const keypair = loadKeypair();
  const wallet = buildWallet(keypair);

  logger.info({ wallet: wallet.publicKey.toBase58(), network: config.network }, "bot starting");

  const bot = await OrcaBot.create({ connection, wallet, config });

  while (true) {
    await withRetry(() => bot.tick(), { retries: 3, baseDelayMs: 1000 });
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

main().catch((err) => {
  logger.error({ err }, "fatal error");
  process.exit(1);
});
