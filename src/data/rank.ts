// Ranking helpers shared by the pulse view and country briefs: rank badges ("#3 of 75") and "vs the average" lines.

export interface Rank { rank: number; of: number; percentile: number }

/** Ranks items by value, highest first; equal values share a rank; items without a value are left out. */
export function rankBy<T extends { id: string }>(items: T[], value: (x: T) => number | null | undefined): Map<string, Rank> {
  const scored = items.map((x) => [x.id, value(x)] as const).filter((p): p is readonly [string, number] => typeof p[1] === 'number' && Number.isFinite(p[1]));
  scored.sort((a, b) => b[1] - a[1]);
  const of = scored.length;
  const out = new Map<string, Rank>();
  let rank = 0;
  scored.forEach(([id, v], i) => {
    if (i === 0 || v !== scored[i - 1]![1]) rank = i + 1;
    out.set(id, { rank, of, percentile: of > 1 ? Math.round(((of - rank) / (of - 1)) * 100) : 100 });
  });
  return out;
}

/** Signed % difference of v from the mean of values (rounded); null when there is nothing to compare with. */
export function vsAverage(v: number, values: number[]): number | null {
  const ok = values.filter((x) => Number.isFinite(x));
  if (!ok.length) return null;
  const mean = ok.reduce((s, x) => s + x, 0) / ok.length;
  return mean ? Math.round(((v - mean) / mean) * 100) : null;
}
