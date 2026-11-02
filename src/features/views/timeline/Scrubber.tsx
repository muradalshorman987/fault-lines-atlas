// The year scrubber band under the map. Time always runs left → right (the track carries dir="ltr");
// the controls around it follow the page direction. Loaded with the page; the full view is a lazy chunk (TimelineView.tsx).

import * as d3 from 'd3';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { emit } from '../../../app/events';
import { atlas, useAtlas } from '../../../app/store';
import { useDb, useT } from '../../../app/useT';
import type { Conflict, DB, TimelineEvent } from '../../../data/types';
import { esc, reducedMotion } from '../../../ui/dom';
import { Icon } from '../../../ui/Icon';
import { sevVar } from '../../../ui/palette';
import { hideTip, showTip } from '../../../ui/tooltip';
import { cls, rangeOf, SEV, useSize } from './shared';
import './strings';

type Mark = { kind: 'ev' | 'cf'; year: number };

function scrubModel(db: DB) {
  const [Y0, Y1] = rangeOf(db);
  const clampY = (y: number) => Math.max(Y0, Math.min(Y1, Math.round(y)));
  const evByYear = d3.group(db.timeline.events, (e) => e.year);
  const maxN = d3.max([...evByYear.values()], (v) => v.length) || 1;
  const cfByYear = d3.group(db.conflicts.filter((c): c is Conflict & { startYear: number } => !!c.startYear), (c) => clampY(c.startYear));
  return { Y0, Y1, RATE: (Y1 - Y0) / 12000, clampY, evByYear, maxN, cfByYear }; // the whole range plays in about 12 s
}

function scrubGeometry(m: ReturnType<typeof scrubModel>, W: number, H: number) {
  const { Y0, Y1 } = m;
  const B = Math.round(H - 25);
  const x = d3.scaleLinear([Y0, Y1 + 1], [7, W - 7]);
  const step = x(Y0 + 1) - x(Y0);
  const bw = Math.max(1, step - Math.min(2, step * 0.45));
  const histH = Math.max(8, B - 3);
  const every = step * 10 >= 40 ? 10 : step * 10 >= 20 ? 20 : 50;
  const decades = d3.range(Y0, Y1 + 1, 10).map((d) => ({ d, label: (d - Y0) % every === 0 }));
  const bars = [...m.evByYear].map(([y, list]) => {
    const bh = Math.max(2, (list.length / m.maxN) * histH);
    return { y, x: (x(y) + (step - bw) / 2).toFixed(2), top: (B - bh).toFixed(2), w: bw.toFixed(2), h: bh.toFixed(2), rx: Math.min(1.5, bw / 2).toFixed(2) };
  });
  const cfs = [...m.cfByYear].flatMap(([y, list]) => list.map((c, i) => ({ y, id: c.id, sev: c.severity, x: (x(y + 0.5) + (i - (list.length - 1) / 2) * 3 - 1).toFixed(2) })));
  return { W, H, B, x, decades, bars, cfs };
}

export function Scrubber() {
  const db = useDb();
  const { t, pick: L } = useT();
  const year = useAtlas((s) => s.year);
  const yearFilter = useAtlas((s) => s.yearFilter);
  const playing = useAtlas((s) => s.playing);
  const sel = useAtlas((s) => s.selection);
  const m = useMemo(() => scrubModel(db), [db]);
  const [trackRef, size] = useSize<HTMLDivElement>();
  const geo = useMemo(() => (size.w && size.h ? scrubGeometry(m, size.w, size.h) : null), [m, size]);
  const [hover, setHoverMark] = useState<Mark | null>(null);
  const live = useRef<{ hover: Mark | null; drag: { x0: number; mark: Mark | null; moving: boolean } | null }>({ hover: null, drag: null });
  const { Y0, Y1, clampY } = m;

  // ---- play: smooth frames, or a decade every 800 ms when the reader prefers reduced motion
  useEffect(() => {
    if (!playing) return;
    if (atlas.get().year >= Y1) atlas.set({ year: Y0 });
    if (reducedMotion()) {
      const timer = setInterval(() => {
        const next = Math.min(Y1, Math.floor(atlas.get().year / 10) * 10 + 10);
        atlas.set(next >= Y1 ? { year: Y1, playing: false } : { year: next });
      }, 800);
      return () => clearInterval(timer);
    }
    let yf = atlas.get().year, last = performance.now(), raf = 0;
    const tick = (now: number) => {
      const y0 = atlas.get().year;
      if (Math.floor(yf) !== y0) yf = y0; // someone else moved the cursor
      yf += (now - last) * m.RATE;
      last = now;
      if (yf >= Y1) { atlas.set({ year: Y1, playing: false }); return; }
      const y = Math.floor(yf);
      if (y !== y0) atlas.set({ year: y });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, m, Y0, Y1]);

  // the scrubber's own hover highlight must not outlive it
  useEffect(() => {
    const l = live.current;
    return () => { if (l.hover) emit('highlight', null); };
  }, []);

  const stopPlay = () => { if (atlas.get().playing) atlas.set({ playing: false }); };
  const listOf = (h: Mark): (TimelineEvent | Conflict)[] => (h.kind === 'ev' ? m.evByYear.get(h.year) : m.cfByYear.get(h.year)) ?? [];

  // nearest mark under the pointer; the knob itself always drags
  function hitTest(px: number, py: number): Mark | null {
    if (!geo) return null;
    const { x, B } = geo;
    if (Math.hypot(px - x(atlas.get().year + 0.5), py - B) <= 9) return null;
    const kind = py < B ? 'ev' : py <= B + 12 ? 'cf' : null;
    if (!kind) return null;
    const tol = Math.max(7, (x(Y0 + 1) - x(Y0)) * 0.75);
    let best = 0, bd = Infinity;
    for (const y of (kind === 'ev' ? m.evByYear : m.cfByYear).keys()) {
      const dist = Math.abs(x(y + 0.5) - px);
      if (dist < bd) { bd = dist; best = y; }
    }
    return bd <= tol ? { kind, year: best } : null;
  }

  function tipFor(h: Mark): string {
    const ev = h.kind === 'ev';
    const list = listOf(h);
    const rows = ev
      ? (list as TimelineEvent[]).slice(0, 6).map((o) => `<span class="tip-sub">${esc(L(o))}</span>`)
      : (list as Conflict[]).slice(0, 6).map((o) => `<span class="tip-sub">${esc(L(o.name))} · ${esc(L(SEV.get(o.severity)))}${(o.startYear ?? Y0) < Y0 ? ` · ${o.startYear}` : ''}</span>`);
    const more = list.length > 6 ? `<span class="tip-sub">${esc(t('sc.more', { n: list.length - 6 }))}</span>` : '';
    const s = atlas.get().selection, kind = ev ? 'event' : 'conflict';
    const again = list.length > 1 && s?.kind === kind && list.some((o) => o.id === s.id);
    return `<b>${h.year}</b> · ${esc(t(ev ? 'sc.events' : 'sc.began', { n: list.length }))}${rows.join('')}${more}<span class="tip-sub">${esc(t(again ? 'sc.pickNext' : 'sc.pick'))}</span>`;
  }

  /** Select the first record of that year; clicking the same year again walks through the rest. */
  function activate(h: Mark) {
    const ids = listOf(h).map((o) => o.id), kind = h.kind === 'ev' ? 'event' : 'conflict', s = atlas.get().selection;
    const j = s?.kind === kind ? ids.indexOf(s.id) : -1;
    const id = ids[(j + 1) % ids.length];
    if (id) atlas.select(kind, id);
  }

  function setHover(h: Mark | null, e: { clientX: number; clientY: number }) {
    const cur = live.current.hover;
    const same = !!h && !!cur && h.kind === cur.kind && h.year === cur.year;
    if (!same && (h || cur)) {
      live.current.hover = h;
      setHoverMark(h);
      emit('highlight', h ? { iso3: [...new Set(listOf(h).flatMap((o) => o.countries ?? []))] } : null);
    }
    if (h) showTip(tipFor(h), e.clientX, e.clientY);
    else if (!same) hideTip();
  }

  function setYearAt(px: number) {
    if (!geo) return;
    const y = clampY(Math.floor(geo.x.invert(px)));
    if (y !== atlas.get().year) atlas.set({ year: y });
  }

  const local = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !geo) return;
    const [px, py] = local(e), mark = hitTest(px, py);
    live.current.drag = { x0: e.clientX, mark, moving: !mark };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (!mark) { stopPlay(); hideTip(); setYearAt(px); }
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const [px, py] = local(e), drag = live.current.drag;
    if (drag) {
      if (!drag.moving && Math.abs(e.clientX - drag.x0) > 4) { drag.moving = true; drag.mark = null; setHover(null, e); stopPlay(); }
      if (drag.moving) setYearAt(px);
      return;
    }
    setHover(hitTest(px, py), e);
  }
  function onPointerUp() {
    const drag = live.current.drag;
    if (drag?.mark && !drag.moving) activate(drag.mark);
    live.current.drag = null;
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const y = atlas.get().year;
    const next = ({ ArrowRight: y + 1, ArrowUp: y + 1, ArrowLeft: y - 1, ArrowDown: y - 1, PageUp: y + 10, PageDown: y - 10, Home: Y0, End: Y1 } as Record<string, number>)[e.key];
    if (next == null) return;
    e.preventDefault();
    stopPlay();
    atlas.set({ year: clampY(next) });
  }

  const playLabel = t(playing ? 'sc.pause' : 'sc.play');
  const selYear = sel?.kind === 'event' ? db.eventById.get(sel.id)?.year : null;
  const future = (y: number) => yearFilter && y > year;

  return (
    <footer id="scrubber" className="sc">
      <button className={cls('btn icon sc-play', playing && 'is-playing')} type="button" aria-label={playLabel} data-tip={esc(playLabel)}
        onClick={() => atlas.set({ playing: !atlas.get().playing })}>
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <div className="sc-year"><span className="sc-year-l">{t('sc.year')}</span><output className="sc-year-v">{year}</output></div>
      <div ref={trackRef} className={cls('sc-track', hover && 'is-mark')} role="slider" tabIndex={0} dir="ltr"
        aria-valuemin={Y0} aria-valuemax={Y1} aria-label={t('sc.slider')} aria-valuenow={year}
        aria-valuetext={yearFilter ? `${year} — ${t('sc.filtered')}` : String(year)}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => { live.current.drag = null; }}
        onPointerLeave={(e) => { if (!live.current.drag) setHover(null, e); }}
        onKeyDown={onKeyDown}>
        <svg className="sc-svg" aria-hidden="true" viewBox={geo ? `0 0 ${geo.W} ${geo.H}` : undefined}>
          {geo && (
            <>
              <line className="sc-base" x1={geo.x(Y0)} x2={geo.x(Y1 + 1)} y1={geo.B + 0.5} y2={geo.B + 0.5} />
              {geo.decades.flatMap(({ d, label }) => [
                <line key={`t${d}`} className="sc-tick" x1={geo.x(d)} x2={geo.x(d)} y1={geo.B} y2={geo.B + 3} />,
                label ? <text key={`l${d}`} className="sc-lab" x={geo.x(d)} y={geo.H - 1} textAnchor={d === Y0 ? 'start' : 'middle'}>{d}</text> : null,
              ])}
              {geo.bars.map((b) => (
                <rect key={b.y} className={cls('sc-bar', future(b.y) && 'is-future', b.y === selYear && 'is-sel', hover?.kind === 'ev' && hover.year === b.y && 'is-hover')}
                  data-y={b.y} x={b.x} y={b.top} width={b.w} height={b.h} rx={b.rx} />
              ))}
              {geo.cfs.map((c) => {
                const on = (sel?.kind === 'conflict' && sel.id === c.id) || (hover?.kind === 'cf' && hover.year === c.y);
                return (
                  <rect key={c.id} className={cls('sc-cf', future(c.y) && 'is-future')} data-y={c.y} data-id={c.id}
                    x={c.x} y={on ? geo.B + 3 : geo.B + 4} width="2" height={on ? 9 : 6} style={{ fill: sevVar(c.sev) }} />
                );
              })}
              <g className="sc-handle" transform={`translate(${geo.x(year + 0.5).toFixed(2)},0)`}>
                <line className="sc-hline" y1="0" y2={geo.B + 13} /><circle className="sc-knob" cy={geo.B} r="5.5" />
              </g>
            </>
          )}
        </svg>
      </div>
      <button className="chip sc-filter" type="button" aria-label={t('sc.filter')} data-tip={esc(t('sc.filter'))} aria-pressed={yearFilter}
        onClick={() => atlas.set({ yearFilter: !atlas.get().yearFilter })}>
        <Icon name="filter" size={15} /><span className="sc-lbl">{t('sc.filter')}</span>
      </button>
      <button className="btn ghost sc-open" type="button" aria-label={t('sc.open')} data-tip={esc(t('sc.open'))} onClick={() => atlas.openView('timeline')}>
        <Icon name="clock" size={17} /><span className="sc-lbl">{t('sc.open')}</span>
      </button>
    </footer>
  );
}
