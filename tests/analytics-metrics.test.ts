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

  it("does not count Pago Emprestimo as realized pnl or fee yield", () => {
    const loanClose = {
      timestamp: "2026-04-05T12:00:00.000Z",
      action: "kamino-close",
      actionType: "fechamento-emprestimo",
      positionEntryUsd: 1000,
      positionExitUsd: 260,
      positionFeesUsd: 20,
      positionPnlUsd: 264,
      kaminoLoanPnlUsd: 264
    };

    const metrics = getHistoryEventMetrics(loanClose);
    expect(metrics.rawPnl).toBe(264);
    expect(metrics.pnl).toBeNull();
    expect(metrics.pnlTotal).toBeNull();
    expect(metrics.pnlTotalNet).toBeNull();
    expect(metrics.pnlOutlier).toBeNull();
    expect(metrics.fees).toBe(0);
    expect(metrics.entryUsd).toBeNull();

    const stats = summarizePerformance([loanClose]);
    expect(stats.closeCount).toBe(1);
    expect(stats.pnlUsd).toBeNull();
    expect(stats.totalFeesUsd).toBe(0);
    expect(stats.totalEntryUsd).toBe(0);
    expect(stats.feeYieldPct).toBeNull();
    expect(aggregatePerformance([loanClose], "day")).toEqual([]);
  });

  it("keeps Pago Emprestimo from inflating total pnl series when mixed with pool closes", () => {
    const items = [
      {
        timestamp: "2026-04-05T10:00:00.000Z",
        action: "close-position",
        positionEntryUsd: 100,
        positionExitUsd: 106,
        positionFeesUsd: 1,
        positionPnlUsd: 5
      },
      {
        timestamp: "2026-04-05T12:00:00.000Z",
        action: "kamino-close",
        actionType: "fechamento-emprestimo",
        positionEntryUsd: 1000,
        positionExitUsd: 260,
        positionFeesUsd: 20,
        positionPnlUsd: 264,
        kaminoLoanPnlUsd: 264
      }
    ];

    const stats = summarizePerformance(items);
    const [bucket] = aggregatePerformance(items, "day");

    expect(stats.closeCount).toBe(2);
    expect(stats.pnlUsd).toBe(5);
    expect(stats.totalFeesUsd).toBe(1);
    expect(stats.totalEntryUsd).toBe(100);
    expect(bucket.pnlTotal).toBe(5);
    expect(bucket.pnlTotalNet).toBe(4);
    expect(bucket.pnlCum).toBe(5);
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

  it("ignores realized pnl outliers above the position reference", () => {
    const item = {
      timestamp: "2026-04-05T12:00:00.000Z",
      action: "close-position",
      budgetUsd: 1.5,
      positionEntryUsd: 1.5,
      positionExitUsd: 1.6,
      positionFeesUsd: 0.01,
      positionPnlUsd: 264
    };

    const metrics = getHistoryEventMetrics(item);
    expect(metrics.rawPnl).toBe(264);
    expect(metrics.pnlOutlier).toBe(264);
    expect(metrics.pnl).toBeNull();

    const stats = summarizePerformance([item]);
    expect(stats.outlierCount).toBe(1);
    expect(stats.pnlUsd).toBeNull();

    const [bucket] = aggregatePerformance([item], "day");
    expect(bucket.fees).toBeCloseTo(0.01, 6);
    expect(bucket.pnl).toBeNull();
    expect(bucket.pnlTotal).toBeNull();
    expect(bucket.pnlCum).toBeNull();
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
