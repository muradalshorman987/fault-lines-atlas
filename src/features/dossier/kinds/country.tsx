// Country dossier: brief (the default), summary, religion, peoples, conflicts, relations, resources and history tabs.

import { Fragment, type ReactNode } from 'react';
import { BarList, Donut, Pips } from '../../../ui/charts';
import { esc } from '../../../ui/dom';
import { Icon } from '../../../ui/Icon';
import { edgeVar, traditionColor } from '../../../ui/palette';
import type { Bi } from '../../../i18n/format';
import type { Country } from '../../../data/types';
import { CountryBrief } from '../brief/Brief';
import { gdpOf, gdpPerCapOf, popOf } from '../brief/facts';
import { extPowers, pickList, type ConflictX, type EdgeX, type EventX, type IntelX, type Panel, type ResEntryX } from '../model';
import type { Kit } from '../parts';

const byRank = (a: ConflictX, b: ConflictX) => b.rank - a.rank;

export function countryPanel(id: string, k: Kit): Panel | null {
  const c = k.db.countries.get(id);
  if (!c) return null;
  const { t, fmt } = k;
  const worst = c.conflicts.map((x) => k.db.conflictById.get(x) as ConflictX | undefined).filter((x) => !!x).sort(byRank)[0];
  const maj = c.religion?.majority;
  return {
    head: {
      region: k.ne(c.subregion),
      title: k.pickKey(c, 'name'),
      plate: [k.altSpan(c), <span className="data">{c.iso3}</span>, k.coord([c.lon, c.lat])],
      badges: [
        worst && <span className="pill dz-pill" data-tip={esc(t('dz.b.worstTip'))}>{k.sevGlyph(worst.severity, 12)}{t('dz.b.worst', { s: k.sevName(worst.severity) })}</span>,
        maj && <span className="pill dz-pill">{k.sw(traditionColor(maj))}{k.tradName(maj)}{' '}<span className="data">{fmt.pct(c.religion?.majorityShare)}</span></span>,
        c.type && c.type !== 'Sovereign country' && <span className="pill">{k.ne(c.type)}</span>,
        k.unverifiedPill('country', c.iso3),
      ],
    },
    tabs: [
      { id: 'brief', label: t('dz.br.tab'), render: () => <CountryBrief c={c} k={k} /> },
      { id: 'summary', label: t('dz.t.summary'), render: () => summary(c, k) },
      { id: 'religion', label: t('dz.t.religion'), count: c.religion ? null : 0, render: () => religion(c, k) },
      { id: 'peoples', label: t('dz.t.peoples'), count: c.groups.length, render: () => peoples(c, k) },
      { id: 'conflicts', label: t('dz.t.conflicts'), count: new Set([...c.conflicts, ...c.external]).size, render: () => conflicts(c, k) },
      { id: 'relations', label: t('dz.t.relations'), count: c.edges.length, render: () => relations(c, k) },
      { id: 'resources', label: t('dz.t.resources'), count: c.resources.length + c.sites.length + c.chokepoints.length, render: () => resources(c, k) },
      { id: 'history', label: t('dz.t.history'), count: c.events.length, render: () => history(c, k) },
    ],
  };
}

function summary(c: Country, k: Kit) {
  const { t, pick: L, fmt, db } = k;
  const intel = c.intel as IntelX | null;
  const money = (v: number) => k.numUnit(t('dz.u.usd', { v: fmt.num(v) }));
  // D10: generated population and GDP win over Natural Earth's; the note names the source when one is in use
  const pop = popOf(db, c), gdp = gdpOf(db, c), gdppc = gdpPerCapOf(db, c);
  const gen = [...new Set([pop, gdp, gdppc].flatMap((x) => (x?.source ? [x.source] : [])))];
  const head = k.facts([
    k.fact(t('dz.f.pop'), pop ? k.numUnit(fmt.compact(pop.value)) : '—', { year: pop?.year }),
    k.fact(t('dz.f.gdp'), gdp ? k.numUnit(fmt.gdp(gdp.value)) : '—', { year: gdp?.year }),
    k.fact(t('dz.f.gdppc'), gdppc ? money(gdppc.value) : '—', { year: gdppc?.year }),
    k.fact(t('dz.f.area'), <><span className="data">{fmt.num(c.areaKm2)}</span>{' '}<span className="dz-unit">{t('dz.u.km2')}</span></>, { tipText: t('dz.f.areaTip') }),
    k.fact(t('dz.f.density'), c.density ? <><span className="data">{fmt.num(c.density, c.density < 10 ? 1 : 0)}</span>{' '}<span className="dz-unit">{t('dz.u.perKm2')}</span></> : '—'),
    k.fact(t('dz.f.income'), k.ne(c.income), { text: true }),
    k.fact(t('dz.f.economy'), k.ne(c.economy), { text: true }),
    k.fact(t('dz.f.type'), k.ne(c.type), { text: true }),
    k.fact(t('dz.f.region'), `${k.ne(c.continent)} · ${k.ne(c.subregion)}`, { text: true, wide: true }),
    intel?.system && k.fact(t('dz.f.system'), L(intel.system), { text: true, wide: true }),
    intel?.langs && k.fact(t('dz.f.langs'), k.listJoin(pickList(k, intel.langs)), { text: true, wide: true }),
  ]);

  const edges = c.edges.map((id) => db.edgeById.get(id)).filter((e) => !!e);
  const nAll = edges.filter((e) => e.type === 'alliance').length, nRiv = edges.filter((e) => e.type === 'rivalry').length;
  const blocs = c.blocs.filter((b) => db.relations.blocById.has(b));
  const cell = (ic: string, v: ReactNode, label: string, goto: string, anchor: string, zero: boolean) => (
    <button type="button" className={`dz-x${zero ? ' is-zero' : ''}`} data-act="goto" data-goto={goto} data-anchor={anchor || undefined} onClick={() => k.goto(goto, anchor || null)}>
      <span className="dz-x-v"><Icon name={ic} size={15} /><span className="data">{v}</span></span><span className="dz-x-l">{label}</span>
    </button>
  );
  const exposure = (
    <div className="dz-x-grid">
      {cell('flame', fmt.num(c.conflicts.length), t('dz.x.conflicts'), 'conflicts', '', !c.conflicts.length)}
      {cell('target', fmt.num(c.external.length), t('dz.x.external'), 'conflicts', 'external', !c.external.length)}
      {cell('network', <>{fmt.num(nAll)}<span className="dz-x-sep">·</span>{fmt.num(nRiv)}</>, t('dz.x.ties'), 'relations', '', !(nAll + nRiv))}
      {cell('layers', fmt.num(blocs.length), t('dz.x.blocs'), 'summary', 'blocs', !blocs.length)}
      {cell('anchor', fmt.num(c.chokepoints.length), t('dz.x.chokes'), 'resources', 'chokes', !c.chokepoints.length)}
      {cell('gem', fmt.num(c.resources.length), t('dz.x.res'), 'resources', 'entries', !c.resources.length)}
    </div>
  );

  const blocChips = blocs.length
    ? <div className="chips dz-chips">{blocs.map((id) => { const b = db.relations.blocById.get(id)!; return k.kchip('bloc', id, L(b), { isos: b.members }); })}</div>
    : k.empty(t('dz.s.noBlocs'));
  const neigh = c.neighbors.length ? [k.cchips(c.neighbors), k.note(t('dz.s.neighborsNote'))] : null;
  const disputedNE = c.disputed.map((id) => db.disputedById.get(id)).filter((d) => !!d);

  let intelPart;
  if (intel) {
    const seps = (intel.separatists ?? []).map(L), disp = (intel.disputes ?? []).map(L);
    intelPart = <>
      {k.sec(t('dz.s.separatists'), seps.length ? k.bullets(seps) : k.note(t('dz.s.noneRecorded')))}
      {k.sec(t('dz.s.disputes'), disp.length ? k.bullets(disp) : k.note(t('dz.s.noneRecorded')))}
    </>;
  } else {
    intelPart = k.sec(null, k.empty(t('dz.noIntel')));
  }

  return <>
    {k.sec(null, [head, k.note(gen.length ? t('dz.br.noteGen', { s: k.listJoin(gen) }) : t('dz.f.note'))], { cls: 'first' })}
    {k.sec(t('dz.x.title'), exposure)}
    {k.sec(t('dz.s.blocs'), blocChips, { id: 'blocs', count: blocs.length })}
    {intelPart}
    {disputedNE.length ? k.sec(t('dz.s.neDisputed'), <div className="chips dz-chips">{disputedNE.map((d) => k.kchip('disputed', d.id, k.pickKey(d, 'name'), { lead: <Icon name="hatch" size={13} /> }))}</div>) : null}
    {k.sec(t('dz.s.neighbors'), neigh)}
  </>;
}

function religion(c: Country, k: Kit) {
  const { t, pick: L, fmt, db } = k;
  const r = c.religion;
  if (!r) return <>{k.sec(null, k.empty(t('dz.rel.none')), { cls: 'first' })}{k.sec(t('dz.rel.method'), k.prose(L(db.religion.methodNote)))}</>;
  const parts = r.sorted.map(([tid, p]) => ({ label: k.tradName(tid), value: p, color: traditionColor(tid) }));
  const sum = parts.reduce((s, p) => s + p.value, 0);
  const side = k.facts([
    k.fact(t('dz.rel.majority'), <>{k.sw(traditionColor(r.majority ?? ''))}{k.tradName(r.majority)}</>, { text: true, wide: true }),
    k.fact(t('dz.rel.diversity'), <span className="data">{fmt.num(r.diversity, 2)}</span>, { tipText: t('dz.rel.diversityTip'), wide: true }),
    k.fact(t('dz.rel.source'), k.srcName(r.source ?? ''), { year: r.year, text: true, wide: true }),
  ]);
  const bars = parts.map((p) => ({ ...p, tip: `<b>${esc(p.label)}</b> ${esc(fmt.pct(p.value, p.value < 10 ? 1 : 0))}` }));
  return <>
    {k.sec(null, <div className="dz-donut">
      <Donut parts={parts} size={128} thickness={15} total={Math.max(100, sum)} label={t('dz.rel.title')} center={fmt.pct(r.majorityShare)} sub={k.tradName(r.majority)} />
      <div className="dz-donut-side">{side}</div>
    </div>, { cls: 'first' })}
    {r.contested ? k.sec(null, k.caveat(t('dz.rel.contested'))) : null}
    {k.sec(t('dz.rel.shares'), <BarList rows={bars} unit="%" max={100} />, { count: parts.length })}
    {r.note ? k.sec(t('dz.rel.note'), k.prose(L(r.note as Bi))) : null}
    {k.sec(t('dz.rel.method'), k.prose(L(db.religion.methodNote)))}
  </>;
}

function peoples(c: Country, k: Kit) {
  const { t, fmt, db } = k;
  const gs = c.groups.map((id) => db.ethnic.groups.get(id)).filter((g) => !!g);
  const warn = k.caveat(k.pickKey(db.ethnic.meta as object | null, 'warning'));
  if (!gs.length) return <>{k.sec(null, k.empty(t('dz.p.none', { n: fmt.num(db.stats.groups) })), { cls: 'first' })}{k.sec(null, warn)}</>;
  return <>{k.sec(t('dz.p.title'), k.rows(gs.map(k.groupRow)), { count: gs.length, cls: 'first' })}{k.sec(null, warn)}</>;
}

function conflicts(c: Country, k: Kit) {
  const { t, pick: L, fmt, db } = k;
  const get = (id: string) => db.conflictById.get(id) as ConflictX | undefined;
  const party = c.conflicts.map(get).filter((x) => !!x).sort(byRank);
  const ext = [...new Set(c.external)].map(get).filter((x) => !!x).sort(byRank);
  const extRows = ext.map((cf) => {
    const ep = extPowers(cf).find((e) => e.iso3 === c.iso3);
    return k.conflictRow(cf, {
      meta: ep?.kind ? k.kindPill(ep.kind) : null,
      sub: <><span className="dz-sevlab">{k.sevName(cf.severity)}</span>{ep ? L(ep.role) : ''}</>,
    });
  });
  return <>
    {k.sec(t('dz.c.party'), party.length ? k.rows(party.map((cf) => k.conflictRow(cf))) : k.empty(t('dz.c.noParty', { n: fmt.num(db.conflicts.length) })), { count: party.length, cls: 'first' })}
    {k.sec(t('dz.c.external'), ext.length ? k.rows(extRows) : k.empty(t('dz.c.noExternal')), { count: ext.length, id: 'external' })}
  </>;
}

function relations(c: Country, k: Kit) {
  const { t, pick: L, fmt, db } = k;
  const iso = c.iso3;
  const edges = c.edges.map((id) => db.edgeById.get(id) as EdgeX | undefined).filter((e) => !!e);
  if (!edges.length) return k.sec(null, [k.empty(t('dz.r.none', { n: fmt.num(db.relations.edges.length) })), k.networkBtn()], { cls: 'first' });
  const seen = new Set<string>();
  const groups = db.relations.edgeTypes.map((et) => {
    const list = edges.filter((e) => e.type === et.id).sort((a, b) => (b.weight || 0) - (a.weight || 0));
    if (!list.length) return null;
    const items = list.map((e) => {
      const partner = e.a === iso ? e.b : e.a;
      const bil = !seen.has(partner) ? db.bilateralFor(iso, partner) as Bi | null : null;
      seen.add(partner);
      const weight = t('dz.r.weight', { n: e.weight ?? 0 });
      return (
        <div key={e.id} className="dz-rel" data-hl={partner}>
          <div className="dz-rel-h">{k.cchip(partner)}{k.kindPill(e.kind)}
            {e.contested ? <span className="pill warn" data-tip={esc(t('dz.r.contestedTip'))}><Icon name="alert" size={12} />{t('dz.r.contested')}</span> : null}
            {e.weight ? <span className="dz-weight" data-tip={esc(weight)}><Pips n={e.weight} of={5} color={edgeVar(e.type)} /><span className="vh">{weight}</span></span> : null}
          </div>
          {k.prose(L(e), { clamp: false, cls: 'sm' })}
          {bil ? <div className="dz-bi"><p className="dz-bi-h">{t('dz.r.bilateral')}</p>{k.prose(L(bil), { cls: 'sm' })}</div> : null}
        </div>
      );
    });
    return <Fragment key={et.id}>{k.sec(L(et as Partial<Bi>), k.rows(items), { count: list.length, lead: k.sw(edgeVar(et.id)) })}</Fragment>;
  });
  return <>{k.sec(null, [k.note(t('dz.r.hint')), k.networkBtn()], { cls: 'first dz-tight' })}{groups}</>;
}

function resources(c: Country, k: Kit) {
  const { t, pick: L, db } = k;
  const entries = [...c.resources as ResEntryX[]].sort((a, b) => (a.rank || 99) - (b.rank || 99));
  const sites = c.sites.map((id) => db.siteById.get(id)).filter((s) => !!s);
  const chokes = c.chokepoints.map((id) => db.chokeById.get(id)).filter((p) => !!p);
  if (!entries.length && !sites.length && !chokes.length) return k.sec(null, k.empty(t('dz.res.none')), { cls: 'first' });
  return <>
    {k.sec(t('dz.res.entries'), entries.length ? k.rows(entries.map((e, i) => k.resourceEntry(e, i))) : k.empty(t('dz.res.none')), { id: 'entries', count: entries.length, cls: 'first' })}
    {sites.length ? k.sec(t('dz.res.sites'), k.rows(sites.map(k.siteRow)), { count: sites.length }) : null}
    {chokes.length ? k.sec(t('dz.res.chokes'), k.rows(chokes.map(k.chokeRow)), { id: 'chokes', count: chokes.length }) : null}
    {entries.length ? k.sec(null, k.note(L(db.resources.note))) : null}
  </>;
}

function history(c: Country, k: Kit) {
  const { t, fmt, db } = k;
  const evs = c.events.map((id) => db.eventById.get(id) as EventX | undefined).filter((e) => !!e);
  if (!evs.length) {
    const [from, to] = db.timeline.range as [number, number];
    return k.sec(null, k.empty(t('dz.h.none', { n: fmt.num(db.timeline.events.length), from, to })), { cls: 'first' });
  }
  return k.sec(t('dz.h.title'), k.eventList(evs), { count: evs.length, cls: 'first' });
}
