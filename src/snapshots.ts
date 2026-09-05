/**
 * Serie temporal por pool.
 *
 * O historico (`HistoryEvent`) grava eventos discretos: abriu, fechou, pagou
 * emprestimo. Isso responde "o que aconteceu", mas nao responde "como o valor
 * da posicao evoluiu entre dois eventos". Os snapshots preenchem essa lacuna:
 * uma amostra periodica e barata do estado ja em memoria do runner.
 *
 * Tudo aqui e puro (sem I/O) para ficar testavel sem PoolManager.
 */

/** Uma amostra. Campos numericos e curtos: o arquivo e reescrito com frequencia. */
export type PoolSnapshot = {
  /** epoch ms */
  t: number;
  price: number | null;
  solUsd: number | null;
  posValueUsd: number | null;
  posPnlUsd: number | null;
  posEntryUsd: number | null;
  posFeesUsd: number | null;
  portfolioUsd: number | null;
  pnlUsd: number | null;
  posValueSol: number | null;
  posPnlSol: number | null;
  rangeLower: number | null;
  rangeUpper: number | null;
  posLower: number | null;
  posUpper: number | null;
  kCollatUsd: number | null;
  kDebtUsd: number | null;
  kLtv: number | null;
  running: 0 | 1;
  inRange: 0 | 1 | null;
  /**
   * Unico campo textual. Sem ele nao da para saber que a posicao foi fechada e
   * reaberta, e a curva de taxas (que zera a cada posicao) vira dente de serra.
   */
  posMint: string | null;
};

export type SnapshotBucket = "raw" | "5m" | "15m" | "1h" | "1d";

export const SNAPSHOT_BUCKETS: SnapshotBucket[] = ["raw", "5m", "15m", "1h", "1d"];

const BUCKET_MS: Record<Exclude<SnapshotBucket, "raw">, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000
};

export function isSnapshotBucket(value: unknown): value is SnapshotBucket {
  return typeof value === "string" && (SNAPSHOT_BUCKETS as string[]).includes(value);
}

/** Campos agregados por media dentro do bucket. */
const MEAN_FIELDS = [
  "price",
  "solUsd",
  "posValueUsd",
  "posPnlUsd",
  "posEntryUsd",
  "portfolioUsd",
  "pnlUsd",
  "posValueSol",
  "posPnlSol",
  "kCollatUsd",
  "kDebtUsd",
  "kLtv"
] as const;

/**
 * Campos que sao acumulados dentro da posicao: agregamos pelo ultimo valor do
 * bucket, nunca pela media, senao o acumulado "anda para tras".
 */
const LAST_FIELDS = [
  "posFeesUsd",
  "rangeLower",
  "rangeUpper",
  "posLower",
  "posUpper",
  "inRange",
  "running",
  "posMint"
] as const;

function meanOf(values: Array<number | null>): number | null {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  }
  return count ? sum / count : null;
}

function lastOf<T>(values: Array<T | null>): T | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] != null) {
      return values[i];
    }
  }
  return null;
}

/** Ordena por tempo e descarta amostras sem timestamp valido. */
export function normalizeSnapshots(points: unknown): PoolSnapshot[] {
  if (!Array.isArray(points)) {
    return [];
  }
  return (points as PoolSnapshot[])
    .filter((p) => p && typeof p.t === "number" && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}

export function filterSnapshots(
  points: PoolSnapshot[],
  from?: number | null,
  to?: number | null
): PoolSnapshot[] {
  const min = typeof from === "number" && Number.isFinite(from) ? from : null;
  const max = typeof to === "number" && Number.isFinite(to) ? to : null;
  if (min == null && max == null) {
    return points;
  }
  return points.filter((p) => (min == null || p.t >= min) && (max == null || p.t <= max));
}

/**
 * Agrega em janelas fixas. Media para valores instantaneos, ultimo valor para
 * acumulados e flags. O `t` do bucket e o inicio da janela.
 */
export function bucketSnapshots(points: PoolSnapshot[], bucket: SnapshotBucket): PoolSnapshot[] {
  if (bucket === "raw" || points.length === 0) {
    return points;
  }
  const size = BUCKET_MS[bucket];
  const groups = new Map<number, PoolSnapshot[]>();
  for (const point of points) {
    const key = Math.floor(point.t / size) * size;
    const group = groups.get(key);
    if (group) {
      group.push(point);
    } else {
      groups.set(key, [point]);
    }
  }
  const keys = [...groups.keys()].sort((a, b) => a - b);
  return keys.map((key) => {
    const group = groups.get(key) as PoolSnapshot[];
    const merged: PoolSnapshot = { ...group[group.length - 1], t: key };
    for (const field of MEAN_FIELDS) {
      merged[field] = meanOf(group.map((p) => p[field]));
    }
    for (const field of LAST_FIELDS) {
      (merged as Record<string, unknown>)[field] = lastOf(
        group.map((p) => p[field] as unknown as null)
      );
    }
    return merged;
  });
}

/**
 * Retencao. Ao estourar o limite, em vez de cortar a cauda antiga (que apagaria
 * o inicio da serie), rareia a metade mais antiga mantendo um ponto a cada dois.
 * O resultado e detalhe fino no recente e um rastro grosseiro no passado.
 */
export function compactSnapshots(
  points: PoolSnapshot[],
  maxPoints: number,
  downsample = true
): PoolSnapshot[] {
  if (!Number.isFinite(maxPoints) || maxPoints <= 0 || points.length <= maxPoints) {
    return points;
  }
  if (!downsample) {
    return points.slice(points.length - maxPoints);
  }
  // A metade mais recente do orcamento fica intacta, sempre. So a regiao antiga
  // e rareada, mantendo um ponto a cada dois ate caber — o primeiro ponto da
  // serie sobrevive a todas as passadas porque esta sempre no indice par.
  const keepRecent = Math.max(1, Math.floor(maxPoints / 2));
  const recent = points.slice(points.length - keepRecent);
  let older = points.slice(0, points.length - keepRecent);
  while (older.length + recent.length > maxPoints && older.length > 1) {
    older = older.filter((_, index) => index % 2 === 0);
  }
  const result = [...older, ...recent];
  return result.length > maxPoints ? result.slice(result.length - maxPoints) : result;
}

/**
 * Ultima amostra da serie, quando ela ainda descreve uma posicao aberta.
 *
 * Vale sempre o ponto final: `sampleSnapshots` grava uma amostra logo apos a
 * pool parar, entao uma posicao ja fechada termina a serie com valores nulos.
 * Sem essa guarda, uma pool parada ressuscitaria a ultima posicao que teve.
 *
 * Com `maxAgeMs`, tambem descarta amostra antiga demais para representar o
 * estado atual.
 */
export function lastOpenPositionSnapshot(
  points: PoolSnapshot[],
  options: { now?: number; maxAgeMs?: number } = {}
): PoolSnapshot | null {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }
  const last = points[points.length - 1];
  if (!last) {
    return null;
  }
  const hasValue = typeof last.posValueUsd === "number" && Number.isFinite(last.posValueUsd) && last.posValueUsd > 0;
  const hasEntry = typeof last.posEntryUsd === "number" && Number.isFinite(last.posEntryUsd) && last.posEntryUsd > 0;
  if (!hasValue && !hasEntry) {
    return null;
  }
  // Amostra velha nao e evidencia de posicao viva: enquanto o bot roda a serie
  // ganha um ponto a cada intervalo, entao um ultimo ponto antigo significa que
  // faz tempo que ninguem observa essa pool — e nao que a posicao segue aberta.
  const maxAgeMs = options.maxAgeMs;
  if (typeof maxAgeMs === "number" && Number.isFinite(maxAgeMs)) {
    const now = options.now ?? Date.now();
    if (now - last.t > maxAgeMs) {
      return null;
    }
  }
  return last;
}

/**
 * Desde quando a posicao atual esta aberta, em epoch ms, lendo a serie de tras
 * para frente ate o `posMint` mudar. Serve para pools cujo runner nao esta vivo
 * — quem esta rodando ja tem `positionOpenedAt` no proprio status.
 *
 * Devolve `null` quando a serie nao registra mint (amostras antigas) ou quando
 * a posicao ja comecara antes do primeiro ponto guardado, porque nesse caso o
 * inicio real e desconhecido e chutar o comeco da serie mentiria a idade.
 */
export function positionOpenedAtFromSnapshots(points: PoolSnapshot[]): number | null {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }
  const mint = points[points.length - 1]?.posMint ?? null;
  if (!mint) {
    return null;
  }
  let index = points.length - 1;
  while (index > 0 && points[index - 1]?.posMint === mint) {
    index -= 1;
  }
  if (index === 0) {
    return null;
  }
  const start = points[index];
  return typeof start?.t === "number" && Number.isFinite(start.t) ? start.t : null;
}
