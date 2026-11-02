// The detailed map (M7): MapLibre GL with OpenFreeMap vector tiles, and our Natural Earth countries on top in the
// current lens colours. This module and maplibre-gl load lazily, in their own chunks. Selection, the hover line,
// flights, highlight and the viewport event work as on the canvas map; markers and arcs stay on the canvas map.
// Anything that fails before the first frame (no WebGL, style or tiles blocked, the chunk itself) calls onFail,
// and MapStage puts the globe back.

import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { ErrorEvent as MlErrorEvent, LayerSpecification, Map as MlMap, MapLayerMouseEvent, MapMouseEvent, MapSourceDataEvent } from 'maplibre-gl';
import type { FeatureCollection, Geometry } from 'geojson';
import { useEffect, useRef, type FocusEvent, type RefObject } from 'react';
import { onStateChange } from '../../../app/compat';
import { emit, on, type Events } from '../../../app/events';
import { atlas, type AtlasState } from '../../../app/store';
import { useDb } from '../../../app/useT';
import type { DB, Kind } from '../../../data/types';
import { translate } from '../../../i18n/strings';
import { reducedMotion } from '../../../ui/dom';
import { isDark, pal } from '../../../ui/palette';
import { hideTip, showTip } from '../../../ui/tooltip';
import type { MapControlsApi } from '../MapControls';
import { focusGeometry, type LonLat } from '../engine/geo';
import { buildScene, emptyScene, eventAnchor, tipFor, type Scene } from '../engine/scene';
import { countryBoxes, visibleInBounds, zoomFromScale, type BoxItem, type MapView } from '../engine/viewport';
import {
  FILL_OPACITY, LAYER, POINT_SOURCE, SOURCE, STYLE_URL, boundsOf, glColor, isNameField, isOwnSource, isoFilter, labelField, scenePaint,
} from './style';
import '../strings';
import './detailed.css';

export interface DetailedMapProps {
  /** Set while this map is mounted: what the zoom and reset buttons call. */
  apiRef: RefObject<MapControlsApi | null>;
  /** The camera handed between this map and the canvas engine when the projection changes. */
  viewRef: RefObject<MapView | null>;
  /** Called once if the map cannot start. Must be stable (it is an effect dependency). */
  onFail: (err: unknown) => void;
}

const HOME: LonLat = [35, 25];
const POINT_KINDS: Kind[] = ['conflict', 'choke', 'site'];
const SCENE_KEYS = new Set<keyof AtlasState>(['lens', 'selection', 'filters', 'layers', 'year', 'yearFilter', 'theme', 'compare', 'view', 'lang']);
const VIEWPORT_MS = 200;
/** No first frame after this long counts as a failure (tiles that never answer). */
const LOAD_TIMEOUT_MS = 20000;
/** Basemap tile errors, with no tile loaded at all, that count as "tiles blocked" before the first frame. */
const TILE_FAILS = 4;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const t = (key: string) => translate(atlas.get().lang, key);
const styleUrl = () => (isDark() ? STYLE_URL.dark : STYLE_URL.light);

const boxCache = new WeakMap<DB, BoxItem[]>();
const boxesOf = (db: DB) => {
  let b = boxCache.get(db);
  if (!b) boxCache.set(db, (b = countryBoxes(db.features.map((f) => ({ iso3: f.properties.iso3, feature: f })))));
  return b;
};

export default function DetailedMap({ apiRef, viewRef, onFail }: DetailedMapProps) {
  const db = useDb();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);

  useEffect(() => {
    const el: HTMLDivElement | null = box.current;
    if (!el) return;
    const container: HTMLDivElement = el;
    let disposed = false, failed = false;
    let map: MlMap | null = null;
    const offs: (() => void)[] = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
    const cancel = (id: ReturnType<typeof setTimeout> | undefined) => { if (id !== undefined) { clearTimeout(id); timers.delete(id); } };

    let styleReady = false, loaded = false, tileOk = 0, tileErr = 0, raf = 0, handedView = false;
    let currentUrl = styleUrl();
    let labelLayers: string[] = [];
    const symbolVisibility = new Map<string, 'visible' | 'none'>();
    let hoverIso: string | null = null, tipHtml = '';
    let hl: Events['highlight'] = null;
    let vpTimer: ReturnType<typeof setTimeout> | undefined, vpLast: string | null = null;
    const focusCache = new Map<string, Geometry | null>();

    const fail = (err: unknown) => {
      if (disposed || failed) return;
      failed = true;
      onFail(err);
    };

    // ---- camera
    const size = () => { const r = el.getBoundingClientRect(); return Math.max(1, Math.min(r.width, r.height)); };
    /** The zoom at which the canvas globe shows the whole world (its base scale, 0.43 × the short side). */
    const homeZoom = () => Math.max(0.5, zoomFromScale(0.43 * size()));
    const zoomForK = (k: number) => clamp(zoomFromScale(0.43 * size() * k), 1, 18);
    const focusOf = (iso: string) => {
      if (!focusCache.has(iso)) { const c = db.countries.get(iso); focusCache.set(iso, c ? focusGeometry(c.feature) : null); }
      return focusCache.get(iso) ?? null;
    };
    /** Room around fitted places; the camera padding (syncSheet) already keeps them clear of a bottom sheet. */
    const padding = () => ({ top: 48, right: 48, bottom: 48, left: 48 });
    /** How much of the map a bottom sheet (the phone dossier) covers, as the canvas map measures it. */
    const sheetOverlap = () => {
      const r = container.getBoundingClientRect(), dz = document.getElementById('dossier');
      if (!dz || dz.hidden) return 0;
      const d = dz.getBoundingClientRect();
      const spans = d.width > 0 && d.left <= r.left + 8 && d.right >= r.right - 8;
      return spans && d.top > r.top + 60 && d.top < r.bottom - 10 ? Math.round(r.bottom - d.top) : 0;
    };
    let sheet = 0;
    /** Move the camera's centre into the part of the map the sheet leaves clear (and back when it closes). */
    function syncSheet() {
      const bottom = sheetOverlap();
      if (!map || Math.abs(bottom - sheet) < 4) return;
      // never cut a flight short: glide into the clear part once it lands
      if (map.isMoving()) { map.once('moveend', syncSheet); return; }
      sheet = bottom;
      map.easeTo({ padding: { top: 0, right: 0, bottom, left: 0 }, duration: reducedMotion() ? 0 : 300 });
    }
    let sheetTimers: ReturnType<typeof setTimeout>[] = [];
    const scheduleSheet = () => {
      sheetTimers.forEach(cancel);
      // once at the start of the sheet's slide and once after it (the canvas map waits the same 60 / 460 ms)
      sheetTimers = [later(syncSheet, 60), later(syncSheet, 460)];
    };

    function flyToTarget(tg: Events['flyto']) {
      if (!map) return;
      if ('lonlat' in tg) { map.flyTo({ center: tg.lonlat, zoom: zoomForK(tg.k ?? 4) }); return; }
      if ('iso3' in tg) {
        const b = boundsOf(tg.iso3.map(focusOf));
        if (b) map.fitBounds(b, { padding: padding(), maxZoom: 8 });
        return;
      }
      const { kind, id } = tg;
      if (!db.get(kind, id)) return;
      const geoms = kind === 'group' ? db.ethnic.groups.get(id)?.features.map((f) => f.geometry) ?? []
        : kind === 'disputed' ? [db.disputedById.get(id)?.feature.geometry]
          : db.countriesOf(kind, id).map(focusOf);
      const anchor = POINT_KINDS.includes(kind) ? db.anchorOf(kind, id) : null;
      if (anchor) {
        // a place stays the centre; its states set the zoom, within a regional window
        const b = boundsOf(geoms, [anchor]);
        const cam = b ? map.cameraForBounds(b, { padding: padding() }) : undefined;
        map.flyTo({ center: anchor, zoom: clamp(cam?.zoom ?? 5, 3, 6.5) });
        return;
      }
      const ev = kind === 'event' ? db.eventById.get(id) : undefined;
      const a = ev ? eventAnchor(db, ev) : null;
      const b = boundsOf(geoms, a ? [a] : []);
      if (b) map.fitBounds(b, { padding: padding(), maxZoom: 8 });
    }

    // ---- what the map shows
    function scheduleViewport(force = false) {
      cancel(vpTimer);
      vpTimer = later(() => {
        vpTimer = undefined;
        if (!map) return;
        const b = map.getBounds();
        const iso3 = visibleInBounds([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], boxesOf(db));
        const key = iso3.join(',');
        if (!force && key === vpLast) return;
        vpLast = key;
        emit('viewport', { iso3 });
      }, force ? 0 : VIEWPORT_MS);
    }

    // ---- style: our layers under the basemap labels, label language, layer toggles, lens paint
    function setup() {
      if (!map) return;
      const layers = map.getStyle().layers ?? [];
      const symbols = layers.filter((l) => l.type === 'symbol' && !isOwnSource((l as { source?: unknown }).source));
      labelLayers = symbols.filter((l) => isNameField(l.layout && 'text-field' in l.layout ? l.layout['text-field'] : null)).map((l) => l.id);
      symbolVisibility.clear();
      for (const l of symbols) symbolVisibility.set(l.id, l.layout && 'visibility' in l.layout && l.layout.visibility === 'none' ? 'none' : 'visible');
      const before = symbols[0]?.id;
      if (!map.getSource(SOURCE)) map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: db.features }, attribution: 'Natural Earth' });
      if (!map.getSource(POINT_SOURCE)) map.addSource(POINT_SOURCE, { type: 'geojson', data: EMPTY });
      const none = isoFilter([]);
      const specs: LayerSpecification[] = [
        { id: LAYER.fill, type: 'fill', source: SOURCE, paint: { 'fill-color': 'rgba(0, 0, 0, 0)', 'fill-opacity': FILL_OPACITY } },
        { id: LAYER.borders, type: 'line', source: SOURCE, paint: { 'line-width': 0.6, 'line-opacity': 0.7 } },
        { id: LAYER.outlineDash, type: 'line', source: SOURCE, filter: none, layout: { 'line-join': 'round' }, paint: { 'line-dasharray': [3, 2] } },
        { id: LAYER.outline, type: 'line', source: SOURCE, filter: none, layout: { 'line-join': 'round' } },
        { id: LAYER.hl, type: 'line', source: SOURCE, filter: none, paint: { 'line-width': 1.6, 'line-dasharray': [2.5, 1.9] } },
        { id: LAYER.hover, type: 'line', source: SOURCE, filter: none, paint: { 'line-width': 1.2, 'line-opacity': 0.8 } },
        { id: LAYER.hlPoint, type: 'circle', source: POINT_SOURCE, paint: { 'circle-radius': 8, 'circle-color': 'rgba(0, 0, 0, 0)', 'circle-stroke-width': 2 } },
      ];
      for (const spec of specs) if (!map.getLayer(spec.id)) map.addLayer(spec, before);
      styleReady = true;
      applyLabels();
      applyLayers();
      paintNow();
      applyHighlight();
    }

    function applyLabels() {
      if (!map || !styleReady) return;
      const field = labelField(atlas.get().lang);
      for (const id of labelLayers) map.setLayoutProperty(id, 'text-field', field);
    }

    function applyLayers() {
      if (!map || !styleReady) return;
      const L = atlas.get().layers;
      map.setLayoutProperty(LAYER.borders, 'visibility', L.boundaries ? 'visible' : 'none');
      for (const [id, v] of symbolVisibility) map.setLayoutProperty(id, 'visibility', L.labels ? v : 'none');
    }

    function paintNow() {
      if (!map || !styleReady) return;
      const P = pal();
      let sc: Scene;
      try { sc = buildScene(db, atlas.get(), P); } catch (err) { console.error('[atlas] map scene failed', err); sc = emptyScene(); }
      const p = scenePaint(sc, P, db.countries.keys());
      map.setPaintProperty(LAYER.fill, 'fill-color', p.fill);
      for (const [id, o] of [[LAYER.outline, p.outline], [LAYER.outlineDash, p.outlineDash]] as const) {
        map.setFilter(id, o.filter);
        map.setPaintProperty(id, 'line-color', o.color);
        map.setPaintProperty(id, 'line-width', o.width);
      }
      map.setPaintProperty(LAYER.borders, 'line-color', glColor(P.border));
      map.setPaintProperty(LAYER.hl, 'line-color', glColor(P.accent2));
      map.setPaintProperty(LAYER.hover, 'line-color', glColor(P.fg));
      map.setPaintProperty(LAYER.hlPoint, 'circle-stroke-color', glColor(P.accent2));
    }

    function schedulePaint() {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintNow(); });
    }

    function applyHighlight() {
      if (!map || !styleReady) return;
      map.setFilter(LAYER.hl, isoFilter(hl?.iso3 ?? []));
      const ll = hl?.lonlat;
      const src = map.getSource(POINT_SOURCE) as { setData?: (d: FeatureCollection) => void } | undefined;
      src?.setData?.(ll ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: ll } }] } : EMPTY);
    }

    function restyle() {
      const url = styleUrl();
      if (!map || url === currentUrl) return;
      currentUrl = url;
      styleReady = false;
      // a full reload fires style.load, where our sources and layers are added again
      map.setStyle(url, { diff: false });
    }

    // ---- pointer
    function setHover(iso: string | null, ev?: { clientX: number; clientY: number }) {
      if (!map) return;
      if (iso !== hoverIso) {
        hoverIso = iso;
        map.getCanvas().style.cursor = iso ? 'pointer' : '';
        if (styleReady) map.setFilter(LAYER.hover, isoFilter(iso ? [iso] : []));
        tipHtml = iso ? tipFor({ kind: 'country', id: iso }, db, atlas.get()) : '';
        emit('hover', iso && ev ? { kind: 'country', id: iso, x: ev.clientX, y: ev.clientY } : null);
      }
      if (tipHtml && ev) showTip(tipHtml, ev.clientX, ev.clientY);
      else hideTip();
    }

    function bind(m: MlMap) {
      m.on('style.load', setup);
      m.on('load', () => {
        loaded = true;
        if (tileErr && !tileOk) { fail(new Error('[atlas] basemap tiles did not load')); return; }
        // a selection made before this map existed (a shared link) had its flight announced to nobody
        const sel = atlas.get().selection;
        if (sel && !handedView) flyToTarget(sel);
        syncSheet();
        scheduleViewport();
      });
      m.on('resize', scheduleSheet);
      m.on('error', (e: MlErrorEvent) => {
        const sourceId = (e as { sourceId?: unknown }).sourceId;
        if (isOwnSource(sourceId)) return;
        if (loaded) {
          // after the first frame a missing tile or glyph is not a failure; the network panel shows the request
          if (sourceId == null) console.warn('[atlas] detailed map:', e.error.message);
          return;
        }
        if (!styleReady && sourceId == null) fail(e.error); // the style itself did not load
        else if (sourceId != null && ++tileErr >= TILE_FAILS && !tileOk) fail(e.error);
      });
      m.on('sourcedata', (e: MapSourceDataEvent) => { if (e.tile && !isOwnSource(e.sourceId)) tileOk++; });
      m.on('moveend', () => scheduleViewport());
      m.on('mousemove', LAYER.fill, (e: MapLayerMouseEvent) => {
        const iso = e.features?.[0]?.properties?.iso3;
        setHover(typeof iso === 'string' ? iso : null, e.originalEvent);
      });
      m.on('mouseleave', LAYER.fill, () => setHover(null));
      m.on('click', (e: MapMouseEvent) => {
        const iso = m.queryRenderedFeatures(e.point, { layers: [LAYER.fill] })[0]?.properties?.iso3;
        if (typeof iso === 'string' && db.countries.has(iso)) atlas.select('country', iso, { fly: false });
        else if (atlas.get().selection) atlas.select(null);
      });
    }

    function bindApp() {
      let inView = atlas.get().filters.inView;
      offs.push(onStateChange((keys, s) => {
        if (s.filters.inView !== inView) { inView = s.filters.inView; if (inView) scheduleViewport(true); }
        if (keys.includes('theme')) restyle();
        if (keys.includes('lang')) { applyLabels(); map?.getCanvas().setAttribute('aria-label', t('map.detailed.aria')); }
        if (keys.includes('layers')) applyLayers();
        if (keys.includes('selection') || keys.includes('view')) scheduleSheet();
        if (keys.some((k) => SCENE_KEYS.has(k))) {
          if (hoverIso) setHover(null);
          schedulePaint();
        }
      }));
      offs.push(on('flyto', (tg) => { if (tg) flyToTarget(tg); }));
      offs.push(on('highlight', (h) => { hl = h && (h.iso3?.length || h.lonlat) ? h : null; applyHighlight(); }));
      if (typeof matchMedia === 'function') {
        const mq = matchMedia('(prefers-color-scheme: dark)');
        const onScheme = () => { if (atlas.get().theme === 'system') { restyle(); schedulePaint(); } };
        mq.addEventListener?.('change', onScheme);
        offs.push(() => mq.removeEventListener?.('change', onScheme));
      }
    }

    const api: MapControlsApi = {
      zoom: (f) => { if (map) map.zoomTo(map.getZoom() + Math.log2(f), { duration: reducedMotion() ? 0 : 320 }); },
      reset: () => { map?.flyTo({ center: HOME, zoom: homeZoom() }); },
    };

    async function start() {
      let ml: typeof import('maplibre-gl');
      try {
        [ml] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
      } catch (err) { fail(err); return; }
      if (disposed) return;
      const v = viewRef.current;
      handedView = !!v;
      try {
        ml.setWorkerUrl(workerUrl); // same origin, so the CSP needs worker-src 'self' only
        map = new ml.Map({
          container,
          style: currentUrl,
          center: v?.center ?? HOME,
          zoom: v ? clamp(v.zoom, 0.5, 18) : homeZoom(),
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
          locale: { 'Map.Title': t('map.detailed.aria') },
          fadeDuration: reducedMotion() ? 0 : 300,
        });
      } catch (err) { fail(err); return; }
      mapRef.current = map;
      const m = map;
      // OpenFreeMap's styles name a few icons their sprite lacks (circle-11, wood-pattern): draw nothing, quietly
      m.setMissingStyleImageResolver((id) => { if (!m.hasImage(id)) m.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) }); });
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.addControl(new ml.AttributionControl({ compact: false }), 'top-right');
      bind(map);
      bindApp();
      apiRef.current = api;
      later(() => { if (!loaded) fail(new Error('[atlas] the detailed map did not load in time')); }, LOAD_TIMEOUT_MS);
    }

    void start();

    return () => {
      disposed = true;
      for (const off of offs.splice(0)) off();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      if (raf) cancelAnimationFrame(raf);
      if (map) {
        const c = map.getCenter();
        viewRef.current = { center: [c.lng, c.lat], zoom: map.getZoom() };
        map.remove();
        map = null;
      }
      mapRef.current = null;
      if (hoverIso) emit('hover', null);
      hideTip();
      if (apiRef.current === api) apiRef.current = null;
    };
  }, [db, apiRef, viewRef, onFail]);

  // The dossier hands focus back to #map when it closes: pass it on to the MapLibre canvas, which takes the keys.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) mapRef.current?.getCanvas().focus(); };
  return <div id="map" ref={box} className="map-detailed" tabIndex={-1} onFocus={onFocus} />;
}
