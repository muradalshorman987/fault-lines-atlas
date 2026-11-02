// createMap / destroy in jsdom: Canvas 2D, Path2D, ResizeObserver, matchMedia and requestAnimationFrame are stubbed,
// and every listener, frame, timer and store subscription the engine takes is counted.

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { on } from '../src/app/events';
import { atlas, useAtlas } from '../src/app/store';
import { build } from '../src/data/build';
import type { DB } from '../src/data/types';
import { createMap } from '../src/features/map/engine/engine';
import { readRaw } from './helpers/readRaw';

let db: DB;
beforeAll(() => { db = build(readRaw()); });

// ---- stubs
/** A Canvas 2D context that accepts every call and property write. */
function fakeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop() { /* stub */ } };
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: s.length * 6 }),
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    createPattern: () => ({ setTransform() { /* stub */ } }),
  };
  return new Proxy(target, {
    get: (t, k: string) => (k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

class FakePath2D {
  addPath() { /* stub */ } moveTo() { /* stub */ } lineTo() { /* stub */ } closePath() { /* stub */ }
  arc() { /* stub */ } rect() { /* stub */ } bezierCurveTo() { /* stub */ } quadraticCurveTo() { /* stub */ }
}

const observers = new Set<FakeResizeObserver>();
let roThrows = false;
class FakeResizeObserver {
  constructor(public cb: ResizeObserverCallback) {
    if (roThrows) throw new Error('ResizeObserver unavailable');
    observers.add(this);
  }
  observe() { /* stub */ }
  unobserve() { /* stub */ }
  disconnect() { observers.delete(this); }
}

// frames: pending callbacks by id
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const flushFrames = (n = 5) => {
  for (let i = 0; i < n && frames.size; i++) {
    const due = [...frames.entries()];
    frames.clear();
    for (const [, cb] of due) cb(performance.now());
  }
};

// listeners: every addEventListener on any EventTarget, minus removals and aborted signals
interface Reg { target: EventTarget; type: string; fn: unknown; signal?: AbortSignal }
let regs: Reg[] = [];
const realAdd = EventTarget.prototype.addEventListener;
const realRemove = EventTarget.prototype.removeEventListener;
const liveListeners = (el: Element) => regs.filter((r) => !r.signal?.aborted && (r.target === el || r.target === document || r.target === window || r.target instanceof MediaQueryStub));

class MediaQueryStub extends EventTarget {
  matches = false;
  constructor(public media: string) { super(); }
}

// store subscriptions: subscribe calls minus unsubscribe calls
let subs = 0;
let unsubs = 0;

let mount: HTMLDivElement;
const made: { destroy(): void }[] = [];
/** createMap, destroyed in afterEach even when a test fails half-way. */
const make = () => { const m = createMap(mount, db); made.push(m); return m; };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('Path2D', FakePath2D);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('matchMedia', (q: string) => new MediaQueryStub(q));
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++frameId, cb); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext() as never);
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) {
    regs.push({ target: this, type, fn, signal: typeof opts === 'object' ? opts.signal : undefined });
    realAdd.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | EventListenerOptions) {
    regs = regs.filter((r) => !(r.target === this && r.type === type && r.fn === fn));
    realRemove.call(this, type, fn, opts);
  };
  const realSubscribe = useAtlas.subscribe;
  vi.spyOn(useAtlas, 'subscribe').mockImplementation((fn) => {
    subs++;
    const off = realSubscribe(fn);
    return () => { unsubs++; off(); };
  });
  mount = document.createElement('div');
  vi.spyOn(mount, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) });
  document.body.append(mount);
});

afterEach(() => {
  for (const m of made.splice(0)) m.destroy();
  EventTarget.prototype.addEventListener = realAdd;
  EventTarget.prototype.removeEventListener = realRemove;
  regs = []; subs = 0; unsubs = 0; roThrows = false;
  frames.clear(); observers.clear();
  mount.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  atlas.reset();
});

describe('createMap', () => {
  test('mounts two canvases and binds input, store and resize', () => {
    const map = make();
    expect(mount.querySelectorAll('canvas')).toHaveLength(2);
    expect(mount.getAttribute('role')).toBe('application');
    expect(liveListeners(mount).length).toBeGreaterThan(0);
    expect(subs - unsubs).toBe(1);
    expect(observers.size).toBe(1);
    map.destroy();
  });

  test('destroy leaves no listener, frame, timer, observer, store subscription or canvas behind', () => {
    const map = make();
    flushFrames();
    atlas.set({ lens: 'conflicts' }); // a pulsing lens keeps a frame queued
    flushFrames(1);
    map.destroy();
    expect(liveListeners(mount)).toEqual([]);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(observers.size).toBe(0);
    expect(subs - unsubs).toBe(0);
    expect(mount.querySelectorAll('canvas')).toHaveLength(0);
    expect(mount.hasAttribute('role') || mount.hasAttribute('tabindex') || mount.classList.contains('map-root')).toBe(false);
    // the app keeps talking; the dead engine must not wake up
    atlas.set({ lens: 'religion', selection: { kind: 'country', id: 'SAU' } });
    expect(frames.size).toBe(0);
    map.destroy(); // twice is safe
  });

  test('when setup throws after binding, createMap tears down before rethrowing', () => {
    roThrows = true; // the ResizeObserver comes after input and store binding
    expect(() => createMap(mount, db)).toThrow('ResizeObserver unavailable');
    expect(liveListeners(mount)).toEqual([]);
    expect(subs - unsubs).toBe(0);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(mount.querySelectorAll('canvas')).toHaveLength(0);
    expect(mount.classList.contains('map-root')).toBe(false);
  });

  test('without Canvas 2D it throws and leaves the mount as it found it', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => null);
    expect(() => createMap(mount, db)).toThrow(/Canvas 2D/);
    expect(liveListeners(mount)).toEqual([]);
    expect(subs - unsubs).toBe(0);
    expect(mount.querySelectorAll('canvas')).toHaveLength(0);
  });
});

describe('the viewport event', () => {
  test('is emitted once the first frame settles, with the countries on the visible side of the globe', () => {
    const seen: string[][] = [];
    const off = on('viewport', ({ iso3 }) => seen.push(iso3));
    const map = make();
    flushFrames();
    expect(seen).toHaveLength(0); // debounced
    vi.advanceTimersByTime(1000);
    flushFrames();
    vi.advanceTimersByTime(1000);
    expect(seen.length).toBeGreaterThanOrEqual(1);
    const last = seen[seen.length - 1]!;
    expect(last).toContain('SAU');
    expect(last).not.toContain('MEX');
    // the same view is not reported twice
    const n = seen.length;
    atlas.set({ lens: 'religion' });
    flushFrames();
    vi.advanceTimersByTime(1000);
    expect(seen).toHaveLength(n);
    map.destroy();
    off();
  });

  test('turning on "figures follow the map" re-sends the current set at once', () => {
    const seen: string[][] = [];
    const off = on('viewport', ({ iso3 }) => seen.push(iso3));
    const map = make();
    flushFrames();
    vi.advanceTimersByTime(1000);
    const n = seen.length;
    atlas.setFilter('inView', true);
    vi.advanceTimersByTime(50);
    expect(seen).toHaveLength(n + 1);
    map.destroy();
    off();
  });

  test('a flight emits the new set when it lands', () => {
    const seen: string[][] = [];
    const off = on('viewport', ({ iso3 }) => seen.push(iso3));
    vi.stubGlobal('matchMedia', (q: string) => Object.assign(new MediaQueryStub(q), { matches: q.includes('reduced-motion') }));
    const map = make();
    flushFrames();
    vi.advanceTimersByTime(1000);
    atlas.select('country', 'BRA'); // reduced motion: the view jumps
    flushFrames();
    vi.advanceTimersByTime(1000);
    flushFrames();
    vi.advanceTimersByTime(1000);
    expect(seen[seen.length - 1]).toContain('BRA');
    expect(seen[seen.length - 1]).not.toContain('SAU');
    map.destroy();
    off();
  });
});
