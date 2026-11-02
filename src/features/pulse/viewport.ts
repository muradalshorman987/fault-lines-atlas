// The countries the map last reported as visible ("figures follow the map"). The view reads the sticky last payload
// (lastOf) when it mounts, so a viewport the map reported before the view opened (or before its chunk loaded) still counts,
// and then follows every new report.

import { useSyncExternalStore } from 'react';
import { lastOf, on } from '../../app/events';

// A payload the view was told to forget (tests): events.ts keeps the last payload for the page's lifetime.
let forgotten: unknown;

const subscribe = (fn: () => void) => on('viewport', fn);
const snapshot = (): readonly string[] | null => {
  const v = lastOf('viewport');
  return v && v !== forgotten ? v.iso3 : null;
};

/** The latest viewport (null until the map reports one: treat as every country). */
export function useViewport(): readonly string[] | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Forget the viewport reported so far; the next report counts again. Used by tests. */
export function resetViewport(): void {
  forgotten = lastOf('viewport');
}
