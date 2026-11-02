// After a deploy, a tab that stayed open asks for lazy chunks of the old build, which no longer exist.
// Vite reports that as `vite:preloadError`; reload once to pick up the new build. A short guard window (kept in
// sessionStorage, which survives the reload) stops a loop when the files are really missing; a later deploy can reload again.

const KEY = 'atlas-chunk-reload-at';
const GUARD_MS = 60_000;

interface Deps { reload: () => void; storage: Storage; now: () => number }

export function installChunkReload(target: EventTarget, { reload, storage, now }: Deps): void {
  let reloadedWithoutStorage = false;
  target.addEventListener('vite:preloadError', (e) => {
    let last: number;
    try {
      last = Number(storage.getItem(KEY)) || 0;
    } catch {
      // storage blocked: no guard survives the reload, so allow a single reload for this page only
      if (reloadedWithoutStorage) return;
      reloadedWithoutStorage = true;
      e.preventDefault();
      reload();
      return;
    }
    if (last && now() - last < GUARD_MS) return;
    try {
      storage.setItem(KEY, String(now()));
    } catch {
      // storage became unwritable: the reload still happens once; the guard just won't survive it
    }
    e.preventDefault();
    reload();
  });
}
