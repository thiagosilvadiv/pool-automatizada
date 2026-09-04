import { describe, expect, it } from "vitest";
import {
  bucketSnapshots,
  compactSnapshots,
  filterSnapshots,
  isSnapshotBucket,
  normalizeSnapshots,
  type PoolSnapshot
} from "../src/snapshots.js";

const MINUTE = 60_000;

function point(t: number, overrides: Partial<PoolSnapshot> = {}): PoolSnapshot {
  return {
    t,
    price: 1,
    solUsd: 100,
    posValueUsd: 10,
    posPnlUsd: 0,
    posEntryUsd: 10,
    posFeesUsd: 0,
    portfolioUsd: 10,
    pnlUsd: 0,
    posValueSol: 0.1,
    posPnlSol: 0,
    rangeLower: 0.9,
    rangeUpper: 1.1,
    posLower: 0.9,
    posUpper: 1.1,
    kCollatUsd: null,
    kDebtUsd: null,
    kLtv: null,
    running: 1,
    inRange: 1,
    posMint: "mint-1",
    ...overrides
  };
}

describe("normalizeSnapshots", () => {
  it("ordena por tempo e descarta pontos sem timestamp", () => {
    const result = normalizeSnapshots([
      point(3000),
      { ...point(0), t: Number.NaN },
      point(1000),
      null
    ]);
    expect(result.map((p) => p.t)).toEqual([1000, 3000]);
  });

  it("devolve lista vazia para entrada invalida", () => {
    expect(normalizeSnapshots(null)).toEqual([]);
    expect(normalizeSnapshots({})).toEqual([]);
  });
});

describe("filterSnapshots", () => {
  const points = [point(1000), point(2000), point(3000)];

  it("filtra por from/to inclusivo", () => {
    expect(filterSnapshots(points, 2000, 3000).map((p) => p.t)).toEqual([2000, 3000]);
    expect(filterSnapshots(points, null, 1000).map((p) => p.t)).toEqual([1000]);
  });

  it("devolve tudo quando nao ha limites", () => {
    expect(filterSnapshots(points, null, null)).toHaveLength(3);
  });
});

describe("bucketSnapshots", () => {
  it("nao altera nada no modo raw", () => {
    const points = [point(0), point(MINUTE)];
    expect(bucketSnapshots(points, "raw")).toBe(points);
  });

  it("agrega valores instantaneos pela media", () => {
    const points = [
      point(0, { price: 10, posValueUsd: 100 }),
      point(MINUTE, { price: 20, posValueUsd: 200 }),
      point(6 * MINUTE, { price: 30, posValueUsd: 300 })
    ];
    const result = bucketSnapshots(points, "5m");
    expect(result).toHaveLength(2);
    expect(result[0].t).toBe(0);
    expect(result[0].price).toBe(15);
    expect(result[0].posValueUsd).toBe(150);
    expect(result[1].price).toBe(30);
  });

  it("usa o ultimo valor para acumulados e flags, nunca a media", () => {
    const points = [
      point(0, { posFeesUsd: 1, inRange: 1, running: 1, posMint: "a" }),
      point(MINUTE, { posFeesUsd: 4, inRange: 0, running: 0, posMint: "b" })
    ];
    const [merged] = bucketSnapshots(points, "5m");
    // Media daria 2.5 e faria o acumulado "andar para tras".
    expect(merged.posFeesUsd).toBe(4);
    expect(merged.inRange).toBe(0);
    expect(merged.running).toBe(0);
    expect(merged.posMint).toBe("b");
  });

  it("ignora nulos ao calcular a media", () => {
    const points = [point(0, { price: null }), point(MINUTE, { price: 8 })];
    expect(bucketSnapshots(points, "5m")[0].price).toBe(8);
  });

  it("devolve null quando o bucket inteiro e nulo", () => {
    const points = [point(0, { kLtv: null }), point(MINUTE, { kLtv: null })];
    expect(bucketSnapshots(points, "5m")[0].kLtv).toBeNull();
  });
});

describe("compactSnapshots", () => {
  const series = Array.from({ length: 100 }, (_, i) => point(i * MINUTE));

  it("nao mexe quando esta abaixo do limite", () => {
    expect(compactSnapshots(series, 200)).toBe(series);
  });

  it("respeita o limite ao rarear", () => {
    const result = compactSnapshots(series, 60);
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it("preserva o inicio e o fim da serie", () => {
    const result = compactSnapshots(series, 60);
    expect(result[0].t).toBe(series[0].t);
    expect(result[result.length - 1].t).toBe(series[series.length - 1].t);
  });

  it("mantem intacta a metade recente do orcamento", () => {
    const maxPoints = 60;
    const result = compactSnapshots(series, maxPoints);
    // A garantia e sobre os ultimos maxPoints/2 pontos, nao sobre metade da
    // entrada: e essa janela que fica com resolucao total.
    const recent = series.slice(series.length - maxPoints / 2).map((p) => p.t);
    const resultTimes = result.map((p) => p.t);
    for (const t of recent) {
      expect(resultTimes).toContain(t);
    }
  });

  it("corta a cauda antiga quando downsample esta desligado", () => {
    const result = compactSnapshots(series, 10, false);
    expect(result).toHaveLength(10);
    expect(result[0].t).toBe(series[90].t);
  });

  it("trata limite zero ou invalido como sem limite", () => {
    expect(compactSnapshots(series, 0)).toBe(series);
    expect(compactSnapshots(series, Number.NaN)).toBe(series);
  });

  it("mantem os pontos ordenados", () => {
    const result = compactSnapshots(series, 30);
    const times = result.map((p) => p.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe("isSnapshotBucket", () => {
  it("aceita apenas os buckets conhecidos", () => {
    expect(isSnapshotBucket("15m")).toBe(true);
    expect(isSnapshotBucket("raw")).toBe(true);
    expect(isSnapshotBucket("7m")).toBe(false);
    expect(isSnapshotBucket(null)).toBe(false);
  });
});
