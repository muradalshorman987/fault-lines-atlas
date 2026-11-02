// Wikidata SPARQL: a drift report of bloc memberships (P463 "member of", with start P580 and end P582 dates) against
// the curated relations.blocs. It goes into the data pull request text only and never changes the curated data.
// Licence CC0. Wikidata asks every client to send an identifying User-Agent (http.ts does).

import { atlasIso } from '../refs';
import type { AtlasRefs, FetchContext } from '../types';

/** Wikidata items of the curated blocs. A new bloc in relations.json needs its item here (a test checks). */
export const BLOC_QIDS: Record<string, string> = {
  nato: 'Q7184',
  gcc: 'Q217172',
  eu: 'Q458',
  aes: 'Q122624387',
  brics: 'Q243630',
  csto: 'Q318693',
  sco: 'Q485207',
  'arab-league': 'Q7172',
  turkic: 'Q596850',
};

export interface BlocDrift {
  bloc: string; name: string; qid: string;
  /** Current members per Wikidata that the atlas does not list, with the start date when Wikidata has one. */
  onlyWikidata: { iso3: string; since?: string }[];
  /** Members the atlas lists that Wikidata does not show as current, with the end date when Wikidata has one. */
  onlyAtlas: { iso3: string; until?: string }[];
}

interface Binding { country: { value: string }; bloc: { value: string }; iso?: { value: string }; start?: { value: string }; end?: { value: string } }

const qidOf = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1);
const day = (v: string | undefined) => (v ? v.replace(/^\+/, '').slice(0, 10) : undefined);

/** Countries are matched by Natural Earth's Wikidata id, else by the item's ISO 3166-1 alpha-3 code (P298) when the
 *  atlas has that country: Natural Earth sometimes names a different item (e.g. the Kingdom of Denmark). */
export function blocDrift(rows: Binding[], refs: Pick<AtlasRefs, 'qidToIso' | 'blocs'> & { isos?: Set<string> }, now: Date): BlocDrift[] {
  const today = now.toISOString().slice(0, 10);
  const blocByQid = new Map(Object.entries(BLOC_QIDS).map(([id, q]) => [q, id]));
  // bloc → iso → { current, since, until }
  const seen = new Map<string, Map<string, { current: boolean; since?: string; until?: string }>>();
  for (const r of rows) {
    const code = r.iso?.value ? atlasIso(r.iso.value) : undefined;
    const bloc = blocByQid.get(qidOf(r.bloc.value));
    const iso = refs.qidToIso.get(qidOf(r.country.value)) ?? (code && refs.isos?.has(code) ? code : undefined);
    if (!bloc || !iso) continue;
    const start = day(r.start?.value), end = day(r.end?.value);
    const current = (!start || start <= today) && (!end || end > today);
    const m = seen.get(bloc) ?? new Map();
    const prev = m.get(iso);
    m.set(iso, {
      current: !!prev?.current || current,
      since: current ? start ?? prev?.since : prev?.since,
      until: end && end <= today && (!prev?.until || end > prev.until) ? end : prev?.until,
    });
    seen.set(bloc, m);
  }
  const out: BlocDrift[] = [];
  for (const b of refs.blocs) {
    const qid = BLOC_QIDS[b.id];
    if (!qid) continue;
    const wd = seen.get(b.id) ?? new Map();
    const atlas = new Set(b.members);
    const onlyWikidata = [...wd].filter(([iso, s]) => s.current && !atlas.has(iso)).map(([iso3, s]) => ({ iso3, ...(s.since ? { since: s.since } : {}) }));
    const onlyAtlas = b.members.filter((iso) => !wd.get(iso)?.current).map((iso3) => {
      const until = wd.get(iso3)?.until;
      return { iso3, ...(until ? { until } : {}) };
    });
    const byIso = (a: { iso3: string }, z: { iso3: string }) => a.iso3.localeCompare(z.iso3);
    if (onlyWikidata.length || onlyAtlas.length) out.push({ bloc: b.id, name: b.en, qid, onlyWikidata: onlyWikidata.sort(byIso), onlyAtlas: onlyAtlas.sort(byIso) });
  }
  return out;
}

export async function fetchDrift({ http, refs, now }: FetchContext): Promise<BlocDrift[]> {
  const values = refs.blocs.map((b) => BLOC_QIDS[b.id]).filter(Boolean).map((q) => `wd:${q}`).join(' ');
  const query = `SELECT ?country ?bloc ?iso ?start ?end WHERE {
  VALUES ?bloc { ${values} }
  ?country p:P463 ?st . ?st ps:P463 ?bloc ; wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end } OPTIONAL { ?country wdt:P298 ?iso }
}`;
  const body = await http.json<{ results?: { bindings?: Binding[] } }>(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`);
  const rows = body.results?.bindings;
  if (!Array.isArray(rows)) throw new Error('Wikidata: unexpected SPARQL answer');
  return blocDrift(rows, refs, now);
}
