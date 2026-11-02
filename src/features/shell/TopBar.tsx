// The top bar: brand, search button, breadcrumb (lens › selection), view buttons, tools and the phone menu button.
import { useEffect, useLayoutEffect, useRef } from 'react';

import { emit } from '../../app/events';
import { atlas, useAtlas } from '../../app/store';
import { useDb, useT } from '../../app/useT';
import { LENSES, VIEWS } from '../../config';
import { esc } from '../../ui/dom';
import { Icon } from '../../ui/Icon';
import '../tours/tours'; // registers the kind.* names the breadcrumb shows
import { copyLink, cycleTheme, MOD, nextTheme, THEME_ICON, toggleLang, toggleView } from './actions';
import { HelpIcon, Mark } from './marks';
import { ToursButton } from './ToursMenu';
import { openHelp, openPalette, openSheet, useShellUi } from './ui';

// data-tip holds HTML for the tooltip's innerHTML: plain text goes in through esc() (React escapes the attribute itself).

function Crumb() {
  const db = useDb();
  const { t, pick: L, lang } = useT();
  const lensId = useAtlas((s) => s.lens);
  const selection = useAtlas((s) => s.selection);
  const lens = LENSES.find((l) => l.id === lensId) ?? LENSES[0];
  const sel = selection && db.exists(selection.kind, selection.id) ? selection : null;
  // When the crumb's buttons disappear under keyboard focus (× or Esc), focus goes to search, as in v2.
  // Whether focus was in the crumb is read when the selection changes, before React removes the buttons
  // (store listeners run inside atlas.set; the re-render comes after).
  const crumbRef = useRef<HTMLDivElement>(null);
  const hadFocus = useRef(false);
  useEffect(() => useAtlas.subscribe((s, prev) => {
    if (s.selection !== prev.selection) hadFocus.current = !!crumbRef.current?.contains(document.activeElement);
  }), []);
  useLayoutEffect(() => {
    if (sel) return;
    if (hadFocus.current && (!document.activeElement || document.activeElement === document.body)) {
      document.querySelector<HTMLElement>('#topbar [data-k="search"]')?.focus();
    }
    hadFocus.current = false;
  }, [sel]);
  return (
    <div ref={crumbRef} className={`tb-crumb${sel ? ' has-sel' : ''}`} role="group" aria-label={t('sh.context')}>
      <span className="cr-lens"><Icon name={lens.icon} size={15} /><span className="cr-lens-name">{L(lens)}</span></span>
      {sel && (
        <>
          <span className="cr-sep" aria-hidden="true"><Icon name="chevron" size={14} /></span>
          <button type="button" className="cr-sel" data-k="crumb-fly" data-tip={esc(t('sh.flyTip'))}
            onClick={() => emit('flyto', { kind: sel.kind, id: sel.id })}>
            <span className="cr-kind">{t('kind.' + sel.kind)}</span><span className="cr-name">{db.nameOf(sel.kind, sel.id, lang)}</span>
          </button>
          <button type="button" className="cr-x" data-k="crumb-clear" aria-label={t('sh.clearSel')} data-tip={esc(t('sh.clearSel'))}
            onClick={() => atlas.select(null)}>
            <Icon name="close" size={14} />
          </button>
        </>
      )}
    </div>
  );
}

export function TopBar() {
  const { t, pick: L, lang } = useT();
  const theme = useAtlas((s) => s.theme);
  const view = useAtlas((s) => s.view);
  const ask = useAtlas((s) => s.ask);
  const askReady = useAtlas((s) => s.askReady);
  const sheetOpen = useShellUi((s) => s.sheet);
  const themeTip = t('sh.themeTip', { mode: t('sh.theme.' + theme), next: t('sh.theme.' + nextTheme(theme)) });
  return (
    <>
      <div className="tb-brand"><Mark /><h1 className="tb-name">{t('appName')}</h1><p className="tb-tag">{t('appTag')}</p></div>
      <button type="button" className="tb-search" data-k="search" aria-haspopup="dialog" aria-label={t('sh.searchLabel')} aria-keyshortcuts="Control+K /"
        onClick={(e) => openPalette(e.currentTarget)}>
        <Icon name="search" size={16} /><span className="tb-search-ph">{t('sh.searchPh')}</span>
        <span className="tb-keys" aria-hidden="true"><kbd className="kbd">{MOD} K</kbd><kbd className="kbd">/</kbd></span>
      </button>
      <Crumb />
      <div className="tb-views" role="group" aria-label={t('sh.views')}>
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className="tb-view" data-k={`view-${v.id}`} aria-pressed={view === v.id} aria-label={L(v)} data-tip={esc(L(v))}
            onClick={() => toggleView(v.id)}>
            <Icon name={v.icon} size={16} /><span className="lbl">{L(v)}</span>
          </button>
        ))}
      </div>
      <div className="tb-tools">
        {askReady && (
          <button type="button" className={`btn ghost tb-ask${ask ? ' is-on' : ''}`} data-k="ask" aria-pressed={ask} aria-keyshortcuts="A" data-tip={esc(t('sh.ask'))}
            onClick={() => atlas.set({ ask: !atlas.get().ask })}>
            <Icon name="spark" size={17} /><span className="lbl">{t('sh.ask')}</span>
          </button>
        )}
        <ToursButton />
        <button type="button" className="btn ghost icon" data-k="link" aria-label={t('sh.copyLinkTip')} data-tip={esc(t('sh.copyLinkTip'))}
          onClick={() => void copyLink()}>
          <Icon name="link" size={17} />
        </button>
        <button type="button" className="btn ghost icon tb-lang" data-k="lang" aria-label={t('sh.toLang')} data-tip={esc(t('sh.toLang'))} onClick={toggleLang}>
          <span lang={lang === 'ar' ? 'en' : 'ar'}>{lang === 'ar' ? 'EN' : 'ع'}</span>
        </button>
        <button type="button" className="btn ghost icon" data-k="theme" aria-label={themeTip} data-tip={esc(themeTip)} onClick={cycleTheme}>
          <Icon name={THEME_ICON[theme]} size={17} />
        </button>
        <button type="button" className="btn ghost icon" data-k="help" aria-haspopup="dialog" aria-label={t('sh.helpTitle')} aria-keyshortcuts="?" data-tip={esc(t('sh.helpTitle'))}
          onClick={(e) => openHelp(e.currentTarget)}>
          <HelpIcon />
        </button>
      </div>
      <button type="button" className="btn ghost icon tb-menu" data-k="menu" aria-haspopup="dialog" aria-expanded={sheetOpen} aria-label={t('sh.menu')}
        onClick={(e) => openSheet(e.currentTarget)}>
        <Icon name="menu" size={19} />
      </button>
    </>
  );
}
