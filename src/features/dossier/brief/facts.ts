// Country figures and rankings shared by the Brief tab, the Summary tab and the Compare view. Pure functions over the model.
// D10: a generated figure (db.figures, or a popSource/gdpSource the build sets) wins; Natural Earth is the fallback.

import type { Figure } from '../../../data/figures';
import { rankBy, vsAverage, type Rank } from '../../../data/rank';
import type { Country, DB } from '../../../data/types';
import type { ChokeX } from '../model';

/** A figure as shown: its value, its year, and the generated source's display name (null = Natural Earth). */
export interface Shown { value: number; year: number | null; source: string | null; srcId: string | null }

export const sourceOf = (db: DB, id: string | null | undefined) => (id ? db.figures.sources.find((s) => s.id === id) ?? null : null);
const sourceName = (db: DB, id: string) => sourceOf(db, id)?.name ?? id;
const shown = (db: DB, f: Figure, value = f.value): Shown => ({ value, year: f.year, source: sourceName(db, f.source), srcId: f.source });
const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** A generated GDP figure in million USD: World Bank values are plain US$ unless the unit says millions. */
export const figureMd = (f: Figure) => (/million|^m(?:usd|\$)?$/i.test(f.unit ?? '') ? f.value : f.value / 1e6);

export function popOf(db: DB, c: Country): Shown | null {
  const f = db.figures.country(c.iso3).population;
  if (f && ok(f.value)) return shown(db, f);
  if (!ok(c.pop)) return null;
  const s = c.popSource;
  return { value: c.pop, year: c.popYear ?? null, source: s ? sourceName(db, s) : null, srcId: s ?? null };
}

/** GDP in million USD (the unit Natural Earth uses and fmt.gdp expects). */
export function gdpOf(db: DB, c: Country): Shown | null {
  const f = db.figures.country(c.iso3).gdp;
  if (f && ok(f.value)) return shown(db, f, figureMd(f));
  if (!ok(c.gdp) || !c.gdp) return null;
  const s = c.gdpSource;
  return { value: c.gdp, year: c.gdpYear ?? null, source: s ? sourceName(db, s) : null, srcId: s ?? null };
}

export function gdpPerCapOf(db: DB, c: Country): Shown | null {
  const f = db.figures.country(c.iso3).gdpPerCapita;
  if (f && ok(f.value)) return shown(db, f);
  const g = gdpOf(db, c), p = popOf(db, c);
  if (g?.srcId && p?.value) return { ...g, value: (g.value * 1e6) / p.value };
  if (!ok(c.gdpPerCap)) return null;
  const s = c.gdpSource;
  return { value: c.gdpPerCap, year: c.gdpYear ?? null, source: s ? sourceName(db, s) : null, srcId: s ?? null };
}

/** Refugees from the state plus people displaced inside it; null when neither figure exists. */
export function displacedOf(db: DB, c: Country): Shown | null {
  const f = db.figures.country(c.iso3);
  const parts = [f.refugeesFrom, f.idps].filter((x): x is Figure => !!x && ok(x.value));
  if (!parts.length) return null;
  const first = parts[0]!;
  return { ...shown(db, first), value: parts.reduce((s, x) => s + x.value, 0), year: Math.max(...parts.map((x) => x.year)) };
}

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
