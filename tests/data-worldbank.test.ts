// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { worldbank, wbRecords } from '../scripts/data/fetchers/worldbank';
import { fakeCtx, fakeHttp } from './data-fakes';

const isos = new Set(['SAU', 'KOS', 'TWN']);

describe('World Bank parser', () => {
  const records = wbRecords({
    population: [
      { countryiso3code: 'SAU', date: '2025', value: 36973555 },
      { countryiso3code: 'XKX', date: '2025', value: 1576876 },
      { countryiso3code: 'WLD', date: '2025', value: 8.2e9 },
      { countryiso3code: '', date: '2025', value: 5 },
    ],
    gdp: [{ countryiso3code: 'SAU', date: '2024', value: 1.24e12 }, { countryiso3code: 'KOS', date: '2024', value: null }],
    gdpPerCapita: [{ countryiso3code: 'SAU', date: '2024', value: 33500.5 }],
  }, isos);

  test('keeps the latest value per country, keyed by ISO3, with XKX read as KOS', () => {
    expect(records).toEqual({
      SAU: { population: { value: 36973555, year: 2025 }, gdp: { value: 1.24e12, year: 2024 }, gdpPerCapita: { value: 33500.5, year: 2024 } },
      KOS: { population: { value: 1576876, year: 2025 } },
    });
  });

  test('aggregates (WLD), empty codes and null values are left out', () => {
    expect(records.WLD).toBeUndefined();
    expect(records.KOS?.gdp).toBeUndefined();
  });

  test('the fetcher pages through the API and writes the spec shape', async () => {
    const page = (n: number, pages: number, rows: unknown[]) => [{ page: n, pages }, rows];
    const http = fakeHttp({
      'SP.POP.TOTL': (url) => (url.includes('page=2') ? page(2, 2, [{ countryiso3code: 'TWN', date: '2024', value: 1 }]) : page(1, 2, [{ countryiso3code: 'SAU', date: '2025', value: 2 }])),
      'NY.GDP.MKTP.CD': () => page(1, 1, []),
      'NY.GDP.PCAP.CD': () => [{ message: [{ id: '120', value: 'Invalid value' }] }],
    });
    await expect(worldbank.run(fakeCtx({ http, isos }))).rejects.toThrow(/NY\.GDP\.PCAP\.CD/);
    http.routes['NY.GDP.PCAP.CD'] = () => page(1, 1, []);
    const file = await worldbank.run(fakeCtx({ http, isos }));
    expect(file).toMatchObject({ source: 'worldbank', keys: 'iso3', licence: 'CC BY 4.0', records: { SAU: { population: { value: 2, year: 2025 } }, TWN: { population: { value: 1, year: 2024 } } } });
    expect(Object.keys('indicators' in file ? file.indicators : {})).toEqual(['population', 'gdp', 'gdpPerCapita']);
  });
});
