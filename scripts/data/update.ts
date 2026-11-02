// Runs every open-data fetcher, validates each new file and writes it to public/data/generated/<source>.json.
// A source that fails, whose output fails validation, or whose record count drops by more than 20% keeps its previous
// file; the error goes to _status.json and the run still succeeds for the other sources. Values that did not change leave the file untouched (no churn in pull requests).
//
//   npm run data:update                         all sources
//   npm run data:update -- --only ucdp,unhcr    some sources
//   npm run data:update -- --report report.md   also write the pull request text
//
// In GitHub Actions it also sets the step outputs `changed`, `failed` and `new_failure` (see .github/workflows/data-update.yml).

import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { checkGenerated } from '../check-data';
import { formatJson } from '../format-json';
import { statusFile, type SourceState } from '../schema';
import { eia } from './fetchers/eia';
import { ucdp } from './fetchers/ucdp';
import { unhcr } from './fetchers/unhcr';
import { usgs } from './fetchers/usgs';
import { fetchDrift, type BlocDrift } from './fetchers/wikidata';
import { worldbank } from './fetchers/worldbank';
import { createHttp } from './http';
import { loadRefs } from './refs';
import { diffFiles, renderReport, type SourceRun } from './report';
import { SourceUnavailable, type FetchContext, type Fetcher, type GeneratedFile } from './types';

/** In GENERATED order (src/data/files.ts): the app gives the earlier file priority. */
export const FETCHERS: Fetcher[] = [worldbank, ucdp, unhcr, usgs, eia];

type Status = { updatedAt: string; sources: Record<string, { state: SourceState; checkedAt: string; fetchedAt: string | null; message?: string; records?: number }>; drift?: { state: 'ok' | 'error'; checkedAt: string; differences?: number; message?: string } };

/** `changed`: some file was rewritten. `failed`: some source failed. `newFailure`: a source failed that did not fail the same way
 *  last run (the workflow opens a pull request for `changed || newFailure`, so a source that stays down does not open one weekly). */
export interface UpdateResult { runs: SourceRun[]; drift: BlocDrift[] | null; driftError?: string; changed: boolean; failed: boolean; newFailure: boolean; status: Status }

const readJson = (file: string): unknown => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } // missing or unreadable: treated as "no previous file"
};
/** A new file with this much fewer records than the last good one is treated as a failure (the previous file stays). */
const MAX_SHRINK = 0.2;
const isFailure = (r: SourceRun) => r.state === 'error' || r.state === 'unavailable';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);
const sameData = (a: GeneratedFile, b: GeneratedFile) =>
  isDeepStrictEqual({ ...a, fetchedAt: '' }, { ...b, fetchedAt: '' });

export async function runUpdate({ dataDir, fetchers, ctx, drift }: {
  dataDir: string; fetchers: Fetcher[]; ctx: FetchContext; drift?: (ctx: FetchContext) => Promise<BlocDrift[]>;
}): Promise<UpdateResult> {
  const dir = path.join(dataDir, 'generated');
  fs.mkdirSync(dir, { recursive: true });
  const statusPath = path.join(dir, '_status.json');
  const old = statusFile.safeParse(readJson(statusPath));
  const last = old.success ? (old.data as Status) : null;
  // Sources and the drift summary that this run does not touch (--only) keep their last entries.
  const status: Status = { updatedAt: ctx.now.toISOString(), sources: { ...last?.sources }, ...(last?.drift ? { drift: last.drift } : {}) };
  const before = { ...status.sources };
  const checkedAt = ctx.now.toISOString();
  const refs = {
    isos: ctx.refs.isos, conflictIds: new Set(ctx.refs.conflicts.map((c) => c.id)), resourceTypes: new Set(ctx.refs.resourceTypes.keys()),
  };

  const runs = await Promise.all(fetchers.map(async (f): Promise<SourceRun> => {
    const file = path.join(dir, `${f.id}.json`);
    const prevRaw = readJson(file);
    const prev = prevRaw && checkGenerated(`generated/${f.id}.json`, prevRaw, refs).length === 0 ? (prevRaw as GeneratedFile) : null;
    const keep = (state: SourceState, msg: string): SourceRun => {
      status.sources[f.id] = { state, checkedAt, fetchedAt: prev?.fetchedAt ?? null, message: msg };
      ctx.log(`${f.id}: ${state}: ${msg}`);
      return { id: f.id, name: f.name, state, message: msg };
    };
    let next: GeneratedFile;
    try {
      const out = await f.run(ctx);
      if ('skip' in out) return keep('skipped', out.skip);
      next = out;
    } catch (e) {
      return keep(e instanceof SourceUnavailable ? 'unavailable' : 'error', message(e));
    }
    const problems = checkGenerated(`generated/${f.id}.json`, next, refs);
    if (problems.length) {
      const list = problems.slice(0, 5).map((p) => `${p.path || '(file)'} › ${p.message}`).join('; ');
      return keep('error', `failed validation (${problems.length} problem${problems.length > 1 ? 's' : ''}): ${list}`);
    }
    const records = Object.keys(next.records).length;
    const had = prev ? Object.keys(prev.records).length : 0;
    if (records < had * (1 - MAX_SHRINK)) {
      return keep('error', `records fell from ${had} to ${records}, more than ${MAX_SHRINK * 100}%; kept the previous file (the newest year may be only partly published)`);
    }
    if (prev && sameData(prev, next)) {
      status.sources[f.id] = { state: 'unchanged', checkedAt, fetchedAt: prev.fetchedAt, records };
      ctx.log(`${f.id}: no change`);
      return { id: f.id, name: f.name, state: 'unchanged' };
    }
    fs.writeFileSync(file, formatJson(next));
    status.sources[f.id] = { state: 'ok', checkedAt, fetchedAt: next.fetchedAt, records };
    const diff = diffFiles(prev, next);
    ctx.log(`${f.id}: ${records} records; ${diff.added} added, ${diff.changed} changed, ${diff.removed} removed`);
    return { id: f.id, name: f.name, state: 'ok', diff };
  }));

  let driftOut: BlocDrift[] | null = null, driftError: string | undefined;
  if (drift) {
    try {
      driftOut = await drift(ctx);
      status.drift = { state: 'ok', checkedAt, differences: driftOut.reduce((n, d) => n + d.onlyAtlas.length + d.onlyWikidata.length, 0) };
    } catch (e) {
      driftError = message(e);
      status.drift = { state: 'error', checkedAt, message: driftError };
    }
  }
  // Sources in FETCHERS order whatever ran this time (--only), then any others, so the file diffs cleanly.
  const rank = (id: string) => {
    const i = FETCHERS.findIndex((f) => f.id === id), j = fetchers.findIndex((f) => f.id === id);
    return [i < 0 ? FETCHERS.length : i, j < 0 ? fetchers.length : j] as const;
  };
  const order = Object.keys(status.sources).sort((a, b) => {
    const [ra, sa] = rank(a), [rb, sb] = rank(b);
    return ra - rb || sa - sb || a.localeCompare(b);
  });
  status.sources = Object.fromEntries(order.map((id) => [id, status.sources[id]!]));
  fs.writeFileSync(statusPath, formatJson(status));
  return {
    runs, drift: driftOut, driftError, status,
    changed: runs.some((r) => r.state === 'ok'),
    failed: runs.some(isFailure),
    newFailure: runs.some((r) => isFailure(r) && before[r.id]?.state !== r.state),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const only = opt('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
  const reportPath = opt('--report');
  const unknown = only?.filter((id) => !FETCHERS.some((f) => f.id === id) && id !== 'wikidata');
  if (unknown?.length) throw new Error(`unknown source(s): ${unknown.join(', ')}; known: ${FETCHERS.map((f) => f.id).join(', ')}, wikidata`);

  const dataDir = path.resolve(import.meta.dirname, '../../public/data');
  const ctx: FetchContext = { now: new Date(), refs: loadRefs(dataDir), env: process.env, http: createHttp(), log: (m) => console.log(m) };
  const fetchers = only ? FETCHERS.filter((f) => only.includes(f.id)) : FETCHERS;
  const wantDrift = !only || only.includes('wikidata');
  const r = await runUpdate({ dataDir, fetchers, ctx, drift: wantDrift ? fetchDrift : undefined });

  if (reportPath) fs.writeFileSync(reportPath, renderReport({ runAt: ctx.now.toISOString(), runs: r.runs, drift: r.drift, driftError: r.driftError }));
  if (r.drift) for (const d of r.drift) console.log(`wikidata drift: ${d.name}: +${d.onlyWikidata.map((x) => x.iso3).join(',') || '-'} / -${d.onlyAtlas.map((x) => x.iso3).join(',') || '-'}`);
  if (r.driftError) console.log(`wikidata: error: ${r.driftError}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${r.changed}\nfailed=${r.failed}\nnew_failure=${r.newFailure}\n`);
  console.log(`\n${r.runs.filter((x) => x.state === 'ok').length} updated, ${r.runs.filter((x) => x.state === 'unchanged').length} unchanged, `
    + `${r.runs.filter((x) => x.state === 'skipped').length} skipped, ${r.runs.filter(isFailure).length} failed`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
