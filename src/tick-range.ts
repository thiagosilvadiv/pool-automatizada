export type TickRange = {
  lowerTick: number;
  upperTick: number;
};

export type DirectionalTickOptions = {
  preferredSide?: "lower" | "upper" | null;
  referenceTickIndex?: number | null;
};

function floorToSpacing(tickIndex: number, tickSpacing: number): number {
  return Math.floor(tickIndex / tickSpacing) * tickSpacing;
}

function ceilToSpacing(tickIndex: number, tickSpacing: number): number {
  return Math.ceil(tickIndex / tickSpacing) * tickSpacing;
}

export function alignTickRangeToSpacing(
  lowerIndex: number,
  upperIndex: number,
  tickSpacing: number,
  options?: DirectionalTickOptions
): TickRange {
  if (!Number.isFinite(lowerIndex) || !Number.isFinite(upperIndex)) {
    throw new Error("tick indexes must be finite");
  }
  if (!Number.isFinite(tickSpacing) || tickSpacing <= 0) {
    throw new Error("tickSpacing must be greater than zero");
  }

  let lowerTick = floorToSpacing(lowerIndex, tickSpacing);
  let upperTick = ceilToSpacing(upperIndex, tickSpacing);

  const referenceTickIndex = options?.referenceTickIndex;
  const preferredSide = options?.preferredSide;
  if (Number.isFinite(referenceTickIndex)) {
    const reference = Number(referenceTickIndex);
    if (preferredSide === "upper") {
      lowerTick = selectDirectionalLowerTick(lowerIndex, lowerTick, upperTick, tickSpacing, reference);
    } else if (preferredSide === "lower") {
      upperTick = selectDirectionalUpperTick(upperIndex, lowerTick, upperTick, tickSpacing, reference);
    }
  }

  if (lowerTick === upperTick) {
    upperTick = lowerTick + tickSpacing;
  }
  if (lowerTick > upperTick) {
    const temp = lowerTick;
    lowerTick = upperTick;
    upperTick = temp + tickSpacing;
  }

  return { lowerTick, upperTick };
}

function selectDirectionalLowerTick(
  lowerIndex: number,
  lowerFloor: number,
  upperTick: number,
  tickSpacing: number,
  referenceTickIndex: number
): number {
  const lowerCeil = ceilToSpacing(lowerIndex, tickSpacing);
  const candidates = Array.from(new Set([lowerFloor, lowerCeil]))
    .filter((candidate) => candidate < upperTick && candidate < referenceTickIndex);
  if (candidates.length === 0) {
    return lowerFloor;
  }
  const upTicks = upperTick - referenceTickIndex;
  return candidates.reduce((best, candidate) => {
    const downTicks = referenceTickIndex - candidate;
    const violation = Math.max(0, downTicks - upTicks);
    const score = violation * 10_000 + Math.abs(candidate - lowerIndex);
    const bestDown = referenceTickIndex - best;
    const bestViolation = Math.max(0, bestDown - upTicks);
    const bestScore = bestViolation * 10_000 + Math.abs(best - lowerIndex);
    return score < bestScore ? candidate : best;
  }, candidates[0]);
}

function selectDirectionalUpperTick(
  upperIndex: number,
  lowerTick: number,
  upperCeil: number,
  tickSpacing: number,
  referenceTickIndex: number
): number {
  const upperFloor = floorToSpacing(upperIndex, tickSpacing);
  const candidates = Array.from(new Set([upperFloor, upperCeil]))
    .filter((candidate) => candidate > lowerTick && candidate > referenceTickIndex);
  if (candidates.length === 0) {
    return upperCeil;
  }
  const downTicks = referenceTickIndex - lowerTick;
  return candidates.reduce((best, candidate) => {
    const upTicks = candidate - referenceTickIndex;
    const violation = Math.max(0, upTicks - downTicks);
    const score = violation * 10_000 + Math.abs(candidate - upperIndex);
    const bestUp = best - referenceTickIndex;
    const bestViolation = Math.max(0, bestUp - downTicks);
    const bestScore = bestViolation * 10_000 + Math.abs(best - upperIndex);
    return score < bestScore ? candidate : best;
  }, candidates[0]);
}
