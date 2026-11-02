// Builds one linked model (DB) from the raw data files. Pure: the input is cloned, never mutated.

import { geoArea, geoCentroid, geoDistance } from 'd3';
import type { Feature, FeatureCollection } from 'geojson';
import { RELIGION_FAMILIES, RESOURCE_CLASSES, SEVERITY_RANK } from '../config';
import { normalize, type Lang } from '../i18n/format';
import { CONFLICT_FILES } from './files';
import { emptyFigures } from './figures';
import type { Conflict, Country, DB, Disputed, Group, IndexRow, Kind, RawData, SearchEntry } from './types';

const EARTH_R = 6371;
// Thematic files use ISO codes that Natural Earth spells differently.
const ISO_ALIAS: Record<string, string> = { XKX: 'KOS' };
const fix = (iso: string) => ISO_ALIAS[iso] ?? iso;
// Natural Earth's Arabic name is wrong for a few disputed features (English brk_name is right).
const DISPUTED_AR_FIX: Record<string, string> = { 'Spratly Is.': 'جزر سبراتلي' };

const collection = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });

/** Rewrite every ISO reference in the thematic files to Natural Earth's codes before linking. */
function normalizeIsos(R: RawData) {
  const arr = (a: string[] | undefined) => (Array.isArray(a) ? a.map(fix) : a);
  for (const k of CONFLICT_FILES) {
    for (const c of R[k].conflicts) {
      c.countries = arr(c.countries) ?? [];
      for (const e of c.externalPowers ?? []) e.iso3 = fix(e.iso3);
    }
  }
  for (const e of R.relations.edges) { e.a = fix(e.a); e.b = fix(e.b); }
  for (const b of R.relations.blocs) b.members = arr(b.members) ?? [];
  R.relations.bilateral = Object.fromEntries(Object.entries(R.relations.bilateral).map(([k, v]) => [k.split('|').map(fix).join('|'), v]));
  for (const f of R.ethnic.features) f.properties.countries = arr(f.properties.countries);
  for (const p of R.choke.points) p.borderStates = arr(p.borderStates);
  for (const e of R.timeline.events) e.countries = arr(e.countries);
  for (const e of R.resources.entries) e.iso3 = fix(e.iso3);
  for (const s of R.resources.sites) s.iso3 = fix(s.iso3);
  R.intel.countries = Object.fromEntries(Object.entries(R.intel.countries).map(([k, v]) => [fix(k), v]));
  R.religions.countries = Object.fromEntries(Object.entries(R.religions.countries).map(([k, v]) => [fix(k), v]));
}

export function build(input: RawData): DB {
  const R = structuredClone(input);
  normalizeIsos(R);
  const DB = { raw: R, corrections: R.corrections ?? [], figures: emptyFigures() } as DB;

  // ---- countries (Natural Earth admin-0 + index)
  const idx = new Map(R.index.map((r) => [r.iso3, r]));
  DB.features = R.countries.features;
  DB.countries = new Map();
  for (const f of DB.features) {
    const p = f.properties;
    const r: Partial<IndexRow> = idx.get(p.iso3) ?? {};
    DB.countries.set(p.iso3, {
      iso3: p.iso3, iso2: p.iso_a2_eh, nameAr: p.name_ar || r.nameAr, nameEn: p.name_en || r.name, nameLong: p.name_long,
      type: p.type, sovereign: p.sovereignt, continent: p.continent, subregion: p.subregion, regionWb: p.region_wb,
      pop: p.pop_est, popYear: p.pop_year, gdp: p.gdp_md, gdpYear: p.gdp_year, income: p.income_grp, economy: p.economy,
      lon: r.lon ?? p.label_x, lat: r.lat ?? p.label_y, wikidata: p.wikidataid,
      areaKm2: geoArea(f) * EARTH_R * EARTH_R,
      feature: f, gdpPerCap: null, density: null,
      intel: null, religion: null, resources: [], sites: [], conflicts: [], external: [], blocs: [], edges: [],
      events: [], groups: [], chokepoints: [], neighbors: [], disputed: [],
    });
  }
  for (const c of DB.countries.values()) {
    c.gdpPerCap = c.gdp && c.pop ? (c.gdp * 1e6) / c.pop : null;
    c.density = c.pop && c.areaKm2 > 1 ? c.pop / c.areaKm2 : null;
  }
  const C = (iso: string): Country | undefined => DB.countries.get(iso);

  DB.boundaries = R.boundaries.features;
  DB.disputed = R.disputed.features.map((f, i): Disputed => {
    const p = f.properties;
    const brk = String(p.brk_name || p.name_en || '').replace(/\uFEFF/g, '').trim();
    const d: Disputed = {
      id: String(i), nameAr: DISPUTED_AR_FIX[brk] || p.name_ar || brk, nameEn: brk, admin: p.admin, sovereign: p.sovereignt,
      claimant: p.claimant, note: p.note_brk, subregion: p.subregion, lon: p.label_x, lat: p.label_y, feature: f,
    };
    const adminC = [...DB.countries.values()].find((c) => c.nameEn === p.admin || c.sovereign === p.admin);
    if (adminC) adminC.disputed.push(d.id);
    return d;
  });
  DB.disputedById = new Map(DB.disputed.map((d) => [d.id, d]));

  // ---- conflicts (5 regional files)
  DB.conflicts = [];
  for (const k of CONFLICT_FILES) {
    const file = R[k];
    for (const c of file.conflicts) {
      DB.conflicts.push({ ...c, region: file.region, regionName: file.regionName, startYear: parseInt(c.started ?? '', 10) || null,
        rank: SEVERITY_RANK[c.severity] || 0, events: [], chokepoints: [] });
    }
  }
  DB.conflicts.sort((a, b) => b.rank - a.rank);
  DB.conflictById = new Map(DB.conflicts.map((c) => [c.id, c]));
  DB.conflictsAsOf = R.cMideast.statusAsOf;
  for (const c of DB.conflicts) {
    for (const iso of c.countries ?? []) C(iso)?.conflicts.push(c.id);
    for (const e of c.externalPowers ?? []) C(e.iso3)?.external.push(c.id);
  }

  // ---- country intel
  for (const [iso, v] of Object.entries(R.intel.countries)) { const c = C(iso); if (c) c.intel = v; }
  DB.intelNote = R.intel.note;

  // ---- religion
  const rel = R.religions;
  const familyOf: Record<string, string> = Object.fromEntries(RELIGION_FAMILIES.flatMap((f) => f.members.map((m) => [m, f.id])));
  DB.religion = {
    traditions: rel.traditions, traditionById: new Map(rel.traditions.map((t) => [t.id, t])),
    families: RELIGION_FAMILIES, familyOf, coverageNote: rel.coverageNote, methodNote: rel.methodNote, countries: rel.countries,
  };
  for (const [iso, v] of Object.entries(rel.countries)) {
    const c = C(iso); if (!c) continue;
    const groups = Object.entries(v.groups).filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]);
    const fam: Record<string, number> = {};
    for (const [tid, p] of groups) { const f = familyOf[tid] ?? 'none'; fam[f] = (fam[f] ?? 0) + p; }
    const famSorted = Object.entries(fam).sort((a, b) => b[1] - a[1]);
    const diversity = 1 - groups.reduce((s, [, p]) => s + (p / 100) ** 2, 0); // Gini–Simpson over traditions
    c.religion = { ...v, sorted: groups, majority: groups[0]?.[0] ?? null, majorityShare: groups[0]?.[1] ?? 0,
      families: famSorted, majorityFamily: famSorted[0]?.[0] ?? null, diversity };
  }

  // ---- ethnic groups (approximate polygons)
  const eth = R.ethnic;
  DB.ethnic = { features: eth.features, meta: eth.metadata, groups: new Map(), families: [] };
  for (const f of eth.features) {
    const p = f.properties;
    let g = DB.ethnic.groups.get(p.groupId);
    if (!g) {
      g = { id: p.groupId, nameAr: p.nameAr, nameEn: p.nameEn, family: p.family, langAr: p.langAr, langEn: p.langEn,
        regionAr: p.regionAr, regionEn: p.regionEn, countries: p.countries ?? [], noteAr: p.noteAr, noteEn: p.noteEn,
        features: [], lon: 0, lat: 0 } satisfies Group;
      DB.ethnic.groups.set(p.groupId, g);
    }
    g.features.push(f);
  }
  for (const g of DB.ethnic.groups.values()) {
    [g.lon, g.lat] = geoCentroid(collection(g.features));
    for (const iso of g.countries) C(iso)?.groups.push(g.id);
  }
  DB.ethnic.families = [...new Set(eth.features.map((f) => f.properties.family))];

  // ---- resources
  const res = R.resources;
  DB.resources = {
    types: res.types, typeById: new Map(res.types.map((t) => [t.id, t])), classes: RESOURCE_CLASSES,
    classOf: Object.fromEntries(RESOURCE_CLASSES.flatMap((k) => k.members.map((m) => [m, k.id]))),
    entries: res.entries, sites: res.sites, note: res.note, coverageNote: res.coverageNote,
  };
  DB.siteById = new Map(res.sites.map((s) => [s.id, s]));
  for (const e of res.entries) C(e.iso3)?.resources.push(e);
  for (const s of res.sites) C(s.iso3)?.sites.push(s.id);

  // ---- relations: blocs + typed edges + bilateral notes
  const R2 = R.relations;
  DB.relations = {
    edgeTypes: R2.edgeTypes, edgeTypeById: new Map(R2.edgeTypes.map((e) => [e.id, e])), edgeKinds: R2.edgeKinds,
    blocs: R2.blocs, blocById: new Map(R2.blocs.map((b) => [b.id, b])),
    edges: R2.edges.map((e, i) => ({ ...e, id: 'e' + i })),
    bilateral: R2.bilateral,
  };
  DB.bilateralFor = (a, b) => R2.bilateral[`${fix(a)}|${fix(b)}`] ?? R2.bilateral[`${fix(b)}|${fix(a)}`] ?? null;
  DB.edgesBetween = (a, b) => DB.relations.edges.filter((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  for (const e of DB.relations.edges) { C(e.a)?.edges.push(e.id); C(e.b)?.edges.push(e.id); }
  DB.edgeById = new Map(DB.relations.edges.map((e) => [e.id, e]));
  for (const b of R2.blocs) for (const iso of b.members) { const c = C(iso); if (c && !c.blocs.includes(b.id)) c.blocs.push(b.id); }
  // relations.blocs member lists are canonical; intel bloc ids only add blocs that list doesn't define
  for (const c of DB.countries.values()) for (const b of c.intel?.blocs ?? []) if (!DB.relations.blocById.has(b) && !c.blocs.includes(b)) c.blocs.push(b);

  // ---- chokepoints
  DB.chokepoints = R.choke.points;
  DB.chokeNote = R.choke.note;
  DB.chokeById = new Map(DB.chokepoints.map((p) => [p.id, p]));
  for (const p of DB.chokepoints) {
    for (const iso of p.borderStates ?? []) C(iso)?.chokepoints.push(p.id);
    for (const cid of p.conflictIds ?? []) DB.conflictById.get(cid)?.chokepoints.push(p.id);
  }

  // ---- timeline
  const tl = R.timeline;
  DB.timeline = {
    range: tl.range, categories: tl.categories, catById: new Map(tl.categories.map((c) => [c.id, c])),
    boundaryLimitation: tl.boundaryLimitation,
    events: tl.events.map((e) => ({ ...e, year: parseInt(String(e.date).slice(0, 4), 10) })).sort((a, b) => String(a.date).localeCompare(String(b.date))),
  };
  DB.eventById = new Map(DB.timeline.events.map((e) => [e.id, e]));
  for (const e of DB.timeline.events) {
    for (const iso of e.countries ?? []) C(iso)?.events.push(e.id);
    for (const cid of e.conflictIds ?? []) DB.conflictById.get(cid)?.events.push(e.id);
  }

  // ---- sources
  DB.sources = R.sources;
  DB.datasetById = new Map(R.sources.datasets.map((d) => [d.id, d]));
  DB.referenceById = new Map(R.sources.references.map((r) => [r.id, r]));

  // ---- neighbours: nearest label points inside the same subregion (proximity, not an official border list)
  const all = [...DB.countries.values()].filter((c) => c.lon != null && c.lat != null);
  for (const c of all) {
    const pool = all.filter((o) => o !== c && o.subregion === c.subregion);
    c.neighbors = pool
      .map((o) => [o.iso3, geoDistance([c.lon!, c.lat!], [o.lon!, o.lat!])] as const)
      .sort((a, b) => a[1] - b[1]).slice(0, 6).map(([iso]) => iso);
  }

  // ---- lookups
  DB.get = (kind, id) => {
    switch (kind) {
      case 'country': return DB.countries.get(id);
      case 'conflict': return DB.conflictById.get(id);
      case 'group': return DB.ethnic.groups.get(id);
      case 'religion': return DB.religion.traditionById.get(id);
      case 'choke': return DB.chokeById.get(id);
      case 'disputed': return DB.disputedById.get(id);
      case 'event': return DB.eventById.get(id);
      case 'bloc': return DB.relations.blocById.get(id);
      case 'site': return DB.siteById.get(id);
      default: return undefined;
    }
  };
  DB.exists = (kind, id) => !!DB.get(kind, id);
  DB.isUnverified = (kind, id) => {
    if (kind === 'country') return DB.countries.get(id)?.intel?.unverified === true;
    const x = DB.get(kind, id) as { unverified?: boolean } | undefined;
    return x?.unverified === true;
  };
  /** Countries a selection touches (for map emphasis and fly-to bounds). */
  DB.countriesOf = (kind, id) => {
    const x = DB.get(kind, id) as Record<string, unknown> | undefined;
    if (!x) return [];
    switch (kind) {
      case 'country': return [id];
      case 'conflict': return (x.countries as string[] | undefined) ?? [];
      case 'group': return x.countries as string[];
      case 'religion': return Object.entries(DB.religion.countries).filter(([, v]) => (v.groups[id] ?? 0) >= 5).map(([iso]) => iso);
      case 'choke': return (x.borderStates as string[] | undefined) ?? [];
      case 'disputed': return [];
      case 'event': return (x.countries as string[] | undefined) ?? [];
      case 'bloc': return x.members as string[];
      case 'site': return [x.iso3 as string];
      default: return [];
    }
  };
  /** [lon, lat] anchor of a selection. */
  DB.anchorOf = (kind, id) => {
    const x = DB.get(kind, id) as { coords?: [number, number]; lon?: number; lat?: number } | undefined;
    if (!x) return null;
    if (x.coords) return x.coords;
    if (x.lon != null && x.lat != null) return [x.lon, x.lat];
    const isos = DB.countriesOf(kind, id).map(C).filter((c): c is Country => !!c);
    if (!isos.length) return null;
    return geoCentroid(collection(isos.map((c) => c.feature)));
  };
  DB.nameOf = (kind: Kind, id: string, lang: Lang) => {
    const x = DB.get(kind, id) as Record<string, unknown> | undefined;
    if (!x) return id;
    const ar = lang === 'ar';
    if (x.nameAr) return String(ar ? x.nameAr : x.nameEn);
    const name = x.name as { ar?: string; en?: string } | undefined;
    if (name && typeof name === 'object') return (ar ? name.ar : name.en) ?? id;
    return String((ar ? x.ar : x.en) ?? id);
  };

  // ---- search index
  const S: SearchEntry[] = [];
  const push = (kind: Kind, id: string, ar = '', en = '', subAr = '', subEn = '') =>
    S.push({ kind, id, ar, en, subAr, subEn, n: normalize(`${ar} ${en} ${id}`) });
  for (const c of DB.countries.values()) push('country', c.iso3, c.nameAr, c.nameEn, c.subregion, c.subregion);
  for (const c of DB.conflicts as Conflict[]) push('conflict', c.id, c.name.ar, c.name.en, c.regionName.ar, c.regionName.en);
  for (const g of DB.ethnic.groups.values()) push('group', g.id, g.nameAr, g.nameEn, g.regionAr, g.regionEn);
  for (const t of DB.religion.traditions) push('religion', t.id, t.ar, t.en);
  for (const p of DB.chokepoints) push('choke', p.id, p.ar, p.en);
  for (const d of DB.disputed) push('disputed', d.id, d.nameAr, d.nameEn, d.admin ?? '', d.admin ?? '');
  for (const e of DB.timeline.events) push('event', e.id, e.ar, e.en, e.date, e.date);
  for (const b of DB.relations.blocs) push('bloc', b.id, b.ar, b.en);
  for (const s of DB.resources.sites) push('site', s.id, s.ar, s.en);
  DB.searchIndex = S;
  DB.search = (q, limit = 30) => {
    const n = normalize(q);
    if (!n) return [];
    const out: [SearchEntry, number][] = [];
    for (const e of S) {
      const i = e.n.indexOf(n);
      if (i < 0) continue;
      const wordStart = i === 0 || e.n[i - 1] === ' ';
      out.push([e, (i === 0 ? 0 : wordStart ? 1 : 2) + (e.kind === 'country' ? 0 : 0.5)]);
    }
    return out.sort((a, b) => a[1] - b[1]).slice(0, limit).map(([e]) => e);
  };

  DB.stats = {
    countries: DB.countries.size,
    conflicts: DB.conflicts.length,
    groups: DB.ethnic.groups.size,
    religionCountries: Object.keys(rel.countries).length,
    edges: DB.relations.edges.length,
    blocs: DB.relations.blocs.length,
    events: DB.timeline.events.length,
    chokepoints: DB.chokepoints.length,
    sites: DB.resources.sites.length,
    disputed: DB.disputed.length,
  };
  return DB;
}
