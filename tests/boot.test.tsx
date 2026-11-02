import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Boot } from '../src/features/boot/Boot';
import type { WorldLite } from '../src/features/boot/worldLite';
import { atlas } from '../src/app/store';
import { SEVERITY } from '../src/config';
import { build } from '../src/data/build';
import { FILES, GENERATED } from '../src/data/files';
import { DATA_DIR, readRaw } from './helpers/readRaw';

const WORLD_FILE = path.resolve(__dirname, '../public/world-lite.json');
const N_CORE = Object.keys(FILES).length;
const N_ALL = N_CORE + Object.keys(GENERATED).length;

type Res = { ok: boolean; status: number; json: () => Promise<unknown> };
/** Serves public/ from disk; a file that is not there (e.g. an optional generated file) answers 404. */
const fromDisk = async (url: string): Promise<Res> => {
  const file = url.endsWith('world-lite.json') ? WORLD_FILE : path.join(DATA_DIR, url.replace(/^.*?data\//, ''));
  if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
};

/** fetch whose responses the test releases one at a time. */
function heldFetch() {
  const held: { url: string; release: () => Promise<void> }[] = [];
  const fn = vi.fn((url: string) => new Promise<Res>((resolve) => {
    held.push({ url, release: async () => { resolve(await fromDisk(url)); } });
  }));
  /** Release the first held request whose url passes `test`; false when none is left. */
  const release = async (test: (url: string) => boolean = () => true) => {
    const i = held.findIndex((h) => test(h.url));
    if (i < 0) return false;
    const [h] = held.splice(i, 1);
    await act(async () => { await h!.release(); });
    return true;
  };
  return { fn, release };
}

const isWorld = (url: string) => url.endsWith('world-lite.json');
const loader = () => document.getElementById('loader')!;
const stage = () => Number(loader().dataset.stage);

/** jsdom stamps animation frames on its own clock, not performance.now(); count-ups need the two to agree. */
const frameClock = () => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
};

/** A matchMedia that answers yes to prefers-reduced-motion. */
const reducedMotion = (q: string) => ({
  matches: q.includes('prefers-reduced-motion: reduce'), media: q, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); atlas.reset(); history.replaceState(null, '', '#'); });

describe('Boot', () => {
  test('shows the app once the data is loaded, in Arabic RTL', async () => {
    vi.stubGlobal('fetch', vi.fn(fromDisk));
    render(<Boot><p>atlas ready</p></Boot>);
    expect(await screen.findByText('atlas ready')).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });

  test('fills the timeline category filter with every category once loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(fromDisk));
    render(<Boot><p>atlas ready</p></Boot>);
    await screen.findByText('atlas ready');
    const cats = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'curated/timeline.json'), 'utf8')).categories.map((c: { id: string }) => c.id);
    expect([...(atlas.get().filters.timelineCats ?? [])]).toEqual(cats);
  });

  test('switching to English flips direction and title', async () => {
    vi.stubGlobal('fetch', vi.fn(fromDisk));
    render(<Boot><p>atlas ready</p></Boot>);
    await screen.findByText('atlas ready');
    act(() => { atlas.set({ lang: 'en' }); });
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.title).toBe('Fault Lines Atlas');
  });

  test('a failed file shows the error and Retry loads again without a page reload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let first = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (first && url.endsWith('timeline.json')) { first = false; return { ok: false, status: 404, json: async () => ({}) }; }
      return fromDisk(url);
    }));
    render(<Boot><p>atlas ready</p></Boot>);
    expect(await screen.findByText(/تعذّر تحميل بيانات الأطلس/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'أعد المحاولة' }));
    await waitFor(() => expect(screen.getByText('atlas ready')).toBeInTheDocument());
  });

  test('replaces the static first-paint loader', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const stat = document.createElement('div');
    stat.id = 'loader';
    document.body.append(stat);
    render(<Boot><p>atlas ready</p></Boot>);
    expect(stat.isConnected).toBe(false);
    expect(document.querySelectorAll('#loader')).toHaveLength(1);
  });
});

describe('Living loader', () => {
  test('wakes in four stages, in order, as the files arrive, then counts up to the real figures', async () => {
    const stats = build(readRaw()).stats;
    frameClock();
    const f = heldFetch();
    vi.stubGlobal('fetch', f.fn);
    render(<Boot><p>atlas ready</p></Boot>);
    expect(stage()).toBe(1);
    expect(screen.getByRole('status')).toHaveTextContent('المرحلة 1 من 4');
    await f.release(isWorld);
    expect(loader().querySelector('.ld-base.is-on .ld-land path')).not.toBeNull();

    const seen = [stage()];
    const layers: Record<number, string[]> = {};
    while (await f.release((u) => !isWorld(u))) {
      seen.push(stage());
      layers[stage()] ??= [...loader().querySelectorAll('.ld-layer.is-on')].map((el) => el.classList[1]!);
    }
    await screen.findByText('atlas ready');
    seen.push(stage());

    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect([...new Set(seen)]).toEqual([1, 2, 3, 4]);
    // Each stage adds its own layer: borders, then the bloc constellations, then the conflict pins.
    expect(layers[2]).toEqual(expect.arrayContaining(['ld-base', 'ld-blocs']));
    expect(layers[2]).not.toContain('ld-pins');
    expect(layers[3]).toEqual(expect.arrayContaining(['ld-base', 'ld-blocs', 'ld-pins']));
    expect(loader().querySelector('[aria-current="step"]')).toHaveTextContent('الأرقام');

    await waitFor(() => expect(loader().querySelector('[data-k="countries"] .num')).toHaveTextContent(String(stats.countries)), { timeout: 3000 });
    expect(loader().querySelector('[data-k="conflicts"] .num')).toHaveTextContent(String(stats.conflicts));
    // Once the data is in, the loader no longer takes pointer events.
    expect(loader()).toHaveClass('done');
  });

  test('names a few conflicts and draws one constellation per bloc in the outline', async () => {
    const f = heldFetch();
    vi.stubGlobal('fetch', f.fn);
    render(<Boot><p>atlas ready</p></Boot>);
    await f.release(isWorld);
    const world = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8')) as WorldLite;
    expect(loader().querySelectorAll('.ld-bloc')).toHaveLength(world.blocs.length);
    expect(loader().querySelectorAll('.ld-pin')).toHaveLength(world.conflicts.length);
    const named = world.conflicts.filter((c) => c.label);
    expect([...loader().querySelectorAll('.ld-name')].map((n) => n.textContent)).toEqual(named.map((c) => c.ar));
  });

  test('offers to start loading again when nothing arrives for 8 seconds', () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    render(<Boot><p>atlas ready</p></Boot>);
    const name = 'ابدأ التحميل من جديد';
    act(() => { vi.advanceTimersByTime(7900); });
    expect(screen.queryByRole('button', { name })).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByRole('status')).toHaveTextContent(`التحميل أبطأ من المعتاد: وصل 0 من ${N_ALL} ملفاً.`);
    const before = fetch.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name }));
    expect(fetch.mock.calls.length - before).toBe(N_CORE);
    expect(screen.queryByRole('button', { name })).toBeNull();
  });

  test('under reduced motion the whole map is drawn at once and holds still', async () => {
    const stats = build(readRaw()).stats;
    vi.stubGlobal('matchMedia', reducedMotion);
    const f = heldFetch();
    vi.stubGlobal('fetch', f.fn);
    render(<Boot><p>atlas ready</p></Boot>);
    await f.release(isWorld);
    expect(loader()).toHaveAttribute('data-motion', 'static');
    expect(stage()).toBe(1);
    expect([...loader().querySelectorAll('.ld-layer.is-on')].map((el) => el.classList[1])).toEqual(
      expect.arrayContaining(['ld-base', 'ld-blocs', 'ld-pins']));
    while (await f.release()) { /* every data file */ }
    await screen.findByText('atlas ready');
    // No count-up: the figures are final at once.
    expect(loader().querySelector('[data-k="countries"] .num')).toHaveTextContent(String(stats.countries));
  });

  test('runs without the outline when world-lite.json is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (isWorld(url) ? { ok: false, status: 404, json: async () => ({}) } : fromDisk(url))));
    render(<Boot><p>atlas ready</p></Boot>);
    await screen.findByText('atlas ready');
    expect(loader().querySelector('.ld-pin')).toBeNull();
    expect(stage()).toBe(4);
  });
});

describe('world-lite.json', () => {
  const text = fs.readFileSync(WORLD_FILE, 'utf8');
  const w = JSON.parse(text) as WorldLite;
  const inBox = ([x, y]: [number, number]) => x >= 0 && y >= 0 && x <= w.viewBox[2] && y <= w.viewBox[3];

  test('is under 60 KB and has the fields the loader draws', () => {
    expect(Buffer.byteLength(text)).toBeLessThan(60 * 1024);
    expect(w.v).toBe(1);
    expect(w.viewBox.slice(0, 2)).toEqual([0, 0]);
    expect(w.viewBox[2]).toBeGreaterThan(w.viewBox[3]);
    expect(inBox(w.focus)).toBe(true);
    expect(w.graticule).toMatch(/^M/);
    expect(w.land.length).toBeGreaterThanOrEqual(5);
    for (const l of w.land) expect(l.d).toMatch(/^M[-\d. lzM]+z$/);
    const sev = SEVERITY.map((s) => s.id) as string[];
    for (const c of w.conflicts) {
      expect(sev).toContain(c.sev);
      expect(inBox([c.x, c.y])).toBe(true);
      expect(c.ar && c.en).toBeTruthy();
    }
    const named = w.conflicts.filter((c) => c.label);
    expect(named.length).toBeGreaterThanOrEqual(3);
    expect(named.length).toBeLessThanOrEqual(6);
    expect(w.blocs.length).toBeGreaterThanOrEqual(3);
    for (const b of w.blocs) {
      expect(b.pts.length).toBeGreaterThanOrEqual(3);
      expect(b.pts.every(inBox)).toBe(true);
      expect(b.d).toMatch(/^M/);
      expect(b.ar && b.en).toBeTruthy();
    }
  });

  test('matches the curated data (after changing conflicts or blocs, run npm run build:world-lite)', () => {
    const db = build(readRaw());
    expect(w.conflicts.map((c) => c.id).sort()).toEqual(db.conflicts.map((c) => c.id).sort());
    for (const c of w.conflicts) {
      const real = db.conflictById.get(c.id)!;
      expect([c.sev, c.ar, c.en]).toEqual([real.severity, real.name.ar, real.name.en]);
    }
    for (const b of w.blocs) {
      const real = db.relations.blocById.get(b.id);
      expect(real).toBeDefined();
      expect(b.pts).toHaveLength(real!.members.filter((iso) => db.anchorOf('country', iso)).length);
    }
  });
});
