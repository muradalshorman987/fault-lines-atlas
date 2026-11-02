// World pulse model: every figure in the view, computed from the loaded DB and the active filters. Pure (no React, no store).
//
// Scope rules (one place, so the read line, tiles, charts and lists always agree):
// - a conflict is in scope when it matches severity, region and dimension, and (figures follow the map) touches a country in view;
// - a chart never filters itself: the severity bars ignore the severity filter, the region bars the region filter (crossfilter);
// - chokepoints and events follow the conflicts in scope (through their conflictIds) once a conflict filter is on;
// - country figures (external roles, rankings) count only states the map shows when figures follow the map.

import { CHOKE_STATUS, DIMENSIONS, SEVERITY } from '../../config';
import { CONFLICT_FILES } from '../../data/files';
import { rankBy, vsAverage, type Rank } from '../../data/rank';
import type { Chokepoint, Conflict, DB, TimelineEvent } from '../../data/types';
import type { Bi } from '../../i18n/format';

export const SEV_IDS: string[] = SEVERITY.map((s) => s.id);
export type DimId = keyof typeof DIMENSIONS;
export const DIM_IDS = Object.keys(DIMENSIONS) as DimId[];
export type ChokeStatus = keyof typeof CHOKE_STATUS;

export interface PulseInput {
  severity: ReadonlySet<string>;
  region: string | null;
  dimension: string | null;
  /** Figures follow the map: the latest viewport, or null when off or not reported yet (= every country). */
  viewport: readonly string[] | null;
  /** The current calendar year; the "events this decade" tile counts from its decade. */
  year: number;
}

export interface Region { id: string; name: Bi }
export interface Bucket { id: string; n: number; isos: string[] }
export interface Kpis {
  wars: number; armed: number; external: number; chokes: number; chokeCrisis: number;
  unverified: number; decade: number; decadeFrom: number; displaced: number | null;
}
export type AttnRule = 'unverified' | 'chokeLink' | 'choke' | 'external';
export type AttnItem =
  | { rule: 'unverified'; kind: 'conflict'; id: string; isos: string[]; severity: string }
  | { rule: 'chokeLink'; kind: 'conflict'; id: string; isos: string[]; chokes: string[] }
  | { rule: 'choke'; kind: 'choke'; id: string; isos: string[]; status: ChokeStatus; flow: number | null; conflicts: string[] }
  | { rule: 'external'; kind: 'conflict'; id: string; isos: string[]; powers: string[] };
export interface AttnGroup { rule: AttnRule; items: AttnItem[] }
export type RankTab = 'involvement' | 'diversity' | 'displaced';
export interface RankRow { iso: string; value: number; rank: Rank; vs: number | null; party?: number; ext?: number }
export interface RegionStrip { id: string; conflicts: number; involved: number; topSeverity: string | null; share: number }

export interface Pulse {
  regions: Region[];
  conflicts: Conflict[];
  chokepoints: Chokepoint[];
  /** Any filter that narrows the conflict files (severity, region, dimension). */
  filtered: boolean;
  following: boolean;
  kpis: Kpis;
  topRegions: { ids: string[]; n: number } | null;
  bySeverity: Bucket[];
  byRegion: Bucket[];
  byDimension: Bucket[];
  /** matrix[severity][region] */
  matrix: Record<string, Record<string, Bucket>>;
  matrixMax: number;
  attention: AttnGroup[];
  rankings: Record<RankTab, RankRow[]>;
  hasDisplaced: boolean;
  strip: RegionStrip | null;
}

// ---- field readers: optional curated fields arrive as unknown (types.ts keeps the raw records open)

export const dimsOf = (c: Conflict): string[] => (Array.isArray(c.dimensions) ? c.dimensions.filter((d): d is string => typeof d === 'string') : []);
export const chokeStatus = (p: Chokepoint): ChokeStatus | null => (typeof p.status === 'string' && p.status in CHOKE_STATUS ? (p.status as ChokeStatus) : null);
const oilFlow = (p: Chokepoint): number | null => (typeof p.oilFlowMbd === 'number' && Number.isFinite(p.oilFlowMbd) ? p.oilFlowMbd : null);
const uniq = <T>(xs: Iterable<T>): T[] => [...new Set(xs)];
const partiesOf = (cs: Conflict[]) => uniq(cs.flatMap((c) => c.countries ?? []));
const involvedOf = (cs: Conflict[]) => uniq(cs.flatMap((c) => [...(c.countries ?? []), ...(c.externalPowers ?? []).map((e) => e.iso3)]));
const bucket = (id: string, cs: Conflict[]): Bucket => ({ id, n: cs.length, isos: partiesOf(cs) });

/** Conflict regions in file order (Middle East, Europe, Asia, Africa, Americas). */
export function regionsOf(db: DB): Region[] {
  return CONFLICT_FILES.map((k) => ({ id: db.raw[k].region, name: db.raw[k].regionName }));
}

/** Displaced = refugees from the state plus its internally displaced people (M5 figures); null when it has neither. */
export function displacedOf(db: DB, iso: string): number | null {
  const f = db.figures.country(iso);
  if (!f.refugeesFrom && !f.idps) return null;
  return (f.refugeesFrom?.value ?? 0) + (f.idps?.value ?? 0);
}

export function computePulse(db: DB, input: PulseInput): Pulse {
  const { severity, region, dimension, year } = input;
  const vp = input.viewport ? new Set(input.viewport) : null;
  const allSev = SEV_IDS.every((id) => severity.has(id));
  const filtered = !allSev || !!region || !!dimension;
  const touches = (isos: readonly string[] | undefined) => !vp || (isos ?? []).some((iso) => vp.has(iso));
  const match = (c: Conflict, ignore?: 'severity' | 'region' | 'dimension') =>
    (ignore === 'severity' || severity.has(c.severity))
    && (ignore === 'region' || !region || c.region === region)
    && (ignore === 'dimension' || !dimension || dimsOf(c).includes(dimension))
    && touches(c.countries);

  const regions = regionsOf(db);
  const conflicts = db.conflicts.filter((c) => match(c));
  const ids = new Set(conflicts.map((c) => c.id));
  const linked = (cids: readonly string[] | undefined) => (cids ?? []).some((id) => ids.has(id));
  const inView = (iso: string) => !vp || vp.has(iso);

  // chokepoints and events in scope
  const chokepoints = db.chokepoints.filter((p) => (!filtered || linked(p.conflictIds)) && touches(p.borderStates));
  const events = db.timeline.events.filter((e: TimelineEvent) =>
    (!filtered || linked(e.conflictIds)) && (!vp || touches(e.countries) || linked(e.conflictIds)));

  // ---- countries in scope: involved in the conflicts shown (when filtered), and on the map (when following it)
  const involved = new Set(involvedOf(conflicts));
  const countryIn = (iso: string) => inView(iso) && (!filtered || involved.has(iso));

  // ---- KPI tiles
  const decadeFrom = Math.floor(year / 10) * 10;
  const hasDisplaced = [...db.countries.keys()].some((iso) => displacedOf(db, iso) != null);
  const kpis: Kpis = {
    wars: conflicts.filter((c) => c.severity === 'war').length,
    armed: conflicts.filter((c) => c.severity === 'armed-conflict').length,
    external: uniq(conflicts.flatMap((c) => (c.externalPowers ?? []).map((e) => e.iso3))).filter(inView).length,
    chokes: chokepoints.filter((p) => { const s = chokeStatus(p); return s === 'crisis' || s === 'elevated'; }).length,
    chokeCrisis: chokepoints.filter((p) => chokeStatus(p) === 'crisis').length,
    unverified: conflicts.filter((c) => db.isUnverified('conflict', c.id)).length,
    decade: events.filter((e) => e.year >= decadeFrom).length,
    decadeFrom,
    displaced: hasDisplaced
      ? [...db.countries.keys()].filter(countryIn).reduce((s, iso) => s + (displacedOf(db, iso) ?? 0), 0)
      : null,
  };

  // ---- read line: the region with the most files (all tied regions), only when no region filter narrows it to one
  let topRegions: Pulse['topRegions'] = null;
  if (!region && conflicts.length) {
    const per = regions.map((r) => ({ id: r.id, n: conflicts.filter((c) => c.region === r.id).length }));
    const n = Math.max(...per.map((r) => r.n));
    topRegions = { ids: per.filter((r) => r.n === n).map((r) => r.id), n };
  }

  // ---- distributions (each ignores its own filter)
  const bySeverity = SEV_IDS.map((id) => bucket(id, db.conflicts.filter((c) => c.severity === id && match(c, 'severity'))));
  const byRegion = regions.map((r) => bucket(r.id, db.conflicts.filter((c) => c.region === r.id && match(c, 'region'))));
  const byDimension = DIM_IDS.map((id) => bucket(id, db.conflicts.filter((c) => dimsOf(c).includes(id) && match(c, 'dimension'))));

  // ---- matrix: severity × region over the files on the map (and in the dimension), so its cells stay comparable
  const pool = db.conflicts.filter((c) => touches(c.countries) && (!dimension || dimsOf(c).includes(dimension)));
  const matrix: Pulse['matrix'] = {};
  let matrixMax = 0;
  for (const s of SEV_IDS) {
    const row: Record<string, Bucket> = {};
    for (const r of regions) {
      const b = bucket(`${r.id}|${s}`, pool.filter((c) => c.severity === s && c.region === r.id));
      row[r.id] = b;
      matrixMax = Math.max(matrixMax, b.n);
    }
    matrix[s] = row;
  }

  // ---- needs attention: data rules over the conflicts and chokepoints in scope
  const crisisChokes = chokepoints.filter((p) => chokeStatus(p) === 'crisis');
  const bySev = (a: Conflict, b: Conflict) => b.rank - a.rank;
  const attention: AttnGroup[] = [
    {
      rule: 'unverified',
      items: conflicts.filter((c) => (c.severity === 'war' || c.severity === 'armed-conflict') && db.isUnverified('conflict', c.id))
        .sort(bySev).map((c) => ({ rule: 'unverified', kind: 'conflict', id: c.id, isos: c.countries ?? [], severity: c.severity })),
    },
    {
      rule: 'chokeLink',
      items: conflicts.map((c) => ({ c, chokes: crisisChokes.filter((p) => (p.conflictIds ?? []).includes(c.id)).map((p) => p.id) }))
        .filter((x) => x.chokes.length).sort((a, b) => bySev(a.c, b.c))
        .map(({ c, chokes }) => ({ rule: 'chokeLink', kind: 'conflict', id: c.id, isos: c.countries ?? [], chokes })),
    },
    {
      rule: 'choke',
      items: chokepoints.flatMap((p): AttnItem[] => {
        const status = chokeStatus(p);
        if (status !== 'crisis' && status !== 'elevated') return [];
        return [{ rule: 'choke', kind: 'choke', id: p.id, isos: p.borderStates ?? [], status, flow: oilFlow(p),
          conflicts: (p.conflictIds ?? []).filter((id) => db.conflictById.has(id)) }];
      }).sort((a, b) => (a.rule === 'choke' && b.rule === 'choke' ? Number(b.status === 'crisis') - Number(a.status === 'crisis') || (b.flow ?? 0) - (a.flow ?? 0) : 0)),
    },
    {
      rule: 'external',
      items: conflicts.filter((c) => (c.externalPowers ?? []).length >= 3)
        .sort((a, b) => (b.externalPowers ?? []).length - (a.externalPowers ?? []).length || bySev(a, b))
        .map((c) => ({ rule: 'external', kind: 'conflict', id: c.id, isos: c.countries ?? [], powers: uniq((c.externalPowers ?? []).map((e) => e.iso3)) })),
    },
  ];

  // ---- hotspot rankings
  const rank = (rows: { id: string; value: number; party?: number; ext?: number }[]): RankRow[] => {
    const ranks = rankBy(rows, (x) => x.value);
    const values = rows.map((x) => x.value);
    return rows.flatMap((x) => {
      const r = ranks.get(x.id);
      return r ? [{ iso: x.id, value: x.value, rank: r, vs: vsAverage(x.value, values), party: x.party, ext: x.ext }] : [];
    }).sort((a, b) => a.rank.rank - b.rank.rank || a.iso.localeCompare(b.iso));
  };
  // involvement = files a state is a party to or an external power in, each file once (as the country brief counts it):
  // an external role counts only in files the state is not already a party to, so party + ext is the value
  const party = new Map<string, number>(), ext = new Map<string, number>();
  for (const c of conflicts) {
    const parties = new Set(c.countries ?? []);
    for (const iso of parties) party.set(iso, (party.get(iso) ?? 0) + 1);
    for (const iso of uniq((c.externalPowers ?? []).map((e) => e.iso3))) if (!parties.has(iso)) ext.set(iso, (ext.get(iso) ?? 0) + 1);
  }
  const rankings: Pulse['rankings'] = {
    involvement: rank([...involved].filter((iso) => countryIn(iso) && db.countries.has(iso)).map((iso) => {
      const p = party.get(iso) ?? 0, e = ext.get(iso) ?? 0;
      return { id: iso, value: p + e, party: p, ext: e };
    })),
    diversity: rank([...db.countries.values()].filter((c) => c.religion && countryIn(c.iso3))
      .map((c) => ({ id: c.iso3, value: c.religion!.diversity }))),
    displaced: rank([...db.countries.keys()].filter(countryIn).flatMap((iso) => {
      const v = displacedOf(db, iso);
      return v == null ? [] : [{ id: iso, value: v }];
    })),
  };

  return {
    regions, conflicts, chokepoints, filtered, following: !!vp, kpis, topRegions,
    bySeverity, byRegion, byDimension, matrix, matrixMax, attention, rankings, hasDisplaced,
    strip: region ? regionStrip(db, region) : null,
  };
}

/** The region as a whole (every file in it, whatever the other filters): the strip under the filter row. */
export function regionStrip(db: DB, region: string): RegionStrip {
  const cs = db.conflicts.filter((c) => c.region === region);
  const top = cs.reduce<Conflict | null>((best, c) => (!best || c.rank > best.rank ? c : best), null);
  return {
    id: region, conflicts: cs.length, involved: involvedOf(cs).length, topSeverity: top?.severity ?? null,
    share: db.conflicts.length ? (cs.length / db.conflicts.length) * 100 : 0,
  };
}
