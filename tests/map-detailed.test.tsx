// The detailed map (MapLibre + OpenFreeMap) with maplibre-gl mocked: layers, labels, selection, flights,
// the viewport event and the fallback to the canvas map.

import { act, render, waitFor } from '@testing-library/react';
import { Suspense, useRef, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { emit, on } from '../src/app/events';
import { atlas } from '../src/app/store';
import { DbContext } from '../src/app/useT';
import { build } from '../src/data/build';
import type { DB } from '../src/data/types';
import type { MapControlsApi } from '../src/features/map/MapControls';
import type { MapView } from '../src/features/map/engine/viewport';
import '../src/i18n/core';
import { readRaw } from './helpers/readRaw';

type Handler = { layer?: string; fn: (e: Record<string, unknown>) => void };
type Layer = { id: string; type: string; layout?: Record<string, unknown>; before?: string; [k: string]: unknown };

const h = vi.hoisted(() => {
  const state = { failNext: false, maps: [] as InstanceType<typeof FakeMap>[], workerUrl: '' };
  const NAME_FIELD = ['case', ['has', 'name:nonlatin'], ['concat', ['get', 'name:latin'], '\n', ['get', 'name:nonlatin']], ['coalesce', ['get', 'name_en'], ['get', 'name']]];
  class FakeMap {
    opts: Record<string, unknown>;
    handlers = new Map<string, Handler[]>();
    sources = new Map<string, Record<string, unknown>>();
    layers = new Map<string, Layer>();
    paint = new Map<string, unknown>();
    layout = new Map<string, unknown>();
    filters = new Map<string, unknown>();
    styleLayers: Layer[] = [
      { id: 'water', type: 'fill' },
      { id: 'label_city', type: 'symbol', layout: { 'text-field': NAME_FIELD } },
      { id: 'road_shield', type: 'symbol', layout: { 'text-field': ['to-string', ['get', 'ref']] } },
    ];
    canvas = document.createElement('canvas');
    flyTo = vi.fn(); fitBounds = vi.fn(); easeTo = vi.fn(); jumpTo = vi.fn(); zoomTo = vi.fn();
    remove = vi.fn(); setStyle = vi.fn(); addControl = vi.fn(); resize = vi.fn();
    images = new Set<string>();
    resolver: ((id: string) => void) | null = null;
    setMissingStyleImageResolver(fn: ((id: string) => void) | null) { this.resolver = fn; return this; }
    hasImage(id: string) { return this.images.has(id); }
    addImage(id: string) { this.images.add(id); return this; }
    queryRenderedFeatures = vi.fn((): unknown[] => []);
    touchZoomRotate = { disableRotation: vi.fn() };
    keyboard = { disableRotation: vi.fn() };
    dragRotate = { disable: vi.fn() };
    constructor(opts: Record<string, unknown>) {
      if (state.failNext) throw new Error('Failed to initialize WebGL');
      this.opts = opts;
      (opts.container as HTMLElement).append(this.canvas);
      state.maps.push(this);
    }
    on(type: string, a: unknown, b?: unknown) {
      const list = this.handlers.get(type) ?? [];
      list.push(typeof a === 'string' ? { layer: a, fn: b as Handler['fn'] } : { fn: a as Handler['fn'] });
      this.handlers.set(type, list);
      return this;
    }
    off() { return this; }
    once(type: string, fn: Handler['fn']) { return this.on(type, fn); }
    fire(type: string, ev: Record<string, unknown> = {}) { for (const x of this.handlers.get(type) ?? []) x.fn({ type, target: this, ...ev }); }
    getStyle() { return { layers: [...this.styleLayers, ...this.layers.values()] }; }
    getLayer(id: string) { return this.layers.get(id) ?? this.styleLayers.find((l) => l.id === id); }
    getLayoutProperty(id: string, k: string) { return this.layout.get(`${id}.${k}`) ?? this.styleLayers.find((l) => l.id === id)?.layout?.[k]; }
    addSource(id: string, s: Record<string, unknown>) { this.sources.set(id, s); }
    getSource(id: string) { return this.sources.get(id) && { setData: vi.fn() }; }
    addLayer(l: Layer, before?: string) { this.layers.set(l.id, { ...l, before }); }
    setPaintProperty(id: string, k: string, v: unknown) { this.paint.set(`${id}.${k}`, v); }
    setLayoutProperty(id: string, k: string, v: unknown) { this.layout.set(`${id}.${k}`, v); }
    setFilter(id: string, f: unknown) { this.filters.set(id, f); }
    getCenter() { return { lng: 35, lat: 25, toArray: () => [35, 25] }; }
    getZoom() { return 2.5; }
    getBounds() { return { getWest: () => -10, getSouth: () => 35, getEast: () => 30, getNorth: () => 60 }; }
    cameraForBounds() { return { center: [0, 0], zoom: 5 }; }
    getCanvas() { return this.canvas; }
    moving = false;
    isMoving() { return this.moving; }
    isStyleLoaded() { return true; }
  }
  class AttributionControl { constructor(public opts: unknown) {} }
  return { state, FakeMap, AttributionControl };
});

vi.mock('maplibre-gl', () => ({
  Map: h.FakeMap,
  AttributionControl: h.AttributionControl,
  setWorkerUrl: (u: string) => { h.state.workerUrl = u; },
  default: {},
}));

const engine = vi.hoisted(() => ({ created: 0, destroyed: 0 }));
vi.mock('../src/features/map/engine/engine', () => ({
  createMap: () => {
    engine.created++;
    return { zoom: () => undefined, reset: () => undefined, view: () => ({ center: [35, 25], zoom: 1.6 }), destroy: () => { engine.destroyed++; } };
  },
}));

const { default: DetailedMap } = await import('../src/features/map/detailed/DetailedMap');
const { MapStage } = await import('../src/features/map');

let db: DB;
beforeAll(() => { db = build(readRaw()); });
beforeEach(() => { h.state.failNext = false; h.state.maps = []; engine.created = engine.destroyed = 0; });
afterEach(() => { atlas.reset(); localStorage.clear(); });

const withDb = (ui: ReactNode) => render(<DbContext.Provider value={db}><Suspense fallback={null}>{ui}</Suspense></DbContext.Provider>);

function Harness({ onFail, api }: { onFail: (e: unknown) => void; api?: { current: MapControlsApi | null } }) {
  const apiRef = useRef<MapControlsApi | null>(null);
  const viewRef = useRef<MapView | null>(null);
  return <DetailedMap apiRef={api ?? apiRef} viewRef={viewRef} onFail={onFail} />;
}

async function mounted(onFail = vi.fn(), api?: { current: MapControlsApi | null }) {
  const r = withDb(<Harness onFail={onFail} api={api} />);
  await waitFor(() => expect(h.state.maps).toHaveLength(1));
  const map = h.state.maps[0]!;
  act(() => { map.fire('style.load'); map.fire('load'); });
  return { map, onFail, ...r };
}
const frame = () => act(() => new Promise<void>((res) => requestAnimationFrame(() => res())));

describe('DetailedMap', () => {
  test('starts on an OpenFreeMap style with a same-origin worker and visible attribution', async () => {
    const { map } = await mounted();
    expect(map.opts.style).toBe('https://tiles.openfreemap.org/styles/positron');
    expect(h.state.workerUrl).toMatch(/maplibre-gl-worker/);
    expect(map.addControl).toHaveBeenCalledWith(expect.any(h.AttributionControl), expect.any(String));
    const attribution = vi.mocked(map.addControl).mock.calls[0]![0] as InstanceType<typeof h.AttributionControl>;
    expect(attribution.opts).toMatchObject({ compact: false });
  });

  test('on load it adds the countries source and its layers under the basemap labels', async () => {
    const { map } = await mounted();
    const src = map.sources.get('atlas-countries') as { type: string; data: { features: unknown[] } };
    expect(src.type).toBe('geojson');
    expect(src.data.features).toHaveLength(db.features.length);
    const fill = map.layers.get('atlas-fill')!;
    expect(fill).toMatchObject({ type: 'fill', source: 'atlas-countries', before: 'label_city' });
    expect(map.layers.get('atlas-outline')).toMatchObject({ type: 'line', source: 'atlas-countries' });
  });

  test('the fill follows the lens colours of the scene', async () => {
    atlas.set({ lens: 'conflicts' });
    const { map } = await mounted();
    await frame();
    const expr = JSON.stringify(map.paint.get('atlas-fill.fill-color'));
    expect(expr).toContain('"match"');
    expect(expr).toContain('"SDN"');
    expect(expr).not.toContain('"NOR"'); // not party to a conflict: the basemap shows through
  });

  test('labels use name:ar in Arabic and switch with the language; road shields keep their numbers', async () => {
    const { map } = await mounted();
    expect(map.layout.get('label_city.text-field')).toEqual(['coalesce', ['get', 'name:ar'], ['get', 'name']]);
    expect(map.layout.has('road_shield.text-field')).toBe(false);
    act(() => { atlas.set({ lang: 'en' }); });
    expect(JSON.stringify(map.layout.get('label_city.text-field'))).toContain('name:en');
  });

  test('clicking a country selects it; clicking the sea clears the selection', async () => {
    const { map } = await mounted();
    map.queryRenderedFeatures.mockReturnValue([{ properties: { iso3: 'SAU' } }]);
    act(() => { map.fire('click', { point: { x: 10, y: 10 } }); });
    expect(atlas.get().selection).toEqual({ kind: 'country', id: 'SAU' });
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith({ x: 10, y: 10 }, { layers: ['atlas-fill'] });
    map.queryRenderedFeatures.mockReturnValue([]);
    act(() => { map.fire('click', { point: { x: 20, y: 20 } }); });
    expect(atlas.get().selection).toBeNull();
  });

  test('the selection gets an outline', async () => {
    const { map } = await mounted();
    act(() => { atlas.select('country', 'EGY', { fly: false }); });
    await frame();
    expect(JSON.stringify(map.filters.get('atlas-outline'))).toContain('"EGY"');
  });

  test('hovering a country shows the engine tooltip text', async () => {
    const tipBox = Object.assign(document.createElement('div'), { id: 'tooltip', hidden: true });
    document.body.append(tipBox);
    const { map } = await mounted();
    act(() => { map.fire('mousemove', { features: [{ properties: { iso3: 'SAU' } }], originalEvent: { clientX: 5, clientY: 5 } }); });
    const tip = document.getElementById('tooltip')!;
    expect(tip.hidden).toBe(false);
    expect(tip.innerHTML).toContain('السعودية');
    act(() => { map.fire('mouseleave'); });
    expect(tip.hidden).toBe(true);
    tip.remove();
  });

  test('flyto: a country fits its main body, a point flies to it, a list fits them all', async () => {
    const { map } = await mounted();
    act(() => { emit('flyto', { kind: 'country', id: 'FRA' }); });
    const [[w, s], [e, n]] = vi.mocked(map.fitBounds).mock.calls[0]![0] as [[number, number], [number, number]];
    expect(w).toBeGreaterThan(-10); // French Guiana and the islands are left out
    expect(e).toBeLessThan(12);
    expect(s).toBeGreaterThan(40);
    expect(n).toBeLessThan(52);
    act(() => { emit('flyto', { lonlat: [10, 20], k: 4 }); });
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [10, 20] }));
    act(() => { emit('flyto', { kind: 'conflict', id: 'sudan' }); });
    const sudan = db.anchorOf('conflict', 'sudan');
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: sudan }));
    act(() => { emit('flyto', { iso3: ['SAU', 'YEM'] }); });
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
  });

  test('highlight outlines the countries and clears', async () => {
    const { map } = await mounted();
    act(() => { emit('highlight', { iso3: ['SAU', 'YEM'] }); });
    expect(map.filters.get('atlas-hl')).toEqual(['in', ['get', 'iso3'], ['literal', ['SAU', 'YEM']]]);
    act(() => { emit('highlight', null); });
    expect(map.filters.get('atlas-hl')).toEqual(['in', ['get', 'iso3'], ['literal', []]]);
  });

  test('emits viewport after the map settles', async () => {
    const seen: string[][] = [];
    const off = on('viewport', ({ iso3 }) => seen.push(iso3));
    const { map } = await mounted();
    act(() => { map.fire('moveend'); });
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[seen.length - 1]).toContain('FRA');
    expect(seen[seen.length - 1]).not.toContain('AUS');
    off();
  });

  test('zoom and reset drive the MapLibre camera', async () => {
    const api = { current: null as MapControlsApi | null };
    const { map } = await mounted(vi.fn(), api);
    api.current!.zoom(2);
    expect(map.zoomTo).toHaveBeenCalledWith(3.5, expect.anything());
    api.current!.reset();
    expect(map.flyTo).toHaveBeenCalled();
  });

  test('a theme change swaps to the dark style', async () => {
    const { map } = await mounted();
    act(() => { atlas.set({ theme: 'dark' }); });
    expect(map.setStyle).toHaveBeenCalledWith('https://tiles.openfreemap.org/styles/dark', expect.objectContaining({ diff: false }));
  });

  test('an error before the first load reports a failure', async () => {
    const onFail = vi.fn();
    withDb(<Harness onFail={onFail} />);
    await waitFor(() => expect(h.state.maps).toHaveLength(1));
    act(() => { h.state.maps[0]!.fire('error', { error: new Error('style 404') }); });
    expect(onFail).toHaveBeenCalledOnce();
  });

  test('a tile error after the map has loaded is not a failure', async () => {
    const { map, onFail } = await mounted();
    act(() => { map.fire('error', { error: new Error('tile 404'), sourceId: 'openmaptiles' }); });
    expect(onFail).not.toHaveBeenCalled();
  });

  test('icons the basemap style names but its sprite lacks get a blank stand-in instead of a console warning', async () => {
    const { map } = await mounted();
    map.resolver?.('circle-11');
    expect(map.hasImage('circle-11')).toBe(true);
  });

  test('a selection made before the map existed is flown to once it loads', async () => {
    atlas.select('conflict', 'sudan'); // its flyto went out while nothing listened
    const { map } = await mounted();
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: db.anchorOf('conflict', 'sudan') }));
  });

  test('when the phone dossier sheet opens over the map, the camera keeps the selection in the clear part', async () => {
    const rect = (top: number, bottom: number) => ({ x: 0, y: top, left: 0, top, right: 390, bottom, width: 390, height: bottom - top, toJSON: () => ({}) });
    const sheet = Object.assign(document.createElement('div'), { id: 'dossier' });
    vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue(rect(500, 800));
    document.body.append(sheet);
    const { map } = await mounted();
    vi.spyOn(document.getElementById('map')!, 'getBoundingClientRect').mockReturnValue(rect(0, 800));
    map.moving = true; // a flight is under way: the sheet waits for it to land
    act(() => { atlas.select('country', 'EGY', { fly: false }); });
    await new Promise((r) => setTimeout(r, 600));
    expect(map.easeTo).not.toHaveBeenCalled();
    map.moving = false;
    act(() => { map.fire('moveend'); });
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ padding: expect.objectContaining({ bottom: 300 }) }));
    sheet.hidden = true;
    act(() => { atlas.select(null); });
    await waitFor(() => expect(map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ padding: expect.objectContaining({ bottom: 0 }) })));
    sheet.remove();
  });

  test('unmounting removes the map', async () => {
    const { map, unmount } = await mounted();
    unmount();
    expect(map.remove).toHaveBeenCalledOnce();
  });
});

describe('MapStage with the detailed map', () => {
  test('mounts the detailed map instead of the canvas, and back', async () => {
    atlas.set({ projection: 'detailed' });
    withDb(<MapStage />);
    await waitFor(() => expect(h.state.maps).toHaveLength(1));
    expect(engine.created).toBe(0);
    act(() => { atlas.set({ projection: 'globe' }); });
    expect(h.state.maps[0]!.remove).toHaveBeenCalled();
    expect(engine.created).toBe(1);
    expect(document.querySelectorAll('#map')).toHaveLength(1);
  });

  test('when MapLibre fails it falls back to the globe, toasts, and the preference no longer says detailed', async () => {
    const toasts: string[] = [];
    const off = on('toast', (m) => toasts.push(m));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.state.failNext = true;
    atlas.set({ projection: 'detailed' });
    withDb(<MapStage />);
    await waitFor(() => expect(atlas.get().projection).toBe('globe'));
    expect(toasts).toEqual(['تعذّر تحميل الخريطة التفصيلية، فعادت الكرة الأرضية.']);
    expect(engine.created).toBe(1);
    expect(JSON.parse(localStorage.getItem('atlas-v2-prefs') ?? '{}').projection).toBe('globe');
    off();
  });
});
