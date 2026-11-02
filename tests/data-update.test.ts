// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { formatJson } from '../scripts/format-json';
import { statusFile } from '../scripts/schema';
import { diffFiles, renderReport } from '../scripts/data/report';
import { runUpdate } from '../scripts/data/update';
import { SourceUnavailable, type Fetcher, type GeneratedFile } from '../scripts/data/types';
import { fakeCtx, fakeHttp } from './data-fakes';

const file = (records: GeneratedFile['records'], fetchedAt = '2026-10-26T04:00:00.000Z'): GeneratedFile => ({
  source: 'wb', name: 'World Bank', licence: 'CC BY 4.0', url: 'https://data.worldbank.org/', fetchedAt, keys: 'iso3',
  indicators: { population: { label: { ar: 'السكان', en: 'Population' }, unit: 'people' } },
  records,
});
const fetcher = (run: Fetcher['run'], id = 'wb'): Fetcher => ({ id, name: 'World Bank', run });
const ctx = () => fakeCtx({ http: fakeHttp({}), isos: new Set(['SAU', 'QAT', 'KOS']) });

let dir: string;
const gen = (f: string) => path.join(dir, 'generated', f);
const read = (f: string) => fs.readFileSync(gen(f), 'utf8');
const status = () => statusFile.parse(JSON.parse(read('_status.json'))) as { sources: Record<string, { state: string; message?: string; fetchedAt?: string | null }> };
const PREV = file({ SAU: { population: { value: 100, year: 2024 } } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-update-'));
  fs.mkdirSync(path.join(dir, 'generated'));
  fs.writeFileSync(gen('wb.json'), formatJson(PREV));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('runUpdate keeps the last good file', () => {
  test('when a fetcher throws', async () => {
    const r = await runUpdate({ dataDir: dir, fetchers: [fetcher(async () => { throw new Error('HTTP 502'); })], ctx: ctx() });
    expect(read('wb.json')).toBe(formatJson(PREV));
    expect(status().sources.wb).toMatchObject({ state: 'error', message: 'HTTP 502', fetchedAt: PREV.fetchedAt });
    expect(r).toMatchObject({ changed: false, failed: true });
  });

  test('when the output fails validation', async () => {
    const bad = file({ XXX: { population: { value: 1, year: 2025 } }, SAU: { population: { value: Number.NaN, year: 2025 } } });
    await runUpdate({ dataDir: dir, fetchers: [fetcher(async () => bad)], ctx: ctx() });
    expect(read('wb.json')).toBe(formatJson(PREV));
    expect(status().sources.wb!.state).toBe('error');
    expect(status().sources.wb!.message).toMatch(/failed validation/);
    expect(status().sources.wb!.message).toMatch(/records\.XXX/);
  });

  test('when the source refuses scripted access, it is marked unavailable', async () => {
    await runUpdate({ dataDir: dir, fetchers: [fetcher(async () => { throw new SourceUnavailable('Cloudflare challenge'); })], ctx: ctx() });
    expect(read('wb.json')).toBe(formatJson(PREV));
    expect(status().sources.wb).toMatchObject({ state: 'unavailable', message: 'Cloudflare challenge' });
  });

  test('when the record count drops by more than 20% (e.g. a partly published year)', async () => {
    const five = file({ SAU: { population: { value: 1, year: 2024 } }, QAT: { population: { value: 2, year: 2024 } }, KOS: { population: { value: 3, year: 2024 } }, TWN: { population: { value: 4, year: 2024 } }, FRA: { population: { value: 5, year: 2024 } } });
    fs.writeFileSync(gen('wb.json'), formatJson(five));
    const big = new Set(['SAU', 'QAT', 'KOS', 'TWN', 'FRA']);
    const three = file({ SAU: { population: { value: 9, year: 2025 } }, QAT: { population: { value: 9, year: 2025 } }, KOS: { population: { value: 9, year: 2025 } } });
    const r = await runUpdate({ dataDir: dir, fetchers: [fetcher(async () => three)], ctx: fakeCtx({ http: fakeHttp({}), isos: big }) });
    expect(read('wb.json')).toBe(formatJson(five));
    expect(status().sources.wb).toMatchObject({ state: 'error', fetchedAt: five.fetchedAt });
    expect(status().sources.wb!.message).toMatch(/records fell from 5 to 3/);
    expect(r).toMatchObject({ changed: false, failed: true });

    const four = file({ SAU: { population: { value: 9, year: 2025 } }, QAT: { population: { value: 9, year: 2025 } }, KOS: { population: { value: 9, year: 2025 } }, TWN: { population: { value: 9, year: 2025 } } });
    await runUpdate({ dataDir: dir, fetchers: [fetcher(async () => four)], ctx: fakeCtx({ http: fakeHttp({}), isos: big }) });
    expect(read('wb.json')).toBe(formatJson(four)); // a 20% drop is still accepted
  });

  test('when the fetcher is skipped (no key)', async () => {
    const r = await runUpdate({ dataDir: dir, fetchers: [fetcher(async () => ({ skip: 'EIA_API_KEY is not set' }))], ctx: ctx() });
    expect(read('wb.json')).toBe(formatJson(PREV));
    expect(status().sources.wb).toMatchObject({ state: 'skipped', message: 'EIA_API_KEY is not set' });
    expect(r.failed).toBe(false);
  });
});

describe('runUpdate writes new data', () => {
  test('a changed file is written in the canonical layout and the other sources still run', async () => {
    const next = file({ SAU: { population: { value: 110, year: 2025 } }, KOS: { population: { value: 2, year: 2025 } } }, '2026-11-02T04:00:00.000Z');
    const r = await runUpdate({
      dataDir: dir, ctx: ctx(),
      fetchers: [fetcher(async () => next), fetcher(async () => { throw new Error('down'); }, 'other')],
    });
    expect(read('wb.json')).toBe(formatJson(next));
    expect(status().sources.wb).toMatchObject({ state: 'ok', fetchedAt: next.fetchedAt });
    expect(status().sources.other!.state).toBe('error');
    expect(r).toMatchObject({ changed: true, failed: true });
    expect(r.runs[0]!.diff).toMatchObject({ added: 1, removed: 0, changed: 1 });
  });

  test('the same values with a new fetch time leave the file untouched', async () => {
    const r = await runUpdate({ dataDir: dir, fetchers: [fetcher(async () => file(PREV.records, '2026-11-02T04:00:00.000Z'))], ctx: ctx() });
    expect(read('wb.json')).toBe(formatJson(PREV));
    expect(status().sources.wb!.state).toBe('unchanged');
    expect(r.changed).toBe(false);
  });

  test('a first run with no previous file creates it', async () => {
    fs.rmSync(gen('wb.json'));
    await runUpdate({ dataDir: dir, fetchers: [fetcher(async () => PREV)], ctx: ctx() });
    expect(JSON.parse(read('wb.json'))).toEqual(PREV);
  });

  test('the drift report runs too, and its failure is reported, never fatal', async () => {
    const r = await runUpdate({ dataDir: dir, fetchers: [], ctx: ctx(), drift: async () => { throw new Error('SPARQL 429'); } });
    expect(r.driftError).toBe('SPARQL 429');
    expect(JSON.parse(read('_status.json')).drift).toMatchObject({ state: 'error', message: 'SPARQL 429' });
  });

  test('a run of some sources only (--only) keeps the other entries, including the last drift summary', async () => {
    await runUpdate({ dataDir: dir, fetchers: [fetcher(async () => { throw new Error('down'); }, 'other')], ctx: ctx(), drift: async () => [] });
    await runUpdate({ dataDir: dir, fetchers: [fetcher(async () => PREV)], ctx: ctx() });
    const s = JSON.parse(read('_status.json'));
    expect(Object.keys(s.sources)).toEqual(['wb', 'other']);
    expect(s.drift).toMatchObject({ state: 'ok', differences: 0 });
  });

  test('_status.json lists the real sources in pipeline order, whichever ran last', async () => {
    const real = (id: string) => fetcher(async () => ({ skip: 'test' }), id);
    await runUpdate({ dataDir: dir, fetchers: ['eia', 'worldbank', 'ucdp', 'usgs'].map(real), ctx: ctx() });
    await runUpdate({ dataDir: dir, fetchers: [real('unhcr')], ctx: ctx() });
    expect(Object.keys(JSON.parse(read('_status.json')).sources)).toEqual(['worldbank', 'ucdp', 'unhcr', 'usgs', 'eia']);
  });
});

describe('report', () => {
  const before = file({ SAU: { population: { value: 100, year: 2024 } }, QAT: { population: { value: 50, year: 2024 } }, KOS: { population: { value: 9, year: 2024 } } });
  const after = file({ SAU: { population: { value: 101, year: 2025 } }, QAT: { population: { value: 80, year: 2025 } }, TWN: { population: { value: 3, year: 2025 } } });

  test('counts added, removed and changed values and ranks the biggest relative changes', () => {
    const d = diffFiles(before, after);
    expect(d).toMatchObject({ added: 1, removed: 1, changed: 2 });
    expect(d.biggest.map((c) => c.key)).toEqual(['QAT', 'SAU']);
    expect(d.biggest[0]).toMatchObject({ indicator: 'population', from: 50, to: 80, fromYear: 2024, toYear: 2025 });
    expect(diffFiles(null, after)).toMatchObject({ added: 3, removed: 0, changed: 0 });
  });

  test('the pull request text lists changes, failures and the bloc drift', () => {
    const md = renderReport({
      runAt: '2026-11-02T04:00:00.000Z',
      runs: [
        { id: 'wb', name: 'World Bank', state: 'ok', diff: diffFiles(before, after) },
        { id: 'usgs', name: 'USGS', state: 'unavailable', message: 'Cloudflare challenge' },
        { id: 'eia', name: 'EIA', state: 'skipped', message: 'EIA_API_KEY is not set' },
      ],
      drift: [{ bloc: 'brics', name: 'BRICS', qid: 'Q243630', onlyWikidata: [{ iso3: 'IDN', since: '2025-01-06' }], onlyAtlas: [{ iso3: 'SAU' }] }],
    });
    expect(md).toContain('World Bank');
    expect(md).toMatch(/QAT.*population.*50.*80/);
    expect(md).toMatch(/USGS.*unavailable.*Cloudflare challenge/);
    expect(md).toMatch(/EIA.*skipped/);
    expect(md).toMatch(/BRICS[\s\S]*IDN[\s\S]*2025-01-06[\s\S]*SAU/);
    expect(md).toContain('never changes the curated data');
  });
});
