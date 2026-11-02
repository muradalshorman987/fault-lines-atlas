// The help dialog (#help): keyboard shortcuts and about the atlas.

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { atlas } from '../../app/store';
import { useDb, useT } from '../../app/useT';
import { Icon } from '../../ui/Icon';
import { MOD, openWelcome } from './actions';
import { keyOf } from './keyboard';
import { Mark } from './marks';
import { closeHelp, helpReturnTo, restoreFocus, trapTab, useShellUi } from './ui';

const ORIGINAL = { url: 'https://claude.ai/artifact/7Y8KPakRKzrUtZYxjCwJai', ar: 'الأطلس الجيوسياسي والعرقي الديني العالمي' };

const k = (...keys: string[]) => (
  <span className="keyset" dir="ltr">
    {keys.map((x, i) => (x === '–' ? <span key={i} className="to">–</span> : <kbd key={i} className="kbd">{x}</kbd>))}
  </span>
);

const ROWS: [ReactNode, string][] = [
  [k(MOD, 'K'), 'sh.kPalette'], [k('/'), 'sh.kSearch'], [k('1', '–', '9'), 'sh.kLens'], [k('G'), 'sh.kProj'], [k('T'), 'sh.kTheme'],
  [k('L'), 'sh.kLang'], [k('?'), 'sh.kHelp'], [k('Esc'), 'sh.kEsc'], [k('←', '→'), 'sh.kTour'], [<>{k('←', '↑', '↓', '→')} {k('+', '−')}</>, 'sh.kMap'],
];

/** Split a translated string on its {placeholder} and put a node there. */
function fill(text: string, slot: string, node: ReactNode): ReactNode {
  const at = text.indexOf(`{${slot}}`);
  return at < 0 ? text : <>{text.slice(0, at)}{node}{text.slice(at + slot.length + 2)}</>;
}

function HelpBox() {
  const db = useDb();
  const { t, lang, fmt } = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => { closeRef.current?.focus(); }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape' || keyOf(e.nativeEvent) === '?') { e.preventDefault(); closeHelp(); }
    else if (e.key === 'Tab') trapTab(boxRef.current, e);
  };

  const openSources = () => {
    const ret = helpReturnTo();
    closeHelp({ restore: false });
    atlas.openView('sources');
    restoreFocus(ret);
  };

  // Focus goes back to where help was opened from; the panel takes it if it wants it.
  const openStart = () => {
    closeHelp();
    openWelcome();
  };

  const link = (
    <>
      <a href={ORIGINAL.url} target="_blank" rel="noopener"><bdi lang="ar">«{ORIGINAL.ar}»</bdi></a>
      {lang === 'ar' ? '' : ' (Global Geopolitical, Ethnic and Religious Atlas)'}
    </>
  );

  return (
    <>
      <div className="dlg-scrim" data-close="" onClick={() => closeHelp()} />
      <div ref={boxRef} className="help-box" role="dialog" aria-modal="true" aria-labelledby="help-h" onKeyDown={onKeyDown}>
        <header className="help-head">
          <span className="help-mark"><Mark /></span>
          <h2 id="help-h">{t('sh.helpTitle')}</h2>
          <button ref={closeRef} type="button" className="btn ghost icon" data-close="" data-k="help-close" aria-label={t('close')} onClick={() => closeHelp()}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="help-body scroll">
          <section className="help-sec" aria-labelledby="help-k">
            <h3 className="eyebrow" id="help-k">{t('sh.helpKeys')}</h3>
            <table className="keys">
              <tbody>{ROWS.map(([keys, s]) => <tr key={s}><th scope="row">{keys}</th><td>{t(s)}</td></tr>)}</tbody>
            </table>
          </section>
          <section className="help-sec" aria-labelledby="help-a">
            <h3 className="eyebrow" id="help-a">{t('sh.helpAbout')}</h3>
            <p className="help-about">{t('sh.about')}</p>
            <p className="help-credit">{fill(t('sh.credit'), 'link', link)}</p>
            <p className="caveat"><Icon name="info" size={16} /><span>{fill(t('sh.asOf'), 'date', <span className="num">{fmt.date(db.conflictsAsOf)}</span>)}</span></p>
            <div className="chips">
              <button type="button" className="btn" data-k="help-welcome" onClick={openStart}>
                <Icon name="compass" size={16} /><span>{t('sh.welcome')}</span>
              </button>
              <button type="button" className="btn" data-k="help-sources" onClick={openSources}>
                <Icon name="book" size={16} /><span>{t('sh.openSources')}</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export function HelpDialog() {
  const open = useShellUi((s) => s.help);
  return <div id="help" hidden={!open}>{open && <HelpBox />}</div>;
}
