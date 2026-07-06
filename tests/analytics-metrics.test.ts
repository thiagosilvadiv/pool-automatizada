import { describe, expect, it } from "vitest";

import {
  aggregatePerformance,
  getHistoryEventMetrics,
  selectDrawableMetrics,
  summarizePerformance
} from "../public/analytics-metrics.js";

describe("analytics report metrics", () => {
  it("uses close-position realized pnl from history without recalculating it", () => {
    const metrics = getHistoryEventMetrics({
      action: "close-position",
      positionEntryUsd: 100,
      positionExitUsd: 112,
      positionFeesUsd: 2,
      txFeeUsd: 0.1,
      positionPnlUsd: 11.9,
      solUsdPrice: 100
    });

    expect(metrics.pnl).toBe(11.9);
    expect(metrics.pnlNet).toBe(9.9);
    expect(metrics.pnlSol).toBeCloseTo(0.119, 6);
  });

  it("uses kaminoLoanPnlUsd for loan close instead of net exit minus entry", () => {
    const metrics = getHistoryEventMetrics({
      action: "kamino-close",
      actionType: "fechamento-emprestimo",
      positionEntryUsd: 100,
      positionExitUsd: 51.5,
      positionFeesUsd: 0,
      positionPnlUsd: 1.4,
      kaminoLoanPnlUsd: 1.4,
      kaminoDebtUsd: 50,
      kaminoCollateralUsd: 101.5
    });

    expect(metrics.pnl).toBeCloseTo(1.4, 6);
    expect(metrics.pnlTotal).toBeCloseTo(1.4, 6);
    expect(metrics.pnl).not.toBeCloseTo(-48.5, 6);
  });

  it("computes fee yield from total fees divided by total valid entry", () => {
    const items = [
      {
        timestamp: "2026-04-01T12:00:00.000Z",
        action: "close-position",
        positionEntryUsd: 100,
        positionFeesUsd: 1,
        positionPnlUsd: 5
      },
      {
        timestamp: "2026-04-01T15:00:00.000Z",
        action: "close-position",
        positionEntryUsd: 100,
        positionFeesUsd: 1,
        positionPnlUsd: 3
      }
    ];

    const stats = summarizePerformance(items, {
      start: "2026-04-01T00:00:00.000Z",
      end: "2026-04-03T00:00:00.000Z"
    });
    const [bucket] = aggregatePerformance(items, "day");

    expect(stats.totalFeesUsd).toBe(2);
    expect(stats.totalEntryUsd).toBe(200);
    expect(stats.feeYieldPct).toBeCloseTo(1, 6);
    expect(stats.dailyFeeYieldPct).toBeCloseTo(0.5, 6);
    expect(bucket.feeYieldPct).toBeCloseTo(1, 6);
  });

  it("returns null pnl and yield when there are no realized close events", () => {
    const stats = summarizePerformance([
      { action: "open-position", positionEntryUsd: 100, positionPnlUsd: 20 }
    ]);

    expect(stats.closeCount).toBe(0);
    expect(stats.pnlUsd).toBeNull();
    expect(stats.feeYieldPct).toBeNull();
    expect(aggregatePerformance([], "day")).toEqual([]);
  });

  it("keeps percent metrics separate from USD chart metrics", () => {
    expect(selectDrawableMetrics(["feeYieldPct"])).toEqual({
      metrics: ["feeYieldPct"],
      skipped: [],
      reason: null
    });
    expect(selectDrawableMetrics(["pnl", "feeYieldPct", "fees"])).toEqual({
      metrics: ["pnl", "fees"],
      skipped: ["feeYieldPct"],
      reason: "mixed-units"
    });
  });
});
