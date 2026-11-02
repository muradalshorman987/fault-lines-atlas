// The body of the full swimlane timeline view (#view-timeline), loaded on demand; the view host renders the panel frame.
// Time always runs left → right (the plot carries dir="ltr"); the controls around it follow the page direction.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { emit } from '../../../app/events';
import { atlas, useAtlas } from '../../../app/store';
import { useDb, useT } from '../../../app/useT';
import { SEVERITY } from '../../../config';
import type { Conflict, DB } from '../../../data/types';
import { esc } from '../../../ui/dom';
import { Icon } from '../../../ui/Icon';
import { isDark } from '../../../ui/palette';
import { hideTip } from '../../../ui/tooltip';
import { catColor, chartLayout, createChart, datePos, AX, type Cat, type Chart, type ConfRow, type Ev, type EvRow, type VisRow, type ZoomCmd } from './chart';
import { SevIcon, UvMark } from './marks';
import { cls, rangeOf, SEV, useMedia, useSize } from './shared';
import './strings';

function viewModel(db: DB) {
  const [Y0, Y1] = rangeOf(db);
  const cats = db.timeline.categories as Cat[];
  const catById = db.timeline.catById as Map<string, Cat>;
  const evs: EvRow[] = (db.timeline.events as Ev[]).map((e) => ({ e, pos: datePos(e.date) }));
  const confs: ConfRow[] = db.conflicts.filter((c): c is Conflict & { startYear: number } => !!c.startYear)
    .map((c) => ({ c, pos: datePos(c.started), pre: c.startYear < Y0 }))
    .sort((a, b) => a.pos - b.pos || b.c.rank - a.c.rank);
  return { Y0, Y1, cats, catById, evs, confs, today: datePos(db.conflictsAsOf) };
}

// The chevron of the "earlier" button points back in time (left), whatever the page direction.
const BACK: CSSProperties = { transform: 'scaleX(-1)' };

/** The body of the full timeline view; the view host renders the panel frame around it. */
export function TimelineView() {
  const db = useDb();
  const { t, pick: L, pickKey: Lk, fmt } = useT();
  const theme = useAtlas((s) => s.theme);
  const on = useAtlas((s) => s.filters.timelineCats);
  const selection = useAtlas((s) => s.selection);
  const narrow = useMedia('(max-width: 760px)');
  const [coarse] = useState(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  const dark = theme === 'system' ? isDark() : theme === 'dark';
  const LANE = narrow ? 26 : 30;

  const md = useMemo(() => viewModel(db), [db]);
  const { Y0, Y1, cats, catById, confs } = md;
  const lanes = useMemo(() => cats.filter((c) => !on || on.has(c.id)), [cats, on]);
  const { laneOf, vis } = useMemo(() => {
    const laneOf = new Map(lanes.map((c, i) => [c.id, i]));
    const vis: VisRow[] = [];
    for (const d of md.evs) {
      const act = d.e.cat.filter((c) => laneOf.has(c));
      if (act[0] != null) vis.push({ ...d, lane: laneOf.get(act[0]) ?? 0, cat: act[0], extra: act.slice(1) });
    }
    return { laneOf, vis };
  }, [md, lanes]);
  const { confTop, H } = chartLayout(LANE, lanes.length, confs.length);
  const color = (c: Cat | undefined) => catColor(c, dark);

  const [plotRef, plot] = useSize<HTMLDivElement>();
  const W = plot.w;
  const svgRef = useRef<SVGSVGElement>(null);
  const chart = useRef<Chart | null>(null);
  const live = useRef({ hover: null as string | null, revealed: false });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [domain, setDomain] = useState<[number, number] | null>(null);

  const hoverEvent = useCallback((id: string | null) => {
    if (id === live.current.hover) return;
    live.current.hover = id;
    setHoverId(id);
    emit('highlight', id ? { iso3: db.eventById.get(id)?.countries ?? [] } : null);
  }, [db]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el || !W) return;
    const uvLine = (kind: 'event' | 'conflict', id: string) => (db.isUnverified(kind, id) ? `<span class="tip-sub">${esc(t('vw.uv'))}</span>` : '');
    const c = createChart(el, {
      W, lane: LANE, nLanes: lanes.length, laneOf, vis, confs, Y0, Y1, today: md.today,
      color: (id) => catColor(catById.get(id), dark),
      isUv: (id) => db.isUnverified('event', id),
      noCats: t('tl.noCats'),
      evTip: (e) => `<b>${esc(L(e))}</b><span class="tip-sub">${esc(fmt.date(e.date))} · ${esc(e.cat.map((k) => L(catById.get(k))).join('، '))}</span><span class="tip-sub">${esc(Lk(e, 'sum'))}</span>${uvLine('event', e.id)}`,
      confTip: (k) => `<b>${esc(L(k.name))}</b><span class="tip-sub">${esc(L(SEV.get(k.severity)))} · ${esc(t('tl.since', { d: fmt.date(k.started) }))}</span>${uvLine('conflict', k.id)}`,
      label: (e) => L(e),
      hoverId: () => live.current.hover,
      onHoverEvent: hoverEvent,
      onView: (d0, d1) => setDomain([d0, d1]),
    });
    chart.current = c;
    if (!live.current.revealed) { live.current.revealed = true; c.reveal(); }
    return () => { c.destroy(); chart.current = null; };
  }, [db, md, W, LANE, lanes.length, laneOf, vis, confs, Y0, Y1, catById, dark, t, L, Lk, fmt, hoverEvent]);

  useEffect(() => { chart.current?.drawFocus(); }, [selection, hoverId]);
  useEffect(() => { chart.current?.reveal(); }, [selection]);
  // The year changes up to 10 times a second while the scrubber plays: move the cursor without re-rendering the view.
  useEffect(() => useAtlas.subscribe((s, prev) => { if (s.year !== prev.year) chart.current?.moveCursor(); }), []);
  useEffect(() => {
    const l = live.current;
    return () => { hideTip(); if (l.hover) emit('highlight', null); };
  }, []);

  // ---- events in view (keyboard and screen-reader route to every dot)
  const [d0, d1] = domain ?? [Y0, Y1 + 1];
  const rows = useMemo(() => vis.filter((d) => d.pos >= d0 && d.pos < d1).sort((a, b) => a.pos - b.pos), [vis, d0, d1]);
  const selId = selection?.kind === 'event' ? selection.id : null;
  const rowHover = (target: EventTarget) => {
    const b = (target as Element).closest?.<HTMLElement>('.tl-row');
    hoverEvent(b?.dataset.id ?? null);
  };

  // ---- category chips (filters.timelineCats, shared with the map's history lens)
  const allOn = !on || cats.every((c) => on.has(c.id));
  const count = (id: string) => md.evs.filter((d) => d.e.cat.includes(id)).length;
  const zoomBtn = (z: ZoomCmd, label: string, icon: string) => (
    <button className="btn icon" type="button" data-z={z} aria-label={label} data-tip={esc(label)} onClick={() => chart.current?.zoom(z)}>
      <Icon name={icon} size={16} style={z === 'earlier' ? BACK : undefined} />
    </button>
  );
  const catNames = (e: Ev) => e.cat.map((c) => L(catById.get(c))).join('، ');

  return (
    <div className="tl">
      <div className="vw-filters">
        <div className="vw-fgroup">
          <span className="eyebrow" id="tl-cats-l">{t('tl.cats')}</span>
          <div className="chips tl-cats" role="group" aria-labelledby="tl-cats-l">
            <button className="chip" type="button" data-all="" aria-pressed={allOn}
              onClick={() => atlas.setFilter('timelineCats', new Set(allOn ? [] : cats.map((c) => c.id)))}>{t('tl.all')}</button>
            {cats.map((c) => (
              <button key={c.id} className="chip" type="button" data-cat={c.id} aria-pressed={!on || on.has(c.id)} onClick={() => atlas.toggleInSet('timelineCats', c.id)}>
                <i className="sw" style={{ background: color(c) }} />{L(c)}<span className="n">{count(c.id)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="tl-tools">
        <p className="tl-hint">{t(coarse ? 'tl.hintTouch' : 'tl.hint')}</p>
        <span className="tl-range num">{`${Math.max(Y0, Math.floor(d0))}–${Math.min(Y1, Math.floor(d1 - 1e-6))}`}</span>
        <div className="tl-zoom" dir="ltr">
          {zoomBtn('earlier', t('tl.earlier'), 'chevron')}
          {zoomBtn('later', t('tl.later'), 'chevron')}
          {zoomBtn('out', t('tl.out'), 'minus')}
          {zoomBtn('in', t('tl.in'), 'plus')}
          <button className="btn" type="button" data-z="reset" onClick={() => chart.current?.zoom('reset')}><Icon name="home" size={15} /><span>{t('tl.reset')}</span></button>
        </div>
      </div>
      <div className="tl-chart">
        <div className="tl-labels" aria-hidden="true" style={{ blockSize: `${H}px` }}>
          {lanes.map((c, i) => (
            <div key={c.id} className="tl-lane-l" style={{ insetBlockStart: `${AX + i * LANE}px`, blockSize: `${LANE}px` }}>
              <i className="sw" style={{ background: color(c) }} /><span>{L(c)}</span>
            </div>
          ))}
          <div className="tl-conf-l" style={{ insetBlockStart: `${confTop - 4}px` }}>{t('tl.conflicts')}</div>
        </div>
        <div className="tl-plot" dir="ltr" ref={plotRef}>
          <svg className="tl-svg" role="img" aria-label={t('tl.chart', { a: Y0, b: Y1 })} ref={svgRef} />
        </div>
      </div>
      <div className="tl-foot">
        <div className="tl-foot-g"><span className="eyebrow">{t('tl.events')}</span>
          <ul className="vw-legend">
            <li><svg className="sev-ic" width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true"><circle r="5" className="tl-key-uv" /></svg>{t('tl.uvDot')}</li>
            <li><svg className="sev-ic" width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true"><circle r="2.6" className="tl-key-sat" /></svg>{t('tl.satDot')}</li>
          </ul>
        </div>
        <div className="tl-foot-g"><span className="eyebrow">{t('tl.severity')}</span>
          <ul className="vw-legend">
            {SEVERITY.filter((s) => confs.some((d) => d.c.severity === s.id)).map((s) => <li key={s.id}><SevIcon id={s.id} />{L(s)}</li>)}
          </ul>
        </div>
      </div>
      <div className="caveat"><Icon name="info" size={16} /><p><b>{t('tl.borders')}</b> {L(db.timeline.boundaryLimitation)}</p></div>
      <section className="tl-list" aria-labelledby="tl-list-h">
        <h3 className="vw-h3" id="tl-list-h">{t('tl.inView')} <span className="n">{rows.length}</span></h3>
        <ol className="tl-rows" onPointerOver={(e) => rowHover(e.target)} onFocus={(e) => rowHover(e.target)} onPointerLeave={() => hoverEvent(null)}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hoverEvent(null); }}>
          {rows.length ? rows.map(({ e }) => (
            <li key={e.id}>
              <button className={cls('tl-row', e.id === hoverId && 'is-hover')} type="button" data-id={e.id} aria-current={e.id === selId ? 'true' : undefined}
                onClick={() => atlas.select('event', e.id)}>
                <span className="tl-row-d">{fmt.date(e.date)}</span>
                <span className="tl-row-n">{L(e)}</span>
                <span className="tl-row-c">
                  {e.cat.map((c) => <i key={c} className="sw" style={{ background: color(catById.get(c)) }} data-tip={esc(L(catById.get(c)))} />)}
                  <span className="vh">{catNames(e)}</span>
                </span>
              </button>
              <UvMark kind="event" id={e.id} />
            </li>
          )) : <li className="empty">{t(vis.length ? 'tl.noneInView' : 'tl.noCats')}</li>}
        </ol>
      </section>
    </div>
  );
}
