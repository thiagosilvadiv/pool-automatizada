import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { registerPoolsSummaryRoute } from "../src/server.js";

type ServerHandle = {
  baseUrl: string;
  close: () => Promise<void>;
};

const activeServers: ServerHandle[] = [];

class PoolRouteStub {
  getSelectedPoolId() {
    return "pool-1";
  }

  async listSummaries() {
    return [
      {
        id: "pool-1",
        name: "SOL/USDC",
        whirlpoolAddress: "So11111111111111111111111111111111111111112",
        createdAt: "2026-03-30T00:00:00.000Z",
        selected: true,
        running: true,
        lastAction: "open-position",
        lastError: null,
        lastPrice: 150,
        positionValueUsd: null,
        positionPnlUsd: null,
        positionValueSol: null,
        positionPnlSol: null,
        tokenAMint: null,
        tokenBMint: null,
        isTokenASol: null,
        isTokenBSol: null,
        trendDirection: null,
        trendUpdatedAt: null,
        trendTimeframe: null,
        trendEnabled: false,
        trendStale: false,
        overrides: null
      }
    ];
  }

  getAutoResumeStatus() {
    return {
      enabled: true,
      maxAttempts: 5,
      baseDelayMs: 5000,
      activePoolIds: ["pool-1"],
      pendingPoolIds: ["pool-1"],
      inFlightPoolIds: [],
      attempts: { "pool-1": 1 },
      lastErrors: { "pool-1": "temporary" }
    };
  }
}

async function createServer(): Promise<ServerHandle> {
  const app = express();
  app.use(express.json());
  registerPoolsSummaryRoute(app, new PoolRouteStub() as any);

  const server = await new Promise<import("http").Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get server address");
  }

  const handle: ServerHandle = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    }
  };
  activeServers.push(handle);
  return handle;
}

afterEach(async () => {
  while (activeServers.length) {
    const handle = activeServers.pop();
    if (handle) {
      await handle.close();
    }
  }
});

describe("pools api route", () => {
  it("includes autoResume diagnostics in /api/pools", async () => {
    const server = await createServer();
    const response = await fetch(`${server.baseUrl}/api/pools`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.selectedPoolId).toBe("pool-1");
    expect(Array.isArray(data.pools)).toBe(true);
    expect(data.autoResume).toBeTruthy();
    expect(data.autoResume.enabled).toBe(true);
    expect(data.autoResume.activePoolIds).toContain("pool-1");
    expect(data.autoResume.pendingPoolIds).toContain("pool-1");
  });
});
