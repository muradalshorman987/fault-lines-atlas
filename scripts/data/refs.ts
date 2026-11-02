// Reads what the fetchers need to know about the atlas from public/data: country codes, names and Wikidata ids,
// conflicts with their UCDP mapping, resource types and blocs.

import fs from 'node:fs';
import path from 'node:path';
import { CONFLICT_FILES, FILES } from '../../src/data/files';
import type { Bi } from '../../src/i18n/format';
import type { AtlasRefs } from './types';

export const ISO_ALIAS: Record<string, string> = { XKX: 'KOS', XKS: 'KOS' };
export const atlasIso = (code: string) => ISO_ALIAS[code] ?? code;

/** Lower case, no accents, no punctuation: "Côte d'Ivoire" → "cote d ivoire". */
export const normName = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

type Json = Record<string, unknown>;
const read = (dir: string, rel: string) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8')) as Json;

export function loadRefs(dataDir: string): AtlasRefs {
  const geo = read(dataDir, FILES.countries) as { features: { properties: Record<string, string | undefined> }[] };
  const isos = new Set<string>(), qidToIso = new Map<string, string>(), names = new Map<string, string>();
  for (const { properties: p } of geo.features) {
    const iso = p.iso3!;
    isos.add(iso);
    if (p.wikidataid) qidToIso.set(p.wikidataid, iso);
    for (const n of [p.name_en, p.name_long, p.admin]) if (n && !names.has(normName(n))) names.set(normName(n), iso);
  }
  const conflicts = CONFLICT_FILES.flatMap((k) => (read(dataDir, FILES[k]).conflicts as { id: string; started?: string; ucdp?: number[] }[])
    .map(({ id, started, ucdp }) => ({ id, started, ucdp })));
  const res = read(dataDir, FILES.resources) as { types: { id: string; ar: string; en: string }[] };
  const rel = read(dataDir, FILES.relations) as { blocs: { id: string; en: string; members: string[] }[] };
  return {
    isos, qidToIso, names, conflicts,
    resourceTypes: new Map<string, Bi>(res.types.map((t) => [t.id, { ar: t.ar, en: t.en }])),
    blocs: rel.blocs.map((b) => ({ id: b.id, en: b.en, members: b.members.map(atlasIso) })),
  };
}
