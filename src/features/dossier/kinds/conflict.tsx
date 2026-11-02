// Conflict dossier: status, parties, roots and related tabs.

import { DIMENSIONS } from '../../../config';
import { Icon } from '../../../ui/Icon';
import { extPowers, pickList, type ChokeX, type ConflictX, type EventX, type Panel, type ResEntryX } from '../model';
import type { Kit } from '../parts';
import { DeathsChart } from '../brief/Deaths';

const DIMS: Record<string, { ar: string; en: string }> = DIMENSIONS;

function relatedOf(cf: ConflictX, k: Kit) {
  const { db } = k;
  return {
    events: (cf.events ?? []).map((id) => db.eventById.get(id) as EventX | undefined).filter((e) => !!e),
    chokes: (cf.chokepoints ?? []).map((id) => db.chokeById.get(id) as ChokeX | undefined).filter((p) => !!p),
    res: (db.resources.entries as ResEntryX[]).filter((e) => (e.conflictIds ?? []).includes(cf.id)),
    refs: cf.sourceRefs ?? [],
  };
}
type Related = ReturnType<typeof relatedOf>;

export function conflictPanel(id: string, k: Kit): Panel | null {
  const cf = k.db.conflictById.get(id) as ConflictX | undefined;
  if (!cf) return null;
  const { t, pick: L, fmt, db } = k;
  const plate = [k.altSpan(cf)];
  if (cf.started) plate.push(<span>{t('dz.cf.started')}{' '}<bdi className="dz-when">{fmt.date(cf.started)}</bdi></span>);
  if (cf.currentPhaseStarted) plate.push(<span>{t('dz.cf.phase')}{' '}<bdi className="dz-when">{fmt.date(cf.currentPhaseStarted)}</bdi></span>);
  const rel = relatedOf(cf, k);
  return {
    head: {
      region: L(cf.regionName), title: L(cf.name), plate,
      badges: [k.sevPill(cf.severity), k.confPill(cf)],
      // The as-of stamp stays prominent: current-status fields are not independently verified by this edition.
      extra: (
        <div className="dz-asof-row">
          <p className="dz-asof"><Icon name="clock" size={14} /><span>{t('dz.cf.asOf', { d: fmt.date(cf.statusAsOf || db.conflictsAsOf) })}</span></p>
          {k.unverifiedPill('conflict', cf.id)}
        </div>
      ),
    },
    tabs: [
      { id: 'status', label: t('dz.cf.t.status'), render: () => status(cf, k) },
      { id: 'parties', label: t('dz.cf.t.parties'), count: pickList(k, cf.parties).length, render: () => parties(cf, k) },
      { id: 'roots', label: t('dz.cf.t.roots'), render: () => roots(cf, k) },
      { id: 'related', label: t('dz.cf.t.related'), count: rel.events.length + rel.chokes.length + rel.res.length + rel.refs.length, render: () => related(rel, k) },
    ],
  };
}

function status(cf: ConflictX, k: Kit) {
  const { t, pick: L, fmt } = k;
  const recent = [...(cf.recent ?? [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const list = recent.length
    ? (
      <ol className="dz-tl dz-tl-static" role="list">
        {recent.map((r, i) => (
          <li key={`${r.date}:${i}`}><div className="dz-tl-item">
            <span className="dz-date">{fmt.date(r.date)}</span>
            <p className="dz-prose sm">{L(r)}</p>
            {r.source ? <span className="dz-src">{t('dz.sourceOf', { s: r.source })}</span> : null}
          </div></li>
        ))}
      </ol>
    )
    : k.empty(t('dz.cf.noRecent'));
  const deaths = k.db.figures.conflictDeaths(cf.id);
  return <>
    {k.sec(t('dz.cf.now'), k.prose(L(cf.status)), { cls: 'first' })}
    {deaths.length ? k.sec(t('dz.br.d.title'), <DeathsChart series={deaths} k={k} />, { id: 'deaths' }) : null}
    {k.sec(t('dz.cf.recent'), list, { count: recent.length || null })}
  </>;
}

function parties(cf: ConflictX, k: Kit) {
  const { t, pick: L } = k;
  const ps = pickList(k, cf.parties);
  const eps = extPowers(cf);
  const epRows = eps.map((e) => (
    <div key={e.iso3} className="dz-ep" data-hl={e.iso3}>
      <div className="dz-rel-h">{k.cchip(e.iso3)}{e.kind ? k.kindPill(e.kind) : null}</div>
      {k.prose(L(e.role), { clamp: false, cls: 'sm' })}
    </div>
  ));
  return <>
    {k.sec(t('dz.cf.parties'), ps.length ? <ol className="dz-parties" role="list">{ps.map((p, i) => <li key={i}>{p}</li>)}</ol> : k.empty(t('dz.none')), { count: ps.length, cls: 'first' })}
    {k.sec(t('dz.cf.externals'), eps.length ? k.rows(epRows) : k.empty(t('dz.cf.noExternals')), { count: eps.length })}
    {k.sec(t('dz.cf.countries'), k.cchips(cf.countries))}
  </>;
}

function roots(cf: ConflictX, k: Kit) {
  const { t, pick: L } = k;
  const dims = (cf.dimensions ?? []).map((d) => <span key={d} className="pill">{L(DIMS[d]) || d}</span>);
  const ethno = L(cf.ethnoReligious);
  return <>
    {k.sec(t('dz.cf.dims'), [dims.length ? <div className="chips dz-chips">{dims}</div> : null, k.prose(L(cf.dimensionNote))], { cls: 'first' })}
    {k.sec(t('dz.cf.ethno'), ethno ? k.prose(ethno) : k.empty(L(cf.ethnoReligiousNote) || t('dz.cf.noEthno')))}
    {k.sec(t('dz.cf.history'), k.prose(L(cf.history)))}
    {k.sec(t('dz.cf.causes'), k.prose(L(cf.politicalCauses)))}
    {k.sec(t('dz.cf.claims'), k.prose(L(cf.territorialClaims)))}
    {k.sec(t('dz.cf.interests'), k.prose(L(cf.strategicInterests)))}
  </>;
}

function related(rel: Related, k: Kit) {
  const { t } = k;
  if (!rel.events.length && !rel.chokes.length && !rel.res.length && !rel.refs.length) return k.sec(null, k.empty(t('dz.cf.noRelated')), { cls: 'first' });
  return <>
    {k.sec(t('dz.cf.events'), k.eventList(rel.events), { count: rel.events.length, cls: 'first' })}
    {k.sec(t('dz.cf.chokes'), k.rows(rel.chokes.map(k.chokeRow)), { count: rel.chokes.length })}
    {k.sec(t('dz.cf.resources'), k.rows(rel.res.map((e, i) => k.resourceEntry(e, i, { country: true }))), { count: rel.res.length })}
    {k.sec(t('dz.cf.sources'), rel.refs.length ? <ul className="dz-refs" role="list">{rel.refs.map(k.refItem)}</ul> : null, { count: rel.refs.length })}
  </>;
}
