import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { applyHash } from '../src/app/hash';
import { atlas } from '../src/app/store';
import { DbContext } from '../src/app/useT';
import { VIEWS, type ViewId } from '../src/config';
import { build } from '../src/data/build';
import type { DB, Kind } from '../src/data/types';
import { ViewPanel } from '../src/features/views';
import '../src/i18n/core';
import { readRaw } from './helpers/readRaw';

let db: DB;
beforeAll(() => { db = build(readRaw()); });
// Unmount first so resetting the store does not re-render a mounted panel outside act().
afterEach(() => { cleanup(); atlas.reset(); vi.unstubAllGlobals(); });

/** The panel inside #stage as Layout mounts it, with a focusable opener outside and the global tooltip. */
function renderPanel() {
  return render(
    <DbContext.Provider value={db}>
      <button id="opener" type="button">open</button>
      <main id="stage"><ViewPanel /></main>
      <div id="tooltip" role="tooltip" hidden />
    </DbContext.Provider>,
  );
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const panel = () => q<HTMLElement>('#viewpanel')!;
/** Each view body is a lazy chunk: wait until the panel no longer shows its loading placeholder. */
const loaded = () => waitFor(() => expect(q('#viewpanel [aria-busy="true"]')).toBeNull(), { timeout: 5000 });
const open = async (id: ViewId) => { act(() => { atlas.openView(id); }); await loaded(); };
const show = async (patch: Parameters<typeof atlas.set>[0]) => { act(() => { atlas.set(patch); }); await loaded(); };
const viewName = (id: ViewId, lang: 'ar' | 'en' = 'ar') => VIEWS.find((v) => v.id === id)![lang];
const country = (iso: string, lang: 'ar' | 'en' = 'ar') => db.nameOf('country', iso, lang);

/** Every media query matches: a phone with reduced motion. */
const phone = () => vi.stubGlobal('matchMedia', (media: string) => ({
  matches: true, media, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
}));

// Keep this block first: until a view has opened once in this file, its code is not loaded, as on a cold visit.
describe('share links on a cold load', () => {
  afterEach(() => { history.replaceState(null, '', location.pathname); });

  test.each([
    ['view-network', 'network', '.net-li'],
    ['compare-USA-CHN', 'compare', '.cmp-name-t'],
    ['view-timeline', 'timeline', '.tl-rows'],
    ['view-sources', 'sources', '.src-card'],
  ] as const)('#%s opens the %s view once its code arrives', async (token, id, body) => {
    history.replaceState(null, '', '#' + token);
    renderPanel();
    act(() => { applyHash(db); });
    expect(panel()).toHaveAttribute('data-view', id);
    expect(q('#vp-title')).toHaveTextContent(viewName(id)); // the frame shows at once
    expect(q('#viewpanel .vp-body [aria-busy="true"]')).not.toBeNull(); // while the body loads
    await loaded();
    expect(q(body)).not.toBeNull();
    if (id === 'compare') expect(qa('.cmp-name-t').map((n) => n.textContent)).toEqual([country('USA'), country('CHN')]);
  });
});

describe('view host', () => {
  test('is hidden until a view is set', () => {
    renderPanel();
    expect(panel()).toHaveAttribute('hidden');
    expect(q('#viewpanel .vp-card')).toHaveAttribute('role', 'dialog');
    expect(q('#viewpanel .vp-card')).toHaveAttribute('aria-labelledby', 'vp-title');
  });

  test.each(['network', 'compare', 'sources'] as const)('opening %s renders its title, subtitle and close button', async (id) => {
    renderPanel();
    await open(id);
    expect(panel()).not.toHaveAttribute('hidden');
    expect(panel()).toHaveAttribute('data-view', id);
    expect(panel()).toHaveClass('is-open');
    expect(q('#vp-title')).toHaveTextContent(viewName(id));
    expect(q('#vp-title')).toHaveAttribute('tabindex', '-1');
    expect(q('.vp-sub')?.textContent).toBeTruthy();
    expect(q('.vp-close')).toHaveAttribute('aria-label', 'إغلاق');
    expect(document.activeElement).toBe(q('#vp-title'));
  });

  test('the network subtitle counts the ties', async () => {
    renderPanel();
    await open('network');
    expect(q('.vp-sub')).toHaveTextContent(`— ${db.relations.edges.length} علاقة`);
  });

  test('the timeline view gets the host frame', async () => {
    renderPanel();
    await open('timeline');
    expect(panel()).toHaveAttribute('data-view', 'timeline');
    expect(q('#vp-title')).toHaveTextContent(viewName('timeline'));
  });

  test('switching language re-renders the open view in place', async () => {
    renderPanel();
    await open('sources');
    act(() => { atlas.set({ lang: 'en' }); });
    expect(q('#vp-title')).toHaveTextContent(viewName('sources', 'en'));
    expect(q('#src-ds-h')).toHaveTextContent('Datasets');
    expect(q('.vp-close')).toHaveAttribute('aria-label', 'Close');
  });

  test('closing returns focus to the element that opened it, then hides the panel', async () => {
    renderPanel();
    q('#opener')!.focus();
    await open('network');
    expect(document.activeElement).toBe(q('#vp-title'));
    fireEvent.click(q('.vp-close')!);
    expect(atlas.get().view).toBe(null);
    expect(document.activeElement).toBe(q('#opener'));
    expect(panel()).not.toHaveClass('is-open');
    await waitFor(() => expect(panel()).toHaveAttribute('hidden'));
    expect(panel()).not.toHaveAttribute('data-view');
  });

  test('the scrim closes the view', async () => {
    renderPanel();
    await open('sources');
    fireEvent.click(q('.vp-scrim')!);
    expect(atlas.get().view).toBe(null);
  });

  test('on a phone, selecting a record while a view is open closes the view', async () => {
    phone();
    renderPanel();
    await open('network');
    act(() => { atlas.select('country', 'SAU'); });
    expect(atlas.get().view).toBe(null);
    expect(atlas.get().selection).toEqual({ kind: 'country', id: 'SAU' });
    await waitFor(() => expect(panel()).toHaveAttribute('hidden'));
  });
});

describe('network', () => {
  test('lists every tie, strongest first, with filter chips for each type, kind and bloc', async () => {
    renderPanel();
    await open('network');
    const n = db.relations.edges.length;
    expect(qa('.net-li')).toHaveLength(n);
    expect(q('#nw-list-h .n')).toHaveTextContent(String(n));
    expect(qa('[data-g=type] .chip')).toHaveLength(db.relations.edgeTypes.length);
    expect(qa('[data-g=kind] .chip')).toHaveLength(2);
    expect(qa('[data-g=bloc] .chip')).toHaveLength(db.relations.blocs.length);
    const weights = qa('.net-li').map((li) => db.edgeById.get(li.dataset.edge!)!.weight as number);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(q('.net-svg')).toHaveAttribute('aria-label', expect.stringContaining(String(n)));
    expect(qa('.net-svg .net-n')).toHaveLength(new Set(db.relations.edges.flatMap((e) => [e.a, e.b])).size);
  });

  test('turning a type off drops its ties from the list and the graph', async () => {
    renderPanel();
    await open('network');
    const rivalry = db.relations.edges.filter((e) => e.type === 'rivalry').length;
    fireEvent.click(q('[data-g=type] [data-type="rivalry"]')!);
    expect(atlas.get().filters.relTypes.has('rivalry')).toBe(false);
    expect(q('[data-g=type] [data-type="rivalry"]')).toHaveAttribute('aria-pressed', 'false');
    expect(qa('.net-li')).toHaveLength(db.relations.edges.length - rivalry);
    expect(qa('.net-svg .net-e.is-off')).toHaveLength(rivalry);
  });

  test('no ties left shows the empty line', async () => {
    renderPanel();
    await open('network');
    fireEvent.click(q('[data-g=kind] [data-kind="treaty"]')!);
    fireEvent.click(q('[data-g=kind] [data-kind="assessed"]')!);
    expect(qa('.net-li')).toHaveLength(0);
    expect(q('.net-list .empty')).toHaveTextContent('لا روابط تطابق الفلاتر الحالية.');
  });

  test('a bloc chip outlines the bloc and the caption counts its members', async () => {
    renderPanel();
    await open('network');
    expect(q('.net-caption')).toHaveAttribute('hidden');
    fireEvent.click(q('[data-g=bloc] [data-bloc="nato"]')!);
    expect(atlas.get().filters.bloc).toBe('nato');
    expect(q('.net-caption')).not.toHaveAttribute('hidden');
    expect(q('.net-caption')).toHaveTextContent('حلف شمال الأطلسي');
    expect(qa('.net-svg .net-n.is-member').length).toBeGreaterThan(0);
    fireEvent.click(q('[data-g=bloc] [data-bloc="nato"]')!);
    expect(atlas.get().filters.bloc).toBe(null);
  });

  test('a row opens its details; their buttons select a state or compare the pair', async () => {
    renderPanel();
    await open('network');
    const li = qa('.net-li')[0]!;
    const e = db.edgeById.get(li.dataset.edge!)!;
    fireEvent.click(li.querySelector('.net-row')!);
    expect(li.querySelector('.net-row')).toHaveAttribute('aria-expanded', 'true');
    expect(li).toHaveClass('is-open');
    expect(li.querySelector('.net-more')).not.toHaveAttribute('hidden');
    fireEvent.click(li.querySelector(`[data-sel="${e.b}"]`)!);
    expect(atlas.get().selection).toEqual({ kind: 'country', id: e.b });
    fireEvent.click(li.querySelector('[data-cmp]')!);
    expect(atlas.get().view).toBe('compare');
    expect(atlas.get().compare).toEqual([e.a, e.b]);
  });

  test('a selected state outside the network is named in the caption', async () => {
    renderPanel();
    await open('network');
    const iso = [...db.countries.keys()].find((k) => !db.countries.get(k)!.edges.length)!;
    act(() => { atlas.select('country', iso, { fly: false }); });
    expect(q('.net-caption')).toHaveTextContent(country(iso));
  });
});

describe('compare', () => {
  test('SAU and IRN: both names head the comparison', async () => {
    renderPanel();
    await show({ view: 'compare', compare: ['SAU', 'IRN'] });
    const names = qa('.cmp-name-t').map((n) => n.textContent);
    expect(names).toEqual([country('SAU'), country('IRN')]);
    expect(q<HTMLInputElement>('#cmp-in-0')!.value).toBe(country('SAU'));
    expect(q<HTMLInputElement>('#cmp-in-1')!.value).toBe(country('IRN'));
    expect(qa('.cmp-fig')).toHaveLength(5);
    expect(qa('.cmp-sec h3').map((h) => h.textContent)).toContain('العلاقة المباشرة');
  });

  test('opening without a valid pair picks the default pair', async () => {
    renderPanel();
    await open('compare');
    expect(atlas.get().compare).toEqual(['USA', 'CHN']);
    expect(qa('.cmp-name-t').map((n) => n.textContent)).toEqual([country('USA'), country('CHN')]);
  });

  test('the swap button swaps the two states', async () => {
    renderPanel();
    await show({ view: 'compare', compare: ['SAU', 'IRN'] });
    fireEvent.click(q('.cmp-swap')!);
    expect(atlas.get().compare).toEqual(['IRN', 'SAU']);
    expect(q<HTMLInputElement>('#cmp-in-0')!.value).toBe(country('IRN'));
  });

  test('the picker searches states and Enter chooses the active option', async () => {
    renderPanel();
    await show({ view: 'compare', compare: ['SAU', 'IRN'], lang: 'en' });
    const input = q<HTMLInputElement>('#cmp-in-1')!;
    fireEvent.change(input, { target: { value: 'Turk' } });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(q('#cmp-lb-1')).not.toHaveAttribute('hidden');
    expect(input).toHaveAttribute('aria-activedescendant', 'cmp-o-1-0');
    expect(q('#cmp-o-1-0')).toHaveAttribute('aria-selected', 'true');
    const first = q('#cmp-o-1-0')!.dataset.iso!;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(atlas.get().compare).toEqual(['SAU', first]);
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input.value).toBe(country(first, 'en'));
  });

  test('a name with no match says so; Escape closes the list and restores the name', async () => {
    renderPanel();
    await show({ view: 'compare', compare: ['SAU', 'IRN'] });
    const input = q<HTMLInputElement>('#cmp-in-0')!;
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(q('#cmp-lb-0 .cmp-o-none')).toHaveTextContent('لا دولة بهذا الاسم');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(q('#cmp-lb-0')).toHaveAttribute('hidden');
    expect(input.value).toBe(country('SAU'));
  });

  test('a record button in the body selects it', async () => {
    renderPanel();
    await show({ view: 'compare', compare: ['SAU', 'IRN'] });
    fireEvent.click(q('.cmp-name[data-id="IRN"]')!);
    expect(atlas.get().selection).toEqual({ kind: 'country', id: 'IRN' });
  });
});

describe('sources', () => {
  test('lists every correction, all applied', async () => {
    renderPanel();
    await open('sources');
    const n = db.corrections.length;
    expect(q('#src-er-h .n')).toHaveTextContent(String(n));
    const items = qa('#src-er-h ~ .src-derived > div');
    expect(items).toHaveLength(n);
    expect(items[0]?.querySelector('dt')).toHaveTextContent(db.corrections[0]!.where.ar);
    expect(items[0]?.querySelector('dd')).toHaveTextContent(db.corrections[0]!.what.ar);
  });

  test('datasets, references, credit link and the unverified counts', async () => {
    renderPanel();
    await open('sources');
    expect(qa('.src-card')).toHaveLength(db.sources.datasets.length);
    expect(qa('.src-refs > li')).toHaveLength(db.sources.references.length);
    expect(q('.src-credit a')).toHaveAttribute('href', 'https://claude.ai/artifact/7Y8KPakRKzrUtZYxjCwJai');
    // Each kind with unverified records, with its count; kinds with none are left out.
    const kinds: [Kind, string, string[]][] = [
      ['conflict', 'نزاعات', db.conflicts.map((c) => c.id)],
      ['event', 'أحداث', db.timeline.events.map((e) => e.id)],
      ['choke', 'مضائق وممرات', db.chokepoints.map((p) => p.id)],
      ['country', 'دول', [...db.countries.keys()]],
    ];
    const parts = kinds.map(([kind, label, ids]) => [label, ids.filter((id) => db.isUnverified(kind, id)).length] as const)
      .filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`);
    if (parts.length) expect(q('.src-uv p')).toHaveTextContent(parts.join('، '));
    else expect(q('.src-uv')).toBeNull();
  });
});
