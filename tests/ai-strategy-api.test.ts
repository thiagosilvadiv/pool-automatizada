import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { registerAiStrategyRoutes } from "../src/server.js";
import { StrategyModelError, type AnalysisChatRequest, type AnalysisChatThread, type StrategyAnalysisRequest, type StrategyAnalysisResult } from "../src/ai-strategy.js";

type ServerHandle = {
  baseUrl: string;
  close: () => Promise<void>;
};

const activeServers: ServerHandle[] = [];

function createResult(id: string, modelUsed: string | null): StrategyAnalysisResult {
  return {
    id,
    createdAt: "2026-03-30T12:00:00.000Z",
    scope: "all",
    poolId: null,
    riskProfile: "defensivo",
    changeBounds: "conservative",
    format: "full-report",
    requestedModel: modelUsed,
    modelUsed,
    aiUsed: false,
    fallbackUsed: true,
    fallbackReason: "deterministico",
    executiveSummary: "Resumo",
    keyFindings: ["Achado"],
    poolRisks: [
      {
        poolId: "pool-1",
        poolName: "SOL/USDC",
        riskScore: 55,
        riskLevel: "medio",
        confidence: 0.7,
        headline: "Risco moderado",
        metrics: {
          totalEvents: 10,
          closeEvents: 4,
          openEvents: 4,
          rebalanceEvents: 2,
          winRatePct: 50,
          realizedPnlUsd: 10,
          feesUsd: 2,
          txFeesUsd: 0.5,
          hedgePnlUsd: 1,
          pnlTotalUsd: 11,
          pnlTotalNetUsd: 8.5,
          drawdownProxyPct: 18,
          volatilityProxyPct: 1.1,
          rebalancePerDay: 1.2,
          hedgeCoveragePct: 50,
          dataFreshnessHours: 1,
          dataQualityScore: 80
        }
      }
    ],
    recommendations: [
      {
        id: "rec-1",
        priority: 1,
        poolId: "pool-1",
        poolName: "SOL/USDC",
        parameter: "rangeWidthPct",
        currentValue: 1,
        suggestedValue: 1.15,
        rationale: "Reduzir ruido",
        expectedEffect: "Menor volatilidade",
        riskLevel: "low",
        confidence: 0.8
      }
    ],
    warnings: [],
    limitations: [],
    confidence: {
      score: 0.72,
      rationale: "Boa cobertura"
    }
  };
}

class StubAiService {
  allowCustomModel: boolean;
  analyses: Map<string, StrategyAnalysisResult>;
  threads: Map<string, AnalysisChatThread>;

  constructor(allowCustomModel: boolean) {
    this.allowCustomModel = allowCustomModel;
    this.analyses = new Map<string, StrategyAnalysisResult>([["analysis-1", createResult("analysis-1", "gpt-5.4-mini")]]);
    this.threads = new Map<string, AnalysisChatThread>([[
      "analysis-1",
      {
        analysisId: "analysis-1",
        createdAt: "2026-03-30T12:00:00.000Z",
        updatedAt: "2026-03-30T12:00:00.000Z",
        turns: []
      }
    ]]);
  }

  getModelSettings() {
    return {
      defaultModel: "gpt-5.4-mini",
      recommendedModels: ["gpt-5.4-mini", "gpt-5.4"],
      allowCustomModel: this.allowCustomModel
    };
  }

  listHistory() {
    return [{
      id: "analysis-1",
      createdAt: "2026-03-30T12:00:00.000Z",
      scope: "all",
      riskProfile: "defensivo",
      modelUsed: "gpt-5.4-mini",
      fallbackUsed: true,
      summary: "Resumo",
      poolCount: 1,
      recommendationCount: 1
    }];
  }

  getHistoryById(id: string) {
    return this.analyses.get(id) ?? null;
  }

  async runAnalysis(input: StrategyAnalysisRequest): Promise<StrategyAnalysisResult> {
    const model = input.model ?? "gpt-5.4-mini";
    if (model === "bad-model") {
      throw new StrategyModelError("invalid_model", "Modelo invalido.", "gpt-5.4-mini");
    }
    if (!this.allowCustomModel && model === "my-custom") {
      throw new StrategyModelError("invalid_model", "Modelo nao permitido.", "gpt-5.4-mini");
    }
    const id = input.model === "my-custom" ? "analysis-custom" : "analysis-new";
    const result = createResult(id, model);
    this.analyses.set(id, result);
    return result;
  }

  getChatThread(analysisId: string): AnalysisChatThread | null {
    if (!this.analyses.has(analysisId)) {
      return null;
    }
    return this.threads.get(analysisId) ?? {
      analysisId,
      createdAt: "2026-03-30T12:00:00.000Z",
      updatedAt: "2026-03-30T12:00:00.000Z",
      turns: []
    };
  }

  async sendChatMessage(input: AnalysisChatRequest): Promise<AnalysisChatThread> {
    const analysisId = String(input.analysisId ?? "").trim();
    if (!analysisId || !this.analyses.has(analysisId)) {
      throw new Error("Analysis not found");
    }
    const model = String(input.model ?? "gpt-5.4-mini");
    if (model === "bad-model") {
      throw new StrategyModelError("invalid_model", "Modelo invalido.", "gpt-5.4-mini");
    }
    const message = String(input.message ?? "").trim();
    const thread = this.threads.get(analysisId) ?? {
      analysisId,
      createdAt: "2026-03-30T12:00:00.000Z",
      updatedAt: "2026-03-30T12:00:00.000Z",
      turns: []
    };
    thread.turns.push({
      id: `t-${thread.turns.length + 1}`,
      analysisId,
      createdAt: "2026-03-30T12:05:00.000Z",
      role: "user",
      message,
      requestedModel: input.model ?? null,
      modelUsed: null,
      aiUsed: false,
      fallbackUsed: false,
      fallbackReason: null,
      responseTemplate: null
    });
    thread.turns.push({
      id: `t-${thread.turns.length + 1}`,
      analysisId,
      createdAt: "2026-03-30T12:05:01.000Z",
      role: "assistant",
      message: "Resposta",
      requestedModel: input.model ?? null,
      modelUsed: "gpt-5.4-mini",
      aiUsed: false,
      fallbackUsed: true,
      fallbackReason: "deterministico",
      responseTemplate: {
        whatToChange: ["Ajustar rangeWidthPct"],
        why: "Volatilidade elevada",
        risk: "Moderado",
        expectedImpact: "Menor oscilacao",
        safetyLimits: ["Mudar devagar"]
      }
    });
    thread.updatedAt = "2026-03-30T12:05:01.000Z";
    this.threads.set(analysisId, thread);
    return thread;
  }
}

async function createServer(allowCustomModel: boolean): Promise<ServerHandle> {
  const app = express();
  app.use(express.json());
  registerAiStrategyRoutes(app, new StubAiService(allowCustomModel) as any);

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

describe("ai-strategy routes", () => {
  it("returns models with custom enabled", async () => {
    const server = await createServer(true);
    const response = await fetch(`${server.baseUrl}/api/ai/models`);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.allowCustomModel).toBe(true);
    expect(Array.isArray(data.recommendedModels)).toBe(true);
  });

  it("returns models with custom disabled", async () => {
    const server = await createServer(false);
    const response = await fetch(`${server.baseUrl}/api/ai/models`);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.allowCustomModel).toBe(false);
  });

  it("accepts analysis with recommended and custom model; rejects invalid", async () => {
    const server = await createServer(true);

    const recommendedRes = await fetch(`${server.baseUrl}/api/ai/analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "all", model: "gpt-5.4-mini" })
    });
    const recommendedData = await recommendedRes.json();
    expect(recommendedRes.status).toBe(200);
    expect(recommendedData.ok).toBe(true);

    const customRes = await fetch(`${server.baseUrl}/api/ai/analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "all", model: "my-custom" })
    });
    const customData = await customRes.json();
    expect(customRes.status).toBe(200);
    expect(customData.ok).toBe(true);

    const invalidRes = await fetch(`${server.baseUrl}/api/ai/analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "all", model: "bad-model" })
    });
    const invalidData = await invalidRes.json();
    expect(invalidRes.status).toBe(400);
    expect(invalidData.code).toBe("invalid_model");
    expect(invalidData.suggestedModel).toBe("gpt-5.4-mini");
  });

  it("supports chat endpoints and validates analysis link", async () => {
    const server = await createServer(true);

    const getOk = await fetch(`${server.baseUrl}/api/ai/analysis/analysis-1/chat`);
    const getOkData = await getOk.json();
    expect(getOk.status).toBe(200);
    expect(getOkData.ok).toBe(true);

    const getMissing = await fetch(`${server.baseUrl}/api/ai/analysis/analysis-missing/chat`);
    expect(getMissing.status).toBe(404);

    const postOk = await fetch(`${server.baseUrl}/api/ai/analysis/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysisId: "analysis-1", message: "o que fazer", model: "gpt-5.4-mini" })
    });
    const postOkData = await postOk.json();
    expect(postOk.status).toBe(200);
    expect(postOkData.ok).toBe(true);
    expect(postOkData.thread.turns.length).toBeGreaterThan(0);

    const postMissing = await fetch(`${server.baseUrl}/api/ai/analysis/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysisId: "analysis-missing", message: "o que fazer" })
    });
    const postMissingData = await postMissing.json();
    expect(postMissing.status).toBe(400);
    expect(postMissingData.error).toContain("Analysis not found");
  });
});
