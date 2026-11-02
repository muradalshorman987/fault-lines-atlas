// What the year scrubber and the full timeline view share: severity lookup, class joining, media and size hooks.

import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { SEVERITY } from '../../../config';
import type { DB } from '../../../data/types';

export const SEV = new Map<string, (typeof SEVERITY)[number]>(SEVERITY.map((s) => [s.id, s]));
export const cls = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

export function useMedia(query: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    const mq = typeof matchMedia === 'function' ? matchMedia(query) : null;
    mq?.addEventListener('change', cb);
    return () => mq?.removeEventListener('change', cb);
  }, [query]);
  return useSyncExternalStore(subscribe, () => typeof matchMedia === 'function' && matchMedia(query).matches, () => false);
}

/** Watches an element's box; the size is 0×0 until it has been laid out (and in jsdom). */
export function useSize<E extends HTMLElement>(): [RefObject<E | null>, { w: number; h: number }] {
  const ref = useRef<E>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth, h = el.clientHeight;
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export const rangeOf = (db: DB) => db.timeline.range as [number, number];
