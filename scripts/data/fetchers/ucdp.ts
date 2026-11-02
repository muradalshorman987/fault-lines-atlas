// UCDP bulk downloads (not the token API): deaths per year for the atlas conflicts that list UCDP conflict ids (`ucdp`).
// - GED (yearly, final): the `deaths` series and latest value. Each event's `best` estimate is summed per year over the
//   conflict's ids (`conflict_new_id`), from the atlas conflict's start year; quiet years count as zero.
// - Candidate events (monthly, preliminary): `deathsPreliminary`, this year to date. Kept apart from the final series.
// Licence CC BY 4.0. https://ucdp.uu.se/downloads/

import { Unzip, UnzipInflate } from 'fflate';
import { streamCsv } from '../csv';
import type { FetchContext, Fetcher, GeneratedFile, Records } from '../types';

const INDEX = 'https://ucdp.uu.se/downloads/index.html';
const FIRST_GED_YEAR = 1989;

export interface UcdpLinks {
  ged: { url: string; version: string } | null;
  candidate: { url: string; year: number; through: string } | null;
}

// Only files served by UCDP itself over https are fetched: a tampered page cannot point the run elsewhere.
const trusted = (u: string) => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'ucdp.uu.se'; } catch { return false; } };

/** The newest GED CSV zip, and the newest cumulative candidate file (GEDEvent_vYY_01_YY_MM.csv), on the downloads page. */
export function findUcdpLinks(html: string): UcdpLinks {
  let ged: UcdpLinks['ged'] = null, gedN = -1;
  for (const m of html.matchAll(/https?:\/\/[^"'\s<>]*\/ged(\d{2})(\d)-csv\.zip/gi)) {
    if (!trusted(m[0])) continue;
    const n = Number(m[1]) * 10 + Number(m[2]);
    if (n > gedN) { gedN = n; ged = { url: m[0], version: `${m[1]}.${m[2]}` }; }
  }
  let candidate: UcdpLinks['candidate'] = null, candN = -1;
  for (const m of html.matchAll(/https?:\/\/[^"'\s<>]*\/GEDEvent_v(\d{2})_01_(\d{2})_(\d{2})\.csv/gi)) {
    if (!trusted(m[0])) continue;
    const n = Number(m[2]) * 100 + Number(m[3]);
    if (n > candN) { candN = n; candidate = { url: m[0], year: 2000 + Number(m[2]), through: `${2000 + Number(m[2])}-${m[3]}` }; }
  }
  return { ged, candidate };
}

/** Deaths per UCDP conflict id and year, and the last year the file covers. */
export interface Tally { deaths: Map<number, Map<number, number>>; maxYear: number }

async function* textChunks(stream: ReadableStream<Uint8Array>, zipped: boolean): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8');
  const queue: string[] = [];
  let failure: Error | null = null;
  const sink = (data: Uint8Array, final: boolean) => { queue.push(decoder.decode(data, { stream: !final })); };
  let unzip: Unzip | null = null;
  if (zipped) {
    let found = false;
    unzip = new Unzip((file) => {
      if (found || !/\.csv$/i.test(file.name)) return;
      found = true;
      file.ondata = (err, data, final) => { if (err) failure = err; else sink(data, final); };
      file.start();
    });
    unzip.register(UnzipInflate);
  }
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (value) { if (unzip) unzip.push(value); else sink(value, false); }
    if (done) { if (unzip) unzip.push(new Uint8Array(0), true); else queue.push(decoder.decode()); }
    if (failure) throw failure;
    while (queue.length) yield queue.shift()!;
    if (done) return;
  }
}

/** Streams a GED-style CSV (zipped or plain) and sums `best` per conflict_new_id and year, for the wanted ids only. */
export async function tallyCsv(stream: ReadableStream<Uint8Array>, ids: Set<number>, { zipped }: { zipped: boolean }): Promise<Tally> {
  const deaths = new Map<number, Map<number, number>>();
  let maxYear = 0, rows = 0;
  let cYear = -1, cId = -1, cBest = -1;
  await streamCsv(textChunks(stream, zipped), (row, col) => {
    if (cYear < 0) { cYear = col('year'); cId = col('conflict_new_id'); cBest = col('best'); }
    rows++;
    const year = Number(row[cYear]);
    if (year > maxYear) maxYear = year;
    const id = Number(row[cId]);
    if (!ids.has(id)) return;
    const best = Number(row[cBest]) || 0;
    const byYear = deaths.get(id) ?? new Map<number, number>();
    byYear.set(year, (byYear.get(year) ?? 0) + best);
    deaths.set(id, byYear);
  });
  if (!rows) throw new Error('UCDP file has no rows');
  return { deaths, maxYear };
}

/** One record per mapped conflict: the GED series from its start year (leading zero years trimmed) and the preliminary total. */
export function ucdpRecords(conflicts: FetchContext['refs']['conflicts'], ged: Tally, candidate: { tally: Tally; year: number } | null): Records {
  const out: Records = {};
  for (const c of conflicts) {
    if (!c.ucdp?.length) continue;
    const from = Math.max(parseInt(c.started ?? '', 10) || FIRST_GED_YEAR, FIRST_GED_YEAR);
    const sum = (t: Tally, y: number) => c.ucdp!.reduce((s, id) => s + (t.deaths.get(id)?.get(y) ?? 0), 0);
    const series: { year: number; value: number }[] = [];
    for (let y = from; y <= ged.maxYear; y++) {
      const value = sum(ged, y);
      if (value > 0 || series.length) series.push({ year: y, value });
    }
    const rec: Records[string] = {};
    const last = series.at(-1);
    if (last) rec.deaths = { value: last.value, year: last.year, series };
    if (candidate) rec.deathsPreliminary = { value: sum(candidate.tally, candidate.year), year: candidate.year };
    if (Object.keys(rec).length) out[c.id] = rec;
  }
  return out;
}

export const UCDP_CITATION = [
  'Sundberg, Ralph and Erik Melander (2013) “Introducing the UCDP Georeferenced Event Dataset”, Journal of Peace Research 50(4): 523–532.',
  'Hegre, Håvard, Mihai Croicu, Kristine Eck and Stina Högbladh (2020) “Introducing the UCDP Candidate Events Dataset”, Research & Politics 7(3).',
].join(' ');

export const ucdp: Fetcher = {
  id: 'ucdp',
  name: 'UCDP',
  async run({ http, refs, now, log }) {
    const ids = new Set(refs.conflicts.flatMap((c) => c.ucdp ?? []));
    if (!ids.size) throw new Error('no curated conflict has a ucdp field; nothing to fetch');
    const links = findUcdpLinks(await http.text(INDEX));
    if (!links.ged) throw new Error(`no GED CSV link found on ${INDEX}`);
    log(`ucdp: GED ${links.ged.version}${links.candidate ? `, candidate to ${links.candidate.through}` : ''}`);
    const ged = await tallyCsv(await http.stream(links.ged.url), ids, { zipped: true });
    let candidate: { tally: Tally; year: number } | null = null;
    if (links.candidate && links.candidate.year > ged.maxYear) {
      candidate = { tally: await tallyCsv(await http.stream(links.candidate.url), ids, { zipped: false }), year: links.candidate.year };
    }
    const c = links.candidate;
    const file: GeneratedFile = {
      source: 'ucdp',
      name: 'UCDP',
      licence: 'CC BY 4.0',
      url: 'https://ucdp.uu.se/downloads/',
      fetchedAt: now.toISOString(),
      keys: 'conflict',
      version: `GED ${links.ged.version}${candidate && c ? `; Candidate ${c.year}-01 to ${c.through}` : ''}`,
      citation: UCDP_CITATION,
      indicators: {
        deaths: {
          label: { ar: 'الوفيات في العنف المنظّم المرتبط بالنزاع (أفضل تقدير لـ UCDP)', en: 'Deaths in organised violence linked to the conflict (UCDP best estimate)' },
          unit: 'people',
        },
        ...(candidate ? {
          deathsPreliminary: {
            label: { ar: 'الوفيات منذ بداية العام (أولية، أحداث UCDP المرشّحة)', en: 'Deaths this year to date (preliminary, UCDP Candidate events)' },
            unit: 'people',
          },
        } : {}),
      },
      records: ucdpRecords(refs.conflicts, ged, candidate),
    };
    return file;
  },
};
