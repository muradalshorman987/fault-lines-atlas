// The four tools Claude can call. They run here in the page over the loaded atlas and return compact JSON.
// Records are trimmed views in the interface language, so a tool result stays a few thousand characters.

import { atlas } from '../../app/store';
import { CHOKE_STATUS, CONFIDENCE, DIMENSIONS, KINDS, SEVERITY, type Kind } from '../../config';
import type { DB } from '../../data/types';
import type { Lang } from '../../i18n/format';
import { translate } from '../../i18n/strings';
import type { Json, JsonObject } from './api';

export const LISTABLE = ['conflict', 'choke', 'bloc', 'group', 'religion', 'event', 'disputed', 'site'] as const;
const REGIONS = ['middle-east', 'europe', 'asia', 'africa', 'americas'];

const KIND_SCHEMA: JsonObject = { type: 'string', enum: [...KINDS] };

/** Tool definitions as sent to the API. The array never changes during a conversation (thinking blocks are bound to it). */
export const TOOL_DEFS: JsonObject[] = [
  {
    name: 'search_atlas',
    description: 'Search atlas records by name in Arabic or English (countries, conflicts, ethnic groups, religions, chokepoints, disputed areas, events, blocs, resource sites). Returns up to 12 matches as {ref, name_ar, name_en}. Use it to find the kind and id of anything the viewer mentions.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'A name or part of one, e.g. "Hormuz", "الكرد", "Sudan"' } }, required: ['query'], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: 'get_record',
    description: 'Read one atlas record (facts, status with its as-of date, causes, parties, relations, religion shares, open-data figures, related records). kind is one of the atlas kinds; id is the record id, e.g. country SAU (ISO3), conflict sudan, choke hormuz, group kurds, bloc nato. "unverified": true means its latest developments were not independently checked.',
    input_schema: { type: 'object', properties: { kind: KIND_SCHEMA, id: { type: 'string' } }, required: ['kind', 'id'], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: 'list_records',
    description: `List every record of one kind with a short label, optionally filtered. kind: ${LISTABLE.join(', ')}. For conflicts, severity is one of ${SEVERITY.map((s) => s.id).join(', ')} and region one of ${REGIONS.join(', ')}. For events, from_year/to_year filter by year.`,
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...LISTABLE] },
        severity: { type: 'string', enum: SEVERITY.map((s) => s.id) },
        region: { type: 'string', enum: REGIONS },
        from_year: { type: 'integer' },
        to_year: { type: 'integer' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'show_on_map',
    description: 'Select a record on the viewer\'s map and fly to it, opening its file. Use only when the viewer asks to see something.',
    input_schema: { type: 'object', properties: { kind: KIND_SCHEMA, id: { type: 'string' } }, required: ['kind', 'id'], additionalProperties: false },
    eager_input_streaming: true,
  },
];

export interface ToolOutcome { content: string; isError: boolean }
export interface ToolCtx { db: DB; lang: Lang; progress: (msg: string) => void }

class ToolInputError extends Error {}

const isKind = (v: unknown): v is Kind => typeof v === 'string' && (KINDS as readonly string[]).includes(v);
const ref = (kind: string, id: string) => `${kind}:${id}`;

/** Run one tool call. Bad input or an unknown record comes back as an error result Claude can recover from. */
export function runTool(name: string, input: JsonObject, ctx: ToolCtx): ToolOutcome {
  try {
    const out = TOOLS[name]?.(input, ctx);
    if (out === undefined) throw new ToolInputError(`unknown tool ${name}`);
    return { content: JSON.stringify(out), isError: false };
  } catch (err) {
    if (err instanceof ToolInputError) return { content: err.message, isError: true };
    throw err;
  }
}

function recordRef(input: JsonObject, db: DB): [Kind, string] {
  const { kind, id } = input;
  if (!isKind(kind)) throw new ToolInputError(`kind must be one of ${KINDS.join(', ')}`);
  if (typeof id !== 'string' || !id) throw new ToolInputError('id is required, e.g. "SAU" or "sudan"');
  if (!db.exists(kind, id)) throw new ToolInputError(`no atlas record ${ref(kind, id)}; search_atlas first`);
  return [kind, id];
}

const TOOLS: Record<string, (input: JsonObject, ctx: ToolCtx) => Json> = {
  search_atlas(input, { db, lang, progress }) {
    const q = typeof input.query === 'string' ? input.query.trim() : '';
    if (!q) throw new ToolInputError('query is required');
    progress(translate(lang, 'ask.searching', { q: q.slice(0, 40) }));
    const hits = db.search(q, 12);
    const out: JsonObject = { matches: hits.map((e) => ({ ref: ref(e.kind, e.id), name_ar: e.ar, name_en: e.en })) };
    if (!hits.length) out.hint = 'No match. Try a shorter name, the other language, or list_records.';
    return out;
  },

  get_record(input, ctx) {
    const [kind, id] = recordRef(input, ctx.db);
    ctx.progress(translate(ctx.lang, 'ask.reading', { name: ctx.db.nameOf(kind, id, ctx.lang) }));
    return clean(record(kind, id, ctx));
  },

  list_records(input, { db, lang, progress }) {
    const kind = input.kind;
    if (typeof kind !== 'string' || !(LISTABLE as readonly string[]).includes(kind)) throw new ToolInputError(`kind must be one of ${LISTABLE.join(', ')}`);
    const label = translate(lang, `kind.${kind}`);
    progress(translate(lang, 'ask.listing', { what: label === `kind.${kind}` ? kind : label }));
    return clean(list(kind as (typeof LISTABLE)[number], input, db, lang));
  },

  show_on_map(input, { db, lang, progress }) {
    const [kind, id] = recordRef(input, db);
    progress(translate(lang, 'ask.showing', { name: db.nameOf(kind, id, lang) }));
    atlas.select(kind, id); // selects, opens the file and emits 'flyto'
    return { shown: ref(kind, id) };
  },
};

// ------------------------------------------------------------------ record views

type Rec = Record<string, unknown>;
const cut = (s: string, n = 1400) => (s.length > n ? s.slice(0, n) + '…' : s);

/** Text from a string, a {ar, en} pair (whose values may be lists) or a list of either. */
function txt(v: unknown, lang: Lang): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map((x) => txt(x, lang)).filter(Boolean).join('; ');
  if (typeof v === 'object') {
    const o = v as Partial<Record<Lang, unknown>>;
    return txt(o[lang] ?? o.ar ?? o.en, lang);
  }
  return '';
}
/** Flat bilingual fields: field(p, 'note', lang) → p.noteAr | p.noteEn. */
const field = (o: Rec, base: string, lang: Lang) => txt((lang === 'ar' ? o[base + 'Ar'] : o[base + 'En']) ?? o[base + 'Ar'] ?? o[base + 'En'], lang);
const sevLabel = (id: unknown) => SEVERITY.find((s) => s.id === id)?.en ?? String(id ?? '');
const refs = (kind: string, ids: unknown) => (Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string').map((x) => ref(kind, x)) : []);

function record(kind: Kind, id: string, { db, lang }: ToolCtx): Rec {
  const L = (v: unknown, n?: number) => (n ? cut(txt(v, lang), n) : txt(v, lang));
  const unverified = db.isUnverified(kind, id) || undefined;
  const x = db.get(kind, id) as Rec;
  switch (kind) {
    case 'country': {
      const c = db.countries.get(id)!;
      const r = c.religion;
      const figures = db.figures.country(id);
      return {
        ref: ref(kind, id), name_ar: c.nameAr, name_en: c.nameEn, type: c.type, region: [c.continent, c.subregion].filter(Boolean).join(' · '),
        population: c.pop ? { value: c.pop, year: c.popYear } : undefined,
        gdp_million_usd: c.gdp ? { value: c.gdp, year: c.gdpYear } : undefined,
        gdp_per_capita_usd: c.gdpPerCap ? Math.round(c.gdpPerCap) : undefined,
        open_data_figures: Object.keys(figures).length ? figures : undefined,
        area_km2: Math.round(c.areaKm2), income_group: c.income,
        political_system: L(c.intel?.system) || undefined, languages: L(c.intel?.langs) || undefined,
        separatist_or_autonomy_movements: L(c.intel?.separatists) || undefined, territorial_disputes: L(c.intel?.disputes) || undefined,
        religion: r ? {
          source: r.source, year: r.year, note: L(r.note) || undefined,
          shares_pct: Object.fromEntries(r.sorted.map(([tid, p]) => [db.religion.traditionById.get(tid)?.en ?? tid, p])),
        } : 'no estimate in this edition',
        ethnic_groups: refs('group', c.groups),
        conflicts_party_to: c.conflicts.map((cid) => ({ ref: ref('conflict', cid), severity: sevLabel(db.conflictById.get(cid)?.severity) })),
        involved_as_external_power: c.external.map((cid) => ({
          ref: ref('conflict', cid), role: L(db.conflictById.get(cid)?.externalPowers?.find((e) => e.iso3 === id)?.role, 240),
        })),
        blocs: refs('bloc', c.blocs.filter((b) => db.relations.blocById.has(b))),
        relations: c.edges.map((eid) => db.edgeById.get(eid)).filter((e) => !!e).slice(0, 24).map((e) => ({
          partner: ref('country', e.a === id ? e.b : e.a), type: e.type, kind: e.kind, contested: e.contested === true || undefined, note: L(e, 240),
        })),
        resources: c.resources.map((e) => ({ type: e.type, world_rank: e.rank, year: e.year, note: L(e, 240) })),
        chokepoints_bordered: refs('choke', c.chokepoints),
        timeline_events: c.events.slice(-12).map((eid) => ({ ref: ref('event', eid), date: db.eventById.get(eid)?.date })),
        unverified,
      };
    }
    case 'conflict': {
      const c = db.conflictById.get(id)!;
      const deaths = db.figures.conflictDeaths(id);
      return {
        ref: ref(kind, id), name: L(c.name), region: L(c.regionName), severity: sevLabel(c.severity), started: c.started,
        current_phase_since: x.currentPhaseStarted, countries: refs('country', c.countries),
        dimensions: Array.isArray(x.dimensions) ? x.dimensions.map((d) => DIMENSIONS[d as keyof typeof DIMENSIONS]?.en ?? d) : undefined,
        dimension_note: L(x.dimensionNote, 1400), parties: L(x.parties, 1400), ethno_religious: L(x.ethnoReligious, 1400),
        history: L(x.history, 1800), political_causes: L(x.politicalCauses, 1400), territorial_claims: L(x.territorialClaims, 1400),
        strategic_interests: L(x.strategicInterests, 1400),
        external_powers: (c.externalPowers ?? []).map((e) => ({ country: ref('country', e.iso3), role: L(e.role, 400), kind: e.kind })),
        status: L(x.status, 1800), status_as_of: x.statusAsOf ?? db.conflictsAsOf,
        recent: (Array.isArray(x.recent) ? (x.recent as Rec[]) : []).slice(0, 6).map((r) => ({ date: r.date, text: L(r, 500), source: r.source })),
        conflict_deaths_by_year: deaths.length ? deaths.slice(-8) : undefined,
        confidence: CONFIDENCE[x.confidence as keyof typeof CONFIDENCE]?.en ?? x.confidence,
        related_events: refs('event', c.events), related_chokepoints: refs('choke', c.chokepoints),
        sources: (c.sourceRefs ?? []).map((s) => L((db.referenceById.get(s) as Rec | undefined)?.name) || s),
        unverified,
      };
    }
    case 'group': {
      const g = db.ethnic.groups.get(id)!;
      const gx = g as unknown as Rec;
      return {
        ref: ref(kind, id), name: field(gx, 'name', lang), family: g.family, language: field(gx, 'lang', lang),
        region: field(gx, 'region', lang), countries: refs('country', g.countries), note: field(gx, 'note', lang),
        caveat: 'Indicative core areas, not boundaries.',
      };
    }
    case 'religion': {
      const rows = Object.entries(db.religion.countries).map(([iso, v]) => [iso, v.groups[id] ?? 0] as const)
        .filter(([, p]) => p >= 1).sort((a, b) => b[1] - a[1]).slice(0, 25);
      return { ref: ref(kind, id), name: L(x), family: db.religion.familyOf[id], countries_by_share_pct: rows.map(([iso, p]) => ({ country: ref('country', iso), pct: p })), coverage: L(db.religion.coverageNote) || undefined };
    }
    case 'choke':
      return {
        ref: ref(kind, id), name: L(x), status: CHOKE_STATUS[x.status as keyof typeof CHOKE_STATUS]?.en ?? x.status, width: field(x, 'widthKm', lang),
        oil_flow_mb_per_day: x.oilFlowMbd, flow_year: x.flowYear, importance: field(x, 'shareNote', lang),
        border_states: refs('country', x.borderStates), alternatives: field(x, 'alternatives', lang), current_risk: field(x, 'risk', lang),
        related_conflicts: refs('conflict', x.conflictIds), unverified,
      };
    case 'disputed': {
      const d = db.disputedById.get(id)!;
      return { ref: ref(kind, id), name_ar: d.nameAr, name_en: d.nameEn, administered_by: d.admin, natural_earth_note: d.note || undefined };
    }
    case 'event':
      return {
        ref: ref(kind, id), title: L(x), date: x.date,
        categories: Array.isArray(x.cat) ? x.cat.map((c) => String((db.timeline.catById.get(String(c)) as Rec | undefined)?.en ?? c)) : undefined,
        countries: refs('country', x.countries), summary: field(x, 'sum', lang), related_conflicts: refs('conflict', x.conflictIds), unverified,
      };
    case 'bloc':
      return { ref: ref(kind, id), name: L(x), members: refs('country', x.members), note: L(x.note) || undefined };
    case 'site':
      return {
        ref: ref(kind, id), name: L(x), type: String((db.resources.typeById.get(String(x.type)) as Rec | undefined)?.en ?? x.type),
        country: ref('country', String(x.iso3)), note: field(x, 'note', lang),
      };
    default:
      return { ref: ref(kind, id) };
  }
}

function list(kind: (typeof LISTABLE)[number], input: JsonObject, db: DB, lang: Lang): Rec {
  const L = (v: unknown) => txt(v, lang);
  const from = typeof input.from_year === 'number' ? input.from_year : -Infinity;
  const to = typeof input.to_year === 'number' ? input.to_year : Infinity;
  let rows: Rec[];
  switch (kind) {
    case 'conflict':
      rows = db.conflicts.filter((c) => (!input.severity || c.severity === input.severity) && (!input.region || c.region === input.region))
        .map((c) => ({ ref: ref(kind, c.id), name: L(c.name), severity: sevLabel(c.severity), started: c.started, region: c.region }));
      break;
    case 'choke': rows = db.chokepoints.map((p) => ({ ref: ref(kind, p.id), name: L(p), status: p.status, oil_flow_mb_per_day: p.oilFlowMbd })); break;
    case 'bloc': rows = db.relations.blocs.map((b) => ({ ref: ref(kind, b.id), name: L(b), members: b.members.length })); break;
    case 'group': rows = [...db.ethnic.groups.values()].map((g) => ({ ref: ref(kind, g.id), name: lang === 'ar' ? g.nameAr : g.nameEn, countries: g.countries.length })); break;
    case 'religion': rows = db.religion.traditions.map((r) => ({ ref: ref(kind, r.id), name: L(r) })); break;
    case 'event': rows = db.timeline.events.filter((e) => e.year >= from && e.year <= to).map((e) => ({ ref: ref(kind, e.id), date: e.date, title: L(e) })); break;
    case 'disputed': rows = db.disputed.map((d) => ({ ref: ref(kind, d.id), name: lang === 'ar' ? d.nameAr : d.nameEn, administered_by: d.admin })); break;
    case 'site': rows = db.resources.sites.map((s) => ({ ref: ref(kind, s.id), name: L(s), type: s.type, country: s.iso3 })); break;
  }
  return { count: rows.length, records: rows.slice(0, 90), truncated: rows.length > 90 || undefined };
}

/** Drop empty fields so results stay compact, and make the value JSON-safe. */
function clean(v: unknown): Json {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(clean);
  if (typeof v === 'object') {
    const out: JsonObject = {};
    for (const [k, val] of Object.entries(v as Rec)) {
      if (val === undefined || val === null || val === '' || (Array.isArray(val) && !val.length)) continue;
      out[k] = clean(val);
    }
    return out;
  }
  return String(v);
}

