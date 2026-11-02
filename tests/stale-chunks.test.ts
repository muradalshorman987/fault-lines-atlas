import { describe, expect, test, vi } from 'vitest';
import { installChunkReload } from '../src/app/staleChunks';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, get length() { return m.size; } };
}

describe('a tab left open across a deploy', () => {
  test('reloads once when a lazy chunk from the old build is gone', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    let now = 1_000_000;
    installChunkReload(target, { reload, storage: memoryStorage(), now: () => now });
    const fire = () => { const e = new Event('vite:preloadError', { cancelable: true }); target.dispatchEvent(e); return e; };
    const first = fire();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);
    now += 5_000;
    fire();                                   // still failing right after the reload: don't loop
    expect(reload).toHaveBeenCalledTimes(1);
    now += 120_000;
    fire();                                   // a later deploy may reload again
    expect(reload).toHaveBeenCalledTimes(2);
  });
  test('still reloads once when storage is blocked', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    installChunkReload(target, { reload, storage: blocked, now: () => 0 });
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
