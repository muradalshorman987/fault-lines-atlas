// @vitest-environment node
import { strToU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import { findUcdpLinks, tallyCsv, ucdp, ucdpRecords, type Tally } from '../scripts/data/fetchers/ucdp';
import { fakeCtx, fakeHttp } from './data-fakes';

const HTML = `
  <a href="https://ucdp.uu.se/downloads/ged/ged251-csv.zip">old</a>
  <a href="https://ucdp.uu.se/downloads/ged/ged261-csv.zip">GED 26.1</a>
  <a href="https://ucdp.uu.se/downloads/ged/ged261-xlsx.zip">xlsx</a>
  <a href="https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_9.csv">one month</a>
  <a href="https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_01_26_08.csv">to August</a>
  <a href="https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_01_26_09.csv">to September</a>`;

// Columns in a different order than the real file, plus a quoted text column with commas and a newline.
const GED = [
  'id,source_article,year,type_of_violence,conflict_new_id,conflict_name,best',
  '1,"AFP, ""quoted""\nsecond line",2022,1,309,Sudan: Government,100',
  '2,x,2023,1,309,Sudan: Government,500',
  '3,x,2025,1,309,Sudan: Government,300',
  '4,x,2015,1,230,Yemen (North Yemen): Government,10',
  '5,x,2016,1,230,Yemen (North Yemen): Government,20',
  '6,x,2016,1,16099,"United Kingdom, United States of America - Yemen",5',
  '7,x,2025,1,999,Elsewhere,7',
].join('\n') + '\n';
const CANDIDATE = 'id,year,conflict_new_id,best\n10,2026,309,40\n11,2026,309,2\n12,2026,119,900\n';

const conflicts = [
  { id: 'sudan', started: '2023-04-15', ucdp: [309] },
  { id: 'yemen', started: '2014-09', ucdp: [230, 16099] },
  { id: 'unmapped', started: '1990' },
];

describe('UCDP', () => {
  test('finds the newest GED zip and the newest cumulative candidate file', () => {
    expect(findUcdpLinks(HTML)).toEqual({
      ged: { url: 'https://ucdp.uu.se/downloads/ged/ged261-csv.zip', version: '26.1' },
      candidate: { url: 'https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_01_26_09.csv', year: 2026, through: '2026-09' },
    });
    expect(findUcdpLinks('<p>nothing</p>')).toEqual({ ged: null, candidate: null });
  });

  test('tallies deaths per conflict id and year from a zipped CSV stream', async () => {
    const zip = zipSync({ 'GEDEvent_v26_1.csv': strToU8(GED) });
    const http = fakeHttp({ ged: () => zip });
    const t = await tallyCsv(await http.stream('ged'), new Set([309, 230, 16099]), { zipped: true });
    expect(t.maxYear).toBe(2025);
    expect(Object.fromEntries([...t.deaths].map(([id, ys]) => [id, Object.fromEntries(ys)]))).toEqual({
      309: { 2022: 100, 2023: 500, 2025: 300 }, 230: { 2015: 10, 2016: 20 }, 16099: { 2016: 5 },
    });
  });

  test('series start at the conflict start, fill quiet years with zero, and sum mapped ids', () => {
    const ged: Tally = { maxYear: 2025, deaths: new Map([[309, new Map([[2022, 100], [2023, 500], [2025, 300]])], [230, new Map([[2015, 10], [2016, 20]])], [16099, new Map([[2016, 5]])]]) };
    const cand: Tally = { maxYear: 2026, deaths: new Map([[309, new Map([[2026, 42]])]]) };
    const r = ucdpRecords(conflicts, ged, { tally: cand, year: 2026 });
    expect(r.sudan).toEqual({
      deaths: { value: 300, year: 2025, series: [{ year: 2023, value: 500 }, { year: 2024, value: 0 }, { year: 2025, value: 300 }] },
      deathsPreliminary: { value: 42, year: 2026 },
    });
    expect(r.yemen?.deaths?.series?.slice(0, 3)).toEqual([{ year: 2015, value: 10 }, { year: 2016, value: 25 }, { year: 2017, value: 0 }]);
    expect(r.yemen?.deaths).toMatchObject({ value: 0, year: 2025 });
    expect(r.yemen?.deathsPreliminary).toEqual({ value: 0, year: 2026 });
    expect(r.unmapped).toBeUndefined();
  });

  test('a conflict that started after the last GED year gets only the preliminary figure', () => {
    const ged: Tally = { maxYear: 2025, deaths: new Map([[16905, new Map()]]) };
    const cand: Tally = { maxYear: 2026, deaths: new Map([[16905, new Map([[2026, 3859]])]]) };
    expect(ucdpRecords([{ id: 'iran', started: '2026-02-28', ucdp: [16905] }], ged, { tally: cand, year: 2026 }))
      .toEqual({ iran: { deathsPreliminary: { value: 3859, year: 2026 } } });
  });

  test('the fetcher downloads both files and cites UCDP', async () => {
    const http = fakeHttp({
      'downloads/index.html': () => HTML,
      'ged261-csv.zip': () => zipSync({ 'GEDEvent_v26_1.csv': strToU8(GED) }),
      'GEDEvent_v26_01_26_09.csv': () => CANDIDATE,
    });
    const file = await ucdp.run(fakeCtx({ http, conflicts }));
    if ('skip' in file) throw new Error('skipped');
    expect(file).toMatchObject({ source: 'ucdp', keys: 'conflict', licence: 'CC BY 4.0', version: 'GED 26.1; Candidate 2026-01 to 2026-09' });
    expect(file.citation).toMatch(/Sundberg/);
    expect(file.citation).toMatch(/Candidate Events Dataset/);
    expect(file.records.sudan?.deathsPreliminary).toEqual({ value: 42, year: 2026 });
  });

  test('without any mapped conflict the fetcher fails instead of writing an empty file', async () => {
    const http = fakeHttp({ 'downloads/index.html': () => HTML });
    await expect(ucdp.run(fakeCtx({ http, conflicts: [{ id: 'x' }] }))).rejects.toThrow(/no curated conflict has a ucdp/);
  });
});
