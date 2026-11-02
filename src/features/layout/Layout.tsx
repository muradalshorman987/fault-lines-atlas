// The app skeleton: the same ids and grid areas as v2, so the legacy stylesheets apply unchanged.
// Each feature renders its own area inside an error boundary, so one failing area cannot blank the page
// (v2 wrapped each module's mount in try/catch). Features never import each other.

import { useEffect } from 'react';
import { useAtlas } from '../../app/store';
import { ErrorBoundary } from '../../ui/ErrorBoundary';
import { initTips } from '../../ui/tooltip';
import { Dossier } from '../dossier';
import { MapStage } from '../map';
import { LensRail, ShellOverlays, TopBar } from '../shell';
import { TourPlayer } from '../tours/TourPlayer';
import { AskPanel } from '../ask';
import { ViewPanel } from '../views';
import { Welcome } from '../welcome';
import { Scrubber } from '../views/timeline';

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
      <ErrorBoundary name="tour" fallback={<div id="tour" hidden />}><TourPlayer /></ErrorBoundary>
      <ErrorBoundary name="ask" fallback={<div id="ask" hidden />}><AskPanel /></ErrorBoundary>
      <ErrorBoundary name="welcome" fallback={null}><Welcome /></ErrorBoundary>
      <ErrorBoundary name="overlays" fallback={null}><ShellOverlays /></ErrorBoundary>
    </>
  );
}
