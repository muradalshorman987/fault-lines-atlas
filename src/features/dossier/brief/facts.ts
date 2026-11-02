// Country KPIs, rankings and "what stands out" for the Brief tab. Pure functions over the model.
// The figures themselves (popOf, gdpOf, …) live in src/data/shown.ts, shared with the Compare view.

import { displacedOf, gdpOf, gdpPerCapOf, popOf, sourceOf, figureMd, type Shown } from '../../../data/shown';
import { rankBy, type Rank } from '../../../data/rank';
import type { Country, DB } from '../../../data/types';
import type { ChokeX } from '../model';

export { displacedOf, gdpOf, gdpPerCapOf, popOf, sourceOf, figureMd, type Shown };

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

interface Table { world: Map<string, Rank>; region: Map<string, Map<string, Rank>> }
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
  };
  byKpi.set(id, t);
  return t;
}

/** "#n of N" among every state and territory with a value, in the world and in the subregion (missing without a value). */
export function rankOf(db: DB, id: KpiId, c: Country): { world?: Rank; region?: Rank } {
  const t = table(db, id);
  return { world: t.world.get(c.iso3), region: c.subregion ? t.region.get(c.subregion)?.get(c.iso3) : undefined };
}

// ---- comparison lines. A plain mean over entries lets microstates and dependencies dominate (Monaco, the Vatican),
// so GDP per person is compared with the group's own figure (total GDP ÷ total population) and the other figures with
// the median. Population gets no comparison.

/** Median of finite values; null for none. */
export function median(values: number[]): number | null {
  const s = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** GDP per person of a group taken as one: total GDP ÷ total population over the members that have both. */
export function weightedGdpPerCap(db: DB, members: Country[]): number | null {
  let gdp = 0, pop = 0;
  for (const c of members) {
    const g = gdpOf(db, c), p = popOf(db, c);
    if (g && p?.value) { gdp += g.value * 1e6; pop += p.value; }
  }
  return pop ? gdp / pop : null;
}

/** Signed, rounded % difference from a reference; null when the reference is missing or zero. */
const diffFrom = (v: number, ref: number | null) => (ref ? Math.round(((v - ref) / ref) * 100) : null);

export interface Bench { kpi: KpiId; kind: 'figure' | 'median'; world: number | null; region: number | null }

/** The figure the median comparison reads: conflicts count every state, including those with none. */
const benchValue = (db: DB, id: KpiId, c: Country) => (id === 'conflicts' ? involvement(c) : kpiValue(db, id, c));

/** How a state's figure compares with the world and its subregion; null when nothing can be said. */
export function benchOf(db: DB, id: KpiId, c: Country): Bench | null {
  if (id === 'pop') return null;
  const v = benchValue(db, id, c);
  if (v == null) return null;
  const all = [...db.countries.values()];
  const peers = c.subregion ? all.filter((x) => x.subregion === c.subregion) : [];
  let world: number | null, region: number | null = null;
  if (id === 'gdppc') {
    world = diffFrom(v, weightedGdpPerCap(db, all));
    if (peers.filter((x) => gdpOf(db, x) && popOf(db, x)?.value).length > 1) region = diffFrom(v, weightedGdpPerCap(db, peers));
  } else {
    const values = (xs: Country[]) => xs.flatMap((x) => { const y = benchValue(db, id, x); return y == null ? [] : [y]; });
    world = diffFrom(v, median(values(all)));
    const pv = values(peers);
    if (pv.length > 1) region = diffFrom(v, median(pv));
  }
  return world == null && region == null ? null : { kpi: id, kind: id === 'gdppc' ? 'figure' : 'median', world, region };
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
