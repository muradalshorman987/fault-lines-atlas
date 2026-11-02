// Compare two states side by side: figures on a shared scale per row, composition, memberships, conflicts, the direct tie.

import { Fragment, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { atlas, useAtlas } from '../../app/store';
import { useDb, useT } from '../../app/useT';
import type { Country, DB, Kind } from '../../data/types';
import type { Bi } from '../../i18n/format';
import { registerStrings } from '../../i18n/strings';
import { Pips, StackBar } from '../../ui/charts';
import { esc } from '../../ui/dom';
import { Icon } from '../../ui/Icon';
import { resClassVar, traditionColor } from '../../ui/palette';
import { gdpOf, gdpPerCapOf, popOf, type Shown } from '../dossier/brief/facts';
import '../dossier/brief.css';
import { SevIcon, UvMark } from './timeline/marks';
import { LineKey } from './network';
import type { NetEdge } from './networkGraph';

registerStrings({
  ar: {
    'cp.a': 'الدولة الأولى',
    'cp.b': 'الدولة الثانية',
    'cp.search': 'اكتب اسم دولة',
    'cp.swap': 'بدّل الدولتين',
    'cp.noMatch': 'لا دولة بهذا الاسم',
    'cp.same': 'اختر دولتين مختلفتين للمقارنة.',
    'cp.figures': 'أرقام أساسية',
    'cp.pop': 'السكان',
    'cp.gdp': 'الناتج المحلي الإجمالي',
    'cp.gdppc': 'نصيب الفرد من الناتج',
    'cp.area': 'المساحة',
    'cp.density': 'الكثافة السكانية',
    'cp.km2': 'كم²',
    'cp.perKm2': 'نسمة لكل كم²',
    'cp.usd': '{n} دولار',
    'cp.figNote': 'السكان والناتج تقديرات Natural Earth (سنة {y}). المساحة محسوبة من حدود الخريطة. كل صف بمقياسه الخاص.',
    'cp.figNoteGen': 'بجوار كل رقم من البيانات المفتوحة مصدره وسنته، والباقي تقديرات Natural Earth. المساحة محسوبة من حدود الخريطة. كل صف بمقياسه الخاص.',
    'cp.src': '{s} · {y}',
    'cp.profile': 'التصنيف',
    'cp.region': 'الإقليم',
    'cp.income': 'فئة الدخل',
    'cp.economy': 'الاقتصاد',
    'cp.status': 'الوضع',
    'cp.system': 'نظام الحكم',
    'cp.langs': 'اللغات',
    'cp.religion': 'التركيب الديني',
    'cp.diversity': 'التنوّع الديني',
    'cp.noReligion': 'لا تتوفّر بيانات دينية لهذه الدولة في الأطلس.',
    'cp.contested': 'التقديرات محلّ خلاف',
    'cp.ethnic': 'المجموعات العرقية',
    'cp.blocs': 'التكتلات',
    'cp.conflicts': 'النزاعات',
    'cp.external': 'طرف خارجي',
    'cp.choke': 'المضائق والممرات',
    'cp.resources': 'أنواع الموارد',
    'cp.only': '{name} وحدها',
    'cp.shared': 'مشتركة',
    'cp.relation': 'العلاقة المباشرة',
    'cp.noTie': 'لا توجد حافة مسجّلة بين هاتين الدولتين.',
    'cp.bilateral': 'ملاحظة ثنائية',
    'cp.treaty': 'موثّقة بمعاهدة',
    'cp.assessed': 'تقدير تحليلي',
    'cp.weight': 'القوة {n} من 5',
    'inc.1': 'دخل مرتفع (OECD)', 'inc.2': 'دخل مرتفع (خارج OECD)', 'inc.3': 'دخل متوسط أعلى', 'inc.4': 'دخل متوسط أدنى', 'inc.5': 'دخل منخفض',
    'eco.1': 'متقدّم — مجموعة السبع', 'eco.2': 'متقدّم', 'eco.3': 'ناشئ — بريك', 'eco.4': 'ناشئ — MIKT', 'eco.5': 'ناشئ — مجموعة العشرين', 'eco.6': 'نامٍ', 'eco.7': 'الأقل نموّاً',
    'typ.Sovereign country': 'دولة ذات سيادة', 'typ.Country': 'دولة', 'typ.Dependency': 'إقليم تابع', 'typ.Disputed': 'متنازع عليه', 'typ.Indeterminate': 'وضع غير محسوم', 'typ.Sovereignty': 'سيادة',
    'sub.Southern Asia': 'جنوب آسيا', 'sub.Southern Europe': 'جنوب أوروبا', 'sub.Northern Africa': 'شمال أفريقيا', 'sub.Polynesia': 'بولينيزيا',
    'sub.Middle Africa': 'وسط أفريقيا', 'sub.Caribbean': 'الكاريبي', 'sub.Antarctica': 'أنتاركتيكا', 'sub.South America': 'أمريكا الجنوبية',
    'sub.Western Asia': 'غرب آسيا', 'sub.Australia and New Zealand': 'أستراليا ونيوزيلندا', 'sub.Seven seas (open ocean)': 'المحيطات المفتوحة',
    'sub.Western Europe': 'غرب أوروبا', 'sub.Eastern Europe': 'شرق أوروبا', 'sub.Central America': 'أمريكا الوسطى', 'sub.Western Africa': 'غرب أفريقيا',
    'sub.Northern America': 'أمريكا الشمالية', 'sub.Southern Africa': 'جنوب أفريقيا', 'sub.South-Eastern Asia': 'جنوب شرق آسيا', 'sub.Eastern Africa': 'شرق أفريقيا',
    'sub.Northern Europe': 'شمال أوروبا', 'sub.Micronesia': 'ميكرونيزيا', 'sub.Melanesia': 'ميلانيزيا', 'sub.Eastern Asia': 'شرق آسيا', 'sub.Central Asia': 'آسيا الوسطى',
  },
  en: {
    'cp.a': 'First state',
    'cp.b': 'Second state',
    'cp.search': 'Type a state’s name',
    'cp.swap': 'Swap the two states',
    'cp.noMatch': 'No state by that name',
    'cp.same': 'Choose two different states to compare.',
    'cp.figures': 'Key figures',
    'cp.pop': 'Population',
    'cp.gdp': 'GDP',
    'cp.gdppc': 'GDP per person',
    'cp.area': 'Area',
    'cp.density': 'Population density',
    'cp.km2': 'km²',
    'cp.perKm2': 'per km²',
    'cp.usd': '${n}',
    'cp.figNote': 'Population and GDP are Natural Earth estimates ({y}). Area is computed from the map outline. Each row has its own scale.',
    'cp.figNoteGen': 'Open-data figures show their source and year; the rest are Natural Earth estimates. Area is computed from the map outline. Each row has its own scale.',
    'cp.src': '{s} · {y}',
    'cp.profile': 'Classification',
    'cp.region': 'Region',
    'cp.income': 'Income group',
    'cp.economy': 'Economy',
    'cp.status': 'Status',
    'cp.system': 'Political system',
    'cp.langs': 'Languages',
    'cp.religion': 'Religious composition',
    'cp.diversity': 'Religious diversity',
    'cp.noReligion': 'The atlas has no religion data for this state.',
    'cp.contested': 'Estimates are contested',
    'cp.ethnic': 'Ethnic groups',
    'cp.blocs': 'Blocs',
    'cp.conflicts': 'Conflicts',
    'cp.external': 'external power',
    'cp.choke': 'Chokepoints',
    'cp.resources': 'Resource types',
    'cp.only': '{name} only',
    'cp.shared': 'Shared',
    'cp.relation': 'The direct relationship',
    'cp.noTie': 'No recorded tie between these two states.',
    'cp.bilateral': 'Bilateral note',
    'cp.treaty': 'Treaty-documented',
    'cp.assessed': 'Analytical assessment',
    'cp.weight': 'Strength {n} of 5',
    'inc.1': 'High income (OECD)', 'inc.2': 'High income (non-OECD)', 'inc.3': 'Upper middle income', 'inc.4': 'Lower middle income', 'inc.5': 'Low income',
    'eco.1': 'Developed — G7', 'eco.2': 'Developed', 'eco.3': 'Emerging — BRIC', 'eco.4': 'Emerging — MIKT', 'eco.5': 'Emerging — G20', 'eco.6': 'Developing', 'eco.7': 'Least developed',
    'typ.Sovereign country': 'Sovereign state', 'typ.Country': 'Country', 'typ.Dependency': 'Dependency', 'typ.Disputed': 'Disputed', 'typ.Indeterminate': 'Indeterminate', 'typ.Sovereignty': 'Sovereignty',
  },
});

type T = ReturnType<typeof useT>;
type Named = Partial<Bi> | string | null | undefined;
type Pair = [string | null, string | null];
interface Item { key: string; node: ReactNode }

/** Vocabulary bound to the language: Natural Earth codes ('3. Upper middle income' → 'inc.3'), subregions, status. */
function words(T: T) {
  const { t, lang } = T;
  return {
    coded: (prefix: string, v: unknown) => (v ? t(`${prefix}.${String(v).split('.')[0]}`) : '—'),
    // English subregion names translate through 'sub.*'; English shows the raw name
    subName: (s: string | undefined) => (s ? (lang === 'ar' ? t(`sub.${s}`) : s) : ''),
    typeName: (v: string | undefined) => (v ? t(`typ.${v}`) : '—'),
  };
}

// '34.3 مليون' → digits in the data face, the unit word in the UI face (Arabic set in a mono face reads cramped)
function NumUnit({ s }: { s: string }) {
  const m = /^([-+$]?[\d.,]+)(.*)$/.exec(s);
  return m ? <><span className="num">{m[1]}</span>{m[2]}</> : <>{s}</>;
}

function SwapIcon() {
  return (
    <svg className="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5" />
    </svg>
  );
}

const weightOf = (db: DB, id: string) => (db.edgeById.get(id) as NetEdge | undefined)?.weight ?? 0;
const otherEnd = (db: DB, id: string, iso: string) => { const e = db.edgeById.get(id); return e ? (e.a === iso ? e.b : e.a) : null; };

function defaultPair(db: DB): Pair {
  const sel = atlas.get().selection;
  const c = sel?.kind === 'country' ? db.countries.get(sel.id) : undefined;
  if (c) {
    const ties = [...c.edges].sort((x, y) => weightOf(db, y) - weightOf(db, x));
    const e = ties.find((id) => ['rivalry', 'territorial'].includes(db.edgeById.get(id)?.type ?? '')) ?? ties[0];
    const other = e ? otherEnd(db, e, c.iso3) : c.neighbors[0];
    if (other) return [c.iso3, other];
  }
  return ['USA', 'CHN'];
}

export function CompareView() {
  const db = useDb();
  const T = useT();
  const { t } = T;
  const compare = useAtlas((s) => s.compare);
  const bigFirst = useMemo(() => [...db.countries.values()].filter((c) => c.pop).sort((a, b) => b.pop! - a.pop!).map((c) => c.iso3), [db]);

  useLayoutEffect(() => {
    const [a0, b0] = atlas.get().compare;
    if (!db.countries.has(a0 ?? '') || !db.countries.has(b0 ?? '')) atlas.set({ compare: defaultPair(db) });
  }, [db]);

  return (
    <div className="cmp">
      <div className="cmp-pickers">
        <Picker i={0} bigFirst={bigFirst} />
        <button className="btn icon cmp-swap" type="button" aria-label={t('cp.swap')} data-tip={esc(t('cp.swap'))}
          onClick={() => { const [a, b] = atlas.get().compare; atlas.set({ compare: [b, a] }); }}>
          <SwapIcon />
        </button>
        <Picker i={1} bigFirst={bigFirst} />
      </div>
      <div className="cmp-body"><Body a={compare[0]} b={compare[1]} /></div>
    </div>
  );
}

// ---- searchable combobox (ARIA 1.2 pattern: focus stays in the input, options via aria-activedescendant)
// The input is uncontrolled, as in v2, so no value attribute appears; reset() writes the chosen state's name back.
function Picker({ i, bigFirst }: { i: 0 | 1; bigFirst: string[] }) {
  const db = useDb();
  const T = useT();
  const { t, lang } = T;
  const { subName } = words(T);
  const compare = useAtlas((s) => s.compare);
  const cur = compare[i];
  const [opts, setOpts] = useState<string[] | null>(null); // null: the list is closed
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const lbRef = useRef<HTMLUListElement>(null);
  const name = (iso: string) => db.nameOf('country', iso, lang);
  const label = t(i ? 'cp.b' : 'cp.a');

  const curName = cur ? db.nameOf('country', cur, lang) : '';
  useLayoutEffect(() => { if (inputRef.current) inputRef.current.value = curName; }, [curName]);
  useLayoutEffect(() => {
    if (opts && active >= 0) lbRef.current?.querySelector(`#cmp-o-${i}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [opts, active, i]);

  const reset = () => { if (inputRef.current) inputRef.current.value = curName; };
  function suggestions(): string[] {
    const other = compare[1 - i] ?? null, c = other ? db.countries.get(other) : undefined;
    const partners = c && other ? [...c.edges].sort((x, y) => weightOf(db, y) - weightOf(db, x)).map((id) => otherEnd(db, id, other)).filter((x): x is string => !!x) : [];
    return [...new Set([...partners, ...bigFirst])].filter((iso) => iso !== other).slice(0, 8);
  }
  function results(): string[] {
    const q = (inputRef.current?.value ?? '').trim();
    if (!q || (cur && q === name(cur))) return suggestions();
    return db.search(q, 400).filter((r) => r.kind === 'country').slice(0, 8).map((r) => r.id);
  }
  const open = (list: string[]) => { setOpts(list); setActive(list.length ? 0 : -1); };
  const close = () => { setOpts(null); setActive(-1); };
  function choose(iso: string) {
    const next: Pair = [...atlas.get().compare];
    next[i] = iso;
    close();
    atlas.set({ compare: next });
    if (inputRef.current) inputRef.current.value = name(iso);
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!opts) { open(results()); return; }
      setActive(Math.max(0, Math.min(opts.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter') {
      const iso = opts?.[active];
      if (iso) { e.preventDefault(); choose(iso); }
    } else if (e.key === 'Escape') {
      // close only the list; the shell's Esc (close the view) should not also fire
      if (opts) { e.preventDefault(); e.stopPropagation(); close(); reset(); }
    } else if (e.key === 'Tab') close();
  };

  return (
    <div className="cmp-pick">
      <label className="eyebrow" htmlFor={`cmp-in-${i}`}>{label}</label>
      <div className="cmp-combo">
        <i className={`sw cmp-sw-${i}`} aria-hidden="true" />
        <input ref={inputRef} id={`cmp-in-${i}`} className="cmp-in" type="text" role="combobox" aria-autocomplete="list" aria-expanded={!!opts}
          aria-controls={`cmp-lb-${i}`} aria-activedescendant={opts && active >= 0 ? `cmp-o-${i}-${active}` : undefined}
          autoComplete="off" spellCheck={false} placeholder={t('cp.search')}
          onChange={() => open(results())}
          onFocus={(e) => e.target.select()}
          onClick={() => { if (!opts) open(results()); }}
          onKeyDown={onKeyDown}
          onBlur={() => { close(); reset(); }} />
        <Icon name="search" size={16} />
        <ul ref={lbRef} className="cmp-lb" id={`cmp-lb-${i}`} role="listbox" aria-label={label} hidden={!opts}
          onMouseDown={(e) => e.preventDefault() /* keep focus in the input while choosing */}>
          {opts && (opts.length ? opts.map((iso, k) => (
            <li key={iso} id={`cmp-o-${i}-${k}`} role="option" aria-selected={k === active} data-iso={iso} onClick={() => choose(iso)}>
              <span>{name(iso)}</span><span className="cmp-o-sub">{subName(db.countries.get(iso)?.subregion)}</span>
            </li>
          )) : <li className="cmp-o-none">{t('cp.noMatch')}</li>)}
        </ul>
      </div>
    </div>
  );
}

// ---- sections

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="cmp-sec"><h3 className="vw-h3">{title}</h3>{children}</section>;
}

function SelBtn({ kind, id, label, pre, post, after }: { kind: Kind; id: string; label: string; pre?: ReactNode; post?: ReactNode; after?: ReactNode }) {
  return (
    <li>
      <button className="cmp-item" type="button" data-k={kind} data-id={id} onClick={() => atlas.select(kind, id)}>{pre}<span>{label}</span>{post}</button>
      {after}
    </li>
  );
}

function Body({ a, b }: { a: string | null; b: string | null }) {
  const db = useDb();
  const T = useT();
  const { t, lang } = T;
  const L = T.pick as (o: Named) => string;
  const A = a ? db.countries.get(a) : undefined, B = b ? db.countries.get(b) : undefined;
  if (!A || !B || a === b) return <p className="empty">{t('cp.same')}</p>;
  const nameOf = (kind: Kind, id: string) => db.nameOf(kind, id, lang);
  const groupItems = (c: Country): Item[] => c.groups.map((id) => ({ key: id, node: <SelBtn kind="group" id={id} label={nameOf('group', id)} /> }));
  const blocItems = (c: Country): Item[] => c.blocs.map((id) => ({ key: id, node: <SelBtn kind="bloc" id={id} label={nameOf('bloc', id)} /> }));
  const conflictItems = (c: Country): Item[] => [...new Set([...c.conflicts, ...c.external])].flatMap((id) => {
    const k = db.conflictById.get(id);
    if (!k) return [];
    const ext = !c.conflicts.includes(id); // involved only as an outside power
    return [{
      key: id,
      node: <SelBtn kind="conflict" id={id} label={L(k.name)} pre={<SevIcon id={k.severity} />}
        post={ext ? <span className="cmp-x">{t('cp.external')}</span> : null} after={<UvMark kind="conflict" id={id} />} />,
    }];
  });
  const chokeItems = (c: Country): Item[] => c.chokepoints.map((id) => ({ key: id, node: <SelBtn kind="choke" id={id} label={nameOf('choke', id)} /> }));
  const resourceItems = (c: Country): Item[] => [...new Set(c.resources.map((e) => e.type))].map((ty) => ({
    key: ty,
    node: (
      <li>
        <span className="cmp-item is-static">
          <i className="sw" style={{ background: resClassVar(db.resources.classOf[ty] ?? '') }} />
          <span>{L(db.resources.typeById.get(ty)) || ty}</span>
        </span>
      </li>
    ),
  }));

  // a recorded tie is the headline of the pair; without one, the honest empty note sits with the other links
  const tied = db.edgesBetween(A.iso3, B.iso3).length > 0 || !!db.bilateralFor(A.iso3, B.iso3);
  return (
    <>
      <Head A={A} B={B} />
      {tied && <Relation A={A} B={B} />}
      <Figures A={A} B={B} />
      <Profile A={A} B={B} />
      <Religion A={A} B={B} />
      <ThreeWay title={t('cp.ethnic')} a={groupItems(A)} b={groupItems(B)} A={A} B={B} />
      <ThreeWay title={t('cp.blocs')} a={blocItems(A)} b={blocItems(B)} A={A} B={B} />
      <ThreeWay title={t('cp.conflicts')} a={conflictItems(A)} b={conflictItems(B)} A={A} B={B} />
      {!tied && <Relation A={A} B={B} />}
      <ThreeWay title={t('cp.choke')} a={chokeItems(A)} b={chokeItems(B)} A={A} B={B} />
      <ThreeWay title={t('cp.resources')} a={resourceItems(A)} b={resourceItems(B)} A={A} B={B} />
    </>
  );
}

function Head({ A, B }: { A: Country; B: Country }) {
  const db = useDb();
  const T = useT();
  const { subName, typeName } = words(T);
  return (
    <div className="cmp-head">
      {[A, B].map((c, i) => (
        <button key={i} className="cmp-name" type="button" data-k="country" data-id={c.iso3} onClick={() => atlas.select('country', c.iso3)}>
          <span className="cmp-name-t"><i className={`sw cmp-sw-${i}`} aria-hidden="true" />{db.nameOf('country', c.iso3, T.lang)}</span>
          <span className="cmp-name-s">{[subName(c.subregion), typeName(c.type)].filter(Boolean).join(' · ')}</span>
        </button>
      ))}
    </div>
  );
}

function Figures({ A, B }: { A: Country; B: Country }) {
  const db = useDb();
  const { t, fmt, lang } = useT();
  const usd = (v: number) => t('cp.usd', { n: fmt.num(v) });
  // D10: generated population and GDP (db.figures, or the build's popSource/gdpSource) replace Natural Earth's, with a chip
  const plain = (v: number | null | undefined): Shown | null => (v == null ? null : { value: v, year: null, source: null, srcId: null });
  const rows: [string, (c: Country) => Shown | null, (v: number) => string][] = [
    [t('cp.pop'), (c) => popOf(db, c), fmt.compact],
    [t('cp.gdp'), (c) => gdpOf(db, c), fmt.gdp],
    [t('cp.gdppc'), (c) => gdpPerCapOf(db, c), usd],
    [t('cp.area'), (c) => plain(c.areaKm2), (v) => `${v >= 1e4 ? fmt.compact(v) : fmt.num(v)} ${t('cp.km2')}`],
    [t('cp.density'), (c) => plain(c.density), (v) => `${fmt.num(v, v < 10 ? 1 : 0)} ${t('cp.perKm2')}`],
  ];
  const bar = (x: Shown | null, max: number, f: (v: number) => string, c: Country, i: number) => {
    const v = x?.value;
    const txt = v == null || Number.isNaN(v) ? '—' : f(v);
    const w = v ? Math.max(0.6, (v / max) * 100) : 0;
    return (
      <div className="cmp-bar" data-tip={`<b>${esc(txt)}</b> <span class="tip-sub">${esc(db.nameOf('country', c.iso3, lang))}</span>`}>
        <span className="cmp-track"><span className={`cmp-fill cmp-fill-${i}`} style={{ inlineSize: `${w.toFixed(2)}%` }} /></span>
        <span className="cmp-val"><NumUnit s={txt} /></span>
        {x?.source ? <span className="cmp-src">{t('cp.src', { s: x.source, y: x.year ?? '—' })}</span> : null}
      </div>
    );
  };
  const shown = rows.slice(0, 3).flatMap(([, get]) => [get(A), get(B)]);
  const generated = shown.some((x) => x?.source);
  const years = [...new Set(shown.flatMap((x) => (x && !x.source && x.year ? [x.year] : [])))].sort().join('–');
  return (
    <Section title={t('cp.figures')}>
      <div className="cmp-figs">
        {rows.map(([label, get, f]) => {
          const va = get(A), vb = get(B), max = Math.max(va?.value || 0, vb?.value || 0) || 1;
          return <div className="cmp-fig" key={label}><div className="cmp-fig-l">{label}</div><div className="cmp-fig-b">{bar(va, max, f, A, 0)}{bar(vb, max, f, B, 1)}</div></div>;
        })}
      </div>
      <p className="vw-note">{generated ? t('cp.figNoteGen') : t('cp.figNote', { y: years || '—' })}</p>
    </Section>
  );
}

function Profile({ A, B }: { A: Country; B: Country }) {
  const T = useT();
  const { t, lang } = T;
  const L = T.pick as (o: Named) => string;
  const { subName, coded, typeName } = words(T);
  const langs = (c: Country) => {
    const v = c.intel?.langs as { ar?: string[]; en?: string[] } | undefined;
    const l = v ? (v[lang] ?? v.ar ?? v.en) : undefined;
    return Array.isArray(l) && l.length ? l.join('، ') : '—';
  };
  const rows: [string, (c: Country) => string][] = [
    [t('cp.region'), (c) => subName(c.subregion) || '—'],
    [t('cp.income'), (c) => coded('inc', c.income)],
    [t('cp.economy'), (c) => coded('eco', c.economy)],
    [t('cp.status'), (c) => typeName(c.type)],
    [t('cp.system'), (c) => L(c.intel?.system as Named) || '—'],
    [t('cp.langs'), langs],
  ];
  return (
    <Section title={t('cp.profile')}>
      <dl className="cmp-dl">
        {rows.map(([k, get]) => <div className="cmp-dl-r" key={k}><dt>{k}</dt><dd>{get(A)}</dd><dd>{get(B)}</dd></div>)}
      </dl>
    </Section>
  );
}

function Religion({ A, B }: { A: Country; B: Country }) {
  const db = useDb();
  const T = useT();
  const { t, fmt, lang } = T;
  const L = T.pick as (o: Named) => string;
  const tradition = (tid: string) => L(db.religion.traditionById.get(tid));
  const one = (c: Country, i: number) => {
    const r = c.religion, name = db.nameOf('country', c.iso3, lang);
    const h = (
      <div className="cmp-rel-h">
        <span className="cmp-rel-n"><i className={`sw cmp-sw-${i}`} aria-hidden="true" />{name}</span>
        {r && <span className="cmp-rel-d">{t('cp.diversity')} <b className="num">{fmt.num(r.diversity, 2)}</b></span>}
      </div>
    );
    if (!r) return <div className="cmp-rel">{h}<p className="vw-muted">{t('cp.noReligion')}</p></div>;
    const parts = r.sorted.map(([tid, p]) => ({ label: tradition(tid), value: p, color: traditionColor(tid) }));
    const note = [r.contested ? t('cp.contested') : '', L(r.note)].filter(Boolean).join(' — ');
    return (
      <div className="cmp-rel">
        {h}
        <StackBar parts={parts} label={`${t('cp.religion')}: ${name}`} height={12} />
        {note && <p className="vw-note">{note}</p>}
      </div>
    );
  };
  const share = new Map<string, number>();
  for (const c of [A, B]) for (const [tid, p] of c.religion?.sorted ?? []) share.set(tid, Math.max(share.get(tid) ?? 0, p));
  const legend = [...share].sort((x, y) => y[1] - x[1]).map(([tid]) => <li key={tid}><i className="sw" style={{ background: traditionColor(tid) }} />{tradition(tid)}</li>);
  return (
    <Section title={t('cp.religion')}>
      <div className="cmp-rels">{one(A, 0)}{one(B, 1)}</div>
      {legend.length > 0 && <ul className="vw-legend">{legend}</ul>}
    </Section>
  );
}

/** Three columns: only A · shared · only B. Each item's node is a ready <li>. */
function ThreeWay({ title, a, b, A, B }: { title: string; a: Item[]; b: Item[]; A: Country; B: Country }) {
  const db = useDb();
  const { t, lang } = useT();
  const bKeys = new Set(b.map((x) => x.key)), aKeys = new Set(a.map((x) => x.key));
  const col = (label: string, list: Item[], cls: string, sw: ReactNode) => (
    <div className={`cmp-col ${cls}`}>
      <h4 className="cmp-col-h">{sw}{label} <span className="n">{list.length}</span></h4>
      {list.length ? <ul className="cmp-items">{list.map((x) => <Fragment key={x.key}>{x.node}</Fragment>)}</ul> : <p className="vw-muted">—</p>}
    </div>
  );
  return (
    <Section title={title}>
      <div className="cmp-3">
        {col(t('cp.only', { name: db.nameOf('country', A.iso3, lang) }), a.filter((x) => !bKeys.has(x.key)), 'is-a', <i className="sw cmp-sw-0" aria-hidden="true" />)}
        {col(t('cp.shared'), a.filter((x) => bKeys.has(x.key)), 'is-both', null)}
        {col(t('cp.only', { name: db.nameOf('country', B.iso3, lang) }), b.filter((x) => !aKeys.has(x.key)), 'is-b', <i className="sw cmp-sw-1" aria-hidden="true" />)}
      </div>
    </Section>
  );
}

function Relation({ A, B }: { A: Country; B: Country }) {
  const db = useDb();
  const T = useT();
  const { t } = T;
  const L = T.pick as (o: Named) => string;
  const es = db.edgesBetween(A.iso3, B.iso3) as NetEdge[], note = db.bilateralFor(A.iso3, B.iso3) as Named;
  if (!es.length && !note) return <Section title={t('cp.relation')}><p className="empty">{t('cp.noTie')}</p></Section>;
  return (
    <Section title={t('cp.relation')}>
      {es.length > 0 && (
        <ul className="cmp-edges">
          {es.map((e) => (
            <li className="cmp-edge" key={e.id}>
              <LineKey type={e.type} kind={e.kind} contested={!!e.contested} w={28} />
              <div>
                <p className="cmp-edge-h">
                  <b>{L(db.relations.edgeTypeById.get(e.type) as Named)}</b><span className="pill">{t('cp.' + e.kind)}</span>
                  {e.contested && <span className="pill">{t('nw.contested')}</span>}
                  <Pips n={e.weight} of={5} color="var(--fg-2)" /><span className="vh">{t('cp.weight', { n: e.weight })}</span>
                </p>
                <p className="cmp-edge-t">{L(e as Named)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {note && <div className="cmp-bi"><span className="eyebrow">{t('cp.bilateral')}</span><p>{L(note)}</p></div>}
    </Section>
  );
}
