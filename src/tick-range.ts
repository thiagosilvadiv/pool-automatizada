export type TickRange = {
  lowerTick: number;
  upperTick: number;
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
  tickSpacing: number
): TickRange {
  if (!Number.isFinite(lowerIndex) || !Number.isFinite(upperIndex)) {
    throw new Error("tick indexes must be finite");
  }
  if (!Number.isFinite(tickSpacing) || tickSpacing <= 0) {
    throw new Error("tickSpacing must be greater than zero");
  }

  let lowerTick = floorToSpacing(lowerIndex, tickSpacing);
  let upperTick = ceilToSpacing(upperIndex, tickSpacing);

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

