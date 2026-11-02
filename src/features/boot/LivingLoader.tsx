// The living loader (spec 2026-11-02, "Loading is the map"): a small world wakes in four stages while the data loads —
// borders, then bloc constellations, then conflict pins with a few names, then the real figures counting up — and fades
// into the live map. No progress bar. All motion is CSS (loader.css) and stops under prefers-reduced-motion, where every
// layer is drawn at once. index.html paints a static copy of the first frame; keep the two in step.

import { useState, type CSSProperties } from 'react';
import { useT } from '../../app/useT';
import type { DB } from '../../data/types';
import { reducedMotion } from '../../ui/dom';
import { useCountUp } from '../../ui/motion';
import { sevVar } from '../../ui/palette';
import type { WorldLite } from './worldLite';
import './loader.css';
import './strings';

export type Stage = 1 | 2 | 3 | 4;
const STAGES: readonly Stage[] = [1, 2, 3, 4];
const COUNT_MS = 700;
const RINGED = new Set(['war', 'armed-conflict']);

/** Stage for a load fraction: borders → alliances (a third in) → conflicts (two thirds in) → figures (model built). */
export function stageOf(progress: number, ready: boolean): Stage {
  if (ready) return 4;
  return progress >= 2 / 3 ? 3 : progress >= 1 / 3 ? 2 : 1;
}

const vars = (o: Record<string, string | number>) => o as CSSProperties;
const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

function LoaderMap({ world, shown }: { world: WorldLite; shown: Stage }) {
  const { lang } = useT();
  const [hot, setHot] = useState<string | null>(null);
  const [, , W, H] = world.viewBox;
  const vb = world.viewBox.join(' ');
  const on = (s: Stage) => (shown >= s ? ' is-on' : '');
  const name = (x: { ar: string; en: string }) => (lang === 'ar' ? x.ar : x.en);
  // Map positions are physical (left/top): a map does not mirror in RTL.
  const at = (x: number, y: number) => ({ left: pct(x, W), top: pct(y, H) });
  return (
    <div className="ld-map" aria-hidden="true">
      <div className={`ld-frame${hot ? ' has-hot' : ''}`}
        style={vars({ '--ratio': `${W} / ${H}`, '--fx': world.focus[0] / W, '--fxp': pct(world.focus[0], W), '--fyp': pct(world.focus[1], H) })}>
        <div className="ld-drift">
          <svg className={`ld-layer ld-base${on(1)}`} viewBox={vb}>
            <path className="ld-grat" d={world.graticule} />
            <g className="ld-land">{world.land.map((l, i) => <path key={l.id} d={l.d} style={vars({ '--i': i })} />)}</g>
          </svg>
          <svg className={`ld-layer ld-blocs${on(2)}`} viewBox={vb}>
            {world.blocs.map((b, i) => (
              <g key={b.id} className={`ld-bloc${hot === b.id ? ' is-hot' : ''}`} style={vars({ '--i': i })}
                onPointerEnter={() => setHot(b.id)} onPointerLeave={() => setHot(null)}>
                <path className="ld-hit" d={b.d} />
                <path className="ld-link" d={b.d} pathLength={1} />
                {b.pts.map((p, j) => <circle key={j} cx={p[0]} cy={p[1]} r={1.7} style={vars({ '--j': j })} />)}
              </g>
            ))}
          </svg>
          <div className={`ld-layer ld-bnames${on(2)}`}>
            {world.blocs.map((b, i) => (
              <span key={b.id} className={`ld-bname${hot === b.id ? ' is-hot' : ''}`} style={{ ...at(b.at[0], b.at[1]), ...vars({ '--i': i }) }}>{name(b)}</span>
            ))}
          </div>
          <div className={`ld-layer ld-pins${on(3)}`}>
            {world.conflicts.map((c, i) => (
              <span key={c.id} className={`ld-pin${RINGED.has(c.sev) ? ' ring' : ''}`} data-sev={c.sev}
                style={{ ...at(c.x, c.y), color: sevVar(c.sev), ...vars({ '--i': i }) }} />
            ))}
          </div>
          <div className={`ld-layer ld-names${on(3)}`}>
            {world.conflicts.filter((c) => c.label).map((c, i) => (
              <span key={c.id} className="ld-name" data-side={c.label} style={{ ...at(c.x, c.y), ...vars({ '--i': i }) }}>{name(c)}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Figure({ k, target, label }: { k: string; target: number | null; label: string }) {
  const { fmt } = useT();
  const v = useCountUp(target ?? 0, COUNT_MS);
  return (
    <li data-k={k}>
      <b className="num">{target == null ? '–' : fmt.num(Math.max(0, Math.round(v)))}</b>
      <span>{label}</span>
    </li>
  );
}

export interface LivingLoaderProps {
  stage: Stage;
  world: WorldLite | null;
  stats: DB['stats'] | null;
  /** The data is in: the loader stops taking pointer events while the figures finish. */
  done: boolean;
  /** Fading into the live map. */
  leaving: boolean;
  failed: boolean;
  /** Set when nothing has arrived for a while: how many files are in. */
  stalled: { done: number; total: number } | null;
  onRetry: () => void;
}

export function LivingLoader({ stage, world, stats, done, leaving, failed, stalled, onRetry }: LivingLoaderProps) {
  const { t } = useT();
  const still = reducedMotion();
  const msg = failed ? t('loadFailed')
    : stalled ? t('ld.slow', stalled)
    : t('ld.stage', { i: stage, n: STAGES.length, what: t(`ld.d${stage}`) });
  return (
    <div id="loader" className={`ld${done ? ' done' : ''}${leaving ? ' leaving' : ''}`} data-stage={stage} data-motion={still ? 'static' : 'live'}>
      {world && <LoaderMap world={world} shown={still ? Math.max(stage, 3) as Stage : stage} />}
      <header className="ld-head">
        <svg className="mark" width="44" height="44" viewBox="0 0 56 56" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="28" cy="28" r="25" /><circle cx="28" cy="28" r="17" strokeDasharray="2 4" />
          <path d="M28 3v50M3 28h50" /><path d="M36 20l-5 11-11 5 5-11z" fill="currentColor" stroke="none" />
        </svg>
        <h1 id="loader-title">{t('appName')}</h1>
        <p className="ld-tag">{t('appTag')}</p>
      </header>
      <section className="ld-panel">
        <ol className="ld-steps" aria-label={t('ld.steps')}>
          {STAGES.map((i) => (
            <li key={i} data-state={i < stage ? 'done' : i === stage ? 'now' : 'todo'} aria-current={i === stage ? 'step' : undefined}>
              <i className="ld-dot" aria-hidden="true" />{t(`ld.s${i}`)}
            </li>
          ))}
        </ol>
        <ul className="ld-figs" aria-label={t('ld.figures')}>
          <Figure k="countries" target={stats?.countries ?? null} label={t('ld.cCountries')} />
          <Figure k="conflicts" target={stats?.conflicts ?? null} label={t('ld.cConflicts')} />
          <Figure k="edges" target={stats?.edges ?? null} label={t('ld.cEdges')} />
          <Figure k="events" target={stats?.events ?? null} label={t('ld.cEvents')} />
        </ul>
        <p id="loader-msg" className="ld-msg" role="status">{msg}</p>
        {failed ? <button className="btn primary" type="button" onClick={onRetry}>{t('retry')}</button>
          : stalled && <button className="ld-again" type="button" onClick={onRetry}>{t('ld.again')}</button>}
      </section>
    </div>
  );
}
