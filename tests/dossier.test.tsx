import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { on } from '../src/app/events';
import { atlas } from '../src/app/store';
import { DbContext } from '../src/app/useT';
import { build } from '../src/data/build';
import type { DB, Kind } from '../src/data/types';
import { Dossier } from '../src/features/dossier';
import '../src/i18n/core';
import { translate } from '../src/i18n/strings';
import { readRaw } from './helpers/readRaw';

let db: DB;
beforeAll(() => { db = build(readRaw()); });
afterEach(() => { atlas.reset(); localStorage.clear(); vi.restoreAllMocks(); });

const withDb = (ui: ReactNode) => render(<DbContext.Provider value={db}>{ui}</DbContext.Provider>);
const aside = () => document.getElementById('dossier')!;
const title = () => document.getElementById('dz-title')?.textContent;
const selectedTab = () => document.querySelector('#dossier [role="tab"][aria-selected="true"]');
const pick = (kind: Kind, id: string) => act(() => { atlas.select(kind, id, { fly: false }); });
const en = (key: string, vars?: Record<string, string | number>) => translate('en', key, vars);

describe('Dossier frame', () => {
  test('the panel is hidden while nothing is selected', () => {
    withDb(<Dossier />);
    expect(aside()).toHaveAttribute('hidden');
    expect(aside().tagName).toBe('ASIDE');
  });

  // One real id per kind: [kind, id, default tab (null = single panel without tabs), a heading the default panel shows]
  const CASES: [Kind, string, string | null, string][] = [
    ['country', 'SAU', 'brief', 'dz.br.kpis'],
    ['conflict', 'sudan', 'status', 'dz.cf.now'],
    ['group', 'kurds', 'overview', 'dz.p.family'],
    ['religion', 'sunni', 'spread', 'dz.rl.majorityIn'],
    ['choke', 'hormuz', null, 'dz.ch.flow'],
    ['disputed', '0', null, 'dz.d.names'],
    ['event', 'halabja', null, 'dz.e.cats'],
    ['bloc', 'gcc', null, 'dz.b.kind'],
  ];
  test.each(CASES)('%s %s renders its name and its default tab', (kind, id, tab, heading) => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick(kind, id);
    expect(aside()).not.toHaveAttribute('hidden');
    expect(aside()).toHaveAttribute('data-kind', kind);
    expect(title()).toBe(db.nameOf(kind, id, 'en'));
    expect(document.querySelector('.dz-eyebrow')?.textContent).toContain(en('dz.kind.' + kind));
    const panel = document.getElementById('dz-panel')!;
    if (tab) {
      expect(selectedTab()?.id).toBe(`dz-tab-${tab}`);
      expect(panel).toHaveAttribute('role', 'tabpanel');
      expect(panel).toHaveAttribute('aria-labelledby', `dz-tab-${tab}`);
    } else {
      expect(document.querySelector('#dossier [role="tablist"]')).toBeNull();
      expect(panel).not.toHaveAttribute('role');
    }
    expect(panel.textContent).toContain(en(heading));
  });

  test('site (the first site id) renders its name and its panel', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    const id = db.resources.sites[0]!.id;
    pick('site', id);
    expect(title()).toBe(db.nameOf('site', id, 'en'));
    expect(document.getElementById('dz-panel')!.textContent).toContain(en('dz.st.type'));
  });

  test('an unverified record shows the unverified badge; a verified one does not', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('conflict', 'sudan');
    expect(db.isUnverified('conflict', 'sudan')).toBe(true);
    const badge = document.querySelector('#dossier .dz-uv');
    expect(badge?.textContent).toContain(en('dz.uv'));
    expect(badge).toHaveAttribute('data-tip');
    pick('event', 'halabja');
    expect(db.isUnverified('event', 'halabja')).toBe(false);
    expect(document.querySelector('#dossier .dz-uv')).toBeNull();
  });

  test('switching lang re-renders in place and keeps the active tab', () => {
    withDb(<Dossier />);
    pick('country', 'SAU');
    expect(title()).toBe(db.nameOf('country', 'SAU', 'ar'));
    fireEvent.click(screen.getByRole('tab', { name: /الشعوب/ }));
    expect(selectedTab()?.id).toBe('dz-tab-peoples');
    act(() => { atlas.set({ lang: 'en' }); });
    expect(title()).toBe('Saudi Arabia');
    expect(selectedTab()?.id).toBe('dz-tab-peoples');
    expect(selectedTab()?.textContent).toMatch(/^Peoples/);
    expect(document.getElementById('dz-panel')!.textContent).toContain(en('dz.p.title'));
  });

  test('the close button calls atlas.select(null) and the panel then hides', async () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('country', 'SAU');
    const spy = vi.spyOn(atlas, 'select');
    fireEvent.click(screen.getByRole('button', { name: en('dz.close') }));
    expect(spy).toHaveBeenCalledWith(null);
    expect(atlas.get().selection).toBeNull();
    await waitFor(() => expect(aside()).toHaveAttribute('hidden'));
    expect(aside().childElementCount).toBe(0);
  });

  test('action buttons carry escaped tooltips; fly emits flyto; compare opens the compare view', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('country', 'SAU');
    const fly = screen.getByRole('button', { name: en('dz.fly') });
    expect(fly).toHaveAttribute('data-tip', en('dz.fly'));
    const flights: unknown[] = [];
    const off = on('flyto', (p) => flights.push(p));
    fireEvent.click(fly);
    off();
    expect(flights).toEqual([{ kind: 'country', id: 'SAU' }]);
    fireEvent.click(screen.getByRole('button', { name: en('dz.compare') }));
    expect(atlas.get().view).toBe('compare');
    expect(atlas.get().compare).toEqual(['SAU', null]);
    pick('conflict', 'sudan');
    expect(screen.queryByRole('button', { name: en('dz.compare') })).toBeNull();
  });
});

describe('Dossier focus', () => {
  test('a keyboard user lands on the record name, and closing returns focus to the opener', () => {
    atlas.set({ lang: 'en' });
    withDb(<><button type="button">opener</button><Dossier /></>);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    fireEvent.keyDown(opener, { key: 'Enter' });
    pick('country', 'SAU');
    expect(document.activeElement?.id).toBe('dz-title');
    fireEvent.click(screen.getByRole('button', { name: en('dz.close') }));
    expect(document.activeElement).toBe(opener);
  });

  test('a pointer user keeps focus where it was', () => {
    withDb(<><button type="button">opener</button><Dossier /></>);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    fireEvent.pointerDown(opener);
    pick('country', 'SAU');
    expect(document.activeElement).toBe(opener);
  });
});

describe('Dossier tabs', () => {
  test('arrow keys move between tabs (forward is ArrowLeft in Arabic), Home and End jump', () => {
    withDb(<Dossier />);
    pick('country', 'SAU');
    const first = document.getElementById('dz-tab-brief')!;
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(selectedTab()?.id).toBe('dz-tab-summary');
    expect(document.activeElement?.id).toBe('dz-tab-summary');
    fireEvent.keyDown(selectedTab()!, { key: 'End' });
    expect(selectedTab()?.id).toBe('dz-tab-history');
    fireEvent.keyDown(selectedTab()!, { key: 'ArrowLeft' });
    expect(selectedTab()?.id).toBe('dz-tab-brief');
    act(() => { atlas.set({ lang: 'en' }); });
    fireEvent.keyDown(selectedTab()!, { key: 'ArrowRight' });
    expect(selectedTab()?.id).toBe('dz-tab-summary');
    expect(selectedTab()).toHaveAttribute('tabindex', '0');
    expect(document.getElementById('dz-tab-brief')).toHaveAttribute('tabindex', '-1');
  });

  test('each kind remembers its last tab across records', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('country', 'SAU');
    fireEvent.click(screen.getByRole('tab', { name: /^Relations/ }));
    pick('country', 'IRN');
    expect(selectedTab()?.id).toBe('dz-tab-relations');
    pick('conflict', 'sudan');
    expect(selectedTab()?.id).toBe('dz-tab-status');
  });

  test('an exposure counter opens its tab', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('country', 'SAU');
    fireEvent.click(screen.getByRole('tab', { name: /^Summary/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en('dz.x.ties')) }));
    expect(selectedTab()?.id).toBe('dz-tab-relations');
  });
});

describe('Dossier links', () => {
  test('a bloc chip selects the bloc and switches to the powers lens; a country chip keeps the lens', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('country', 'SAU');
    fireEvent.click(screen.getByRole('tab', { name: /^Summary/ }));
    const blocs = document.getElementById('dz-a-blocs')!;
    fireEvent.click(within(blocs).getByRole('button', { name: 'Gulf Cooperation Council' }));
    expect(atlas.get().selection).toEqual({ kind: 'bloc', id: 'gcc' });
    expect(atlas.get().lens).toBe('powers');
    fireEvent.click(screen.getByRole('button', { name: 'Qatar' }));
    expect(atlas.get().selection).toEqual({ kind: 'country', id: 'QAT' });
    expect(atlas.get().lens).toBe('powers');
  });

  test('pointing at a linked row highlights its countries on the map', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('bloc', 'gcc');
    const seen: unknown[] = [];
    const off = on('highlight', (h) => seen.push(h));
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Qatar' }));
    fireEvent.pointerLeave(aside());
    off();
    expect(seen).toEqual([{ iso3: ['QAT'] }, null]);
  });

  test('the event year button sets the timeline year and reports its pressed state', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('event', 'halabja');
    const btn = screen.getByRole('button', { name: en('dz.e.setYear', { y: 1988 }) });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(atlas.get().year).toBe(1988);
    expect(atlas.get().yearFilter).toBe(true);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Dossier with missing optional fields', () => {
  // Zambia: no religion estimate, no intel entry, no mapped group, no relation, no event, no resource record.
  const ISO = 'ZMB';
  test('the fixture really lacks the optional data', () => {
    const c = db.countries.get(ISO)!;
    expect(c.religion).toBeNull();
    expect(c.intel).toBeNull();
    expect([c.groups.length, c.edges.length, c.events.length, c.resources.length]).toEqual([0, 0, 0, 0]);
  });

  test('every tab shows the legacy "no data" line instead of a blank section', () => {
    atlas.set({ lang: 'en' });
    withDb(<Dossier />);
    pick('country', ISO);
    const panel = () => document.getElementById('dz-panel')!.textContent;
    fireEvent.click(screen.getByRole('tab', { name: /^Summary/ }));
    expect(panel()).toContain(en('dz.noIntel'));
    const rel = screen.getByRole('tab', { name: /^Religion/ });
    expect(rel).toHaveClass('is-empty');
    fireEvent.click(rel);
    expect(panel()).toContain(en('dz.rel.none'));
    fireEvent.click(screen.getByRole('tab', { name: /^Peoples/ }));
    expect(panel()).toContain(en('dz.p.none', { n: db.stats.groups }));
    fireEvent.click(screen.getByRole('tab', { name: /^Relations/ }));
    expect(panel()).toContain(en('dz.r.none', { n: db.relations.edges.length }));
    fireEvent.click(screen.getByRole('tab', { name: /^Resources/ }));
    expect(panel()).toContain(en('dz.res.none'));
    fireEvent.click(screen.getByRole('tab', { name: /^History/ }));
    const [from, to] = db.timeline.range as [number, number];
    expect(panel()).toContain(en('dz.h.none', { n: db.timeline.events.length, from, to }));
    expect(document.querySelectorAll('#dz-panel .dz-empty').length).toBeGreaterThan(0);
  });
});
