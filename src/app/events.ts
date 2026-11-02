// Transient app events that are not state: pointer hover, map flights, emphasis, toasts, tour starts, boot.

import type { DB, Kind } from '../data/types';

export interface Events {
  hover: { kind: Kind; id: string; x: number; y: number } | null;
  flyto: { kind: Kind; id: string } | { lonlat: [number, number]; k?: number } | { iso3: string[] };
  highlight: { iso3: string[]; lonlat?: [number, number] } | null;
  toast: string;
  starttour: string | { id: string; focus?: boolean };
  ready: DB;
  /** The countries the map shows once it settles (canvas engine and detailed map). */
  viewport: { iso3: string[] };
  /** Reopen the "Start here" panel (help dialog, command palette). */
  welcome: null;
}

type Listener<E extends keyof Events> = (payload: Events[E]) => void;
const listeners = new Map<keyof Events, Set<Listener<never>>>();
// The last payload of each event, for late subscribers (e.g. a lazily mounted view reading the current viewport).
const last = new Map<keyof Events, unknown>();

/** The most recent payload emitted for an event, or undefined if it never fired. */
export function lastOf<E extends keyof Events>(evt: E): Events[E] | undefined {
  return last.get(evt) as Events[E] | undefined;
}

export function on<E extends keyof Events>(evt: E, fn: Listener<E>): () => void {
  let set = listeners.get(evt);
  if (!set) listeners.set(evt, (set = new Set()));
  set.add(fn as Listener<never>);
  return () => { set.delete(fn as Listener<never>); };
}

export function emit<E extends keyof Events>(evt: E, payload: Events[E]): void {
  last.set(evt, payload);
  for (const fn of listeners.get(evt) ?? []) {
    try { (fn as Listener<E>)(payload); } catch (err) { console.error(`[atlas] listener for "${evt}" failed`, err); }
  }
}
