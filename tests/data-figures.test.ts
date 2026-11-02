import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { FILES, GENERATED } from '../src/data/files';
import { buildFigures, isGeneratedFile, type GeneratedFile } from '../src/data/join';
import { loadAll } from '../src/data/load';
import { DATA_DIR } from './helpers/readRaw';

const WB: GeneratedFile = {
  source: 'worldbank', name: 'World Bank', licence: 'CC BY 4.0', url: 'https://data.worldbank.org/', fetchedAt: '2026-11-02T04:00:00.000Z', keys: 'iso3',
  indicators: {
    population: { label: { ar: 'السكان', en: 'Population' }, unit: 'people' },
    gdp: { label: { ar: 'الناتج', en: 'GDP' }, unit: 'USD' },
  },
  records: { SAU: { population: { value: 36973555, year: 2025 }, gdp: { value: 1.24e12, year: 2024 } }, XKX: { population: { value: 1576876, year: 2025 } } },
};
const UCDP: GeneratedFile = {
  source: 'ucdp', name: 'UCDP', licence: 'CC BY 4.0', url: 'https://ucdp.uu.se/downloads/', fetchedAt: '2026-11-02T04:00:00.000Z', keys: 'conflict',
  citation: 'Sundberg and Melander (2013)',
  indicators: { deaths: { label: { ar: 'الوفيات', en: 'Deaths' }, unit: 'people' } },
  records: {
    sudan: { deaths: { value: 300, year: 2025, series: [{ year: 2023, value: 500 }, { year: 2024, value: 0 }, { year: 2025, value: 300 }] } },
    yemen: { deaths: { value: 40, year: 2025 } },
  },
};
const EIA: GeneratedFile = {
  source: 'eia', name: 'EIA', licence: 'Public domain', url: 'https://www.eia.gov/', fetchedAt: '2026-11-02T04:00:00.000Z', keys: 'iso3',
  indicators: { 'prod:oil': { label: { ar: 'إنتاج النفط', en: 'Oil production' }, unit: 'thousand barrels per day' } },
  records: { SAU: { 'prod:oil': { value: 9548.75, year: 2025 } } },
};

describe('db.figures from generated files', () => {
  const figures = buildFigures([WB, UCDP, EIA]);

  test('country figures carry value, year, source id and unit; XKX is read as KOS', () => {
    expect(figures.country('SAU')).toEqual({
      population: { value: 36973555, year: 2025, source: 'worldbank', unit: 'people' },
      gdp: { value: 1.24e12, year: 2024, source: 'worldbank', unit: 'USD' },
    });
    expect(figures.country('KOS').population?.value).toBe(1576876);
    expect(figures.country('TWN')).toEqual({});
  });

  test('conflict deaths come from the yearly series, or the single latest value', () => {
    expect(figures.conflictDeaths('sudan')).toEqual([{ year: 2023, value: 500 }, { year: 2024, value: 0 }, { year: 2025, value: 300 }]);
    expect(figures.conflictDeaths('yemen')).toEqual([{ year: 2025, value: 40 }]);
    expect(figures.conflictDeaths('nowhere')).toEqual([]);
  });

  test('sources list each loaded file, in load order, with its citation', () => {
    expect(figures.sources).toEqual([
      { id: 'worldbank', name: 'World Bank', licence: 'CC BY 4.0', url: 'https://data.worldbank.org/', fetchedAt: '2026-11-02T04:00:00.000Z' },
      { id: 'ucdp', name: 'UCDP', licence: 'CC BY 4.0', url: 'https://ucdp.uu.se/downloads/', fetchedAt: '2026-11-02T04:00:00.000Z', citation: 'Sundberg and Melander (2013)' },
      { id: 'eia', name: 'EIA', licence: 'Public domain', url: 'https://www.eia.gov/', fetchedAt: '2026-11-02T04:00:00.000Z' },
    ]);
  });

  test('the shape check rejects what is not a generated file', () => {
    expect(isGeneratedFile(WB)).toBe(true);
    expect(isGeneratedFile({ source: 'x' })).toBe(false);
    expect(isGeneratedFile('<!doctype html>')).toBe(false);
    expect(isGeneratedFile({ ...WB, records: { SAU: { population: { value: '1', year: 2025 } } } })).toBe(false);
  });
});

describe('loadAll and the optional generated files', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('a missing, broken or unreachable generated file never breaks loading', async () => {
    const answers: Record<string, () => Response> = {
      [GENERATED.worldbank]: () => Response.json(WB),
      [GENERATED.ucdp]: () => new Response('Not found', { status: 404 }),
      [GENERATED.unhcr]: () => new Response('<!doctype html><title>atlas</title>', { status: 200 }),
      [GENERATED.usgs]: () => { throw new TypeError('Failed to fetch'); },
      [GENERATED.eia]: () => Response.json({ source: 'eia' }),
    };
    vi.stubGlobal('fetch', async (url: string) => {
      const rel = url.replace('/base/', '');
      if (answers[rel]) return answers[rel]();
      return new Response(fs.readFileSync(path.join(DATA_DIR, rel)), { status: 200 });
    });
    const seen: string[] = [];
    let last = 0;
    const db = await loadAll((p, file) => { last = p; seen.push(file); }, '/base/');
    expect(db.figures.sources.map((s) => s.id)).toEqual(['worldbank']);
    expect(db.countries.get('SAU')).toMatchObject({ pop: 36973555, popYear: 2025, popSource: 'worldbank' });
    expect(last).toBe(1);
    expect(seen.slice(0, Object.keys(FILES).length).every((f) => !f.startsWith('generated/'))).toBe(true); // core files first
  });

  test('a missing core file still fails loudly', async () => {
    vi.stubGlobal('fetch', async () => new Response('Not found', { status: 404 }));
    await expect(loadAll(() => {}, '/base/')).rejects.toThrow(/HTTP 404/);
  });
});
