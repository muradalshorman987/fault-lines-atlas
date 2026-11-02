// The command palette (#palette): search every record plus lenses, views, actions and tours. A modal combobox.

import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { atlas, useAtlas } from '../../app/store';
import { useDb, useT } from '../../app/useT';
import type { Prefs } from '../../app/prefs';
import { LENSES, RELIGION_FAMILIES, SEVERITY, VIEWS, type LensId, type ViewId } from '../../config';
import type { DB, Kind } from '../../data/types';
import { normalize, type Lang } from '../../i18n/format';
import { esc } from '../../ui/dom';
import { Icon } from '../../ui/Icon';
import { availableTours, stepsLabel, type Tour } from '../tours/tours';
import { copyLink, cycleTheme, KIND_ICON, nextTheme, openWelcome, pickRecord, setLens, startTour, THEME_ICON, toggleLang, toggleProjection } from './actions';
import { markMatch } from './markMatch';
import { closePalette, openHelp, paletteReturn, trapTab, useShellUi } from './ui';

type T = ReturnType<typeof useT>;

// Natural Earth subregions are English-only in the data; this is UI vocabulary for the Arabic interface.
const SUBREGION_AR: Record<string, string> = {
  'Eastern Africa': 'شرق أفريقيا', 'Western Asia': 'غرب آسيا', 'South-Eastern Asia': 'جنوب شرق آسيا', 'South America': 'أمريكا الجنوبية',
  'Southern Europe': 'جنوب أوروبا', 'Melanesia': 'ميلانيزيا', 'Central Asia': 'آسيا الوسطى', 'Micronesia': 'ميكرونيزيا', 'Caribbean': 'الكاريبي',
  'Polynesia': 'بولينيزيا', 'Northern America': 'أمريكا الشمالية', 'Seven seas (open ocean)': 'المحيطات المفتوحة', 'Western Africa': 'غرب أفريقيا',
  'Northern Europe': 'شمال أوروبا', 'Eastern Europe': 'شرق أوروبا', 'Northern Africa': 'شمال أفريقيا', 'Eastern Asia': 'شرق آسيا',
  'Western Europe': 'غرب أوروبا', 'Southern Africa': 'جنوب أفريقيا', 'Southern Asia': 'جنوب آسيا', 'Middle Africa': 'وسط أفريقيا',
  'Central America': 'أمريكا الوسطى', 'Australia and New Zealand': 'أستراليا ونيوزيلندا', 'Antarctica': 'القارة القطبية الجنوبية',
};

interface Item { key: string; ownsFocus?: boolean; run: (ret: Element | null) => void; body: ReactNode }
interface Group { label: string; items: Item[] }
interface Command {
  group: 'lens' | 'view' | 'action' | 'tour'; label: string; sub?: string; ic: string; kbd?: string; on?: boolean; ownsFocus?: boolean;
  run: (ret: Element | null) => void;
}

function countLabel(n: number, lang: Lang): string {
  if (lang !== 'ar') return n === 0 ? 'No results' : n === 1 ? '1 result' : `${n} results`;
  if (n === 0) return 'لا نتائج';
  if (n === 1) return 'نتيجة واحدة';
  if (n === 2) return 'نتيجتان';
  return n <= 10 ? `${n} نتائج` : `${n} نتيجة`;
}

function membersLabel(n: number, lang: Lang): string {
  if (lang !== 'ar') return n === 1 ? '1 member' : `${n} members`;
  if (n === 1) return 'عضو واحد';
  if (n === 2) return 'عضوان';
  return n <= 10 ? `${n} أعضاء` : `${n} عضواً`;
}

const matches = (text: string, q: string) => !!q && normalize(text).includes(normalize(q));

/** The grey second line of a record: where it is, or what it is. */
function subOf(db: DB, T: T, kind: Kind, id: string): string {
  const { lang, pick: L, pickKey: Lk, fmt } = T;
  const ar = lang === 'ar';
  const countryName = (iso: string) => db.nameOf('country', iso, lang);
  switch (kind) {
    case 'country': {
      const x = db.countries.get(id);
      return !x ? '' : ar ? SUBREGION_AR[x.subregion ?? ''] || x.subregion || '' : x.subregion || '';
    }
    case 'conflict': {
      const x = db.conflictById.get(id);
      return !x ? '' : [L(x.regionName), L(SEVERITY.find((s) => s.id === x.severity))].filter(Boolean).join(' · ');
    }
    case 'group': return Lk(db.ethnic.groups.get(id), 'region');
    case 'religion': return db.religion.traditionById.has(id) ? L(RELIGION_FAMILIES.find((f) => f.id === db.religion.familyOf[id])) : '';
    case 'choke': {
      const x = db.chokeById.get(id);
      return !x ? '' : (x.borderStates ?? []).filter((iso) => db.countries.has(iso)).slice(0, 3).map(countryName).join(ar ? '، ' : ', ');
    }
    case 'disputed': {
      const x = db.disputedById.get(id);
      if (!x) return '';
      const c = [...db.countries.values()].find((o) => o.nameEn === x.admin || o.sovereign === x.admin);
      return c ? Lk(c, 'name') : x.admin || '';
    }
    case 'event': {
      const x = db.eventById.get(id);
      return x ? fmt.date(x.date) : '';
    }
    case 'bloc': {
      const x = db.relations.blocById.get(id);
      return x ? membersLabel((x.members || []).length, lang) : '';
    }
    case 'site': {
      const x = db.siteById.get(id);
      return !x ? '' : [x.iso3 && db.countries.has(x.iso3) ? countryName(x.iso3) : '', L(db.resources.typeById.get(x.type))].filter(Boolean).join(' · ');
    }
    default: return '';
  }
}

function dataItem(db: DB, T: T, kind: Kind, id: string, q: string): Item {
  const { lang, t, fmt } = T;
  const name = db.nameOf(kind, id, lang);
  const other = db.nameOf(kind, id, lang === 'ar' ? 'en' : 'ar');
  const subText = subOf(db, T, kind, id);
  // A match on the name in the other language is shown on the second line.
  const viaOther = !!q && !matches(name, q) && !!other && matches(other, q);
  const sub = viaOther ? <><bdi>{markMatch(other, q)}</bdi>{subText ? ' · ' + subText : ''}</> : subText;
  const pop = kind === 'country' ? db.countries.get(id)?.pop : undefined;
  return {
    key: `${kind}:${id}`,
    run: () => pickRecord(kind, id),
    body: (
      <>
        <span className="pal-ic"><Icon name={KIND_ICON[kind]} size={16} /></span>
        <span className="pal-txt"><span className="pal-name">{markMatch(name, q)}</span>{sub ? <span className="pal-sub">{sub}</span> : null}</span>
        {pop ? <span className="pal-meta" data-tip={esc(t('sh.pop'))}><Icon name="people" size={13} /><span className="num">{fmt.compact(pop)}</span></span> : null}
      </>
    ),
  };
}

interface CommandState { lens: LensId; view: ViewId | null; theme: Prefs['theme']; projection: Prefs['projection']; tour: string | undefined }

function commands(T: T, s: CommandState, tours: Tour[]): Command[] {
  const { t, pick: L, lang } = T;
  const next = nextTheme(s.theme);
  const out: Command[] = [];
  LENSES.forEach((l, i) => out.push({ group: 'lens', label: L(l), sub: L(l.sub), ic: l.icon, kbd: String(i + 1), on: s.lens === l.id, run: () => setLens(l.id) }));
  VIEWS.forEach((v) => out.push({ group: 'view', label: L(v), ic: v.icon, on: s.view === v.id, run: () => atlas.openView(v.id) }));
  out.push({ group: 'action', label: t('sh.welcome'), sub: t('sh.welcomeSub'), ic: 'compass', run: openWelcome });
  out.push({ group: 'action', label: t('sh.actTheme', { mode: t('sh.theme.' + next) }), ic: THEME_ICON[next], kbd: 'T', run: cycleTheme });
  out.push({ group: 'action', label: t('sh.actLang'), ic: 'lang', kbd: 'L', run: toggleLang });
  out.push({ group: 'action', label: t(s.projection === 'globe' ? 'sh.actFlat' : 'sh.actGlobe'), ic: s.projection === 'globe' ? 'flat' : 'globe', kbd: 'G', run: toggleProjection });
  out.push({ group: 'action', label: t('sh.actLink'), ic: 'link', run: () => void copyLink() });
  out.push({ group: 'action', label: t('sh.helpTitle'), ic: 'keys', kbd: '?', ownsFocus: true, run: (ret) => openHelp(ret) });
  tours.forEach((tr) => out.push({
    group: 'tour', label: t('sh.actTour', { title: L(tr) }), sub: `${stepsLabel(tr.steps.length, lang)} · ${L(tr.desc)}`, ic: 'route',
    on: s.tour === tr.id, run: () => startTour(tr.id),
  }));
  return out;
}

function cmdItem(T: T, c: Command, q: string, n: number): Item {
  return {
    key: `${c.group}:${n}`,
    ownsFocus: c.ownsFocus,
    run: c.run,
    body: (
      <>
        <span className="pal-ic"><Icon name={c.ic} size={16} /></span>
        <span className="pal-txt"><span className="pal-name">{markMatch(c.label, q)}</span>{c.sub ? <span className="pal-sub">{c.sub}</span> : null}</span>
        {c.on || c.kbd ? (
          <span className="pal-meta">{c.on ? <span className="pal-on">{T.t('sh.current')}</span> : null}{c.kbd ? <kbd className="kbd">{c.kbd}</kbd> : null}</span>
        ) : null}
      </>
    ),
  };
}

function PaletteBox() {
  const db = useDb();
  const T = useT();
  const { t, lang } = T;
  const lens = useAtlas((s) => s.lens);
  const view = useAtlas((s) => s.view);
  const theme = useAtlas((s) => s.theme);
  const projection = useAtlas((s) => s.projection);
  const tour = useAtlas((s) => s.tour?.id);
  const recent = useShellUi((s) => s.recent);
  const tours = useMemo(() => availableTours(db), [db]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => { inputRef.current?.focus(); }, []);

  const q = query.trim();
  const groups: Group[] = [];
  if (q) {
    const byKind = new Map<Kind, Item[]>();
    for (const e of db.search(q, 120)) {
      const g = byKind.get(e.kind) ?? [];
      byKind.set(e.kind, g);
      if (g.length < 6) g.push(dataItem(db, T, e.kind, e.id, q));
    }
    for (const [kind, items] of byKind) groups.push({ label: t('kinds.' + kind), items });
    const nq = normalize(q);
    const cmds = commands(T, { lens, view, theme, projection, tour }, tours).filter((c) => normalize(c.label).includes(nq));
    if (cmds.length) groups.push({ label: t('sh.gActions'), items: cmds.slice(0, 8).map((c, n) => cmdItem(T, c, q, n)) });
  } else {
    const rec = recent.filter((r) => db.exists(r.kind, r.id)).slice(0, 5);
    if (rec.length) groups.push({ label: t('sh.gRecent'), items: rec.map((r) => dataItem(db, T, r.kind, r.id, '')) });
    const all = commands(T, { lens, view, theme, projection, tour }, tours);
    for (const [g, label] of [['lens', 'sh.gLenses'], ['view', 'sh.gViews'], ['action', 'sh.gActions'], ['tour', 'sh.gTours']] as const) {
      groups.push({ label: t(label), items: all.filter((c) => c.group === g).map((c, n) => cmdItem(T, c, '', n)) });
    }
  }
  const items = groups.flatMap((g) => g.items);
  const cur = Math.min(active, Math.max(0, items.length - 1));
  const firstIndex = groups.map((_, gi) => groups.slice(0, gi).reduce((sum, g) => sum + g.items.length, 0));

  const move = (i: number) => {
    setActive(i);
    document.getElementById(`pal-o${i}`)?.scrollIntoView?.({ block: 'nearest' });
  };

  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    const ret = paletteReturn();
    closePalette({ restore: !it.ownsFocus });
    it.run(ret);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation(); // the palette is modal: no global shortcut fires while it is open
    if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && (e.code === 'KeyK' || e.key.toLowerCase() === 'k'))) { e.preventDefault(); closePalette(); return; }
    if (e.key === 'Tab') { trapTab(boxRef.current, e); return; }
    if (e.target !== inputRef.current || e.nativeEvent.isComposing) return;
    const n = items.length;
    if (!n) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); move((cur + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move((cur - 1 + n) % n); }
    else if (e.key === 'PageDown') { e.preventDefault(); move(Math.min(n - 1, cur + 6)); }
    else if (e.key === 'PageUp') { e.preventDefault(); move(Math.max(0, cur - 6)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(cur); }
  };

  return (
    <>
      <div className="dlg-scrim" data-close="" onClick={() => closePalette()} />
      <div ref={boxRef} className="pal-box" role="dialog" aria-modal="true" aria-labelledby="pal-h" onKeyDown={onKeyDown}>
        <h2 id="pal-h" className="vh">{t('sh.palTitle')}</h2>
        <div className="pal-field">
          <Icon name="search" size={18} />
          <input ref={inputRef} id="pal-in" type="text" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list"
            aria-activedescendant={items.length ? `pal-o${cur}` : undefined} aria-label={t('sh.searchLabel')} placeholder={t('sh.searchPh')}
            autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="go"
            // Uncontrolled (the palette remounts empty on each open), so no value attribute appears, as in v2.
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              if (listRef.current) listRef.current.scrollTop = 0;
            }} />
          <button type="button" className="pal-close" data-close="" aria-label={t('close')} onClick={() => closePalette()}>
            <kbd className="kbd">Esc</kbd><Icon name="close" size={18} />
          </button>
        </div>
        <div ref={listRef} id="pal-list" className="pal-list scroll" role="listbox" aria-label={t('sh.results')}>
          {groups.length ? groups.map((g, gi) => (
            <div key={`${gi}:${g.label}`} role="group" aria-labelledby={`pal-g${gi}`}>
              <div className="pal-gh eyebrow" id={`pal-g${gi}`}>{g.label}</div>
              {g.items.map((it, n) => {
                const i = firstIndex[gi]! + n;
                return (
                  <div key={it.key} className="pal-opt" role="option" id={`pal-o${i}`} data-i={i} aria-selected={i === cur}
                    onMouseDown={(e) => e.preventDefault() /* keep focus in the field */}
                    onPointerMove={() => { if (i !== cur) setActive(i); }}
                    onClick={() => choose(i)}>
                    {it.body}
                  </div>
                );
              })}
            </div>
          )) : <p className="empty pal-empty">{t('sh.noResults', { q })}</p>}
        </div>
        <div className="pal-foot">
          <span className="hint"><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> <span data-s="hintMove">{t('sh.hintMove')}</span></span>
          <span className="hint"><kbd className="kbd">Enter</kbd> <span data-s="hintOpen">{t('sh.hintOpen')}</span></span>
          <span className="pal-count num" id="pal-count" aria-live="polite">{q ? countLabel(items.length, lang) : ''}</span>
        </div>
      </div>
    </>
  );
}

export function CommandPalette() {
  const open = useShellUi((s) => s.palette);
  return <div id="palette" hidden={!open}>{open && <PaletteBox />}</div>;
}
