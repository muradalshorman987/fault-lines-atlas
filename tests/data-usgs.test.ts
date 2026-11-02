// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { usgs, usgsRecords } from '../scripts/data/fetchers/usgs';
import { HttpError } from '../scripts/data/http';
import { SourceUnavailable } from '../scripts/data/types';
import { csvRecords } from '../scripts/data/csv';
import { fakeCtx, fakeHttp } from './data-fakes';

// The long format of the MCS data release (MCS2026_ALLchapters_Reconcile.csv), per its published metadata.
const CSV = `MCS chapter,Section,Commodity,Country,Statistics,Statistics_detail,Unit,Year,Value,Notes,Other notes
Lithium,World mine production and reserves,Lithium,Australia,Mine production,,metric tons,2024,"88,000",,
Lithium,World mine production and reserves,Lithium,Australia,Mine production,,metric tons,2025,"92,000",Estimated,
Lithium,World mine production and reserves,Lithium,Australia,Reserves,,metric tons,2025,"7,000,000",,
Lithium,World mine production and reserves,Lithium,United States,Mine production,,metric tons,2025,W,,
Lithium,World mine production and reserves,Lithium,World total (rounded),Mine production,,metric tons,2025,"240,000",,
Cobalt,World mine production and reserves,Cobalt,Congo (Kinshasa),Mine production,contained cobalt,metric tons,2025,"220,000",,
Cobalt,World refinery production,Cobalt,Congo (Kinshasa),Refinery production,,metric tons,2025,"5,000",,
Tantalum,World mine production and reserves,Tantalum,Rwanda,Mine production,,metric tons,2025,400,,
Tantalum,World mine production and reserves,Tantalum,Rwanda,Reserves,,metric tons,2025,NA,,
Zinc,World mine production and reserves,Zinc,Australia,Mine production,,thousand metric tons,2025,"1,100",,
`;

const refs = {
  isos: new Set(['AUS', 'USA', 'COD', 'RWA']),
  names: new Map([['australia', 'AUS'], ['united states', 'USA'], ['rwanda', 'RWA']]),
  resourceTypes: new Map([
    ['lithium', { ar: 'الليثيوم', en: 'Lithium' }], ['cobalt', { ar: 'الكوبالت', en: 'Cobalt' }],
    ['coltan', { ar: 'الكولتان والتنتالوم', en: 'Coltan and tantalum' }], ['oil', { ar: 'النفط', en: 'Oil' }],
  ]),
};

describe('USGS parser', () => {
  const { indicators, records } = usgsRecords(csvRecords(CSV), fakeCtx({ http: fakeHttp({}), ...refs }).refs);

  test('mine production and reserves, latest year, for the atlas resource types only', () => {
    expect(records).toEqual({
      AUS: { 'prod:lithium': { value: 92000, year: 2025 }, 'reserves:lithium': { value: 7000000, year: 2025 } },
      COD: { 'prod:cobalt': { value: 220000, year: 2025 } },
      RWA: { 'prod:coltan': { value: 400, year: 2025 } },
    });
  });

  test('withheld (W), not available (NA), world totals, refinery rows and other commodities are skipped', () => {
    expect(records.USA).toBeUndefined();
    expect(Object.keys(indicators).sort()).toEqual(['prod:cobalt', 'prod:coltan', 'prod:lithium', 'reserves:lithium']);
    expect(indicators['prod:lithium']).toEqual({ label: { ar: 'إنتاج الليثيوم', en: 'Lithium production' }, unit: 'metric tons' });
  });
});

describe('USGS fetcher', () => {
  test('a Cloudflare challenge on ScienceBase marks the source unavailable', async () => {
    const http = fakeHttp({ 'sciencebase.gov': (url) => { throw new HttpError(403, url, '<title>Just a moment...</title>'); } });
    await expect(usgs.run(fakeCtx({ http, ...refs }))).rejects.toBeInstanceOf(SourceUnavailable);
  });

  test('finds the CSV in the ScienceBase item and parses it', async () => {
    const http = fakeHttp({
      'catalog/item/': () => ({ title: 'Mineral Commodity Summaries 2026', files: [{ name: 'MCS2026_ALLchapters_Reconcile.csv', url: 'https://www.sciencebase.gov/catalog/file/get/x?f=1' }] }),
      'catalog/file/get/': () => CSV,
    });
    const file = await usgs.run(fakeCtx({ http, ...refs }));
    if ('skip' in file) throw new Error('skipped');
    expect(file).toMatchObject({ source: 'usgs', keys: 'iso3', licence: expect.stringMatching(/public domain|CC0/i) });
    expect(file.records.COD).toEqual({ 'prod:cobalt': { value: 220000, year: 2025 } });
  });

  test('USGS_MCS_CSV points the fetcher at a file someone downloaded by hand', async () => {
    const http = fakeHttp({ 'example.org/mcs.csv': () => CSV });
    const file = await usgs.run(fakeCtx({ http, ...refs, env: { USGS_MCS_CSV: 'https://example.org/mcs.csv' } }));
    expect('records' in file && file.records.AUS).toBeTruthy();
    expect(http.calls).toEqual(['https://example.org/mcs.csv']);
  });
});
