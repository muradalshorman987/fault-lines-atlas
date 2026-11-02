// World pulse building blocks: read line, filter row, region strip, KPI tiles, needs attention, rankings, empty state.

import { useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { atlas } from '../../app/store';
import { useDb, useT } from '../../app/useT';
import { CHOKE_STATUS, DIMENSIONS, SEVERITY } from '../../config';
import { esc } from '../../ui/dom';
import { useCountUp } from '../../ui/motion';
import { Icon } from '../../ui/Icon';
import { sevVar } from '../../ui/palette';
import { Card, DataTable, tipHtml, VERB_ICON, type Verb } from './charts';
import type { AttnGroup, AttnItem, AttnRule, DimId, Pulse, RankRow, RankTab, RegionStrip as Strip } from './model';

type T = ReturnType<typeof useT>;

export const allSeverities = () => new Set<string>(SEVERITY.map((s) => s.id));
export const sevLabel = (T: T, id: string) => T.pick(SEVERITY.find((s) => s.id === id));
export const dimLabel = (T: T, id: string) => T.pick(DIMENSIONS[id as DimId]);

/** A count phrase: key.zero / key.one / key with {n}. */
function countOf(T: T, key: string, n: number, zero = false): string {
  return T.t(n === 0 && zero ? `${key}.zero` : n === 1 ? `${key}.one` : key, { n: T.fmt.num(n) });
}
/** "a, b and c" / «أ، ب وج» */
export function joinList(T: T, items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return items.slice(0, -1).join(T.t('pl.comma')) + T.t('pl.and') + items.at(-1);
}
/** The first `k` names, then "and n more". */
function someOf(T: T, items: string[], k: number): string {
  if (items.length <= k + 1) return joinList(T, items);
  return T.t('pl.a.more', { list: items.slice(0, k).join(T.t('pl.comma')), n: T.fmt.num(items.length - k) });
}

// ---------- read line

export function ReadLine({ P }: { P: Pulse }) {
  const T = useT();
  const { t } = T;
  const scope = t(P.following ? (P.filtered ? 'pl.scope.mapFiltered' : 'pl.scope.map') : (P.filtered ? 'pl.scope.filtered' : 'pl.scope.all'));
  const n = P.conflicts.length;
  let text: string;
  if (!n) text = t('pl.read.empty', { scope });
  else {
    const k = P.kpis;
    const regionName = (id: string) => T.pick(P.regions.find((r) => r.id === id)?.name);
    const withFiles = new Set(P.conflicts.map((c) => c.region)).size;
    const top = P.topRegions && withFiles > 1
      ? t(P.topRegions.ids.length > 1 ? 'pl.read.topTie' : 'pl.read.top', { region: joinList(T, P.topRegions.ids.map(regionName)), n: T.fmt.num(P.topRegions.n) })
      : '';
    const unv = k.unverified ? countOf(T, 'pl.read.unv', k.unverified) : '';
    text = t(k.wars || k.armed ? 'pl.read' : 'pl.read.noneViolent', {
      scope, files: countOf(T, 'pl.read.files', n),
      wars: countOf(T, 'pl.read.wars', k.wars, true), armed: countOf(T, 'pl.read.armed', k.armed, true), top, unv,
    });
  }
  return <p className="pl-read" aria-live="polite">{text}</p>;
}

// ---------- filter row (chips + "figures follow the map")

interface Chip { key: string; label: string; color?: string; remove: () => void }

export function FilterRow({ P, severity, region, inView, viewport, dimension, setDimension }: {
  P: Pulse; severity: ReadonlySet<string>; region: string | null; inView: boolean; viewport: readonly string[] | null;
  dimension: string | null; setDimension: (d: string | null) => void;
}) {
  const T = useT();
  const { t } = T;
  const chips: Chip[] = [];
  if (region) chips.push({ key: 'region', label: T.pick(P.regions.find((r) => r.id === region)?.name) || region, remove: () => atlas.setFilter('region', null) });
  const picked = SEVERITY.filter((s) => severity.has(s.id));
  if (picked.length !== SEVERITY.length) {
    if (picked.length && picked.length <= 3) {
      for (const s of picked) {
        chips.push({ key: `sev-${s.id}`, label: T.pick(s), color: sevVar(s.id), remove: () => {
          const next = new Set(severity);
          next.delete(s.id);
          atlas.setFilter('severity', next.size ? next : allSeverities());
        } });
      }
    } else chips.push({ key: 'sev', label: t('pl.f.sevSome', { n: picked.length, of: SEVERITY.length }), remove: () => atlas.setFilter('severity', allSeverities()) });
  }
  if (dimension) chips.push({ key: 'dim', label: t('pl.f.dim', { x: dimLabel(T, dimension) }), remove: () => setDimension(null) });
  const clearAll = () => {
    atlas.setFilter('region', null);
    atlas.setFilter('severity', allSeverities());
    setDimension(null);
  };
  return (
    <div className="pl-filters">
      <div className="pl-chips" role="group" aria-label={t('pl.f.label')}>
        <span className="pl-filters-h"><Icon name="filter" size={14} />{t('pl.f.label')}</span>
        {chips.length ? chips.map((c) => (
          <span className="chip pl-chip" key={c.key}>
            {c.color && <i className="sw" style={{ background: c.color }} />}
            <span>{c.label}</span>
            <button type="button" className="pl-chip-x" aria-label={t('pl.f.remove', { x: c.label })} onClick={c.remove}>
              <Icon name="close" size={12} />
            </button>
          </span>
        )) : <span className="pl-none">{t('pl.f.none')}</span>}
        {chips.length > 1 && <button type="button" className="btn ghost pl-clear" onClick={clearAll}>{t('pl.f.clearAll')}</button>}
      </div>
      <div className="pl-follow-wrap">
        <button type="button" className="btn pl-follow" aria-pressed={inView} data-tip={esc(T.t('pl.f.followTip'))}
          onClick={() => atlas.setFilter('inView', !inView)}>
          <span className="pl-switch" aria-hidden="true" />{t('pl.f.follow')}
        </button>
        {inView && <span className="pl-follow-note">{viewport ? t('pl.f.shown', { n: T.fmt.num(viewport.length) }) : t('pl.f.waiting')}</span>}
      </div>
    </div>
  );
}

// ---------- stat (count-up figure) and KPI tiles

function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const shown = useCountUp(value);
  return <span className="pl-fig" aria-hidden="true">{format(value === shown ? value : Math.round(shown))}</span>;
}

export interface TileSpec {
  k: string; label: string; value: number; icon: string; format?: (n: number) => string;
  /** Attention tone, always shown with the alert icon and a label. */
  attn?: { tone: 'warn' | 'critical'; label: string };
  verb: Verb; verbText: string; pressed?: boolean; onClick: () => void;
}

export function Tiles({ tiles }: { tiles: TileSpec[] }) {
  const { fmt } = useT();
  return (
    <div className="pl-tiles">
      {tiles.map((s) => {
        const format = s.format ?? ((n: number) => fmt.num(n));
        const shown = format(s.value);
        return (
          <button type="button" key={s.k} data-k={s.k} className={`pl-tile${s.attn ? ` is-${s.attn.tone}` : ''}`}
            aria-label={`${s.label}: ${shown}`} aria-pressed={s.pressed ?? undefined}
            data-tip={tipHtml(s.label, shown, s.verb, s.verbText)} onClick={s.onClick}>
            <span className="pl-tile-h"><Icon name={s.icon} size={16} /><span>{s.label}</span></span>
            <CountUp value={s.value} format={format} />
            {s.attn && <span className={`pill ${s.attn.tone} pl-tile-attn`}><Icon name="alert" size={12} />{s.attn.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------- region strip

export function RegionStrip({ strip, name }: { strip: Strip; name: string }) {
  const T = useT();
  const { t, fmt } = T;
  const stats: { k: string; label: string; value: ReactNode; aria: string }[] = [
    { k: 'n', label: t('pl.r.conflicts'), value: <CountUp value={strip.conflicts} format={(n) => fmt.num(n)} />, aria: fmt.num(strip.conflicts) },
    { k: 'c', label: t('pl.r.countries'), value: <CountUp value={strip.involved} format={(n) => fmt.num(n)} />, aria: fmt.num(strip.involved) },
    {
      k: 's', label: t('pl.r.top'), aria: strip.topSeverity ? sevLabel(T, strip.topSeverity) : '—',
      value: strip.topSeverity
        ? <span className="pl-fig pl-fig-text" aria-hidden="true"><i className="sw" style={{ background: sevVar(strip.topSeverity) }} />{sevLabel(T, strip.topSeverity)}</span>
        : <span className="pl-fig" aria-hidden="true">—</span>,
    },
    { k: 'p', label: t('pl.r.share'), value: <CountUp value={strip.share} format={(n) => fmt.pct(n)} />, aria: fmt.pct(strip.share) },
  ];
  return (
    <section className="pl-strip" aria-labelledby="pl-strip-h">
      <h3 id="pl-strip-h">{t('pl.r.title', { region: name })}</h3>
      <div className="pl-strip-stats">
        {stats.map((s) => (
          <div key={s.k} className="pl-stat" aria-label={`${s.label}: ${s.aria}`} role="group">
            <span className="pl-stat-l" aria-hidden="true">{s.label}</span>
            {s.value}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- needs attention

const RULE_ORDER: AttnRule[] = ['unverified', 'chokeLink', 'choke', 'external'];
const SHOWN = 3;

function why(T: T, db: ReturnType<typeof useDb>, it: AttnItem): string {
  const conflictName = (id: string) => db.nameOf('conflict', id, T.lang);
  const chokeName = (id: string) => db.nameOf('choke', id, T.lang);
  switch (it.rule) {
    case 'unverified': return T.t('pl.a.w.unverified', { sev: sevLabel(T, it.severity) });
    case 'chokeLink': return T.t('pl.a.w.chokeLink', { list: joinList(T, it.chokes.map(chokeName)) });
    case 'external': return T.t('pl.a.w.external', { n: T.fmt.num(it.powers.length), list: someOf(T, it.powers.map((iso) => db.nameOf('country', iso, T.lang)), 3) });
    case 'choke': {
      const parts = [
        it.flow != null ? T.t('pl.a.w.flow', { n: T.fmt.num(it.flow, 1) }) : '',
        it.conflicts.length ? T.t('pl.a.w.tied', { list: someOf(T, it.conflicts.map(conflictName), 2) }) : '',
      ].filter(Boolean);
      return `${T.pick(CHOKE_STATUS[it.status])}${parts.length ? `: ${parts.join(T.t('pl.comma'))}` : ''}.`;
    }
  }
}
const toneOf = (it: AttnItem): 'critical' | 'warn' =>
  (it.rule === 'choke' ? it.status === 'crisis' : it.rule === 'chokeLink' || (it.rule === 'unverified' && it.severity === 'war')) ? 'critical' : 'warn';

export function Attention({ groups, headingRef }: { groups: AttnGroup[]; headingRef: Ref<HTMLHeadingElement> }) {
  const T = useT();
  const db = useDb();
  const [open, setOpen] = useState<ReadonlySet<AttnRule>>(new Set());
  const shown = RULE_ORDER.map((r) => groups.find((g) => g.rule === r)).filter((g): g is AttnGroup => !!g && g.items.length > 0);
  return (
    <section className="pl-card pl-attn" id="pl-attn" aria-labelledby="pl-attn-h">
      <header className="pl-card-h">
        <h3 id="pl-attn-h" tabIndex={-1} ref={headingRef}><Icon name="alert" size={16} className="ic pl-attn-ic" />{T.t('pl.a.title')}</h3>
      </header>
      <p className="pl-note">{T.t('pl.a.sub')}</p>
      {!shown.length && <p className="empty">{T.t('pl.a.none')}</p>}
      {shown.map((g) => {
        const all = open.has(g.rule);
        const items = all ? g.items : g.items.slice(0, SHOWN);
        return (
          <section key={g.rule} className="pl-ag" data-group={g.rule} aria-labelledby={`pl-ag-${g.rule}`}>
            <h4 id={`pl-ag-${g.rule}`}><span>{T.t(`pl.a.g.${g.rule}`)}</span><span className="pl-ag-n num">{T.fmt.num(g.items.length)}</span></h4>
            <ul role="list">
              {items.map((it) => {
                const name = db.nameOf(it.kind, it.id, T.lang);
                const tone = toneOf(it);
                const data = { [`data-${it.kind}`]: it.id };
                return (
                  <li key={it.id}>
                    <button type="button" className={`pl-ai is-${tone}`} {...data} data-hl={it.isos.length ? it.isos.join(' ') : undefined}
                      data-tip={tipHtml(name, null, 'select', T.t('pl.v.select'))} onClick={() => atlas.select(it.kind, it.id)}>
                      <Icon name="alert" size={15} className="ic pl-ai-ic" />
                      <span className="pl-ai-body"><b>{name}</b><span className="pl-why">{why(T, db, it)}</span></span>
                      <Icon name={VERB_ICON.select} size={14} className="ic pl-cue" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {g.items.length > SHOWN && (
              <button type="button" className="btn ghost pl-more" aria-expanded={all}
                onClick={() => setOpen((s) => { const n = new Set(s); if (all) n.delete(g.rule); else n.add(g.rule); return n; })}>
                {all ? T.t('pl.showLess') : T.t('pl.showAll', { n: T.fmt.num(g.items.length) })}
              </button>
            )}
          </section>
        );
      })}
    </section>
  );
}

// ---------- hotspot rankings

const TOP = 10;

export function Rankings({ P, tab, setTab, headingRef }: {
  P: Pulse; tab: RankTab; setTab: (t: RankTab) => void; headingRef: Ref<HTMLHeadingElement>;
}) {
  const T = useT();
  const db = useDb();
  const { t, fmt } = T;
  const [all, setAll] = useState(false);
  const tabs: RankTab[] = P.hasDisplaced ? ['involvement', 'diversity', 'displaced'] : ['involvement', 'diversity'];
  const current = tabs.includes(tab) ? tab : 'involvement';
  const rows = P.rankings[current];
  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  const value = (v: number) => (current === 'diversity' ? fmt.num(v, 2) : current === 'displaced' ? fmt.compact(v) : fmt.num(v));
  // one line against the average of the rows listed: a percentage, or a multiple once it is more than double
  const verdict = (r: RankRow) => {
    if (r.vs == null) return '';
    if (Math.abs(r.vs) < 1) return t('pl.rk.at');
    if (r.vs >= 100) return t('pl.rk.times', { x: fmt.num(1 + r.vs / 100, 1) });
    return t(r.vs > 0 ? 'pl.rk.above' : 'pl.rk.below', { p: fmt.pct(Math.abs(r.vs)) });
  };
  const name = (iso: string) => db.nameOf('country', iso, T.lang);
  const shown = all ? rows : rows.slice(0, TOP);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key as 'ArrowRight' | 'ArrowLeft'];
    if (!step) return;
    e.preventDefault();
    const dir = T.lang === 'ar' ? -step : step;
    const next = tabs[(tabs.indexOf(current) + dir + tabs.length) % tabs.length]!;
    setTab(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };

  const table = (
    <DataTable caption={t(`pl.rk.t.${current}`)} head={[t('pl.col.country'), t('pl.col.rank'), t('pl.col.value'), t('pl.col.vs')]}
      rows={rows.map((r) => [name(r.iso), t('pl.rk.rank', { r: r.rank.rank, of: r.rank.of }), value(r.value), verdict(r) || '—'])} />
  );
  return (
    <Card id="pl-rank" title={t('pl.rk.title')} table={rows.length ? table : undefined} className="pl-rank">
      <h3 className="vh" tabIndex={-1} ref={headingRef}>{t(`pl.rk.t.${current}`)}</h3>
      <div className="tabs pl-tabs" role="tablist" aria-label={t('pl.rk.title')} onKeyDown={onKey}>
        {tabs.map((id) => (
          <button key={id} type="button" role="tab" data-tab={id} id={`pl-tab-${id}`} aria-controls="pl-rank-panel"
            aria-selected={id === current} tabIndex={id === current ? 0 : -1} onClick={() => { setTab(id); setAll(false); }}>
            {t(`pl.rk.t.${id}`)}<span className="n">{fmt.num(P.rankings[id].length)}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id="pl-rank-panel" aria-labelledby={`pl-tab-${current}`}>
        <p className="pl-note">{t(`pl.rk.n.${current}`)}</p>
        {!rows.length ? <p className="empty">{t('pl.rk.empty')}</p> : (
          <ol className="pl-rk" role="list">
            {shown.map((r) => (
              <li key={r.iso}>
                <button type="button" className="pl-rk-row" data-iso={r.iso} data-hl={r.iso}
                  data-tip={tipHtml(name(r.iso), value(r.value), 'select', t('pl.v.select'))} onClick={() => atlas.select('country', r.iso)}>
                  <span className="pl-rk-badge num">{t('pl.rk.rank', { r: fmt.num(r.rank.rank), of: fmt.num(r.rank.of) })}</span>
                  <span className="pl-rk-name">{name(r.iso)}</span>
                  <span className="pl-rk-val num">{value(r.value)}</span>
                  <span className="pl-bar-track pl-rk-track"><span className="pl-bar" style={{ inlineSize: `${(r.value / max) * 100}%` }} /></span>
                  <span className="pl-rk-verdict">
                    {verdict(r)}
                    {current === 'involvement' && r.party != null && r.ext != null && <> · {t('pl.rk.inv', { p: fmt.num(r.party), e: fmt.num(r.ext) })}</>}
                  </span>
                  <Icon name={VERB_ICON.select} size={14} className="ic pl-cue" />
                </button>
              </li>
            ))}
          </ol>
        )}
        {rows.length > TOP && (
          <button type="button" className="btn ghost pl-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? t('pl.showLess') : t('pl.showAll', { n: fmt.num(rows.length) })}
          </button>
        )}
      </div>
    </Card>
  );
}

// ---------- empty state

export function Empty({ region, regionName, severityAll, dimension, inView, setDimension }: {
  region: string | null; regionName: string; severityAll: boolean; dimension: string | null; inView: boolean; setDimension: (d: string | null) => void;
}) {
  const T = useT();
  const { t } = T;
  return (
    <div className="pl-empty empty" role="status">
      <p><b>{t('pl.e.title')}</b></p>
      <p>{t('pl.e.hint')}</p>
      <div className="pl-empty-acts">
        {region && <button type="button" className="btn" onClick={() => atlas.setFilter('region', null)}>{t('pl.e.region', { x: regionName })}</button>}
        {!severityAll && <button type="button" className="btn" onClick={() => atlas.setFilter('severity', allSeverities())}>{t('pl.e.sev')}</button>}
        {dimension && <button type="button" className="btn" onClick={() => setDimension(null)}>{t('pl.e.dim', { x: dimLabel(T, dimension) })}</button>}
        {inView && <button type="button" className="btn" onClick={() => atlas.setFilter('inView', false)}>{t('pl.e.view')}</button>}
      </div>
    </div>
  );
}
