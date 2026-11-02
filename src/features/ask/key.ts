// The visitor's Anthropic API key. It lives in this module's memory; it is written to localStorage only when the
// visitor ticks "remember on this device". It is never logged, never put in a URL, and api.ts sends it only to
// api.anthropic.com.

import { useSyncExternalStore } from 'react';

export const KEY_STORAGE = 'atlas-v3-anthropic-key';

export interface KeyState { key: string | null; remembered: boolean }

let state: KeyState = { key: null, remembered: false };
let loaded = false;
const subs = new Set<() => void>();

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const v = localStorage.getItem(KEY_STORAGE);
    if (v && isPlausibleKey(v)) state = { key: v, remembered: true };
  } catch {
    // storage blocked (private mode, sandbox): start without a key
  }
}

function change(next: KeyState): void {
  state = next;
  for (const fn of subs) fn();
}

export const keyStore = {
  subscribe(fn: () => void): () => void {
    subs.add(fn);
    return () => { subs.delete(fn); };
  },
  getSnapshot(): KeyState {
    load();
    return state;
  },
  /** Keep the key for this visit; with `remember`, also on this device. Saving without it removes a stored key. */
  save(key: string, remember: boolean): boolean {
    let remembered = false;
    try {
      if (remember) { localStorage.setItem(KEY_STORAGE, key); remembered = true; }
      else localStorage.removeItem(KEY_STORAGE);
    } catch {
      // storage blocked: the key is kept in memory only
    }
    loaded = true;
    change({ key, remembered });
    return remembered;
  },
  forget(): void {
    try { localStorage.removeItem(KEY_STORAGE); } catch { /* storage blocked: nothing was stored */ }
    loaded = true;
    change({ key: null, remembered: false });
  },
};

export function useKey(): KeyState {
  return useSyncExternalStore(keyStore.subscribe, keyStore.getSnapshot);
}

/** Printable ASCII without spaces and of a key's length. A wrong but plausible key gets a 401 from Anthropic. */
export function isPlausibleKey(s: string): boolean {
  return /^[\x21-\x7e]{20,400}$/.test(s);
}

/** Drop the in-memory key as a page reload would (tests). The stored key, if any, is read again on next use. */
export function resetKeyMemory(): void {
  loaded = false;
  change({ key: null, remembered: false });
}
