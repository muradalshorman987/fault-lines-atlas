import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { atlas } from '../src/app/store';
import { DbContext } from '../src/app/useT';
import { build } from '../src/data/build';
import type { DB } from '../src/data/types';
import { Legend } from '../src/features/map/Legend';
import { MapControls } from '../src/features/map/MapControls';
import '../src/i18n/core';
import { readRaw } from './helpers/readRaw';

let db: DB;
beforeAll(() => { db = build(readRaw()); });
afterEach(() => { atlas.reset(); localStorage.clear(); });

const withDb = (ui: ReactNode) => render(<DbContext.Provider value={db}>{ui}</DbContext.Provider>);
const title = () => document.querySelector('#legend .lc-title')?.textContent;

describe('Legend', () => {
  test('on the religion lens, a mode chip sets filters.religionMode', () => {
    atlas.set({ lens: 'religion' });
    withDb(<Legend />);
    const share = screen.getByRole('button', { name: 'حصة ديانة' });
    expect(share).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(share);
    expect(atlas.get().filters.religionMode).toBe('share');
    expect(share).toHaveAttribute('aria-pressed', 'true');
    // share mode adds the tradition picker
    fireEvent.change(document.querySelector('select.lc-select')!, { target: { value: 'catholic' } });
    expect(atlas.get().filters.religionTradition).toBe('catholic');
  });

  test('the title follows the lens in Arabic and English', () => {
    atlas.set({ lens: 'religion' });
    withDb(<Legend />);
    expect(title()).toBe('التوزيع الديني');
    expect(document.getElementById('legend')).toHaveAttribute('data-lens', 'religion');
    act(() => { atlas.set({ lens: 'conflicts' }); });
    expect(title()).toBe('النزاعات ونقاط الاشتعال');
    act(() => { atlas.set({ lang: 'en' }); });
    expect(title()).toBe('Conflicts & flashpoints');
    act(() => { atlas.set({ lens: 'religion' }); });
    expect(title()).toBe('Religion');
    expect(document.getElementById('legend')).toHaveAttribute('aria-label', 'Map key: Religion');
  });

  test('the header collapses and expands the card body', () => {
    withDb(<Legend />);
    const head = document.querySelector<HTMLButtonElement>('#legend .lc-head')!;
    expect(head).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('lc-body')).toHaveAttribute('hidden');
    expect(document.getElementById('legend')).toHaveClass('collapsed');
  });

  test('a region filter shows as a removable chip on the conflicts card, and the counts follow it', () => {
    atlas.set({ lens: 'conflicts' });
    atlas.setFilter('region', 'africa');
    withDb(<Legend />);
    const war = screen.getByRole('button', { name: /حرب نشطة/ });
    const africanWars = db.conflicts.filter((c) => c.region === 'africa' && c.severity === 'war').length;
    expect(war.querySelector('.n')?.textContent).toBe(String(africanWars));
    const chip = screen.getByRole('button', { name: /أفريقيا/ });
    fireEvent.click(chip);
    expect(atlas.get().filters.region).toBeNull();
    expect(screen.queryByRole('button', { name: /أفريقيا/ })).toBeNull();
  });

  test('conflict severity chips toggle the severity filter', () => {
    atlas.set({ lens: 'conflicts' });
    withDb(<Legend />);
    fireEvent.click(screen.getByRole('button', { name: /حرب نشطة/ }));
    expect(atlas.get().filters.severity.has('war')).toBe(false);
  });
});

describe('MapControls', () => {
  test('zoom and reset call the engine', () => {
    const api = { zoom: vi.fn(), reset: vi.fn() };
    render(<MapControls api={api} />);
    fireEvent.click(screen.getByRole('button', { name: 'تكبير' }));
    fireEvent.click(screen.getByRole('button', { name: 'تصغير' }));
    fireEvent.click(screen.getByRole('button', { name: 'إعادة ضبط العرض' }));
    expect(api.zoom.mock.calls).toEqual([[1.6], [1 / 1.6]]);
    expect(api.reset).toHaveBeenCalledOnce();
  });

  test('the projection control has three options and sets projection', () => {
    render(<MapControls api={{ zoom: vi.fn(), reset: vi.fn() }} />);
    const btn = screen.getByRole('button', { name: 'نوع الخريطة' });
    const pop = document.getElementById('mapctl-proj')!;
    expect(pop).toHaveAttribute('hidden');
    fireEvent.click(btn);
    expect(pop).not.toHaveAttribute('hidden');
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')?.querySelector('.ctl-name')?.textContent)).toEqual(['الكرة الأرضية', 'خريطة مسطّحة', 'خريطة تفصيلية']);
    expect(screen.getByRole('radio', { name: 'الكرة الأرضية' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'خريطة مسطّحة' }));
    expect(atlas.get().projection).toBe('flat');
    fireEvent.click(screen.getByRole('radio', { name: 'خريطة تفصيلية' }));
    expect(atlas.get().projection).toBe('detailed');
    expect(screen.getByRole('radio', { name: 'خريطة تفصيلية' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'الكرة الأرضية' }));
    expect(atlas.get().projection).toBe('globe');
    fireEvent.keyDown(pop, { key: 'Escape' });
    expect(pop).toHaveAttribute('hidden');
    expect(document.activeElement).toBe(btn);
  });

  test('a pointer choice of map type closes the popover and returns focus to its button', () => {
    render(<MapControls api={{ zoom: vi.fn(), reset: vi.fn() }} />);
    const btn = screen.getByRole('button', { name: 'نوع الخريطة' });
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('radio', { name: 'خريطة مسطّحة' }), { detail: 1 }); // a real click; arrow keys send detail 0
    expect(atlas.get().projection).toBe('flat');
    expect(document.getElementById('mapctl-proj')).toHaveAttribute('hidden');
    expect(document.activeElement).toBe(btn);
  });

  test('the two popovers never show together', () => {
    render(<MapControls api={{ zoom: vi.fn(), reset: vi.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: 'نوع الخريطة' }));
    fireEvent.click(screen.getByRole('button', { name: 'الطبقات' }));
    expect(document.getElementById('mapctl-proj')).toHaveAttribute('hidden');
    expect(document.getElementById('mapctl-layers')).not.toHaveAttribute('hidden');
  });

  test('on the detailed map the layers popover offers only what that map draws', () => {
    atlas.set({ projection: 'detailed' });
    render(<MapControls api={{ zoom: vi.fn(), reset: vi.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: 'الطبقات' }));
    expect(screen.getAllByRole('checkbox').map((c) => c.getAttribute('data-layer'))).toEqual(['labels', 'boundaries']);
  });

  test('the layers popover toggles layers and closes on Escape', () => {
    render(<MapControls api={{ zoom: vi.fn(), reset: vi.fn() }} />);
    const btn = screen.getByRole('button', { name: 'الطبقات' });
    const pop = document.getElementById('mapctl-layers')!;
    expect(pop).toHaveAttribute('hidden');
    fireEvent.click(btn);
    expect(pop).not.toHaveAttribute('hidden');
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'خطوط الطول والعرض' }));
    expect(atlas.get().layers.graticule).toBe(false);
    fireEvent.keyDown(pop, { key: 'Escape' });
    expect(pop).toHaveAttribute('hidden');
    expect(document.activeElement).toBe(btn);
  });
});
