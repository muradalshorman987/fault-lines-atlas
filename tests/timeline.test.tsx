import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Profiler, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { emit } from '../src/app/events';
import { atlas } from '../src/app/store';
import { DbContext } from '../src/app/useT';
import { build } from '../src/data/build';
import type { DB } from '../src/data/types';
import { escapeLayer } from '../src/features/shell/ui';
import { TourPlayer } from '../src/features/tours/TourPlayer';
import { trimCaption } from '../src/features/tours/tours';
import { Scrubber, TimelineView } from '../src/features/views/timeline';
import '../src/i18n/core';
import { readRaw } from './helpers/readRaw';

let db: DB;
beforeAll(() => { db = build(readRaw()); });
// Boot fills the timeline filter with every category at load.
beforeEach(() => { atlas.setFilter('timelineCats', new Set(db.timeline.categories.map((c) => c.id))); });
// Unmount first so resetting the store does not re-render a mounted tree outside act().
afterEach(() => { cleanup(); atlas.reset(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const wrap = (node: ReactNode) => render(<DbContext.Provider value={db}>{node}</DbContext.Provider>);
const fakeClock = () => vi.useFakeTimers({
  toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
});
const tick = (ms: number) => { act(() => { vi.advanceTimersByTime(ms); }); };
/** matchMedia that answers true only for the given media features (jsdom has none). */
const stubMedia = (...on: string[]) => vi.stubGlobal('matchMedia', (query: string) => ({
  matches: on.some((f) => query.includes(f)), media: query,
  addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
}));

describe('year scrubber', () => {
  test('shows the current year and follows it', () => {
    atlas.set({ year: 1948 });
    wrap(<Scrubber />);
    expect(q('footer#scrubber')).toHaveClass('sc');
    expect(q('.sc-year-v')).toHaveTextContent('1948');
    expect(q('.sc-track')).toHaveAttribute('aria-valuenow', '1948');
    expect(q('.sc-track')).toHaveAttribute('dir', 'ltr');
    act(() => { atlas.set({ year: 1967, yearFilter: true }); });
    expect(q('.sc-year-v')).toHaveTextContent('1967');
    expect(q('.sc-track')).toHaveAttribute('aria-valuetext', '1967 — الخريطة مفلترة حتى هذه السنة');
  });

  test('play advances the year', () => {
    fakeClock();
    atlas.set({ year: 1900 });
    wrap(<Scrubber />);
    fireEvent.click(q('.sc-play')!);
    expect(atlas.get().playing).toBe(true);
    expect(q('.sc-play')).toHaveClass('is-playing');
    expect(q('.sc-play')).toHaveAttribute('aria-label', 'أوقف التشغيل');
    tick(1000);
    const y = atlas.get().year;
    expect(y).toBeGreaterThan(1900);
    expect(y).toBeLessThan(2026);
    expect(q('.sc-year-v')).toHaveTextContent(String(y));
  });

  test('play stops at the last year', () => {
    fakeClock();
    atlas.set({ year: 2020 });
    wrap(<Scrubber />);
    fireEvent.click(q('.sc-play')!);
    tick(3000);
    expect(atlas.get().year).toBe(2026);
    expect(atlas.get().playing).toBe(false);
    expect(q('.sc-play')).not.toHaveClass('is-playing');
    tick(3000);
    expect(atlas.get().year).toBe(2026);
  });

  test('play at the last year starts again from the first', () => {
    fakeClock();
    wrap(<Scrubber />);
    expect(atlas.get().year).toBe(2026);
    fireEvent.click(q('.sc-play')!);
    expect(atlas.get().year).toBe(1900);
    expect(atlas.get().playing).toBe(true);
  });

  test('with reduced motion, play steps a decade every 800 ms and stops on unmount', () => {
    fakeClock();
    stubMedia('prefers-reduced-motion');
    atlas.set({ year: 1903 });
    const { unmount } = wrap(<Scrubber />);
    fireEvent.click(q('.sc-play')!);
    tick(800);
    expect(atlas.get().year).toBe(1910);
    tick(800);
    expect(atlas.get().year).toBe(1920);
    unmount();
    tick(5000);
    expect(atlas.get().year).toBe(1920);
  });

  test('keys on the track move the year and stop play', () => {
    atlas.set({ year: 1950, playing: true });
    wrap(<Scrubber />);
    const track = q('.sc-track')!;
    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(atlas.get().year).toBe(1951);
    expect(atlas.get().playing).toBe(false);
    fireEvent.keyDown(track, { key: 'PageDown' });
    expect(atlas.get().year).toBe(1941);
    fireEvent.keyDown(track, { key: 'End' });
    expect(atlas.get().year).toBe(2026);
    fireEvent.keyDown(track, { key: 'Home' });
    expect(atlas.get().year).toBe(1900);
    fireEvent.keyDown(track, { key: 'ArrowDown' });
    expect(atlas.get().year).toBe(1900);
  });

  test('the filter chip toggles the year filter and the open button opens the full timeline', () => {
    wrap(<Scrubber />);
    expect(q('.sc-filter')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(q('.sc-filter')!);
    expect(atlas.get().yearFilter).toBe(true);
    expect(q('.sc-filter')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(q('.sc-open')!);
    expect(atlas.get().view).toBe('timeline');
    expect(q('.sc-open')).toHaveAttribute('aria-label', 'الخط الزمني الكامل');
  });
});

describe('full timeline view', () => {
  test('lists the events in view, and a row selects its event', () => {
    wrap(<TimelineView />);
    const rows = qa('.tl-rows .tl-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(q('.tl-list .n')).toHaveTextContent(String(rows.length));
    const id = rows[0]!.dataset.id!;
    fireEvent.click(rows[0]!);
    expect(atlas.get().selection).toEqual({ kind: 'event', id });
    expect(q(`.tl-row[data-id="${id}"]`)).toHaveAttribute('aria-current', 'true');
  });

  test('filtering every category out shows the empty state', () => {
    // jsdom has no layout: give the plot a width so the chart builds too.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    wrap(<TimelineView />);
    expect(q('.tl-svg circle')).not.toBeNull();
    act(() => { atlas.setFilter('timelineCats', new Set()); });
    expect(q('.tl-rows .empty')).toHaveTextContent('اختر فئة واحدة على الأقل لعرض الأحداث.');
    expect(qa('.tl-rows .tl-row')).toHaveLength(0);
    expect(q('.tl-svg text.tl-empty')).toHaveTextContent('اختر فئة واحدة على الأقل لعرض الأحداث.');
    expect(q('.tl-cats [data-all]')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(q('.tl-cats [data-all]')!);
    expect(atlas.get().filters.timelineCats?.size).toBe(db.timeline.categories.length);
    expect(q('.tl-rows .empty')).toBeNull();
  });

  test('a category chip toggles that category', () => {
    wrap(<TimelineView />);
    const first = db.timeline.categories[0]!.id;
    const chip = q(`.tl-cats [data-cat="${first}"]`)!;
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(atlas.get().filters.timelineCats?.has(first)).toBe(false);
    expect(q(`.tl-cats [data-cat="${first}"]`)).toHaveAttribute('aria-pressed', 'false');
    expect(q('.tl-cats [data-all]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('play ticks move the cursor without re-rendering the view', () => {
    fakeClock();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800); // a width, so the chart and its cursor exist
    const renders = vi.fn();
    wrap(<Profiler id="timeline" onRender={renders}><TimelineView /></Profiler>);
    tick(100); // let the chart report its first visible range
    expect(q('.tl-cursor text')).toHaveTextContent('2026');
    const before = renders.mock.calls.length;
    for (const year of [1950, 1951, 1952]) act(() => { atlas.set({ year }); });
    tick(100);
    expect(renders.mock.calls.length).toBe(before);
    expect(q('.tl-cursor text')).toHaveTextContent('1952');
    expect(q('.tl-cursor')!.getAttribute('transform')).not.toBe('');
  });

  test('switching language re-renders in place', () => {
    wrap(<TimelineView />);
    expect(q('.tl-hint')).toHaveTextContent('مرّر العجلة');
    act(() => { atlas.set({ lang: 'en' }); });
    expect(q('.tl-hint')).toHaveTextContent('Scroll over the lanes to zoom, drag to pan.');
    expect(q('#tl-list-h')).toHaveTextContent('Events in view');
  });
});

describe('tour player', () => {
  const start = (p: string | { id: string; focus?: boolean }) => { act(() => { emit('starttour', p); }); };

  test('starttour sets the tour and selects step 1', () => {
    wrap(<TourPlayer />);
    expect(q('#tour')).toHaveProperty('hidden', true);
    start('energy');
    expect(atlas.get().tour).toEqual({ id: 'energy', step: 0 });
    expect(atlas.get().selection).toEqual({ kind: 'choke', id: 'hormuz' });
    expect(atlas.get().lens).toBe('chokepoints');
    expect(q('#tour')).toHaveProperty('hidden', false);
    expect(q('#tour')).toHaveAttribute('role', 'region');
    expect(q('.tour-name')).toHaveTextContent(db.nameOf('choke', 'hormuz', 'ar'));
    expect(q('.tour-count')).toHaveTextContent('المحطة 1 من 7');
    expect(q('.tour-live')).toHaveTextContent(`المحطة 1 من 7: ${db.nameOf('choke', 'hormuz', 'ar')}`);
  });

  test('Next and Previous move through the steps', () => {
    wrap(<TourPlayer />);
    start('energy');
    expect(q('[data-k="tour-prev"]')).toBeDisabled();
    fireEvent.click(q('[data-k="tour-next"]')!);
    expect(atlas.get().tour).toEqual({ id: 'energy', step: 1 });
    expect(atlas.get().selection).toEqual({ kind: 'choke', id: 'bab-al-mandab' });
    expect(q('.seg.cur')).toBe(qa('.tour-segs .seg')[1]);
    fireEvent.click(q('[data-k="tour-prev"]')!);
    expect(atlas.get().tour).toEqual({ id: 'energy', step: 0 });
  });

  test('Finish on the last step ends the tour', () => {
    wrap(<TourPlayer />);
    start('energy');
    act(() => { atlas.set({ tour: { id: 'energy', step: 6 } }); });
    expect(q('[data-k="tour-next"]')).toHaveTextContent('إنهاء الجولة');
    fireEvent.click(q('[data-k="tour-next"]')!);
    expect(atlas.get().tour).toBe(null);
    expect(q('#tour')).toHaveProperty('hidden', true);
  });

  test('tour: null hides the card, and the shell Esc ends the tour', () => {
    wrap(<TourPlayer />);
    start('energy');
    act(() => { atlas.set({ tour: null }); });
    expect(q('#tour')).toHaveProperty('hidden', true);
    expect(q('.tour-card')).toBeEmptyDOMElement();
    start('mideast');
    expect(q('#tour')).toHaveProperty('hidden', false);
    act(() => { escapeLayer(); });
    expect(atlas.get().tour).toBe(null);
    expect(q('#tour')).toHaveProperty('hidden', true);
  });

  test('{id, focus} moves focus into the tour card', () => {
    wrap(<TourPlayer />);
    start({ id: 'energy', focus: true });
    expect(document.activeElement).toBe(q('#tour [data-k="tour-next"]'));
  });

  test('focus on Previous moves to Next when Previous becomes disabled', () => {
    wrap(<TourPlayer />);
    start('energy');
    fireEvent.click(q('[data-k="tour-next"]')!);
    q<HTMLButtonElement>('[data-k="tour-prev"]')!.focus();
    fireEvent.click(q('[data-k="tour-prev"]')!);
    expect(q('[data-k="tour-prev"]')).toBeDisabled();
    expect(document.activeElement).toBe(q('#tour [data-k="tour-next"]'));
  });

  test('a tour that moves the timeline gives the year back when it ends', () => {
    wrap(<TourPlayer />);
    start('century');
    expect(atlas.get().year).toBe(1914);
    expect(atlas.get().yearFilter).toBe(true);
    expect(atlas.get().lens).toBe('history');
    act(() => { atlas.set({ tour: null }); });
    expect(atlas.get().year).toBe(2026);
    expect(atlas.get().yearFilter).toBe(false);
  });

  test('arrow keys step through the tour in reading order', () => {
    wrap(<TourPlayer />);
    start('energy');
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' }); // RTL: left is forward
    expect(atlas.get().tour?.step).toBe(1);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(atlas.get().tour?.step).toBe(0);
    act(() => { atlas.set({ lang: 'en' }); });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' }); // LTR: right is forward
    expect(atlas.get().tour?.step).toBe(1);
  });

  test('autoplay moves on every 9 seconds and holds while focus is in the card', () => {
    fakeClock();
    wrap(<TourPlayer />);
    start('energy');
    fireEvent.click(q('[data-k="tour-play"]')!);
    expect(q('[data-k="tour-play"]')).toHaveAttribute('aria-pressed', 'true');
    expect(q('.tour-card')).toHaveClass('is-playing');
    tick(8900);
    expect(atlas.get().tour?.step).toBe(0);
    tick(200);
    expect(atlas.get().tour?.step).toBe(1);
    act(() => { q<HTMLButtonElement>('[data-k="tour-next"]')!.focus(); });
    expect(q('.tour-card')).toHaveClass('is-held');
    tick(20000);
    expect(atlas.get().tour?.step).toBe(1);
  });

  test('autoplay is off under reduced motion', () => {
    stubMedia('prefers-reduced-motion');
    wrap(<TourPlayer />);
    start('energy');
    const play = q('[data-k="tour-play"]')!;
    expect(play).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(play);
    expect(q('[data-k="tour-play"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('switching language re-renders the card on the same step', () => {
    wrap(<TourPlayer />);
    start('energy');
    fireEvent.click(q('[data-k="tour-next"]')!);
    act(() => { atlas.set({ lang: 'en' }); });
    expect(q('.tour-count')).toHaveTextContent('Stop 2 of 7');
    expect(q('.tour-name')).toHaveTextContent(db.nameOf('choke', 'bab-al-mandab', 'en'));
    expect(q('#tour')).toHaveAttribute('aria-label', 'Tour: Energy arteries');
  });

  test('an unverified step shows the note', () => {
    const tours = ['energy', 'mideast', 'europe', 'asia', 'africa'];
    wrap(<TourPlayer />);
    let found = false;
    for (const id of tours) {
      start(id);
      for (let i = 0; i < 10 && atlas.get().tour; i++) {
        const sel = atlas.get().selection!;
        if (db.isUnverified(sel.kind, sel.id)) { found = true; break; }
        fireEvent.click(q('[data-k="tour-next"]')!);
      }
      if (found) break;
    }
    expect(found).toBe(true);
    expect(q('.tour-unv')).toHaveTextContent('لم تتحقّق منه هذه النسخة');
  });
});

describe('trimCaption', () => {
  test('keeps short text and cuts long text at a sentence or a word', () => {
    expect(trimCaption('  short   text ')).toBe('short text');
    const sentence = 'a'.repeat(200) + '. ' + 'b '.repeat(100);
    expect(trimCaption(sentence)).toBe('a'.repeat(200) + '.');
    const words = 'word '.repeat(100);
    const cut = trimCaption(words);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(281);
  });
});
