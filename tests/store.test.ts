import { afterEach, describe, expect, test, vi } from 'vitest';
import { atlas } from '../src/app/store';
import { emit, on } from '../src/app/events';

afterEach(() => { atlas.reset(); vi.unstubAllGlobals(); });

describe('store', () => {
  test('set returns only the changed keys', () => {
    expect(atlas.set({ lens: 'religion', projection: 'globe' })).toEqual(['lens']);
    expect(atlas.set({ compare: [null, null] })).toEqual([]);
  });
  test('sets compare by content', () => {
    expect(atlas.set({ filters: { ...atlas.get().filters, severity: new Set(['war']) } })).toEqual(['filters']);
    expect(atlas.set({ filters: { ...atlas.get().filters, severity: new Set(['war']) } })).toEqual([]);
  });
  test('toggleInSet adds and removes', () => {
    const had = atlas.get().filters.severity.has('war');
    atlas.toggleInSet('severity', 'war');
    expect(atlas.get().filters.severity.has('war')).toBe(!had);
  });
  test('selecting on a phone closes the open view', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    atlas.set({ view: 'network' });
    atlas.select('country', 'SAU', { fly: false });
    expect(atlas.get()).toMatchObject({ view: null, selection: { kind: 'country', id: 'SAU' } });
  });
  test('selecting on desktop keeps the view', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    atlas.set({ view: 'network' });
    atlas.select('country', 'SAU', { fly: false });
    expect(atlas.get().view).toBe('network');
  });
  test('select flies the map by default', () => {
    const seen: unknown[] = [];
    const off = on('flyto', (p) => seen.push(p));
    atlas.select('conflict', 'sudan');
    off();
    expect(seen).toEqual([{ kind: 'conflict', id: 'sudan' }]);
  });
});

describe('event bus', () => {
  test('a failing listener does not stop the others', () => {
    const got: string[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const off1 = on('toast', () => { throw new Error('boom'); });
    const off2 = on('toast', (m) => got.push(m));
    emit('toast', 'x');
    off1(); off2();
    expect(got).toEqual(['x']);
  });
});

describe('sticky last payload', () => {
  test('a view that mounts after the map settled can read the last viewport', async () => {
    const { lastOf } = await import('../src/app/events');
    emit('viewport', { iso3: ['SAU', 'YEM'] });
    expect(lastOf('viewport')).toEqual({ iso3: ['SAU', 'YEM'] });
  });
});
