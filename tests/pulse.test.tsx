import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { emit, on } from '../src/app/events';
import { atlas } from '../src/app/store';
import { DbContext } from '../src/app/useT';
import { SEVERITY } from '../src/config';
import { build } from '../src/data/build';
import type { Figure } from '../src/data/figures';
import type { Conflict, DB } from '../src/data/types';
import { PulseView } from '../src/features/pulse';
import { resetViewport } from '../src/features/pulse/viewport';
import '../src/i18n/core';
import { readRaw } from './helpers/readRaw';

let db: DB;
beforeAll(() => { db = build(readRaw()); });
// Reduced motion: count-up tiles show their final value at once (no rAF updates outside act). Phone queries stay false.
beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: media.includes('reduce'), media, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
});
// Unmount first so resetting the store does not re-render a mounted view outside act().
afterEach(() => { cleanup(); atlas.reset(); resetViewport(); vi.unstubAllGlobals(); });

function renderPulse(model: DB = db) {
  return render(
    <DbContext.Provider value={model}>
      <PulseView />
      <div id="tooltip" role="tooltip" hidden />
    </DbContext.Provider>,
  );
}
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const en = () => act(() => { atlas.set({ lang: 'en' }); });
const readLine = () => q('.pl-read')!.textContent ?? '';
const count = (pred: (c: Conflict) => boolean, list = db.conflicts) => list.filter(pred).length;
const allSev = () => new Set(SEVERITY.map((s) => s.id));
/** Conflict involvement as the country brief counts it: files the state is a party to or an external power in, each once. */
const involvement = (iso: string) => { const c = db.countries.get(iso)!; return new Set([...c.conflicts, ...c.external]).size; };

/** Region with the most conflict files (first on a tie), as the read line names it. */
function topRegion(list: Conflict[]) {
  const by = new Map<string, { name: string; n: number }>();
  for (const c of list) {
    const r = by.get(c.region) ?? { name: c.regionName.en, n: 0 };
    r.n++;
    by.set(c.region, r);
  }
  return [...by.values()].sort((a, b) => b.n - a.n)[0]!;
}

describe('read line', () => {
  test('counts match the data, in English', () => {
    renderPulse();
    en();
    const n = db.conflicts.length;
    const wars = count((c) => c.severity === 'war');
    const armed = count((c) => c.severity === 'armed-conflict');
    const unv = count((c) => db.isUnverified('conflict', c.id));
    const top = topRegion(db.conflicts);
    const line = readLine();
    expect(line).toMatch(/^All files:/);
    expect(line).toContain(`${n} conflict files`);
    expect(line).toContain(`${wars} active wars`);
    expect(line).toContain(`${armed} armed conflicts`);
    expect(line).toContain(`${top.name} has the most (${top.n})`);
    expect(line).toContain(`${unv} of them carry developments this edition has not verified`);
  });

  test('follows a region filter and states the scope, in Arabic', () => {
    renderPulse();
    const region = db.conflicts[0]!.region;
    act(() => { atlas.setFilter('region', region); });
    const n = count((c) => c.region === region);
    const line = readLine();
    expect(line.startsWith('الملفات المصفّاة')).toBe(true);
    expect(line).toContain(`${n} من ملفات النزاع`);
  });
});

describe('filters', () => {
  test('a severity bar filters, shows a chip, and removing the chip clears it', () => {
    renderPulse();
    en();
    const bar = q<HTMLButtonElement>('#pl-sev [data-sev="war"]')!;
    expect(bar).toBeTruthy();
    fireEvent.click(bar);
    expect([...atlas.get().filters.severity]).toEqual(['war']);
    const chip = within(q('.pl-chips')!).getByText('Active war').closest('.pl-chip') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(readLine()).toContain(`${count((c) => c.severity === 'war')} conflict files`);
    fireEvent.click(within(chip).getByRole('button', { name: 'Remove filter: Active war' }));
    expect(atlas.get().filters.severity).toEqual(allSev());
    expect(q('.pl-chip')).toBeNull();
  });

  test('a matrix cell filters by both region and severity', () => {
    renderPulse();
    const c = db.conflicts[0]!;
    const cell = q<HTMLButtonElement>(`#pl-matrix [data-cell="${c.region}|${c.severity}"]`)!;
    expect(cell).toBeTruthy();
    expect(cell.textContent).toBe(String(count((x) => x.region === c.region && x.severity === c.severity)));
    fireEvent.click(cell);
    const f = atlas.get().filters;
    expect(f.region).toBe(c.region);
    expect([...f.severity]).toEqual([c.severity]);
    expect(qa('.pl-chip')).toHaveLength(2);
  });

  test('a region bar filters and shows the region strip', () => {
    renderPulse();
    en();
    const region = db.conflicts[0]!.region;
    fireEvent.click(q(`#pl-region [data-region="${region}"]`)!);
    expect(atlas.get().filters.region).toBe(region);
    const strip = q('.pl-strip')!;
    const n = count((c) => c.region === region);
    expect(within(strip).getByLabelText(`Conflict files: ${n}`)).toBeTruthy();
    const share = Math.round((n / db.conflicts.length) * 100);
    expect(strip.textContent).toContain(`${share}%`);
  });

  test('a KPI tile filters to its severity', () => {
    renderPulse();
    en();
    const wars = count((c) => c.severity === 'war');
    const tile = q<HTMLButtonElement>(`.pl-tile[data-k="wars"]`)!;
    expect(tile).toHaveAttribute('aria-label', `Active wars: ${wars}`);
    fireEvent.click(tile);
    expect([...atlas.get().filters.severity]).toEqual(['war']);
    expect(tile).toHaveAttribute('aria-pressed', 'true');
  });

  test('when everything is filtered out, the empty state says what to clear', () => {
    renderPulse();
    en();
    // a region and a severity with no file in common
    const regions = [...new Set(db.conflicts.map((c) => c.region))];
    let pair: [string, string] | null = null;
    for (const r of regions) for (const s of SEVERITY) if (!pair && !count((c) => c.region === r && c.severity === s.id)) pair = [r, s.id];
    expect(pair).not.toBeNull();
    act(() => { atlas.setFilter('region', pair![0]); atlas.setFilter('severity', new Set([pair![1]])); });
    const empty = q('.pl-empty')!;
    expect(empty).toBeTruthy();
    fireEvent.click(within(empty).getByRole('button', { name: 'Show every severity' }));
    expect(atlas.get().filters.severity).toEqual(allSev());
    expect(atlas.get().filters.region).toBe(pair![0]);
  });
});

describe('figures', () => {
  test('conflict involvement counts each file once, as the country brief does', () => {
    renderPulse();
    en();
    const usa = db.countries.get('USA')!;
    const both = usa.conflicts.filter((id) => usa.external.includes(id)).length;
    expect(both).toBeGreaterThan(0); // the case that used to double-count
    const row = q<HTMLElement>('#pl-rank .pl-rk-row[data-iso="USA"]')!;
    expect(row).toBeTruthy();
    const value = involvement('USA');
    expect(row.querySelector('.pl-rk-val')!.textContent).toBe(String(value));
    // the breakdown adds up: party files, plus external roles in files it is not a party to
    const party = new Set(usa.conflicts).size;
    expect(row.textContent).toContain(`party to ${party}, external power in ${value - party}`);
  });

  test("an attention tile's accessible name includes its attention label", () => {
    renderPulse();
    en();
    const chokes = db.chokepoints.filter((p) => p.status === 'crisis' || p.status === 'elevated').length;
    const crisis = db.chokepoints.some((p) => p.status === 'crisis');
    expect(q('.pl-tile[data-k="choke"]')).toHaveAttribute('aria-label', `Chokepoints in crisis or elevated: ${chokes}, ${crisis ? 'Crisis' : 'Needs attention'}`);
    const unv = count((c) => db.isUnverified('conflict', c.id));
    expect(q('.pl-tile[data-k="unverified"]')).toHaveAttribute('aria-label', `Unverified developments: ${unv}, Needs attention`);
    // a plain tile keeps "label: value"
    expect(q('.pl-tile[data-k="decade"]')!.getAttribute('aria-label')).toMatch(/^Events since \d{4}: \d+$/);
  });
});

describe('linking', () => {
  test('pointing at a ranking row highlights that country; leaving clears it', () => {
    const spy = vi.fn();
    const off = on('highlight', spy);
    renderPulse();
    // the most involved state (files it is a party to or an external power in, each file once) leads the default tab
    const score = new Map<string, number>();
    for (const c of db.countries.values()) {
      const n = involvement(c.iso3);
      if (n) score.set(c.iso3, n);
    }
    const best = Math.max(...score.values());
    const row = q<HTMLElement>('#pl-rank .pl-rk-row')!;
    const iso = row.dataset.iso!;
    expect(score.get(iso)).toBe(best);
    expect(row.textContent).toContain(`#1`);
    fireEvent.pointerOver(row);
    expect(spy).toHaveBeenLastCalledWith({ iso3: [iso] });
    fireEvent.pointerOut(row);
    expect(spy).toHaveBeenLastCalledWith(null);
    fireEvent.click(row);
    expect(atlas.get().selection).toEqual({ kind: 'country', id: iso });
    off();
  });

  test('needs attention lists a chokepoint in crisis with its reason, and a click selects it', () => {
    renderPulse();
    en();
    const choke = db.chokepoints.find((p) => p.status === 'crisis')!;
    expect(choke).toBeTruthy();
    const item = q<HTMLElement>(`#pl-attn [data-choke="${choke.id}"]`)!;
    expect(item).toBeTruthy();
    expect(item.textContent).toContain(choke.en);
    expect(item.textContent).toMatch(/Crisis/);
    fireEvent.click(item);
    expect(atlas.get().selection).toEqual({ kind: 'choke', id: choke.id });
  });

  test('needs attention flags an unverified war with a why sentence', () => {
    renderPulse();
    en();
    const war = db.conflicts.find((c) => c.severity === 'war' && db.isUnverified('conflict', c.id))!;
    const group = q<HTMLElement>('#pl-attn [data-group="unverified"]')!;
    const total = count((c) => (c.severity === 'war' || c.severity === 'armed-conflict') && db.isUnverified('conflict', c.id));
    expect(group.querySelector('.pl-ag-n')!.textContent).toBe(String(total));
    const showAll = within(group).queryByRole('button', { name: /Show all/ });
    if (showAll) fireEvent.click(showAll);
    const item = group.querySelector<HTMLElement>(`[data-conflict="${war.id}"]`)!;
    expect(item.textContent).toContain(war.name.en);
    expect(item.textContent).toContain('not verified');
  });

  test('"figures follow the map" restricts counts to the latest viewport', () => {
    renderPulse();
    en();
    const toggle = q<HTMLButtonElement>('.pl-follow')!;
    fireEvent.click(toggle);
    expect(atlas.get().filters.inView).toBe(true);
    // until the map reports, every country counts
    expect(readLine()).toContain(`${db.conflicts.length} conflict files`);
    const view = ['SDN', 'ETH', 'SSD'];
    act(() => { emit('viewport', { iso3: view }); });
    const n = count((c) => c.countries.some((iso) => view.includes(iso)));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(db.conflicts.length);
    expect(readLine()).toMatch(/^What the map shows:/);
    expect(readLine()).toContain(`${n} conflict file`);
    // ranking rows are only states the map shows
    for (const row of qa('#pl-rank .pl-rk-row')) expect(view).toContain(row.dataset.iso);
  });

  test('a viewport the map reported before the view mounted restricts the counts at once', () => {
    const view = ['UKR', 'RUS', 'MDA'];
    emit('viewport', { iso3: view });
    atlas.setFilter('inView', true);
    renderPulse();
    en();
    const n = count((c) => c.countries.some((iso) => view.includes(iso)));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(db.conflicts.length);
    expect(readLine()).toMatch(/^What the map shows:/);
    expect(readLine()).toContain(`${n} conflict file`);
    expect(q('.pl-follow-note')!.textContent).toBe(`States on the map: ${view.length}.`);
    // and it keeps listening
    act(() => { emit('viewport', { iso3: ['SDN'] }); });
    expect(readLine()).toContain(`${count((c) => c.countries.includes('SDN'))} conflict file`);
  });
});

describe('charts', () => {
  test('each chart has a table view', () => {
    renderPulse();
    en();
    for (const id of ['pl-sev', 'pl-region', 'pl-dim', 'pl-matrix']) {
      const card = q(`#${id}`)!;
      const btn = within(card).getByRole('button', { name: 'Table' });
      fireEvent.click(btn);
      expect(btn).toHaveAttribute('aria-pressed', 'true');
      expect(card.querySelector('table.pl-table')).toBeTruthy();
    }
    const rows = [...q('#pl-sev table.pl-table tbody')!.querySelectorAll('tr')];
    expect(rows).toHaveLength(SEVERITY.length);
    expect(rows[0]!.textContent).toContain(String(count((c) => c.severity === 'war')));
  });

  test('the displaced tile and tab appear only when figures have data', () => {
    renderPulse();
    expect(q('.pl-tile[data-k="displaced"]')).toBeNull();
    expect(q('#pl-rank [role="tab"][data-tab="displaced"]')).toBeNull();
    cleanup();
    const fig = (value: number): Figure => ({ value, year: 2025, source: 'test' });
    const withFigures: DB = {
      ...db,
      figures: {
        sources: [{ id: 'test', name: 'Test', licence: 'CC0', url: 'https://example.org', fetchedAt: '2026-11-01' }],
        country: (iso: string) => (iso === 'SDN' ? { refugeesFrom: fig(1_500_000), idps: fig(8_000_000) } : iso === 'UKR' ? { refugeesFrom: fig(6_000_000) } : {}),
        conflictDeaths: () => [],
      },
    };
    renderPulse(withFigures);
    en();
    expect(q('.pl-tile[data-k="displaced"]')).toHaveAttribute('aria-label', 'Displaced people: 15.5 M');
    const tab = q<HTMLButtonElement>('#pl-rank [role="tab"][data-tab="displaced"]')!;
    fireEvent.click(tab);
    expect(q<HTMLElement>('#pl-rank .pl-rk-row')!.dataset.iso).toBe('SDN');
  });
});

describe('language', () => {
  test('English renders every label in English, whatever the page direction', () => {
    document.documentElement.dir = 'rtl';
    renderPulse();
    en();
    const root = q('.pulse')!;
    expect(root.textContent).not.toMatch(/[؀-ۿ]/);
    expect(q('#pl-sev')!.textContent).toContain('Conflicts by severity');
    document.documentElement.removeAttribute('dir');
  });
});
