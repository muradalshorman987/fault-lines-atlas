// Country KPIs, rankings and "what stands out" for the Brief tab. Pure functions over the model.
// The figures themselves (popOf, gdpOf, …) live in src/data/shown.ts, shared with the Compare view.

import { displacedOf, gdpOf, gdpPerCapOf, popOf, sourceOf, figureMd, type Shown } from '../../../data/shown';
import { rankBy, vsAverage, type Rank } from '../../../data/rank';
import type { Country, DB } from '../../../data/types';
import type { ChokeX } from '../model';

export { displacedOf, gdpOf, gdpPerCapOf, popOf, sourceOf, figureMd, type Shown };

const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

// ---- KPIs and their ranks

export const KPIS = ['pop', 'gdppc', 'diversity', 'conflicts', 'displaced'] as const;
export type KpiId = (typeof KPIS)[number];

/** Conflicts a state is involved in, as a party or an external power. */
export const involvement = (c: Country) => new Set([...c.conflicts, ...c.external]).size;

export function kpiValue(db: DB, id: KpiId, c: Country): number | null {
  switch (id) {
    case 'pop': return popOf(db, c)?.value ?? null;
    case 'gdppc': return gdpPerCapOf(db, c)?.value ?? null;
    case 'diversity': return c.religion?.diversity ?? null;
    case 'conflicts': return involvement(c) || null; // states with no tracked conflict are not ranked
    case 'displaced': return displacedOf(db, c)?.value ?? null;
  }
}

interface Table { world: Map<string, Rank>; region: Map<string, Map<string, Rank>>; values: Map<string, number> }
const cache = new WeakMap<DB, Map<KpiId, Table>>();

function table(db: DB, id: KpiId): Table {
  let byKpi = cache.get(db);
  if (!byKpi) cache.set(db, (byKpi = new Map()));
  const hit = byKpi.get(id);
  if (hit) return hit;
  const all = [...db.countries.values()].map((c) => ({ id: c.iso3, c, v: kpiValue(db, id, c) }));
  const value = (x: { v: number | null }) => x.v;
  const subs = new Map<string, typeof all>();
  for (const x of all) if (x.c.subregion) subs.set(x.c.subregion, [...(subs.get(x.c.subregion) ?? []), x]);
  const t: Table = {
    world: rankBy(all, value),
    region: new Map([...subs].map(([s, xs]) => [s, rankBy(xs, value)])),
    values: new Map(all.filter((x) => ok(x.v)).map((x) => [x.id, x.v!])),
  };
  byKpi.set(id, t);
  return t;
}

/** "#n of N" in the world and in the state's subregion (missing when the state has no value). */
export function rankOf(db: DB, id: KpiId, c: Country): { world?: Rank; region?: Rank } {
  const t = table(db, id);
  return { world: t.world.get(c.iso3), region: c.subregion ? t.region.get(c.subregion)?.get(c.iso3) : undefined };
}

/** Signed % difference from the world and the subregion averages; the subregion needs at least two values. */
export function benchOf(db: DB, id: KpiId, c: Country): { value: number; world: number | null; region: number | null } | null {
  const t = table(db, id);
  const v = t.values.get(c.iso3);
  if (v == null) return null;
  const peers = [...db.countries.values()].filter((x) => x.subregion && x.subregion === c.subregion && t.values.has(x.iso3)).map((x) => t.values.get(x.iso3)!);
  return { value: v, world: vsAverage(v, [...t.values.values()]), region: peers.length > 1 ? vsAverage(v, peers) : null };
}

// ---- "What stands out": data rules in priority order; the brief shows the first four that apply.

export type Standout =
  | { rule: 'war' | 'armed'; ids: string[] }
  | { rule: 'external'; n: number; ids: string[] }
  | { rule: 'choke'; status: 'crisis' | 'elevated'; ids: string[] }
  | { rule: 'top'; kpi: 'diversity' | 'pop' | 'gdppc'; sub: string }
  | { rule: 'displaced'; rank: Rank }
  | { rule: 'blocs'; ids: string[] }
  | { rule: 'popRank'; rank: Rank };

export const MAX_STANDOUTS = 4;
const REGION_MIN = 3; // "most … in its subregion" only means something among three or more states

export function standouts(db: DB, c: Country): Standout[] {
  const out: Standout[] = [];
  const conflict = (id: string) => db.conflictById.get(id);
  const byRank = (a: string, b: string) => (conflict(b)?.rank ?? 0) - (conflict(a)?.rank ?? 0);
  const party = c.conflicts.filter((id) => conflict(id)).sort(byRank);
  const wars = party.filter((id) => conflict(id)!.severity === 'war');
  const armed = party.filter((id) => conflict(id)!.severity === 'armed-conflict');
  if (wars.length) out.push({ rule: 'war', ids: wars });
  else if (armed.length) out.push({ rule: 'armed', ids: armed });

  // external roles in conflicts it is not already a direct party to (the war line names those)
  const ext = [...new Set(c.external)].filter((id) => conflict(id) && !c.conflicts.includes(id)).sort(byRank);
  if (ext.length) out.push({ rule: 'external', n: ext.length, ids: ext });

  const chokes = c.chokepoints.map((id) => db.chokeById.get(id) as ChokeX | undefined);
  for (const status of ['crisis', 'elevated'] as const) {
    const ids = chokes.filter((p) => p?.status === status).map((p) => p!.id);
    if (ids.length) { out.push({ rule: 'choke', status, ids }); break; }
  }

  for (const kpi of ['diversity', 'pop', 'gdppc'] as const) {
    const r = rankOf(db, kpi, c).region;
    if (r && r.rank === 1 && r.of >= REGION_MIN && c.subregion) out.push({ rule: 'top', kpi, sub: c.subregion });
  }

  const dr = rankOf(db, 'displaced', c).world;
  if (dr && dr.rank <= 10) out.push({ rule: 'displaced', rank: dr });

  const blocs = c.blocs.filter((id) => db.relations.blocById.has(id));
  if (blocs.length >= 2) out.push({ rule: 'blocs', ids: blocs });

  const pr = rankOf(db, 'pop', c).world;
  if (pr) out.push({ rule: 'popRank', rank: pr });
  return out.slice(0, MAX_STANDOUTS);
}
