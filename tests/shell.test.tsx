import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { emit, on } from '../src/app/events';
import { atlas } from '../src/app/store';
import { DbContext } from '../src/app/useT';
import { build } from '../src/data/build';
import type { DB } from '../src/data/types';
import { LensRail, ShellOverlays, TopBar } from '../src/features/shell';
import { isTyping, keyOf } from '../src/features/shell/keyboard';
import { markMatch } from '../src/features/shell/markMatch';
import { availableTours, stepsLabel } from '../src/features/tours/tours';
import '../src/i18n/core';
import { readRaw } from './helpers/readRaw';

let db: DB;
beforeAll(() => { db = build(readRaw()); });
// Unmount first so resetting the store does not re-render a mounted shell outside act().
afterEach(() => { cleanup(); atlas.reset(); vi.useRealTimers(); });

/** The shell inside the same containers Layout gives it (the map is left out). */
function renderShell(extra?: React.ReactNode) {
  return render(
    <DbContext.Provider value={db}>
      <div id="app">
        <header id="topbar"><TopBar /></header>
        <nav id="lensrail"><LensRail /></nav>
        <main id="stage">{extra}</main>
      </div>
      <div id="tour" hidden />
      <ShellOverlays />
    </DbContext.Provider>,
  );
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const key = (el: Element | null, init: KeyboardEventInit) => { fireEvent.keyDown(el ?? document.body, init); };
const palOpen = () => q('#palette')!.hidden === false;
const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

describe('lens rail', () => {
  test('clicking a lens sets the lens and closes the open view', () => {
    renderShell();
    act(() => { atlas.openView('network'); });
    fireEvent.click(q('#lensrail [data-k="lens-religion"]')!);
    expect(atlas.get().lens).toBe('religion');
    expect(atlas.get().view).toBe(null);
    expect(q('#lensrail [data-k="lens-religion"]')).toHaveAttribute('aria-pressed', 'true');
    expect(q('#lensrail [data-k="lens-religion"]')).toHaveAttribute('tabindex', '0');
    expect(q('#lensrail [data-k="lens-overview"]')).toHaveAttribute('tabindex', '-1');
  });

  test('arrow keys move focus along the rail without changing the lens', () => {
    renderShell();
    const first = q('#lensrail [data-k="lens-overview"]')!;
    first.focus();
    key(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(q('#lensrail [data-k="lens-conflicts"]'));
    expect(document.activeElement).toHaveAttribute('tabindex', '0');
    key(document.activeElement, { key: 'End' });
    expect(document.activeElement).toBe(q('#lensrail [data-k="lens-history"]'));
    expect(atlas.get().lens).toBe('overview');
  });

  test('labels the rail and gives each lens its number key', () => {
    renderShell();
    expect(q('#lensrail')).toHaveAttribute('aria-label', 'العدسات');
    expect(q('.rail')).toHaveAttribute('role', 'toolbar');
    expect(q('#lensrail [data-k="lens-conflicts"]')).toHaveAttribute('aria-keyshortcuts', '2');
  });
});

describe('command palette', () => {
  test('"/" opens the palette and focuses the search field', () => {
    renderShell();
    expect(palOpen()).toBe(false);
    key(document.body, { key: '/', code: 'Slash' });
    expect(palOpen()).toBe(true);
    expect(document.activeElement).toBe(q('#pal-in'));
    expect(q('#app')).toHaveAttribute('inert');
  });

  test('"/" typed in an input elsewhere does not open the palette', () => {
    renderShell(<input data-testid="other" />);
    const input = screen.getByTestId('other');
    input.focus();
    key(input, { key: '/', code: 'Slash' });
    expect(palOpen()).toBe(false);
  });

  test('Ctrl+K toggles the palette, even while typing', () => {
    renderShell(<input data-testid="other" />);
    const input = screen.getByTestId('other');
    input.focus();
    key(input, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(palOpen()).toBe(true);
    key(q('#pal-in'), { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(palOpen()).toBe(false);
  });

  test('typing السعوديه lists Saudi Arabia first and Enter selects it', () => {
    renderShell();
    fireEvent.click(q('#topbar [data-k="search"]')!);
    const input = q<HTMLInputElement>('#pal-in')!;
    fireEvent.change(input, { target: { value: 'السعوديه' } });
    const first = q('#pal-o0')!;
    expect(first.querySelector('.pal-name')!.textContent).toBe('السعودية');
    expect(first.querySelector('mark')!.textContent).toBe('السعودية');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', 'pal-o0');
    key(input, { key: 'Enter' });
    expect(atlas.get().selection).toEqual({ kind: 'country', id: 'SAU' });
    expect(palOpen()).toBe(false);
    expect(document.activeElement).toBe(q('#topbar [data-k="search"]'));
  });

  test('choosing a conflict switches to the conflicts lens', () => {
    renderShell();
    key(document.body, { key: '/', code: 'Slash' });
    fireEvent.change(q('#pal-in')!, { target: { value: 'sudan' } });
    const group = [...document.querySelectorAll('#pal-list [role="group"]')].find((g) => g.querySelector('.pal-gh')?.textContent === 'النزاعات');
    const opt = group?.querySelector('.pal-opt');
    expect(opt).toBeTruthy();
    fireEvent.click(opt!);
    expect(atlas.get().lens).toBe('conflicts');
    expect(atlas.get().selection?.kind).toBe('conflict');
  });

  test('arrow keys move the active option and wrap', () => {
    renderShell();
    key(document.body, { key: '/', code: 'Slash' });
    const input = q('#pal-in')!;
    const n = document.querySelectorAll('.pal-opt').length;
    expect(n).toBeGreaterThan(10);
    key(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'pal-o1');
    key(input, { key: 'ArrowUp' });
    key(input, { key: 'ArrowUp' });
    expect(input).toHaveAttribute('aria-activedescendant', `pal-o${n - 1}`);
    expect(q(`#pal-o${n - 1}`)).toHaveAttribute('aria-selected', 'true');
  });

  test('with no query it lists lenses, views, actions and tours; the current lens is marked', () => {
    renderShell();
    key(document.body, { key: '/', code: 'Slash' });
    const heads = [...document.querySelectorAll('.pal-gh')].map((h) => h.textContent);
    expect(heads).toEqual(['العدسات', 'العروض', 'أوامر', 'جولات موجّهة']);
    expect(q('#pal-o0 .pal-on')!.textContent).toBe('المفتوحة');
  });

  test('a query with no match says so', () => {
    renderShell();
    key(document.body, { key: '/', code: 'Slash' });
    fireEvent.change(q('#pal-in')!, { target: { value: 'zzqqxx' } });
    expect(q('.pal-empty')!.textContent).toContain('zzqqxx');
    expect(q('#pal-count')!.textContent).toBe('لا نتائج');
    expect(q('#pal-in')).not.toHaveAttribute('aria-activedescendant');
  });

  test('recently opened records lead the empty palette', () => {
    renderShell();
    act(() => { atlas.select('country', 'EGY'); });
    key(document.body, { key: '/', code: 'Slash' });
    expect(q('.pal-gh')!.textContent).toBe('فتحتها مؤخراً');
    expect(q('#pal-o0 .pal-name')!.textContent).toBe('مصر');
  });
});

describe('Esc order', () => {
  test('Esc closes the palette and keeps the selection; a second Esc clears it', () => {
    renderShell();
    act(() => { atlas.select('country', 'SAU'); });
    key(document.body, { key: '/', code: 'Slash' });
    expect(palOpen()).toBe(true);
    key(document.activeElement, { key: 'Escape' });
    expect(palOpen()).toBe(false);
    expect(atlas.get().selection).toEqual({ kind: 'country', id: 'SAU' });
    expect(q('#app')).not.toHaveAttribute('inert');
    key(document.activeElement, { key: 'Escape' });
    expect(atlas.get().selection).toBe(null);
  });

  test('help, then tour, then view, then selection — one level per press', () => {
    renderShell();
    act(() => { atlas.set({ tour: { id: 'energy', step: 0 }, view: 'network', selection: { kind: 'country', id: 'SAU' } }); });
    key(document.body, { key: '?', code: 'Slash', shiftKey: true });
    expect(q('#help')!.hidden).toBe(false);
    expect(document.activeElement).toBe(q('#help [data-k="help-close"]'));
    key(document.activeElement, { key: 'Escape' });
    expect(q('#help')!.hidden).toBe(true);
    expect(atlas.get().tour).not.toBe(null);
    key(document.body, { key: 'Escape' });
    expect(atlas.get().tour).toBe(null);
    expect(atlas.get().view).toBe('network');
    key(document.body, { key: 'Escape' });
    expect(atlas.get().view).toBe(null);
    expect(atlas.get().selection).not.toBe(null);
    key(document.body, { key: 'Escape' });
    expect(atlas.get().selection).toBe(null);
  });

  test('Esc while typing in an input elsewhere does nothing', () => {
    renderShell(<input data-testid="other" />);
    act(() => { atlas.select('country', 'SAU'); });
    const input = screen.getByTestId('other');
    input.focus();
    key(input, { key: 'Escape' });
    expect(atlas.get().selection).not.toBe(null);
  });
});

describe('top bar', () => {
  test('the language button switches lang', () => {
    renderShell();
    const b = q('#topbar [data-k="lang"]')!;
    expect(b.textContent).toBe('EN');
    fireEvent.click(b);
    expect(atlas.get().lang).toBe('en');
    expect(q('#topbar [data-k="lang"]')!.textContent).toBe('ع');
    expect(q('#lensrail')).toHaveAttribute('aria-label', 'Lenses');
  });

  test('the theme button cycles system → dark → light → system and says so', () => {
    renderShell();
    const toasts: string[] = [];
    const off = on('toast', (m) => toasts.push(m));
    const b = () => q('#topbar [data-k="theme"]')!;
    expect(atlas.get().theme).toBe('system');
    expect(b()).toHaveAttribute('aria-label', 'المظهر: تلقائي حسب الجهاز. اضغط للتبديل إلى: داكن');
    fireEvent.click(b());
    expect(atlas.get().theme).toBe('dark');
    fireEvent.click(b());
    expect(atlas.get().theme).toBe('light');
    fireEvent.click(b());
    expect(atlas.get().theme).toBe('system');
    off();
    expect(toasts).toEqual(['المظهر: داكن', 'المظهر: فاتح', 'المظهر: تلقائي حسب الجهاز']);
  });

  test('view buttons toggle the view', () => {
    renderShell();
    fireEvent.click(q('#topbar [data-k="view-compare"]')!);
    expect(atlas.get().view).toBe('compare');
    expect(q('#topbar [data-k="view-compare"]')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(q('#topbar [data-k="view-compare"]')!);
    expect(atlas.get().view).toBe(null);
  });

  test('the crumb shows the selection; its × clears it and its name flies to it', () => {
    renderShell();
    const flights: unknown[] = [];
    const off = on('flyto', (p) => flights.push(p));
    act(() => { atlas.select('country', 'SAU', { fly: false }); });
    expect(q('.tb-crumb')).toHaveClass('has-sel');
    expect(q('.cr-kind')!.textContent).toBe('دولة');
    expect(q('.cr-name')!.textContent).toBe('السعودية');
    fireEvent.click(q('[data-k="crumb-fly"]')!);
    expect(flights).toEqual([{ kind: 'country', id: 'SAU' }]);
    fireEvent.click(q('[data-k="crumb-clear"]')!);
    off();
    expect(atlas.get().selection).toBe(null);
    expect(q('.tb-crumb')).not.toHaveClass('has-sel');
  });

  test('the Ask button stays hidden while askReady is false', () => {
    renderShell();
    expect(q('[data-k="ask"]')).toBe(null);
  });

  test('global letter and digit keys: lens, theme, language, projection', () => {
    renderShell();
    key(document.body, { key: '3', code: 'Digit3' });
    expect(atlas.get().lens).toBe('religion');
    key(document.body, { key: 'ز', code: 'KeyG' }); // Arabic layout: the code decides
    expect(atlas.get().projection).toBe('flat');
    key(document.body, { key: 't', code: 'KeyT' });
    expect(atlas.get().theme).toBe('dark');
    key(document.body, { key: 'l', code: 'KeyL' });
    expect(atlas.get().lang).toBe('en');
  });
});

describe('tours menu', () => {
  test('opens the tour list; picking a tour emits starttour and closes it', () => {
    renderShell();
    const started: unknown[] = [];
    const off = on('starttour', (p) => started.push(p));
    const btn = q('#topbar [data-k="tours"]')!;
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    const pop = q('#sh-tours')!;
    expect(pop.hidden).toBe(false);
    expect(pop).toHaveAttribute('role', 'dialog');
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(q('#sh-tours .tour-row'));
    expect(pop.querySelectorAll('.tour-row')).toHaveLength(availableTours(db).length);
    fireEvent.click(q('#sh-tours [data-k="pt-europe"]')!);
    off();
    expect(started).toEqual([{ id: 'europe', focus: true }]);
    expect(q('#sh-tours')!.hidden).toBe(true);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  test('Esc closes the popover before anything else', () => {
    renderShell();
    act(() => { atlas.select('country', 'SAU'); });
    fireEvent.click(q('#topbar [data-k="tours"]')!);
    key(document.activeElement, { key: 'Escape' });
    expect(q('#sh-tours')!.hidden).toBe(true);
    expect(atlas.get().selection).not.toBe(null);
    expect(document.activeElement).toBe(q('#topbar [data-k="tours"]'));
  });
});

describe('phone menu', () => {
  test('opens as a modal sheet with views, tours and settings', () => {
    renderShell();
    fireEvent.click(q('#topbar [data-k="menu"]')!);
    const sheet = q('#sh-sheet')!;
    expect(sheet.hidden).toBe(false);
    expect(q('#sh-sheet .sheet')).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(q('#sh-sheet [data-k="sheet-close"]'));
    expect(q('#app')).toHaveAttribute('inert');
    fireEvent.click(q('#sh-sheet [data-k="lang"]')!);
    expect(atlas.get().lang).toBe('en');
    expect(q('#sh-sheet [data-k="lang"] .sr-val')!.textContent).toBe('العربية');
    fireEvent.click(q('#sh-sheet [data-k="view-sources"]')!);
    expect(atlas.get().view).toBe('sources');
    expect(q('#sh-sheet')!.hidden).toBe(true);
    expect(q('#app')).not.toHaveAttribute('inert');
  });
});

describe('help dialog', () => {
  test('lists the keys and opens Sources and method', () => {
    renderShell();
    fireEvent.click(q('#topbar [data-k="help"]')!);
    expect(q('#help .help-box')).toHaveAttribute('role', 'dialog');
    expect(document.querySelectorAll('#help .keys tr')).toHaveLength(10);
    expect(q('#help .help-credit a')).toHaveAttribute('href', 'https://claude.ai/artifact/7Y8KPakRKzrUtZYxjCwJai');
    fireEvent.click(q('#help [data-k="help-sources"]')!);
    expect(atlas.get().view).toBe('sources');
    expect(q('#help')!.hidden).toBe(true);
  });
});

describe('toasts', () => {
  test('a toast shows, keeps at most three, and fades out', () => {
    vi.useFakeTimers();
    renderShell();
    act(() => { for (const m of ['a', 'b', 'c', 'd']) emit('toast', m); });
    expect([...document.querySelectorAll('#toasts .toast')].map((n) => n.textContent)).toEqual(['b', 'c', 'd']);
    act(() => { vi.advanceTimersByTime(2600); });
    expect(q('#toasts .toast')).toHaveClass('out');
    act(() => { vi.advanceTimersByTime(240); });
    expect(document.querySelectorAll('#toasts .toast')).toHaveLength(0);
  });
});

describe('pure helpers', () => {
  test('markMatch wraps the normalised match, keeping diacritics, and escapes the rest', () => {
    expect(html(markMatch('السعودية', 'السعوديه'))).toBe('<mark>السعودية</mark>');
    expect(html(markMatch('Saudi Arabia', 'arab'))).toBe('Saudi <mark>Arab</mark>ia');
    expect(html(markMatch('مُحَمَّد', 'محم'))).toBe('<mark>مُحَمَّ</mark>د');
    expect(html(markMatch('<b>x</b>', 'x'))).toBe('&lt;b&gt;<mark>x</mark>&lt;/b&gt;');
    expect(html(markMatch('plain', ''))).toBe('plain');
    expect(html(markMatch('plain', 'zz'))).toBe('plain');
  });

  test('keyOf reads Latin keys from the physical key on other layouts', () => {
    expect(keyOf(new KeyboardEvent('keydown', { key: 'ل', code: 'KeyG' }))).toBe('g');
    expect(keyOf(new KeyboardEvent('keydown', { key: '٣', code: 'Digit3' }))).toBe('3');
    expect(keyOf(new KeyboardEvent('keydown', { key: 'Dead', code: 'Slash', shiftKey: true }))).toBe('?');
  });

  test('isTyping', () => {
    const input = document.createElement('input');
    const box = document.createElement('input');
    box.type = 'checkbox';
    expect(isTyping(input)).toBe(true);
    expect(isTyping(box)).toBe(false);
    expect(isTyping(document.createElement('textarea'))).toBe(true);
    expect(isTyping(document.body)).toBe(false);
  });

  test('stepsLabel agrees in number', () => {
    expect(stepsLabel(7, 'ar')).toBe('7 محطات');
    expect(stepsLabel(2, 'ar')).toBe('محطتان');
    expect(stepsLabel(11, 'ar')).toBe('11 محطة');
    expect(stepsLabel(1, 'en')).toBe('1 stop');
  });
});

describe('review fixes', () => {
  test('clearing the selection from the crumb keeps keyboard focus in the top bar', () => {
    renderShell();
    act(() => { atlas.select('country', 'SAU', { fly: false }); });
    const x = document.querySelector<HTMLElement>('#topbar [data-k="crumb-clear"]')!;
    x.focus();
    fireEvent.click(x);
    expect(atlas.get().selection).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('#topbar [data-k="search"]'));
  });

  test('once focus has left the crumb, a later Esc does not pull focus to search', () => {
    renderShell();
    act(() => { atlas.select('country', 'SAU', { fly: false }); });
    const x = q('#topbar [data-k="crumb-clear"]')!;
    x.focus();
    act(() => { x.blur(); }); // focus leaves with no relatedTarget, as when the reader clicks the map canvas
    expect(document.activeElement).toBe(document.body);
    key(document.body, { key: 'Escape' });
    expect(atlas.get().selection).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('Start here', () => {
  const welcomes = () => {
    const seen: unknown[] = [];
    const off = on('welcome', (p) => { seen.push(p); });
    return { seen, off };
  };

  test('the help dialog reopens the Start here panel', () => {
    const { seen, off } = welcomes();
    renderShell();
    fireEvent.click(q('#topbar [data-k="help"]')!);
    const item = q('#help [data-k="help-welcome"]')!;
    expect(item).toHaveTextContent('ابدأ من هنا');
    fireEvent.click(item);
    off();
    expect(seen).toEqual([null]);
    expect(q('#help')!.hidden).toBe(true);
  });

  test('the palette lists Start here with the actions, and choosing it reopens the panel', () => {
    const { seen, off } = welcomes();
    renderShell();
    act(() => { atlas.set({ lang: 'en' }); });
    key(document.body, { key: '/', code: 'Slash' });
    fireEvent.change(q('#pal-in')!, { target: { value: 'start here' } });
    const opt = [...document.querySelectorAll<HTMLElement>('#pal-list .pal-opt')].find((o) => o.textContent?.includes('Start here'))!;
    expect(opt).toBeTruthy();
    fireEvent.click(opt);
    off();
    expect(seen).toEqual([null]);
    expect(palOpen()).toBe(false);
  });
});
