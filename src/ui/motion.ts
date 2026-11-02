// Small motion helpers. Every one respects prefers-reduced-motion by jumping straight to the end state.

import { useEffect, useRef, useState } from 'react';
import { reducedMotion } from './dom';

/** Animates a number from its last shown value to `target` over `ms` (ease-out); returns the current value. */
export function useCountUp(target: number, ms = 700): number {
  const reduced = reducedMotion();
  const [shown, setShown] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    if (reduced || typeof requestAnimationFrame !== 'function') return;
    let raf = 0;
    const start = last.current;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const v = start + (target - start) * (1 - (1 - k) ** 3);
      last.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return reduced ? target : shown;
}
