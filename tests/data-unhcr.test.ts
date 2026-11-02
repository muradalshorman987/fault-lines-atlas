// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { num, unhcr, unhcrRecords } from '../scripts/data/fetchers/unhcr';
import { fakeCtx, fakeHttp } from './data-fakes';

const isos = new Set(['AFG', 'SYR', 'TUR', 'KOS']);

describe('UNHCR parser', () => {
  test('numbers arrive as numbers, numeric strings or "-"', () => {
    expect([num(5766586), num('0'), num('1200'), num('-'), num(undefined), num('n/a')]).toEqual([5766586, 0, 1200, null, null, null]);
  });

  test('refugees by origin and by asylum, IDPs by origin; zero and unknown values are left out', () => {
    const from = [
      { coo_iso: 'AFG', refugees: 2671560, idps: 3199023 },
      { coo_iso: 'SYR', refugees: '5000', idps: '0' },
      { coo_iso: 'XKX', refugees: 30, idps: '-' },
      { coo_iso: 'UNK', refugees: 10, idps: 0 },
    ];
    const into = [{ coa_iso: 'TUR', refugees: 2900000 }, { coa_iso: 'AFG', refugees: '0' }];
    expect(unhcrRecords(from, into, 2025, isos)).toEqual({
      AFG: { refugeesFrom: { value: 2671560, year: 2025 }, idps: { value: 3199023, year: 2025 } },
      SYR: { refugeesFrom: { value: 5000, year: 2025 } },
      KOS: { refugeesFrom: { value: 30, year: 2025 } },
      TUR: { refugeesIn: { value: 2900000, year: 2025 } },
    });
  });

  test('the fetcher uses the latest year that has data and reads every page', async () => {
    const empty = { page: 1, maxPages: 0, items: [] };
    const http = fakeHttp({
      'yearFrom=2026': () => empty,
      'coo_all=true&page=2': () => ({ page: 2, maxPages: 2, items: [{ coo_iso: 'SYR', refugees: 6, idps: 7 }] }),
      'coo_all=true': () => ({ page: 1, maxPages: 2, items: [{ coo_iso: 'AFG', refugees: 4, idps: 5 }] }),
      'coa_all=true': () => ({ page: 1, maxPages: 1, items: [{ coa_iso: 'TUR', refugees: 8 }] }),
    });
    const file = await unhcr.run(fakeCtx({ http, isos }));
    if ('skip' in file) throw new Error('skipped');
    expect(file).toMatchObject({ source: 'unhcr', keys: 'iso3', licence: 'CC BY 4.0' });
    expect(file.records).toEqual({
      AFG: { refugeesFrom: { value: 4, year: 2025 }, idps: { value: 5, year: 2025 } },
      SYR: { refugeesFrom: { value: 6, year: 2025 }, idps: { value: 7, year: 2025 } },
      TUR: { refugeesIn: { value: 8, year: 2025 } },
    });
    expect(http.calls.some((u) => u.includes('yearFrom=2026'))).toBe(true);
  });
});
