// "Start here" (spec 2026-11-02, "Clear destinations"): on the first visit a dialog offers four questions, World pulse
// and the guided tours, each card naming what it does (filter the map, or open a view). A visit that opens a share link
// skips it. emit('welcome', null) opens it again (the shell's Help dialog and command palette).
// Like the shell's overlays, it handles its own keys (Esc closes it) and stops them, so the global key map never sees them.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { emit, on } from '../../app/events';
import { atlas } from '../../app/store';
import { useDb, useT } from '../../app/useT';
import type { DB } from '../../data/types';
import { Icon } from '../../ui/Icon';
import { availableTours, stepsLabel } from '../tours/tours';
import './strings';
import './welcome.css';

export const WELCOME_KEY = 'atlas-v3-welcome-seen';

function seen(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return false; // storage blocked: every visit counts as the first, and closing still works for this one
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(WELCOME_KEY, '1');
  } catch {
    // storage blocked: the panel shows again on the next visit
  }
}

/** A share link (#country-SAU, #view-network …) says where the visitor wants to go; the default lens is no link. */
function opensLink(): boolean {
  const token = location.hash.replace(/^#/, '');
  return token !== '' && token !== 'lens-overview';
}

/** A sensible first comparison that exists in the data. */
function comparePair(db: DB): [string, string] | null {
  for (const [a, b] of [['SAU', 'IRN'], ['USA', 'CHN']] as const) if (db.countries.has(a) && db.countries.has(b)) return [a, b];
  return null;
}

/** Keep Tab inside the panel (every control is a button; hidden ones are skipped). */
function trapTab(root: HTMLElement | null, e: KeyboardEvent): void {
  if (!root) return;
  const all = [...root.querySelectorAll<HTMLElement>('button:not([disabled])')].filter((el) => !el.closest('[hidden]'));
  const first = all[0], last = all[all.length - 1];
  if (!first || !last) return;
  const inside = root.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
}

type Result = 'filter' | 'navigate';
interface Card { id: string; icon: string; result: Result; q: string; sub: string; cue: string; run: () => void }

function CardButton({ c, first }: { c: Card; first?: boolean }) {
  const { t } = useT();
  return (
    <button type="button" className={`wc-card${c.id === 'pulse' ? ' wc-pulse' : ''}`} data-k={'wc-' + c.id} data-result={c.result}
      data-first={first ? '' : undefined} aria-labelledby={`wc-q-${c.id}`} aria-describedby={`wc-s-${c.id} wc-c-${c.id}`} onClick={c.run}>
      <span className="wc-ic"><Icon name={c.icon} size={20} /></span>
      <span className="wc-q" id={`wc-q-${c.id}`}>{c.q}</span>
      <span className="wc-sub" id={`wc-s-${c.id}`}>{c.sub}</span>
      <span className="wc-cue" id={`wc-c-${c.id}`} data-result={c.result}>
        <Icon name={c.result === 'filter' ? 'filter' : 'chevron'} size={14} /><span>{t(c.cue)}</span>
      </span>
    </button>
  );
}

function WelcomeBox({ first, onClose }: { first: boolean; onClose: (then?: () => void) => void }) {
  const db = useDb();
  const { t, pick, lang } = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const tours = useMemo(() => availableTours(db), [db]);
  const pair = useMemo(() => comparePair(db), [db]);

  // While the panel is open the app and the tour card behind it are inert (the shell's overlays do the same).
  useLayoutEffect(() => {
    const behind = ['app', 'tour'].map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el && !el.hasAttribute('inert'));
    for (const el of behind) el.setAttribute('inert', '');
    boxRef.current?.querySelector<HTMLElement>('[data-first]')?.focus();
    return () => { for (const el of behind) el.removeAttribute('inert'); };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Tab') trapTab(boxRef.current, e);
  };

  const cards: Card[] = [
    { id: 'war', icon: 'flame', result: 'filter', q: t('wc.qWar'), sub: t('wc.qWarSub'), cue: 'wc.cueWar',
      run: () => onClose(() => atlas.set({ lens: 'conflicts', view: null })) },
    { id: 'blocs', icon: 'network', result: 'navigate', q: t('wc.qBlocs'), sub: t('wc.qBlocsSub'), cue: 'wc.cueNetwork',
      run: () => onClose(() => atlas.openView('network')) },
    { id: 'century', icon: 'clock', result: 'navigate', q: t('wc.qCentury'), sub: t('wc.qCenturySub'), cue: 'wc.cueTimeline',
      run: () => onClose(() => atlas.openView('timeline')) },
    { id: 'compare', icon: 'compare', result: 'navigate', q: t('wc.qCompare'), cue: 'wc.cueCompare',
      sub: pair ? t('wc.qCompareSub', { a: db.nameOf('country', pair[0], lang), b: db.nameOf('country', pair[1], lang) }) : t('wc.qCompareAny'),
      run: () => onClose(() => atlas.set({ view: 'compare', compare: pair ?? [null, null] })) },
  ];
  const pulse: Card = { id: 'pulse', icon: 'pulse', result: 'navigate', q: t('wc.pulse'), sub: t('wc.pulseSub'), cue: 'wc.cuePulse',
    run: () => onClose(() => atlas.openView('pulse')) };

  return (
    <div id="welcome" className={first ? 'is-first' : undefined}>
      <div className="wc-scrim" onClick={() => onClose()} />
      <div ref={boxRef} className="wc-box" role="dialog" aria-modal="true" aria-labelledby="wc-h" aria-describedby="wc-lede" tabIndex={-1} onKeyDown={onKeyDown}>
        <header className="wc-head">
          <h2 id="wc-h">{t('wc.title')}</h2>
          <button type="button" className="btn ghost icon" data-k="wc-close" aria-label={t('close')} onClick={() => onClose()}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="wc-body scroll">
          <p id="wc-lede" className="wc-lede">{t('wc.lede')}</p>
          <section className="wc-sec" aria-labelledby="wc-ask">
            <h3 id="wc-ask" className="eyebrow">{t('wc.ask')}</h3>
            <ul className="wc-cards">
              {cards.map((c, i) => <li key={c.id}><CardButton c={c} first={i === 0} /></li>)}
            </ul>
            <CardButton c={pulse} />
          </section>
          {tours.length > 0 && (
            <section className="wc-sec" aria-labelledby="wc-tours">
              <div className="wc-sechead">
                <h3 id="wc-tours" className="eyebrow">{t('wc.tours')}</h3>
                <span className="wc-cue" data-result="navigate"><Icon name="route" size={14} /><span>{t('wc.cueTour')}</span></span>
              </div>
              <ul className="wc-tours">
                {tours.map((tr) => (
                  <li key={tr.id}>
                    <button type="button" className="wc-tour" data-tour={tr.id} data-result="navigate"
                      aria-labelledby={`wc-t-${tr.id}`} aria-describedby={`wc-td-${tr.id}`}
                      onClick={() => onClose(() => emit('starttour', { id: tr.id, focus: true }))}>
                      <span className="wc-tic"><Icon name={tr.icon} size={16} /></span>
                      <span className="wc-ttxt">
                        <span className="wc-ttop"><span className="wc-tname" id={`wc-t-${tr.id}`}>{pick(tr)}</span><span className="wc-tn">{stepsLabel(tr.steps.length, lang)}</span></span>
                        <span className="wc-tdesc" id={`wc-td-${tr.id}`}>{pick(tr.desc)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <footer className="wc-foot">
          <p>{t('wc.later')}</p>
          <button type="button" className="btn primary" data-k="wc-explore" onClick={() => onClose()}>{t('wc.explore')}</button>
        </footer>
      </div>
    </div>
  );
}

export function Welcome() {
  const [open, setOpen] = useState(() => !seen() && !opensLink());
  const [first, setFirst] = useState(open);
  // Where focus goes back to; null for the first-visit panel, which nothing opened.
  const returnTo = useRef<Element | null>(null);

  useEffect(() => on('welcome', () => {
    if (document.getElementById('welcome')) return; // already open: keep the original return target
    returnTo.current = document.activeElement;
    setFirst(false);
    setOpen(true);
  }), []);

  /** Close, give focus back, then run the card's action (so a view or tour can take focus itself). */
  const close = (then?: () => void) => {
    markSeen();
    const back = returnTo.current;
    returnTo.current = null;
    flushSync(() => setOpen(false));
    if (back) {
      // The opener may be gone (the palette closes as it runs a command): fall back to the top bar's search, as the shell does.
      const el = back instanceof HTMLElement && back.isConnected && back !== document.body && !back.closest('[inert]') ? back
        : document.querySelector<HTMLElement>('#topbar [data-k="search"]');
      el?.focus();
    }
    then?.();
  };

  return open ? <WelcomeBox first={first} onClose={close} /> : null;
}
