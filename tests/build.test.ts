import { beforeAll, describe, expect, test } from 'vitest';
import { build } from '../src/data/build';
import type { GeneratedFile } from '../src/data/join';
import type { DB, RawData } from '../src/data/types';
import { readRaw } from './helpers/readRaw';

let raw: RawData;
let db: DB;
beforeAll(() => { raw = readRaw(); db = build(raw); });

describe('build() matches the legacy model', () => {
  test('stats', () => expect(db.stats).toEqual({
    countries: 242, conflicts: 40, groups: 41, religionCountries: 75, edges: 89,
    blocs: 9, events: 86, chokepoints: 11, sites: 24, disputed: 99,
  }));

  test('Saudi Arabia links', () => {
    const sau = db.countries.get('SAU')!;
    expect(sau.conflicts).toEqual(['yemen', 'gulf-security']);
    expect(sau.blocs).toEqual(['gcc', 'brics', 'arab-league']);
    expect(sau.edges).toHaveLength(6);
    expect(sau.religion?.majority).toBe('sunni');
    expect(sau.religion?.majorityFamily).toBe('islam');
    expect(sau.neighbors).toEqual(['BHR', 'QAT', 'KWT', 'YEM', 'ARE', 'IRQ']);
    expect(Math.round(sau.areaKm2)).toBe(1925857);
  });

  test('Arabic search finds Saudi Arabia first', () => {
    expect(db.search('السعوديه', 5)[0]).toMatchObject({ kind: 'country', id: 'SAU' });
  });

  test('Kosovo resolves through the XKX alias', () => expect(db.get('country', 'KOS')).toBeTruthy());

  test('the Spratlys get the corrected Arabic name', () => {
    const i = db.disputed.findIndex((d) => d.nameEn === 'Spratly Is.');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(db.nameOf('disputed', String(i), 'ar')).toBe('جزر سبراتلي');
  });

  test('a conflict has a map anchor', () => expect(db.anchorOf('conflict', 'sudan')).toHaveLength(2));

  test('unknown ids are handled', () => {
    expect(db.exists('country', 'XXX')).toBe(false);
    expect(db.nameOf('country', 'XXX', 'en')).toBe('XXX');
    expect(db.countriesOf('bloc', 'nope')).toEqual([]);
  });

  test('build does not mutate its input', () => {
    const fresh = readRaw();
    build(fresh);
    expect(JSON.stringify(fresh.relations)).toBe(JSON.stringify(readRaw().relations));
  });
});

describe('D10: generated population and GDP replace Natural Earth', () => {
  const wb: GeneratedFile = {
    source: 'worldbank', name: 'World Bank', licence: 'CC BY 4.0', url: 'https://data.worldbank.org/', fetchedAt: '2026-11-02T04:00:00.000Z', keys: 'iso3',
    indicators: {
      population: { label: { ar: 'السكان', en: 'Population' }, unit: 'people' },
      gdp: { label: { ar: 'الناتج', en: 'GDP' }, unit: 'USD' },
      gdpPerCapita: { label: { ar: 'نصيب الفرد', en: 'GDP per capita' }, unit: 'USD' },
    },
    records: {
      SAU: { population: { value: 36973555, year: 2025 }, gdp: { value: 1.24e12, year: 2024 }, gdpPerCapita: { value: 33500.5, year: 2024 } },
      QAT: { population: { value: 3000000, year: 2025 }, gdp: { value: 2.4e11, year: 2024 } },
      FRA: { gdp: { value: 3e12, year: 2024 } },
    },
  };
  let d10: DB;
  beforeAll(() => { d10 = build(raw, [wb]); });

  test('the generated values, years and source win', () => {
    expect(d10.countries.get('SAU')).toMatchObject({
      pop: 36973555, popYear: 2025, popSource: 'worldbank', gdp: 1.24e6, gdpYear: 2024, gdpSource: 'worldbank', gdpPerCap: 33500.5,
    });
  });

  test('GDP per person is derived when the source has GDP but not GDP per capita', () => {
    expect(d10.countries.get('QAT')!.gdpPerCap).toBeCloseTo(80000);
  });

  test('density follows the new population', () => {
    const sau = d10.countries.get('SAU')!;
    expect(sau.density).toBeCloseTo(36973555 / sau.areaKm2);
  });

  test('a country with only some generated figures keeps Natural Earth for the rest', () => {
    const fra = d10.countries.get('FRA')!, ne = db.countries.get('FRA')!;
    expect(fra).toMatchObject({ pop: ne.pop, popYear: ne.popYear, gdp: 3e6, gdpYear: 2024, gdpSource: 'worldbank' });
    expect(fra.popSource).toBeUndefined();
  });

  test('without a generated value Natural Earth is the fallback', () => {
    const twn = d10.countries.get('TWN')!, f = twn.feature.properties;
    expect(twn).toMatchObject({ pop: f.pop_est, popYear: f.pop_year, gdp: f.gdp_md, gdpYear: f.gdp_year });
    expect(twn.popSource).toBeUndefined();
    expect(twn.gdpSource).toBeUndefined();
  });

  test('without generated files nothing changes', () => {
    const sau = db.countries.get('SAU')!;
    expect(sau.pop).toBe(sau.feature.properties.pop_est);
    expect(sau.popSource).toBeUndefined();
    expect(db.figures.sources).toEqual([]);
  });
});
