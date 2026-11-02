// Loads the atlas, mirrors language and theme onto <html>, starts share-link sync, and owns the loading screen.
// index.html paints a static copy of the loader's first frame before scripts run; Boot replaces it with the living
// loader (LivingLoader.tsx) on mount, and hands off to the map once the model is built.

import { useEffect, useState, type ReactNode } from 'react';
import { emit } from '../../app/events';
import { startHashSync } from '../../app/hash';
import { atlas, useAtlas } from '../../app/store';
import { DbContext, useT } from '../../app/useT';
import { FILES, GENERATED } from '../../data/files';
import { loadAll } from '../../data/load';
import type { DB } from '../../data/types';
import '../../i18n/core';
import { LivingLoader, stageOf } from './LivingLoader';
import { loadWorldLite, type WorldLite } from './worldLite';

const STALL_MS = 8000;   // nothing new for this long: offer to start loading again
const HOLD_MS = 800;     // the figures count up (700 ms) before the hand-off
const FADE_MS = 450;     // the loader fades into the map (loader.css)
const TOTAL = Object.keys(FILES).length + Object.keys(GENERATED).length;

function useDocumentLangTheme() {
  const { lang, t } = useT();
  const theme = useAtlas((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    document.title = t('appName');
  }, [lang, theme, t]);
}

export function Boot({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB | null>(null);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [stalled, setStalled] = useState(false);
  const [world, setWorld] = useState<WorldLite | null>(null);
  const [phase, setPhase] = useState<'on' | 'leaving' | 'gone'>('on');
  useDocumentLangTheme();

  useEffect(() => { document.querySelector('body > #loader')?.remove(); }, []);

  useEffect(() => {
    let alive = true;
    void loadWorldLite().then((w) => { if (alive) setWorld(w); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    loadAll((p) => { if (alive) { setProgress(p); setStalled(false); } })
      .then((d) => { if (alive) setDb(d); })
      .catch((err: unknown) => {
        console.error('[atlas] data load failed', err);
        if (alive) setFailed(true);
      });
    return () => { alive = false; };
  }, [attempt]);

  // The stall clock restarts with every file that arrives and with every attempt.
  useEffect(() => {
    if (db || failed) return;
    const id = setTimeout(() => setStalled(true), STALL_MS);
    return () => clearTimeout(id);
  }, [progress, attempt, db, failed]);

  useEffect(() => {
    if (!db) return;
    // The timeline filter starts with every category shown (null only means "not loaded yet").
    atlas.setFilter('timelineCats', new Set(db.timeline.categories.map((c) => c.id)));
    const stop = startHashSync(db);
    emit('ready', db);
    const leave = setTimeout(() => setPhase('leaving'), HOLD_MS);
    const gone = setTimeout(() => setPhase('gone'), HOLD_MS + FADE_MS);
    return () => { stop(); clearTimeout(leave); clearTimeout(gone); };
  }, [db]);

  const restart = () => { setFailed(false); setStalled(false); setProgress(0); setAttempt((a) => a + 1); };

  return (
    <>
      {db && <DbContext.Provider value={db}>{children}</DbContext.Provider>}
      {phase !== 'gone' && (
        <LivingLoader stage={stageOf(progress, !!db)} world={world} stats={db?.stats ?? null} done={!!db} leaving={phase === 'leaving'}
          failed={failed} stalled={stalled && !db && !failed ? { done: Math.round(progress * TOTAL), total: TOTAL } : null} onRetry={restart} />
      )}
    </>
  );
}
