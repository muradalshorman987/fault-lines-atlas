import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { emit, on } from '../src/app/events';
import { atlas } from '../src/app/store';
import { DbContext } from '../src/app/useT';
import { build } from '../src/data/build';
import type { DB } from '../src/data/types';
import { availableTours } from '../src/features/tours/tours';
import { Welcome, WELCOME_KEY } from '../src/features/welcome';
import '../src/i18n/core';
import { readRaw } from './helpers/readRaw';

let db: DB;
beforeAll(() => { db = build(readRaw()); });
beforeEach(() => { localStorage.clear(); history.replaceState(null, '', location.pathname); });
afterEach(() => { atlas.reset(); vi.restoreAllMocks(); localStorage.clear(); history.replaceState(null, '', location.pathname); });

/** The panel as Layout mounts it, with the app behind it. */
const mount = () => render(
  <DbContext.Provider value={db}>
    <div id="app"><button type="button" id="behind">behind</button></div>
    <Welcome />
  </DbContext.Provider>,
);
const panel = () => screen.queryByRole('dialog', { name: 'ابدأ من هنا' });

describe('Start here panel', () => {
  test('opens on the first visit, keeps the app behind it inert, and is not shown again once closed', () => {
    const first = mount();
    expect(panel()).toBeInTheDocument();
    expect(document.getElementById('app')).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }));
    expect(panel()).toBeNull();
    expect(document.getElementById('app')).not.toHaveAttribute('inert');
    expect(localStorage.getItem(WELCOME_KEY)).toBe('1');
    first.unmount();
    mount();
    expect(panel()).toBeNull();
  });

  test('stays closed when the visit opens a share link', () => {
    history.replaceState(null, '', '#country-SAU');
    mount();
    expect(panel()).toBeNull();
  });

  test('still opens and closes when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    mount();
    expect(panel()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'استكشف بنفسك' }));
    expect(panel()).toBeNull();
  });

  test('speaks English when the atlas does', () => {
    atlas.set({ lang: 'en' });
    mount();
    expect(screen.getByRole('dialog', { name: 'Start here' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Where is there war now\?/ })).toBeInTheDocument();
  });

  test.each([
    ['أين تدور الحرب الآن؟', () => { expect(atlas.get().lens).toBe('conflicts'); expect(atlas.get().view).toBeNull(); }],
    ['من يقف مع من؟', () => expect(atlas.get().view).toBe('network')],
    ['قرن من التحوّلات', () => expect(atlas.get().view).toBe('timeline')],
    ['قارن بين دولتين', () => { expect(atlas.get().view).toBe('compare'); expect(atlas.get().compare).toEqual(['SAU', 'IRN']); }],
    ['نبض العالم', () => expect(atlas.get().view).toBe('pulse')],
  ])('"%s" does its action and closes the panel', (name, check) => {
    mount();
    const card = screen.getByRole('button', { name: new RegExp('^' + name) });
    expect(card).toHaveAttribute('data-result');
    fireEvent.click(card);
    check();
    expect(panel()).toBeNull();
    expect(localStorage.getItem(WELCOME_KEY)).toBe('1');
  });

  test('cards name their result: the war card filters the map, the others open a view', () => {
    mount();
    expect(screen.getByRole('button', { name: /^أين تدور الحرب الآن؟/ })).toHaveAttribute('data-result', 'filter');
    for (const name of ['من يقف مع من؟', 'قرن من التحوّلات', 'قارن بين دولتين', 'نبض العالم']) {
      expect(screen.getByRole('button', { name: new RegExp('^' + name) })).toHaveAttribute('data-result', 'navigate');
    }
  });

  test('lists the guided tours, and a tour row starts its tour with focus', () => {
    const started: unknown[] = [];
    const off = on('starttour', (p) => { started.push(p); });
    mount();
    const tours = availableTours(db);
    expect(document.querySelectorAll('#welcome [data-tour]')).toHaveLength(tours.length);
    fireEvent.click(screen.getByRole('button', { name: /^شرايين الطاقة/ }));
    off();
    expect(started).toEqual([{ id: 'energy', focus: true }]);
    expect(panel()).toBeNull();
  });

  test('Esc closes the panel without reaching the global key map', () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    mount();
    expect(document.activeElement?.closest('#welcome')).not.toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    document.removeEventListener('keydown', outer);
    expect(panel()).toBeNull();
    expect(outer).not.toHaveBeenCalled();
  });

  test('Tab stays inside the panel', () => {
    mount();
    const box = panel()!;
    const all = [...box.querySelectorAll<HTMLElement>('button')];
    all[all.length - 1]!.focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(all[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(all[all.length - 1]);
  });

  test('the "welcome" event opens it again on a later visit, and focus goes back where it was', () => {
    localStorage.setItem(WELCOME_KEY, '1');
    mount();
    expect(panel()).toBeNull();
    const behind = document.getElementById('behind')!;
    behind.focus();
    act(() => { emit('welcome', null); });
    expect(panel()).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(behind);
  });
});
