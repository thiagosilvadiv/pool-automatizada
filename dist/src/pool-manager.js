import path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";
import { PublicKey } from "@solana/web3.js";
import { OrcaBot } from "./orca.js";
import { BotRunner } from "./runner.js";
import { logger } from "./logger.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "data");
const POOLS_FILE = path.join(DATA_DIR, "pools.json");
export class PoolManager {
    constructor(baseConfig, connection, wallet) {
        this.pools = new Map();
        this.entries = [];
        this.selectedPoolId = null;
        this.baseConfig = baseConfig;
        this.connection = connection;
        this.wallet = wallet;
    }
    async init() {
        await this.loadPools();
    }
    getSelectedPoolId() {
        return this.selectedPoolId;
    }
    listPools() {
        return [...this.entries];
    }
    listSummaries() {
        return this.entries.map((entry) => {
            const record = this.pools.get(entry.id);
            const status = record?.runner.getStatus();
            return {
                id: entry.id,
                name: entry.name,
                whirlpoolAddress: entry.whirlpoolAddress,
                selected: entry.id === this.selectedPoolId,
                running: status?.running ?? false,
                lastAction: status?.lastAction ?? null,
                lastError: status?.lastError ?? null,
                lastPrice: status?.lastPrice ?? null,
                positionValueUsd: status?.positionValueUsd ?? null,
                positionPnlUsd: status?.positionPnlUsd ?? null,
                positionValueSol: status?.positionValue ?? null,
                positionPnlSol: status?.positionPnl ?? null
            };
        });
    }
    async selectPool(id) {
        if (!this.entries.find((entry) => entry.id === id)) {
            throw new Error("Pool not found");
        }
        this.selectedPoolId = id;
        await this.savePools();
    }
    async addPool(name, whirlpoolAddress) {
        const trimmedName = name.trim();
        const trimmedAddress = whirlpoolAddress.trim();
        if (!trimmedName) {
            throw new Error("Pool name is required");
        }
        if (!trimmedAddress) {
            throw new Error("Whirlpool address is required");
        }
        // Validate address
        try {
            new PublicKey(trimmedAddress);
        }
        catch {
            throw new Error("Invalid whirlpool address");
        }
        if (this.entries.some((entry) => entry.whirlpoolAddress === trimmedAddress)) {
            throw new Error("Pool already exists");
        }
        const entry = {
            id: this.generateId(),
            name: trimmedName,
            whirlpoolAddress: trimmedAddress,
            createdAt: new Date().toISOString()
        };
        await this.createPool(entry);
        this.entries.push(entry);
        if (!this.selectedPoolId) {
            this.selectedPoolId = entry.id;
        }
        await this.savePools();
        return entry;
    }
    async removePool(id) {
        const record = this.pools.get(id);
        if (record) {
            record.runner.stop();
            this.pools.delete(id);
        }
        this.entries = this.entries.filter((entry) => entry.id !== id);
        if (this.selectedPoolId === id) {
            this.selectedPoolId = this.entries[0]?.id ?? null;
        }
        await this.savePools();
    }
    async startPool(id) {
        const record = this.getRecord(id);
        await record.runner.start();
    }
    stopPool(id) {
        const record = this.getRecord(id);
        record.runner.stop();
    }
    async closePool(id) {
        const record = this.getRecord(id);
        await record.runner.closePositionNow();
    }
    getStatus(id) {
        const record = this.pools.get(id);
        return record?.runner.getStatus() ?? null;
    }
    getHistory(id) {
        const record = this.getRecord(id);
        return record.runner.getHistory();
    }
    async clearHistory(id) {
        const record = this.getRecord(id);
        await record.runner.clearHistory();
    }
    async startSelected() {
        if (!this.selectedPoolId) {
            throw new Error("No pool selected");
        }
        await this.startPool(this.selectedPoolId);
    }
    stopSelected() {
        if (!this.selectedPoolId) {
            return;
        }
        this.stopPool(this.selectedPoolId);
    }
    async closeSelected() {
        if (!this.selectedPoolId) {
            throw new Error("No pool selected");
        }
        await this.closePool(this.selectedPoolId);
    }
    getSelectedStatus() {
        if (!this.selectedPoolId) {
            return null;
        }
        return this.getStatus(this.selectedPoolId);
    }
    getSelectedHistory() {
        if (!this.selectedPoolId) {
            return [];
        }
        return this.getHistory(this.selectedPoolId);
    }
    async clearSelectedHistory() {
        if (!this.selectedPoolId) {
            return;
        }
        await this.clearHistory(this.selectedPoolId);
    }
    getRecord(id) {
        const record = this.pools.get(id);
        if (!record) {
            throw new Error("Pool not found");
        }
        return record;
    }
    async loadPools() {
        let data = null;
        try {
            const raw = await fs.readFile(POOLS_FILE, "utf8");
            data = JSON.parse(raw);
        }
        catch {
            data = null;
        }
        let pools = data?.pools ?? [];
        let selectedPoolId = data?.selectedPoolId ?? null;
        if (pools.length === 0 && this.baseConfig.whirlpoolAddress) {
            const entry = {
                id: this.generateId(),
                name: "Pool principal",
                whirlpoolAddress: this.baseConfig.whirlpoolAddress,
                createdAt: new Date().toISOString()
            };
            pools = [entry];
            selectedPoolId = entry.id;
        }
        this.entries = pools;
        this.selectedPoolId = selectedPoolId ?? (pools[0]?.id ?? null);
        for (const entry of pools) {
            try {
                await this.createPool(entry);
            }
            catch (err) {
                logger.warn({ err, entry }, "failed to initialize pool");
            }
        }
        await this.savePools();
    }
    async createPool(entry) {
        const poolConfig = {
            ...this.baseConfig,
            whirlpoolAddress: entry.whirlpoolAddress
        };
        const bot = await OrcaBot.create({
            connection: this.connection,
            wallet: this.wallet,
            config: poolConfig
        });
        const historyFile = path.join(DATA_DIR, `history-${entry.id}.json`);
        const runner = new BotRunner(bot, poolConfig, { historyFile });
        await runner.init();
        this.pools.set(entry.id, { entry, runner });
    }
    async savePools() {
        await fs.mkdir(DATA_DIR, { recursive: true });
        const payload = {
            selectedPoolId: this.selectedPoolId,
            pools: this.entries
        };
        await fs.writeFile(POOLS_FILE, JSON.stringify(payload, null, 2), "utf8");
    }
    generateId() {
        const now = Date.now().toString(36);
        const rand = Math.random().toString(36).slice(2, 8);
        return `pool_${now}_${rand}`;
    }
}
