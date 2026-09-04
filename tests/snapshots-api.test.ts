import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSnapshotRoutes } from "../src/server.js";

vi.mock("../src/pool-manager.js", () => ({
  PoolManager: class {}
}));

type ServerHandle = { baseUrl: string; close: () => Promise<void> };

const activeServers: ServerHandle[] = [];

function point(t: number) {
  return { t, price: t / 1000, posValueUsd: 10, posFeesUsd: 1 };
}

class SnapshotRouteStub {
  cleared: string[] = [];
  lastQuery: unknown = null;

  getSelectedPoolId() {
    return "pool-1";
  }

  hasPool(id: string) {
    return id === "pool-1";
  }

  async getSnapshots(poolId: string, options: unknown) {
    this.lastQuery = { poolId, options };
    return { points: [point(1000), point(2000)], updatedAt: "2026-09-04T00:00:00.000Z" };
  }

  async clearSnapshots(poolId: string) {
    this.cleared.push(poolId);
  }
}

async function createServer(stub: SnapshotRouteStub): Promise<ServerHandle> {
  const app = express();
  app.use(express.json());
  registerSnapshotRoutes(app, stub as any);
  const server = await new Promise<import("http").Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get server address");
  }
  const handle: ServerHandle = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
  activeServers.push(handle);
  return handle;
}

afterEach(async () => {
  while (activeServers.length) {
    const handle = activeServers.pop();
    if (handle) await handle.close();
  }
});

describe("snapshots api routes", () => {
  it("devolve a serie da pool informada", async () => {
    const stub = new SnapshotRouteStub();
    const server = await createServer(stub);
    const response = await fetch(`${server.baseUrl}/api/snapshots/pool-1`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.poolId).toBe("pool-1");
    expect(data.bucket).toBe("raw");
    expect(data.points).toHaveLength(2);
    expect(data.updatedAt).toBe("2026-09-04T00:00:00.000Z");
  });

  it("404 para pool desconhecida", async () => {
    const server = await createServer(new SnapshotRouteStub());
    const response = await fetch(`${server.baseUrl}/api/snapshots/pool-404`);
    expect(response.status).toBe(404);
  });

  it("cai na pool selecionada quando nao ha id na rota", async () => {
    const stub = new SnapshotRouteStub();
    const server = await createServer(stub);
    const response = await fetch(`${server.baseUrl}/api/snapshots`);
    expect(response.status).toBe(200);
    expect((stub.lastQuery as any).poolId).toBe("pool-1");
  });

  it("aceita from/to em epoch ms e em ISO", async () => {
    const stub = new SnapshotRouteStub();
    const server = await createServer(stub);
    await fetch(`${server.baseUrl}/api/snapshots/pool-1?from=1000&to=2026-09-04T00:00:00.000Z`);
    const options = (stub.lastQuery as any).options;
    expect(options.from).toBe(1000);
    expect(options.to).toBe(Date.parse("2026-09-04T00:00:00.000Z"));
  });

  it("repassa o bucket pedido", async () => {
    const stub = new SnapshotRouteStub();
    const server = await createServer(stub);
    const response = await fetch(`${server.baseUrl}/api/snapshots/pool-1?bucket=1h`);
    const data = await response.json();
    expect(data.bucket).toBe("1h");
    expect((stub.lastQuery as any).options.bucket).toBe("1h");
  });

  it("400 para bucket invalido", async () => {
    const server = await createServer(new SnapshotRouteStub());
    const response = await fetch(`${server.baseUrl}/api/snapshots/pool-1?bucket=7m`);
    expect(response.status).toBe(400);
  });

  it("limpa a serie da pool selecionada", async () => {
    const stub = new SnapshotRouteStub();
    const server = await createServer(stub);
    const response = await fetch(`${server.baseUrl}/api/snapshots/clear`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(stub.cleared).toEqual(["pool-1"]);
  });
});
