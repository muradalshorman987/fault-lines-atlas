// World pulse view (#view-pulse, spec 2026-11-02 §Pulse): a read line, KPI tiles, distribution bars, the region × severity
// matrix, needs attention and hotspot rankings, all computed from the loaded model and the active filters (model.ts).
// Linking: anything with data-hl highlights those countries on the map while pointed at or focused; a click filters,
// selects or navigates, and its tooltip says which.

import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import { emit } from '../../app/events';
import { atlas, useAtlas } from '../../app/store';
import { useDb, useT } from '../../app/useT';
import { DIMENSIONS, SEVERITY } from '../../config';
import { reducedMotion } from '../../ui/dom';
import { sevVar } from '../../ui/palette';
import { Card, DataTable, DistBars, Matrix, type DistRow } from './charts';
import { computePulse, DIM_IDS, SEV_IDS, type RankTab } from './model';
import { allSeverities, Attention, dimLabel, Empty, FilterRow, ReadLine, RegionStrip, Rankings, sevLabel, Tiles, type TileSpec } from './parts';
import { useViewport } from './viewport';
import './strings';
import './pulse.css';

const THIS_YEAR = new Date().getFullYear();
const SINGLE = 'var(--cat-1)'; // one series per chart (region, dimension, ranking): slot 1, never coloured by value

const hlOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('[data-hl]')?.dataset.hl ?? null : null);
const leaves = (e: { currentTarget: Element; relatedTarget: EventTarget | null }) =>
  !(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget);

export function PulseView() {
  const db = useDb();
  const T = useT();
  const { t, fmt, pick } = T;
  const severity = useAtlas((s) => s.filters.severity);
  const region = useAtlas((s) => s.filters.region);
  const inView = useAtlas((s) => s.filters.inView);
  const viewport = useViewport();
  // Dimension has no shared filter key yet: it narrows this view only (not the map or the link).
  const [dimension, setDimension] = useState<string | null>(null);
  const [tab, setTab] = useState<RankTab>('involvement');
  const attnRef = useRef<HTMLHeadingElement>(null);
  const rankRef = useRef<HTMLHeadingElement>(null);

  const P = useMemo(() => computePulse(db, {
    severity, region, dimension, viewport: inView ? viewport : null, year: THIS_YEAR,
  }), [db, severity, region, dimension, inView, viewport]);

  // ---- map emphasis from pointing / focusing
  const hlKey = useRef<string | null>(null);
  const setHl = useCallback((key: string | null) => {
    if (key === hlKey.current) return;
    hlKey.current = key;
    emit('highlight', key ? { iso3: key.split(' ') } : null);
  }, []);
  useEffect(() => () => setHl(null), [setHl]);
  const hl = {
    onPointerOver: (e: PointerEvent<HTMLDivElement>) => setHl(hlOf(e.target)),
    onPointerOut: (e: PointerEvent<HTMLDivElement>) => { if (leaves(e)) setHl(null); },
    onFocus: (e: FocusEvent<HTMLDivElement>) => setHl(hlOf(e.target)),
    onBlur: (e: FocusEvent<HTMLDivElement>) => { if (leaves(e)) setHl(null); },
  };

  // ---- filter actions
  const allSev = SEV_IDS.every((id) => severity.has(id));
  const only = (id: string) => severity.size === 1 && severity.has(id);
  const pickSeverity = (id: string) => {
    if (allSev || !severity.has(id)) atlas.setFilter('severity', new Set([id]));
    else {
      const next = new Set(severity);
      next.delete(id);
      atlas.setFilter('severity', next.size ? next : allSeverities());
    }
  };
  const tileSeverity = (id: string) => atlas.setFilter('severity', only(id) ? allSeverities() : new Set([id]));
  const pickRegion = (id: string) => atlas.setFilter('region', region === id ? null : id);
  const pickCell = (sev: string, reg: string) => {
    if (region === reg && only(sev)) { atlas.setFilter('region', null); atlas.setFilter('severity', allSeverities()); return; }
    atlas.setFilter('region', reg);
    atlas.setFilter('severity', new Set([sev]));
  };
  // scroll a section of this view into sight and put focus on its heading (tile navigation)
  const go = (to: 'attn' | 'rank') => {
    const el = to === 'attn' ? attnRef.current : rankRef.current;
    const section = el?.closest('section');
    // scroll only the view's own scroller: scrollIntoView would also scroll the clipped panel card and hide its header
    const scroller = el?.closest<HTMLElement>('.scroll');
    if (section && scroller) {
      const top = scroller.scrollTop + section.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
      scroller.scrollTo?.({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    el?.focus({ preventScroll: true });
  };

  // ---- KPI tiles
  const k = P.kpis;
  const goText = (where: string) => t('pl.v.go', { where: t(where) });
  const tiles: TileSpec[] = [
    { k: 'wars', label: t('pl.k.wars'), value: k.wars, icon: 'flame', pressed: only('war'),
      verb: only('war') ? 'unfilter' : 'filter', verbText: t(only('war') ? 'pl.v.unfilter' : 'pl.v.filter'), onClick: () => tileSeverity('war') },
    { k: 'armed', label: t('pl.k.armed'), value: k.armed, icon: 'target', pressed: only('armed-conflict'),
      verb: only('armed-conflict') ? 'unfilter' : 'filter', verbText: t(only('armed-conflict') ? 'pl.v.unfilter' : 'pl.v.filter'),
      onClick: () => tileSeverity('armed-conflict') },
    { k: 'external', label: t('pl.k.external'), value: k.external, icon: 'network', verb: 'go', verbText: goText('pl.go.rank'),
      onClick: () => { setTab('involvement'); go('rank'); } },
    { k: 'choke', label: t('pl.k.choke'), value: k.chokes, icon: 'anchor', verb: 'go', verbText: goText('pl.go.choke'),
      attn: k.chokeCrisis ? { tone: 'critical', label: t('pl.k.crisis') } : k.chokes ? { tone: 'warn', label: t('pl.k.attn') } : undefined,
      onClick: () => atlas.set({ lens: 'chokepoints', view: null }) },
    { k: 'unverified', label: t('pl.k.unverified'), value: k.unverified, icon: 'info', verb: 'go', verbText: goText('pl.go.attn'),
      attn: k.unverified ? { tone: 'warn', label: t('pl.k.attn') } : undefined, onClick: () => go('attn') },
    { k: 'decade', label: t('pl.k.decade', { y: k.decadeFrom }), value: k.decade, icon: 'clock', verb: 'go', verbText: goText('pl.go.timeline'),
      onClick: () => atlas.openView('timeline') },
    // displaced people (M5 figures): only once the pipeline has data
    ...(k.displaced != null ? [{
      k: 'displaced', label: t('pl.k.displaced'), value: k.displaced, icon: 'people', format: (n: number) => fmt.compact(n),
      verb: 'go' as const, verbText: goText('pl.go.rankDisplaced'), onClick: () => { setTab('displaced'); go('rank'); },
    }] : []),
  ];

  // ---- distributions
  const regionName = (id: string) => pick(P.regions.find((r) => r.id === id)?.name) || id;
  const share = (n: number, total: number) => fmt.pct(total ? (n / total) * 100 : 0);
  const sevRows: DistRow[] = P.bySeverity.map((b) => ({ id: b.id, label: sevLabel(T, b.id), n: b.n, isos: b.isos, color: sevVar(b.id), swatch: true, active: !allSev && severity.has(b.id) }));
  const regRows: DistRow[] = P.byRegion.map((b) => ({ id: b.id, label: regionName(b.id), n: b.n, isos: b.isos, color: SINGLE, active: region === b.id }));
  const dimRows: DistRow[] = P.byDimension.map((b) => ({ id: b.id, label: dimLabel(T, b.id), n: b.n, isos: b.isos, color: SINGLE, active: dimension === b.id }));
  const sevTotal = P.bySeverity.reduce((s, b) => s + b.n, 0);
  const regTotal = P.byRegion.reduce((s, b) => s + b.n, 0);

  const sevCols = SEVERITY.map((s) => ({ id: s.id, label: pick(s), color: sevVar(s.id) }));
  const regCols = P.regions.map((r) => ({ id: r.id, label: pick(r.name) }));
  const cell = (sev: string, reg: string) => P.matrix[sev]?.[reg] ?? { id: '', n: 0, isos: [] };
  const anyCellFilter = !!region || !allSev;
  const mark = (sev: string, reg: string) => ({
    pressed: region === reg && only(sev),
    dim: anyCellFilter && !((!region || region === reg) && (allSev || severity.has(sev))),
  });

  const empty = !P.conflicts.length;
  return (
    <div className="pulse" {...hl}>
      <ReadLine P={P} />
      <FilterRow P={P} severity={severity} region={region} inView={inView} viewport={viewport} dimension={dimension} setDimension={setDimension} />
      {P.strip && <RegionStrip strip={P.strip} name={regionName(P.strip.id)} />}
      {empty
        ? <Empty region={region} regionName={region ? regionName(region) : ''} severityAll={allSev} dimension={dimension} inView={inView} setDimension={setDimension} />
        : <Tiles tiles={tiles} />}

      <div className="pl-grid">
        <div className="pl-area-attn">
          {!empty && <Attention groups={P.attention} headingRef={attnRef} />}
        </div>
        <div className="pl-area-dist">
          <Card id="pl-sev" title={t('pl.c.sev')} note={t('pl.c.selfNote')}
            table={<DataTable caption={t('pl.c.sev')} head={[t('pl.col.sev'), t('pl.col.count'), t('pl.col.share')]}
              rows={P.bySeverity.map((b) => [sevLabel(T, b.id), fmt.num(b.n), share(b.n, sevTotal)])} />}>
            <DistBars rows={sevRows} label={t('pl.c.sev')} attr="sev" anyActive={!allSev} onPick={pickSeverity} />
          </Card>
          <Card id="pl-region" title={t('pl.c.region')}
            table={<DataTable caption={t('pl.c.region')} head={[t('pl.col.region'), t('pl.col.count'), t('pl.col.share')]}
              rows={P.byRegion.map((b) => [regionName(b.id), fmt.num(b.n), share(b.n, regTotal)])} />}>
            <DistBars rows={regRows} label={t('pl.c.region')} attr="region" anyActive={!!region} onPick={pickRegion} />
          </Card>
          <Card id="pl-dim" title={t('pl.c.dim')} note={t('pl.c.dimNote')}
            table={<DataTable caption={t('pl.c.dim')} head={[t('pl.col.dim'), t('pl.col.count')]}
              rows={DIM_IDS.map((id) => [pick(DIMENSIONS[id]), fmt.num(P.byDimension.find((b) => b.id === id)?.n ?? 0)])} />}>
            <DistBars rows={dimRows} label={t('pl.c.dim')} attr="dim" anyActive={!!dimension} onPick={(id) => setDimension(dimension === id ? null : id)} />
          </Card>
        </div>
        <div className="pl-area-mx">
          <Card id="pl-matrix" title={t('pl.c.matrix')} note={t('pl.c.matrixNote')}
            table={<DataTable caption={t('pl.c.matrix')} head={[t('pl.col.sev'), ...regCols.map((c) => c.label), t('pl.col.total')]}
              rows={sevCols.map((s) => [s.label, ...regCols.map((r) => fmt.num(cell(s.id, r.id).n)), fmt.num(regCols.reduce((n, r) => n + cell(s.id, r.id).n, 0))])}
              foot={[t('pl.col.total'), ...regCols.map((r) => fmt.num(sevCols.reduce((n, s) => n + cell(s.id, r.id).n, 0))),
                fmt.num(sevCols.reduce((n, s) => n + regCols.reduce((m, r) => m + cell(s.id, r.id).n, 0), 0))]} />}>
            <Matrix label={t('pl.c.matrix')} rows={sevCols} cols={regCols} cell={cell} max={P.matrixMax} mark={mark} onPick={pickCell} />
          </Card>
        </div>
        <div className="pl-area-rank">
          <Rankings P={P} tab={tab} setTab={setTab} headingRef={rankRef} />
        </div>
      </div>
    </div>
  );
}
