// Shared contracts for the "alive" run (spec 2026-11-02 §Shared contracts).
import { renderHook } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { VIEWS } from '../src/config';
import { parseHash, startHashSync } from '../src/app/hash';
import { loadPrefs, savePrefs } from '../src/app/prefs';
import { atlas } from '../src/app/store';
import { build } from '../src/data/build';
import { rankBy, vsAverage } from '../src/data/rank';
import type { DB } from '../src/data/types';
import { useCountUp } from '../src/ui/motion';
import { readRaw } from './helpers/readRaw';

let db: DB;
beforeAll(() => { db = build(readRaw()); });
afterEach(() => { atlas.reset(); history.replaceState(null, '', location.pathname + '#'); vi.unstubAllGlobals(); localStorage.clear(); });

describe('pulse view and filters', () => {
  test('pulse is a view with a share link', () => {
    expect(VIEWS.some((v) => v.id === 'pulse')).toBe(true);
    expect(parseHash('view-pulse', db)?.patch).toEqual({ view: 'pulse' });
  });
  test('region, severity and in-view filters start from the query string', () => {
    history.replaceState(null, '', '/?region=africa&sev=war,armed-conflict&inview=1#view-pulse');
    const stop = startHashSync(db);
    const f = atlas.get().filters;
    expect(f.region).toBe('africa');
    expect([...f.severity].sort()).toEqual(['armed-conflict', 'war']);
    expect(f.inView).toBe(true);
    expect(atlas.get().view).toBe('pulse');
    stop();
  });
  test('changing those filters writes the query string and keeps the hash', () => {
    history.replaceState(null, '', '/#view-pulse');
    const stop = startHashSync(db);
    atlas.setFilter('region', 'asia');
    atlas.setFilter('inView', true);
    expect(location.search).toBe('?region=asia&inview=1');
    expect(location.hash).toBe('#view-pulse');
    atlas.setFilter('region', null);
    atlas.setFilter('inView', false);
    expect(location.search).toBe('');
    stop();
  });
  test('an unknown region in the link is ignored', () => {
    history.replaceState(null, '', '/?region=atlantis');
    const stop = startHashSync(db);
    expect(atlas.get().filters.region).toBeNull();
    stop();
  });
});

describe('detailed projection preference', () => {
  test('is remembered like the other projections', () => {
    savePrefs({ lang: 'ar', theme: 'system', projection: 'detailed' });
    expect(loadPrefs().projection).toBe('detailed');
  });
});

describe('figures contract', () => {
  test('is empty but callable before the data pipeline fills it', () => {
    expect(db.figures.country('SAU')).toEqual({});
    expect(db.figures.conflictDeaths('sudan')).toEqual([]);
    expect(Array.isArray(db.figures.sources)).toBe(true);
  });
});

describe('ranking helpers', () => {
  test('rankBy ranks highest first with ties sharing a rank, and skips missing values', () => {
    const r = rankBy([{ id: 'a', v: 3 }, { id: 'b', v: 9 }, { id: 'c', v: 3 }, { id: 'd', v: null }], (x) => x.v);
    expect(r.get('b')).toEqual({ rank: 1, of: 3, percentile: 100 });
    expect(r.get('a')?.rank).toBe(2);
    expect(r.get('c')?.rank).toBe(2);
    expect(r.has('d')).toBe(false);
  });
  test('vsAverage gives the signed percent difference from the mean', () => {
    expect(vsAverage(165, [100, 100, 100])).toBe(65);
    expect(vsAverage(80, [100])).toBe(-20);
    expect(vsAverage(5, [])).toBeNull();
  });
});

describe('count-up', () => {
  test('returns the target at once under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const { result } = renderHook(() => useCountUp(240, 600));
    expect(result.current).toBe(240);
  });
});
