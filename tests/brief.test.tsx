import { act, fireEvent, render, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { on } from '../src/app/events';
import { atlas } from '../src/app/store';
import { DbContext } from '../src/app/useT';
import { build } from '../src/data/build';
import type { Figure, Figures } from '../src/data/figures';
import { rankBy } from '../src/data/rank';
import type { Country, DB } from '../src/data/types';
import { Dossier } from '../src/features/dossier';
import { CompareView } from '../src/features/views/compare';
import '../src/i18n/core';
import { translate } from '../src/i18n/strings';
import { readRaw } from './helpers/readRaw';

let db: DB;
beforeAll(() => { db = build(readRaw()); });
afterEach(() => { atlas.reset(); localStorage.clear(); vi.restoreAllMocks(); });

const withDb = (ui: ReactNode, d: DB = db) => render(<DbContext.Provider value={d}>{ui}</DbContext.Provider>);
const pick = (kind: 'country' | 'conflict', id: string) => act(() => { atlas.select(kind, id, { fly: false }); });
const en = (key: string, vars?: Record<string, string | number>) => translate('en', key, vars);
const panel = () => document.getElementById('dz-panel')!;
const selectedTab = () => document.querySelector('#dossier [role="tab"][aria-selected="true"]');

const SOURCES: Figures['sources'] = [
  { id: 'worldbank', name: 'World Bank', licence: 'CC BY 4.0', url: 'https://data.worldbank.org', fetchedAt: '2026-10-30' },
  { id: 'unhcr', name: 'UNHCR', licence: 'CC BY 4.0', url: 'https://www.unhcr.org/refugee-statistics', fetchedAt: '2026-10-30' },
  { id: 'ucdp', name: 'UCDP', licence: 'CC BY 4.0', url: 'https://ucdp.uu.se', fetchedAt: '2026-10-30' },
];
const fig = (value: number, year: number, source: string): Figure => ({ value, year, source });
/** A copy of the model whose figures answer for SAU and the Yemen conflict only. */
const stubbed = (): DB => ({
  ...db,
  figures: {
    country: (iso3) => (iso3 === 'SAU'
      ? { population: fig(35_300_000, 2024, 'worldbank'), gdpPerCapita: fig(33_000, 2024, 'worldbank'), idps: fig(4321, 2024, 'unhcr') }
      : {}),
    conflictDeaths: (id) => (id === 'yemen' ? [{ year: 2020, value: 1200 }, { year: 2021, value: 2500 }, { year: 2022, value: 640 }] : []),
    sources: SOURCES,
  },
});

describe('Country brief', () => {
  test('a country dossier opens on the Brief tab', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('country', 'SAU');
    expect(selectedTab()?.id).toBe('dz-tab-brief');
    expect(selectedTab()?.textContent).toBe(en('dz.br.tab'));
    expect(panel().textContent).toContain(en('dz.br.kpis'));
  });

  test('the SAU rank badges match rankBy over the world and over its subregion', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('country', 'SAU');
    const sau = db.countries.get('SAU')!;
    const world = [...db.countries.values()].map((c) => ({ id: c.iso3, c }));
    const region = world.filter((x) => x.c.subregion === sau.subregion);
    const involved = (c: Country) => new Set([...c.conflicts, ...c.external]).size || null;
    const KPIS: [string, (x: { c: Country }) => number | null | undefined][] = [
      ['pop', (x) => x.c.pop],
      ['gdppc', (x) => x.c.gdpPerCap],
      ['diversity', (x) => x.c.religion?.diversity],
      ['conflicts', (x) => involved(x.c)],
    ];
    for (const [id, value] of KPIS) {
      const tile = panel().querySelector(`[data-kpi="${id}"]`);
      expect(tile, id).not.toBeNull();
      const w = rankBy(world, value).get('SAU')!, r = rankBy(region, value).get('SAU')!;
      expect(tile!.querySelector('[data-scope="world"]')?.textContent, id).toBe(en('dz.br.rankWorld', { n: w.rank, of: w.of }));
      expect(tile!.querySelector('[data-scope="region"]')?.textContent, id).toBe(en('dz.br.rankRegion', { n: r.rank, of: r.of }));
    }
    // no displaced figures yet: that tile stays hidden
    expect(panel().querySelector('[data-kpi="displaced"]')).toBeNull();
  });

  test('a party to an active war gets a "what stands out" line naming the war', () => {
    atlas.set({ lang: 'en' });
    const war = db.conflicts.find((c) => c.severity === 'war')!;
    const iso = war.countries[0]!;
    const wars = db.conflicts.filter((c) => c.severity === 'war' && db.countries.get(iso)!.conflicts.includes(c.id));
    withDb(<Dossier />);
    pick('country', iso);
    const line = document.querySelector('#dz-a-standout [data-rule="war"]');
    expect(line).not.toBeNull();
    expect(wars.some((w) => line!.textContent!.includes(w.name.en))).toBe(true);
    const lines = document.querySelectorAll('#dz-a-standout [data-rule]').length;
    expect(lines).toBeGreaterThanOrEqual(2);
    expect(lines).toBeLessThanOrEqual(4);
  });

  test('a state without religion data shows a dash and no rank for that figure', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('country', 'ZMB');
    const tile = panel().querySelector('[data-kpi="diversity"]')!;
    expect(tile.querySelector('.br-kpi-v')?.textContent).toBe('—');
    expect(tile.querySelector('[data-scope]')).toBeNull();
    expect(document.getElementById('dz-a-near')).not.toBeNull();
  });

  test('the benchmark line compares GDP per person with the world and subregion averages', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('country', 'SAU');
    const bench = document.querySelector('#dz-panel .br-bench');
    expect(bench?.textContent).toMatch(/world average/);
    expect(bench?.textContent).toMatch(/Western Asia/);
  });

  test('clicking a nearby country selects it', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('country', 'SAU');
    const iso = db.countries.get('SAU')!.neighbors[0]!;
    const near = document.getElementById('dz-a-near')!;
    const row = within(near).getByRole('button', { name: new RegExp(`^${db.nameOf('country', iso, 'en')}`) });
    fireEvent.click(row);
    expect(atlas.get().selection).toEqual({ kind: 'country', id: iso });
  });

  test('print calls window.print; copy link copies the address and toasts', async () => {
    atlas.set({ lang: 'en' });
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    withDb(<Dossier />);
    pick('country', 'SAU');
    fireEvent.click(within(panel()).getByRole('button', { name: en('dz.br.print') }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(atlas.get().selection).toEqual({ kind: 'country', id: 'SAU' });
    const toasts: string[] = [];
    const off = on('toast', (m) => toasts.push(m));
    await act(async () => { fireEvent.click(within(panel()).getByRole('button', { name: en('dz.br.copy') })); });
    off();
    expect(write).toHaveBeenCalledWith(location.href);
    expect(toasts).toEqual([en('dz.copied')]);
    Reflect.deleteProperty(navigator, 'clipboard');
  });
});

describe('Latest figures', () => {
  test('renders nothing while db.figures is empty', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('country', 'SAU');
    expect(document.getElementById('dz-a-latest')).toBeNull();
  });

  test('shows each figure with its source and year', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />, stubbed());
    pick('country', 'SAU');
    const block = document.getElementById('dz-a-latest')!;
    expect(block).not.toBeNull();
    const pop = block.querySelector('[data-fig="population"]')!;
    expect(pop.textContent).toContain('35.3 M');
    expect(pop.querySelector('.br-src')?.textContent).toBe(en('dz.br.src', { s: 'World Bank', y: 2024 }));
    expect(block.querySelector('[data-fig="idps"] .br-src')?.textContent).toBe(en('dz.br.src', { s: 'UNHCR', y: 2024 }));
    // the displaced tile appears once a figure exists
    expect(panel().querySelector('[data-kpi="displaced"]')).not.toBeNull();
  });
});

describe('Conflict deaths chart', () => {
  test('is hidden without data', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('conflict', 'yemen');
    expect(document.querySelector('#dz-panel .br-deaths')).toBeNull();
  });

  test('draws one bar per year from conflictDeaths, with a table view', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />, stubbed());
    pick('conflict', 'yemen');
    const chart = document.querySelector('#dz-panel .br-deaths')!;
    expect(chart).not.toBeNull();
    const cols = chart.querySelectorAll('.br-d-col');
    expect(cols).toHaveLength(3);
    // the hover target is the whole column slot, larger than the bar it holds
    expect(cols[1]!.closest('.br-d-slot')!.getAttribute('data-tip')).toContain('2,500');
    expect(chart.textContent).toContain('UCDP');
    fireEvent.click(within(chart as HTMLElement).getByRole('button', { name: en('dz.br.d.table') }));
    expect(chart.querySelectorAll('tbody tr')).toHaveLength(3);
  });
});

describe('Compare source chips', () => {
  const open = (d: DB) => {
    atlas.set({ lang: 'en', view: 'compare', compare: ['SAU', 'QAT'] });
    return withDb(<CompareView />, d);
  };

  test('no chips while no generated source exists', () => {
    open(db);
    expect(document.querySelectorAll('.cmp-src')).toHaveLength(0);
  });

  test('chips appear for figures from db.figures and for popSource/gdpSource fields', () => {
    const d = stubbed();
    const countries = new Map(d.countries);
    const qat = countries.get('QAT')!;
    countries.set('QAT', { ...qat, popSource: 'worldbank', popYear: 2023 } as Country);
    open({ ...d, countries });
    const chips = [...document.querySelectorAll('.cmp-src')].map((x) => x.textContent);
    expect(chips).toContain(en('cp.src', { s: 'World Bank', y: 2024 }));
    expect(chips).toContain(en('cp.src', { s: 'World Bank', y: 2023 }));
  });
});
