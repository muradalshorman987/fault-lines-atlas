// The data pull request text: what changed per source, the biggest changes, failures and the Wikidata bloc drift.
// update.ts writes it with `--report <file>`; the workflow uses that file as the pull request body.

import type { SourceState } from '../schema';
import type { BlocDrift } from './fetchers/wikidata';
import type { GeneratedFile } from './types';

export interface Change { key: string; indicator: string; from: number; to: number; fromYear: number; toYear: number; pct: number }
export interface FileDiff { added: number; removed: number; changed: number; biggest: Change[] }
export interface SourceRun { id: string; name: string; state: SourceState; message?: string; diff?: FileDiff }

const BIGGEST = 5;
const MAX_DRIFT_ROWS = 25;
const MAX_LENGTH = 60_000; // GitHub caps a pull request body at 65,536 characters

/** Value-level differences between two versions of one generated file (a value or its year changing counts once). */
export function diffFiles(prev: GeneratedFile | null, next: GeneratedFile): FileDiff {
  let added = 0, removed = 0, changed = 0;
  const all: Change[] = [];
  const before = prev?.records ?? {};
  for (const [key, rec] of Object.entries(next.records)) {
    for (const [indicator, v] of Object.entries(rec)) {
      const p = before[key]?.[indicator];
      if (!p) { added++; continue; }
      if (p.value === v.value && p.year === v.year) continue;
      changed++;
      const pct = p.value === 0 ? (v.value === 0 ? 0 : Infinity) : (v.value - p.value) / Math.abs(p.value);
      all.push({ key, indicator, from: p.value, to: v.value, fromYear: p.year, toYear: v.year, pct });
    }
  }
  for (const [key, rec] of Object.entries(before)) for (const indicator of Object.keys(rec)) if (!next.records[key]?.[indicator]) removed++;
  const biggest = all.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct) || a.key.localeCompare(b.key)).slice(0, BIGGEST);
  return { added, removed, changed, biggest };
}

const num = (n: number) => (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 100) / 100));
const pct = (p: number) => {
  if (!Number.isFinite(p)) return 'from zero';
  if (Math.abs(p) < 0.001) return 'under 0.1%';
  return `${p > 0 ? '+' : ''}${Math.round(p * 1000) / 10}%`;
};
const STATE_TEXT: Record<SourceState, string> = {
  ok: 'updated', unchanged: 'no change', skipped: 'skipped', error: 'failed — the previous file was kept', unavailable: 'unavailable — the previous file was kept',
};

export function renderReport({ runAt, runs, drift, driftError }: { runAt: string; runs: SourceRun[]; drift?: BlocDrift[] | null; driftError?: string }): string {
  const L: string[] = [];
  L.push(`Weekly open-data update, run ${runAt.slice(0, 16).replace('T', ' ')} UTC.`, '');
  L.push('Checks that ran before this pull request opened: `check-data`, typecheck and unit tests. Review the figures, then merge.', '');
  L.push('## Sources', '', '| Source | Result | Values added | changed | removed |', '|---|---|---:|---:|---:|');
  for (const r of runs) {
    const d = r.diff;
    const result = `${STATE_TEXT[r.state]}${r.message ? `: ${r.message.replace(/\|/g, '\\|')}` : ''}`;
    L.push(`| ${r.name} | ${result} | ${d ? d.added : '—'} | ${d ? d.changed : '—'} | ${d ? d.removed : '—'} |`);
  }
  const big = runs.filter((r) => r.diff?.biggest.length);
  if (big.length) {
    L.push('', '## Biggest changes', '');
    for (const r of big) {
      L.push(`**${r.name}**`, '');
      for (const c of r.diff!.biggest) L.push(`- ${c.key} · ${c.indicator}: ${num(c.from)} (${c.fromYear}) → ${num(c.to)} (${c.toYear}), ${pct(c.pct)}`);
      L.push('');
    }
  }
  const failed = runs.filter((r) => r.state === 'error' || r.state === 'unavailable');
  if (failed.length) {
    L.push('', '## Failures', '', 'These sources kept their previous file. Details are in `public/data/generated/_status.json`.', '');
    for (const r of failed) L.push(`- **${r.name}** (${r.state}): ${r.message ?? 'no message'}`);
  }
  L.push('', '## Bloc membership drift (Wikidata)', '');
  L.push('Wikidata P463 memberships compared with `relations.blocs`. This list is for review only; the pipeline never changes the curated data.', '');
  if (driftError) L.push(`The Wikidata query failed: ${driftError}`);
  else if (!drift?.length) L.push('No differences.');
  else {
    let rows = 0;
    for (const d of drift) {
      if (rows >= MAX_DRIFT_ROWS) { L.push(`- … and ${drift.length - drift.indexOf(d)} more blocs`); break; }
      const only = d.onlyWikidata.map((x) => `${x.iso3}${x.since ? ` (since ${x.since})` : ''}`).join(', ');
      const gone = d.onlyAtlas.map((x) => `${x.iso3}${x.until ? ` (ended ${x.until})` : ''}`).join(', ');
      L.push(`- **${d.name}** ([${d.qid}](https://www.wikidata.org/wiki/${d.qid}))${only ? ` · in Wikidata, not in the atlas: ${only}` : ''}${gone ? ` · in the atlas, not current in Wikidata: ${gone}` : ''}`);
      rows++;
    }
  }
  const text = L.join('\n') + '\n';
  return text.length > MAX_LENGTH ? text.slice(0, MAX_LENGTH) + '\n\n… (report truncated)\n' : text;
}
