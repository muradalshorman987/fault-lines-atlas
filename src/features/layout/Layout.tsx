// The app skeleton: the same ids and grid areas as v2, so the legacy stylesheets apply unchanged.
// Each feature renders its own area inside an error boundary, so one failing area cannot blank the page
// (v2 wrapped each module's mount in try/catch). Features never import each other.
// The tour card, Ask panel and "Start here" panel are lazy chunks; until each arrives its area shows the same
// empty container the feature renders when idle (#tour, #ask), so CSS, focus code and share links find it.

import { lazy, Suspense, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { emit, on, type Events } from '../../app/events';
import { useAtlas } from '../../app/store';
import { ErrorBoundary } from '../../ui/ErrorBoundary';
import { initTips } from '../../ui/tooltip';
import { Dossier } from '../dossier';
import { MapStage } from '../map';
import { LensRail, ShellOverlays, TopBar } from '../shell';
import { ViewPanel } from '../views';
import { Scrubber } from '../views/timeline/Scrubber';

const TourPlayer = lazy(() => import('../tours/TourPlayer').then((m) => ({ default: m.TourPlayer })));
const AskPanel = lazy(() => import('../ask').then((m) => ({ default: m.AskPanel })));
const Welcome = lazy(() => import('../welcome').then((m) => ({ default: m.Welcome })));

// The dossier retries on the next selection, so one bad record does not disable the panel for the visit.
function DossierArea() {
  const selection = useAtlas((s) => s.selection);
  const key = selection ? `${selection.kind}-${selection.id}` : '';
  return <ErrorBoundary name="dossier" resetKey={key} fallback={<aside id="dossier" hidden />}><Dossier /></ErrorBoundary>;
}

function ViewArea() {
  const view = useAtlas((s) => s.view);
  return <ErrorBoundary name="views" resetKey={view} fallback={<section id="viewpanel" hidden />}><ViewPanel /></ErrorBoundary>;
}

function Mounted({ run }: { run: () => () => void }) {
  useEffect(() => run(), [run]);
  return null;
}

/**
 * A lazily loaded page area. An event it listens for can fire before its code arrives (a #tour-energy link sends
 * 'starttour' as soon as the data is in), so until the area is on the page the last such event is held, then sent
 * again right after the area's own listeners are in place.
 */
function LazyArea<E extends keyof Events>({ name, fallback, replay, children }: { name: string; fallback: ReactNode; replay?: E; children: ReactNode }) {
  const box = useRef<{ mounted: boolean; held: { payload: Events[E] } | null }>({ mounted: false, held: null });
  useEffect(() => (replay ? on(replay, (payload) => { if (!box.current.mounted) box.current.held = { payload }; }) : undefined), [replay]);
  // Runs after the area's own effects (it renders after the area, inside the same boundary).
  const arrived = useCallback(() => {
    const b = box.current, held = b.held;
    b.mounted = true;
    b.held = null;
    if (replay && held) emit(replay, held.payload);
    return () => { b.mounted = false; };
  }, [replay]);
  return (
    <ErrorBoundary name={name} fallback={fallback}>
      <Suspense fallback={fallback}>{children}<Mounted run={arrived} /></Suspense>
    </ErrorBoundary>
  );
}

export function Layout() {
  useEffect(() => initTips(), []);
  return (
    <>
      <div id="app">
        <header id="topbar"><ErrorBoundary name="top bar" fallback={null}><TopBar /></ErrorBoundary></header>
        <nav id="lensrail"><ErrorBoundary name="lens rail" fallback={null}><LensRail /></ErrorBoundary></nav>
        <main id="stage">
          <ErrorBoundary name="map" fallback={<div id="map" />}><MapStage /></ErrorBoundary>
          <ViewArea />
        </main>
        <ErrorBoundary name="scrubber" fallback={<footer id="scrubber" />}><Scrubber /></ErrorBoundary>
        <DossierArea />
      </div>
      <div id="tooltip" role="tooltip" hidden />
      <LazyArea name="tour" fallback={<div id="tour" hidden />} replay="starttour"><TourPlayer /></LazyArea>
      <LazyArea name="ask" fallback={<div id="ask" hidden />}><AskPanel /></LazyArea>
      <LazyArea name="welcome" fallback={null} replay="welcome"><Welcome /></LazyArea>
      <ErrorBoundary name="overlays" fallback={null}><ShellOverlays /></ErrorBoundary>
    </>
  );
}
