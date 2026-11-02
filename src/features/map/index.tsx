// Map feature entry: the map (#map), the lens card (#legend) and the map controls (#mapctl), siblings inside
// #stage as in v2. The map is the canvas engine (globe or flat) or, when projection is 'detailed', the lazily
// loaded MapLibre map; only one exists at a time, and the camera is handed over when they swap. If the detailed
// map cannot start, the globe comes back with a toast and the saved preference goes back to the globe.

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { emit } from '../../app/events';
import { atlas, useAtlas } from '../../app/store';
import { useDb } from '../../app/useT';
import { translate } from '../../i18n/strings';
import { createMap } from './engine/engine';
import type { MapView } from './engine/viewport';
import { Legend } from './Legend';
import { MapControls, type MapControlsApi } from './MapControls';
import type { DetailedMapProps } from './detailed/DetailedMap';
import './strings';

/** The lazy chunk itself can fail to arrive (offline, a new deploy): report it like any other start failure. */
const DetailedMap = lazy(() => import('./detailed/DetailedMap').catch((err: unknown) => ({
  default: function Unavailable({ onFail }: DetailedMapProps) {
    useEffect(() => onFail(err), [onFail]);
    return <div id="map" />;
  },
})));

interface MapSlot { apiRef: RefObject<MapControlsApi | null>; viewRef: RefObject<MapView | null> }

function CanvasMap({ apiRef, viewRef }: MapSlot) {
  const db = useDb();
  const mount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let engine: ReturnType<typeof createMap> | null = null;
    // a map that fails to mount must not take the rest of the app down
    try { engine = createMap(el, db, { view: viewRef.current }); } catch (err) { console.error('[atlas] map failed to mount', err); }
    apiRef.current = engine;
    return () => {
      if (!engine) return;
      viewRef.current = engine.view();
      engine.destroy();
      if (apiRef.current === engine) apiRef.current = null;
    };
  }, [db, apiRef, viewRef]);

  return <div id="map" ref={mount} />;
}

export function MapStage() {
  const detailed = useAtlas((s) => s.projection) === 'detailed';
  const apiRef = useRef<MapControlsApi | null>(null);
  const viewRef = useRef<MapView | null>(null);

  const controls = useMemo<MapControlsApi>(() => ({
    zoom: (f) => apiRef.current?.zoom(f),
    reset: () => apiRef.current?.reset(),
  }), []);

  const onFail = useCallback((err: unknown) => {
    console.warn('[atlas] the detailed map could not start; back to the globe', err);
    emit('toast', translate(atlas.get().lang, 'map.detailed.fail'));
    atlas.set({ projection: 'globe' });
  }, []);

  return (
    <>
      {detailed
        ? <Suspense fallback={<div id="map" />}><DetailedMap apiRef={apiRef} viewRef={viewRef} onFail={onFail} /></Suspense>
        : <CanvasMap apiRef={apiRef} viewRef={viewRef} />}
      <Legend />
      <MapControls api={controls} />
    </>
  );
}
