// Country Brief tab: KPI strip with rank badges, a benchmark line, "what stands out", latest open-data figures,
// nearby states, print and copy link. A component (not a plain render function) because the KPI values count up.

import { Fragment, type ReactNode } from 'react';
import { emit } from '../../../app/events';
import type { CountryFigureId, Figure } from '../../../data/figures';
import type { Country, Kind } from '../../../data/types';
import { BarList } from '../../../ui/charts';
import { copyText, esc } from '../../../ui/dom';
import { Icon } from '../../../ui/Icon';
import { useCountUp } from '../../../ui/motion';
import type { Kit } from '../parts';
import {
  benchOf, displacedOf, figureMd, gdpPerCapOf, involvement, kpiValue, popOf, rankOf, sourceOf, standouts,
  type KpiId, type Shown, type Standout,
} from './facts';
import './strings';
import '../brief.css';

/** "World Bank · 2024": the source-and-year chip every figure carries (D10). `source` null means Natural Earth. */
export function SrcChip({ k, source, srcId, year }: { k: Kit; source: string | null; srcId?: string | null; year: number | string | null | undefined }) {
  const s = source ?? k.t('dz.br.ne');
  const meta = sourceOf(k.db, srcId);
  const tip = meta ? k.t('dz.br.srcTip', { s: meta.name, l: meta.licence, d: k.fmt.date(meta.fetchedAt.slice(0, 10)) }) : null;
  return (
    <span className="br-src" data-tip={tip ? esc(tip) : undefined} tabIndex={tip ? 0 : undefined}>
      {k.t('dz.br.src', { s, y: year ?? '—' })}
    </span>
  );
}

function PrintIcon() {
  return (
    <svg className="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 9V3.5h10V9M7 17.5H4.5v-7A1.5 1.5 0 0 1 6 9h12a1.5 1.5 0 0 1 1.5 1.5v7H17M7 14h10v6.5H7z" />
    </svg>
  );
}

/** A number that counts up from zero (or from its last value); the final value is what assistive tech reads. */
function CountUp({ value, format }: { value: number; format: (v: number) => ReactNode }) {
  const v = useCountUp(value);
  return <><span aria-hidden="true">{format(v)}</span><span className="vh">{format(value)}</span></>;
}

interface Tile { id: KpiId; label: string; tip?: string; value: number | null; format: (v: number) => ReactNode; src: ReactNode }

function KpiTile({ tile, c, k }: { tile: Tile; c: Country; k: Kit }) {
  const { t, fmt } = k;
  const r = tile.value == null ? {} : rankOf(k.db, tile.id, c);
  const sub = k.ne(c.subregion);
  return (
    <div className="br-kpi" data-kpi={tile.id}>
      <dt className="br-kpi-l" data-tip={tile.tip ? esc(tile.tip) : undefined} tabIndex={tile.tip ? 0 : undefined}>
        {tile.label}{tile.tip ? <Icon name="info" size={12} /> : null}
      </dt>
      <dd className="br-kpi-v">{tile.value == null ? <span className="br-none">—</span> : <CountUp value={tile.value} format={tile.format} />}</dd>
      {tile.value != null ? <dd className="br-kpi-s">{tile.src}</dd> : null}
      {r.region || r.world ? (
        <dd className="br-ranks">
          {r.region ? (
            <span className="br-rank" data-scope="region" data-tip={esc(t('dz.br.rankRegionTip', { n: fmt.num(r.region.rank), of: fmt.num(r.region.of), sub }))}>
              {t('dz.br.rankRegion', { n: fmt.num(r.region.rank), of: fmt.num(r.region.of) })}
            </span>
          ) : null}
          {r.world ? (
            <span className="br-rank" data-scope="world" data-tip={esc(t('dz.br.rankWorldTip', { n: fmt.num(r.world.rank), of: fmt.num(r.world.of) }))}>
              {t('dz.br.rankWorld', { n: fmt.num(r.world.rank), of: fmt.num(r.world.of) })}
            </span>
          ) : null}
        </dd>
      ) : null}
    </div>
  );
}

const chip = (k: Kit, s: Shown | null) => (s ? <SrcChip k={k} source={s.source} srcId={s.srcId} year={s.year} /> : null);

function tiles(c: Country, k: Kit): Tile[] {
  const { t, fmt, db } = k;
  const pop = popOf(db, c), gdppc = gdpPerCapOf(db, c), displaced = displacedOf(db, c), rel = c.religion;
  const out: Tile[] = [
    { id: 'pop', label: t('dz.br.k.pop'), value: kpiValue(db, 'pop', c), format: (v) => k.numUnit(fmt.compact(v)), src: chip(k, pop) },
    { id: 'gdppc', label: t('dz.br.k.gdppc'), value: kpiValue(db, 'gdppc', c), format: (v) => k.numUnit(t('dz.u.usd', { v: fmt.num(v) })), src: chip(k, gdppc) },
    {
      id: 'diversity', label: t('dz.br.k.diversity'), tip: t('dz.br.k.diversityTip'), value: kpiValue(db, 'diversity', c),
      format: (v) => <span className="data">{fmt.num(v, 2)}</span>,
      src: rel?.source ? <SrcChip k={k} source={k.srcName(rel.source)} year={rel.year} /> : null,
    },
    {
      id: 'conflicts', label: t('dz.br.k.conflicts'), tip: t('dz.br.k.conflictsTip'), value: involvement(c),
      format: (v) => <span className="data">{fmt.num(Math.round(v))}</span>, src: null,
    },
  ];
  if (displaced) {
    out.push({
      id: 'displaced', label: t('dz.br.k.displaced'), tip: t('dz.br.k.displacedTip'), value: displaced.value,
      format: (v) => k.numUnit(fmt.compact(v)), src: chip(k, displaced),
    });
  }
  return out;
}

// ---- comparison lines: GDP per person against the group's own figure, the rest against the median (facts.benchOf)

function benchLines(c: Country, k: Kit): { kpi: KpiId; text: string }[] {
  const { t, fmt, db } = k;
  const word = (d: number) => (Math.abs(d) <= 2 ? t('dz.br.level') : t(d > 0 ? 'dz.br.above' : 'dz.br.below', { p: fmt.pct(Math.abs(d)) }));
  return (['gdppc', 'diversity', 'conflicts', 'displaced'] as const).flatMap((id) => {
    const b = benchOf(db, id, c);
    if (!b) return [];
    const base = b.kind === 'figure' ? 'dz.br.b.gdppc' : 'dz.br.b.med';
    const key = b.world != null && b.region != null ? base : b.world != null ? `${base}W` : `${base}R`;
    const vars = { k: t(`dz.br.bk.${id}`), w: b.world != null ? word(b.world) : '', r: b.region != null ? word(b.region) : '', sub: k.ne(c.subregion) };
    return [{ kpi: id, text: t(key, vars) }];
  });
}

// ---- what stands out

/** Fill a "{names}" slot in a translated sentence with linked records. */
function withNames(text: string, names: ReactNode): ReactNode {
  const [before, after] = text.split('{names}');
  return after === undefined ? text : <>{before}{names}{after}</>;
}

function links(k: Kit, kind: Kind, ids: string[], max = 2): ReactNode {
  const { db, lang, t } = k;
  const shown = ids.slice(0, max).map((id, i) => {
    const isos = db.countriesOf(kind, id);
    return (
      <Fragment key={id}>
        {i ? (lang === 'ar' ? '، ' : ', ') : null}
        <button type="button" className="br-link" data-sel-kind={kind} data-sel-id={id} data-hl={isos.length ? isos.join(' ') : undefined}>{db.nameOf(kind, id, lang)}</button>
      </Fragment>
    );
  });
  return <>{shown}{ids.length > max ? <>{' '}{t('dz.br.more', { n: k.fmt.num(ids.length - max) })}</> : null}</>;
}

function standoutLine(s: Standout, k: Kit): { icon: ReactNode; text: ReactNode } {
  const { t, fmt } = k;
  const slot = { names: '{names}' };
  switch (s.rule) {
    case 'war':
    case 'armed': {
      const key = `dz.br.so.${s.rule}${s.ids.length > 1 ? 's' : ''}`;
      return { icon: k.sevGlyph(s.rule === 'war' ? 'war' : 'armed-conflict', 14), text: withNames(t(key, slot), links(k, 'conflict', s.ids)) };
    }
    case 'external': {
      const key = s.n === 1 ? 'dz.br.so.ext1' : s.n === 2 ? 'dz.br.so.ext2' : 'dz.br.so.extN';
      return { icon: <Icon name="target" size={15} />, text: withNames(t(key, { ...slot, n: fmt.num(s.n) }), links(k, 'conflict', s.ids, 2)) };
    }
    case 'choke':
      return { icon: <Icon name="anchor" size={15} />, text: withNames(t(`dz.br.so.${s.status}`, slot), links(k, 'choke', s.ids)) };
    case 'top':
      return { icon: <Icon name={s.kpi === 'diversity' ? 'pie' : s.kpi === 'pop' ? 'people' : 'spark'} size={15} />, text: t(`dz.br.so.top.${s.kpi}`, { sub: k.ne(s.sub) }) };
    case 'displaced':
      return { icon: <Icon name="route" size={15} />, text: t('dz.br.so.displaced', { n: fmt.num(s.rank.rank), of: fmt.num(s.rank.of) }) };
    case 'blocs':
      return { icon: <Icon name="layers" size={15} />, text: withNames(t('dz.br.so.blocs', { ...slot, n: fmt.num(s.ids.length) }), links(k, 'bloc', s.ids, 3)) };
    case 'popRank':
      return { icon: <Icon name="people" size={15} />, text: t('dz.br.so.popRank', { n: fmt.num(s.rank.rank), of: fmt.num(s.rank.of) }) };
  }
}

// ---- latest figures (db.figures; renders nothing until M5 fills it)

const FIGURE_IDS: CountryFigureId[] = ['population', 'gdp', 'gdpPerCapita', 'refugeesFrom', 'refugeesIn', 'idps'];

/** The "Latest figures" block for one country, or null when the pipeline has nothing for it. */
export function latestFigures(c: Country, k: Kit): ReactNode {
  const { t, fmt, db } = k;
  const figs = db.figures.country(c.iso3);
  const value = (id: CountryFigureId, f: Figure) => {
    if (id === 'gdp') return k.numUnit(fmt.gdp(figureMd(f)));
    if (id === 'gdpPerCapita') return k.numUnit(t('dz.u.usd', { v: fmt.num(f.value) }));
    return k.numUnit(fmt.compact(f.value));
  };
  const rows = FIGURE_IDS.flatMap((id) => {
    const f = figs[id];
    if (!f || !Number.isFinite(f.value)) return [];
    return [(
      <div key={id} className="br-fig" data-fig={id}>
        <dt>{t(`dz.br.f.${id}`)}</dt>
        <dd><span className="br-fig-v">{value(id, f)}</span><SrcChip k={k} source={sourceOf(db, f.source)?.name ?? f.source} srcId={f.source} year={f.year} /></dd>
      </div>
    )];
  });
  if (!rows.length) return null;
  return k.sec(t('dz.br.latest'), [<dl key="l" className="br-figs">{rows}</dl>, k.note(t('dz.br.latestNote'))], { id: 'latest' });
}

// ---- the tab

export function CountryBrief({ c, k }: { c: Country; k: Kit }) {
  const { t, fmt, db, lang } = k;
  const bench = benchLines(c, k);
  const lines = standouts(db, c).map((s) => ({ s, ...standoutLine(s, k) }));

  const near = [c.iso3, ...c.neighbors].flatMap((iso) => {
    const x = db.countries.get(iso), p = x ? popOf(db, x)?.value : null;
    return x && p != null ? [{ iso, p, name: db.nameOf('country', iso, lang) }] : [];
  }).sort((a, b) => b.p - a.p);
  const nearRows = near.map(({ iso, p, name }) => {
    const self = iso === c.iso3;
    return {
      label: name, value: p, color: self ? 'var(--accent)' : 'var(--chart-bar)',
      valueLabel: k.numUnit(fmt.compact(p)),
      tip: `<b>${esc(fmt.compact(p))}</b> <span class="tip-sub">${esc(name)}</span>`,
      rowProps: self ? undefined : k.barRowProps(iso),
    };
  });

  const copy = () => { void copyText(location.href).then((ok) => emit('toast', t(ok ? 'dz.copied' : 'dz.copyFail'))); };

  return (
    <div className="br">
      <div className="br-tools">
        <button type="button" className="btn ghost br-tool" data-act="print" onClick={() => window.print()}><PrintIcon /><span>{t('dz.br.print')}</span></button>
        <button type="button" className="btn ghost br-tool" data-act="copylink" onClick={copy}><Icon name="link" size={16} /><span>{t('dz.br.copy')}</span></button>
      </div>
      {k.sec(t('dz.br.kpis'), [
        <dl key="k" className="br-kpis">{tiles(c, k).map((tile) => <KpiTile key={tile.id} tile={tile} c={c} k={k} />)}</dl>,
        bench.length ? <ul key="b" className="br-bench" role="list">{bench.map((b) => <li key={b.kpi} data-bench={b.kpi}>{b.text}</li>)}</ul> : null,
        k.note(t('dz.br.rankNote')),
      ], { cls: 'first', id: 'kpis' })}
      {k.sec(t('dz.br.standout'), lines.length ? (
        <ul className="br-out" role="list">
          {lines.map(({ s, icon, text }) => <li key={s.rule} data-rule={s.rule}><span className="br-out-g">{icon}</span><span>{text}</span></li>)}
        </ul>
      ) : null, { id: 'standout' })}
      {latestFigures(c, k)}
      {k.sec(t('dz.br.near'), nearRows.length > 1
        ? [<BarList key="n" rows={nearRows} swatch={false} />, k.note(`${t('dz.br.self', { name: db.nameOf('country', c.iso3, lang) })} ${t('dz.s.neighborsNote')}`)]
        : null, { id: 'near', count: c.neighbors.length })}
      <p className="br-print-foot">{t('dz.br.printed', { url: location.href })}</p>
    </div>
  );
}
