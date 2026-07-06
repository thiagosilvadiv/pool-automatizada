const MAX_USD_SANITY = 1_000_000_000;
const PNL_MAX_FACTOR = 3;
const PNL_MAX_FALLBACK = 1_000_000;

export function finiteOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getPnlReferenceUsd(item, entryUsd, exitUsd) {
  const budgetUsd = finiteOrNull(item?.budgetUsd);
  return Math.max(entryUsd ?? 0, exitUsd ?? 0, budgetUsd ?? 0) || null;
}

function isPnlMagnitudeSane(value, item, entryUsd, exitUsd) {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_USD_SANITY) {
    return false;
  }
  const reference = getPnlReferenceUsd(item, entryUsd, exitUsd);
  const abs = Math.abs(value);
  if (reference != null && reference > 0) {
    return abs <= reference * PNL_MAX_FACTOR;
  }
  return abs <= PNL_MAX_FALLBACK;
}

export function isLoanCloseEvent(item) {
  return item?.action === "kamino-close" || item?.actionType === "fechamento-emprestimo";
}

export function isPerformanceCloseEvent(item) {
  return item?.action === "close-position" || isLoanCloseEvent(item);
}

export function getHistoryEventMetrics(item) {
  const isLoanClose = isLoanCloseEvent(item);
  const fees = isLoanClose ? 0 : finiteOrNull(item?.positionFeesUsd) ?? 0;
  const entryUsd = isLoanClose ? null : finiteOrNull(item?.positionEntryUsd);
  const exitUsd = isLoanClose ? null : finiteOrNull(item?.positionExitUsd);
  const rawPnlUsd = isLoanClose
    ? (finiteOrNull(item?.kaminoLoanPnlUsd) ?? finiteOrNull(item?.positionPnlUsd))
    : finiteOrNull(item?.positionPnlUsd);
  const realizedPnlUsd = !isLoanClose && rawPnlUsd != null && isPnlMagnitudeSane(rawPnlUsd, item, entryUsd, exitUsd)
    ? rawPnlUsd
    : null;
  const solUsdPrice = finiteOrNull(item?.solUsdPrice);
  const pnlSol = realizedPnlUsd != null && solUsdPrice != null && solUsdPrice > 0
    ? realizedPnlUsd / solUsdPrice
    : null;
  const pnlNet = realizedPnlUsd != null ? realizedPnlUsd - fees : null;

  return {
    isLoanClose,
    fees,
    entryUsd,
    exitUsd,
    rawPnl: rawPnlUsd,
    pnlOutlier: !isLoanClose && rawPnlUsd != null && realizedPnlUsd == null ? rawPnlUsd : null,
    pnl: realizedPnlUsd,
    pnlSol,
    pnlNet,
    pnlTotal: realizedPnlUsd,
    pnlTotalNet: pnlNet
  };
}

export function getPerfPeriodDays(items, range = {}) {
  const start = range.start ? new Date(range.start) : null;
  const end = range.end ? new Date(range.end) : null;
  let diffMs = null;
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    diffMs = end.getTime() - start.getTime();
  }
  if (!(diffMs > 0)) {
    const times = (items || []).map((item) => Date.parse(item?.timestamp ?? "")).filter(Number.isFinite);
    if (times.length >= 2) {
      diffMs = Math.max(...times) - Math.min(...times);
    }
  }
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 1;
  return Math.max(1, diffMs / (24 * 60 * 60 * 1000));
}

export function summarizePerformance(items, range = {}) {
  const closeItems = Array.isArray(items)
    ? items.filter((item) => isPerformanceCloseEvent(item))
    : [];
  let totalFeesUsd = 0;
  let totalEntryUsd = 0;
  let pnlUsd = 0;
  let pnlUsdCount = 0;
  let pnlSol = 0;
  let pnlSolCount = 0;
  let outlierCount = 0;

  closeItems.forEach((item) => {
    const metrics = getHistoryEventMetrics(item);
    totalFeesUsd += metrics.fees;
    if (metrics.entryUsd != null && metrics.entryUsd > 0) {
      totalEntryUsd += metrics.entryUsd;
    }
    if (metrics.pnlOutlier != null) {
      outlierCount += 1;
    }
    if (metrics.pnl != null) {
      pnlUsd += metrics.pnl;
      pnlUsdCount += 1;
    }
    if (metrics.pnlSol != null) {
      pnlSol += metrics.pnlSol;
      pnlSolCount += 1;
    }
  });

  const feeYieldPct = totalEntryUsd > 0 ? (totalFeesUsd / totalEntryUsd) * 100 : null;
  const periodDays = getPerfPeriodDays(closeItems, range);

  return {
    closeItems,
    closeCount: closeItems.length,
    outlierCount,
    totalFeesUsd,
    totalEntryUsd,
    feeYieldPct,
    dailyFeeYieldPct: feeYieldPct != null ? feeYieldPct / periodDays : null,
    pnlUsd: pnlUsdCount > 0 ? pnlUsd : null,
    pnlSol: pnlSolCount > 0 ? pnlSol : null
  };
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfWeek(date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + diff);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function labelForBucket(date, group) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  if (group === "week") {
    return `Sem ${day}/${month}`;
  }
  if (group === "month") {
    return `${month}/${year}`;
  }
  return `${day}/${month}`;
}

export function getPerfBucketKey(date, group) {
  const d = group === "month" ? startOfMonth(date)
    : group === "week" ? startOfWeek(date)
      : startOfDay(date);
  return d.toISOString();
}

export function aggregatePerformance(items, group) {
  const buckets = new Map();
  items.forEach((item) => {
    if (!isPerformanceCloseEvent(item)) return;
    if (!item?.timestamp) return;
    const date = new Date(item.timestamp);
    if (Number.isNaN(date.getTime())) return;
    const key = getPerfBucketKey(date, group);
    const bucket = buckets.get(key) ?? {
      date: group === "month" ? startOfMonth(date)
        : group === "week" ? startOfWeek(date)
          : startOfDay(date),
      entrySum: 0,
      fees: 0,
      pnl: 0,
      pnlCount: 0,
      pnlNet: 0,
      pnlNetCount: 0,
      pnlTotal: 0,
      pnlTotalCount: 0,
      pnlTotalNet: 0,
      pnlTotalNetCount: 0
    };
    const metrics = getHistoryEventMetrics(item);
    const hasAnyMetric = metrics.pnl != null
      || metrics.pnlNet != null
      || metrics.pnlTotal != null
      || metrics.pnlTotalNet != null
      || metrics.fees !== 0;
    if (!hasAnyMetric) {
      return;
    }
    bucket.fees += metrics.fees;
    if (metrics.entryUsd != null && metrics.entryUsd > 0) {
      bucket.entrySum += metrics.entryUsd;
    }
    if (metrics.pnl != null) {
      bucket.pnl += metrics.pnl;
      bucket.pnlCount += 1;
    }
    if (metrics.pnlNet != null) {
      bucket.pnlNet += metrics.pnlNet;
      bucket.pnlNetCount += 1;
    }
    if (metrics.pnlTotal != null) {
      bucket.pnlTotal += metrics.pnlTotal;
      bucket.pnlTotalCount += 1;
    }
    if (metrics.pnlTotalNet != null) {
      bucket.pnlTotalNet += metrics.pnlTotalNet;
      bucket.pnlTotalNetCount += 1;
    }
    buckets.set(key, bucket);
  });
  const series = Array.from(buckets.values()).sort((a, b) => a.date - b.date);
  let runningPnl = 0;
  let hasRunningPnl = false;
  let runningNet = 0;
  let hasRunningNet = false;
  let runningFees = 0;
  return series.map((entry) => {
    if (entry.pnlCount > 0) {
      runningPnl += entry.pnl;
      hasRunningPnl = true;
    }
    if (entry.pnlNetCount > 0) {
      runningNet += entry.pnlNet;
      hasRunningNet = true;
    }
    runningFees += entry.fees;
    return {
      label: labelForBucket(entry.date, group),
      fees: entry.fees,
      feeYieldPct: entry.entrySum > 0 ? (entry.fees / entry.entrySum) * 100 : null,
      pnl: entry.pnlCount > 0 ? entry.pnl : null,
      pnlNet: entry.pnlNetCount > 0 ? entry.pnlNet : null,
      pnlTotal: entry.pnlTotalCount > 0 ? entry.pnlTotal : null,
      pnlTotalNet: entry.pnlTotalNetCount > 0 ? entry.pnlTotalNet : null,
      feesCum: runningFees,
      pnlCum: hasRunningPnl ? runningPnl : null,
      pnlNetCum: hasRunningNet ? runningNet : null
    };
  });
}

export function isPercentMetric(key) {
  return key === "feeYieldPct";
}

export function selectDrawableMetrics(activeMetrics) {
  const metrics = Array.isArray(activeMetrics) ? activeMetrics : [];
  const hasPercent = metrics.some((key) => isPercentMetric(key));
  const hasNonPercent = metrics.some((key) => !isPercentMetric(key));
  if (hasPercent && hasNonPercent) {
    return {
      metrics: metrics.filter((key) => !isPercentMetric(key)),
      skipped: metrics.filter((key) => isPercentMetric(key)),
      reason: "mixed-units"
    };
  }
  return {
    metrics,
    skipped: [],
    reason: null
  };
}
