// View host: one full panel over the stage (pulse, network, timeline, compare, sources). Layout mounts the year scrubber itself.
// Esc is the shell's job; this file owns opening, closing, focus and re-rendering on state changes.

import { Component, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { atlas, useAtlas } from '../../app/store';
import { useDb, useT } from '../../app/useT';
import { VIEWS, type ViewId } from '../../config';
import { registerStrings } from '../../i18n/strings';
import { esc, reducedMotion } from '../../ui/dom';
import { Icon } from '../../ui/Icon';
import { hideTip } from '../../ui/tooltip';
import { PulseView } from '../pulse';
import { CompareView } from './compare';
import { NetworkView } from './network';
import { SourcesView } from './sources';
import { TimelineView } from './timeline';

registerStrings({
  ar: {
    'vw.sub.pulse': 'حال العالم الآن: النزاعات حسب الشدة والمنطقة، وما يستحق الانتباه، والترتيب',
    'vw.sub.network': 'من يتحالف مع من، ومن ينافس من — {n} علاقة موثّقة أو مقدّرة',
    'vw.sub.timeline': 'كل حدث في مسار فئته، والنزاعات الجارية بمددها، من 1900 إلى اليوم',
    'vw.sub.compare': 'الأرقام والتركيب والعضويات والعلاقة المباشرة جنباً إلى جنب',
    'vw.sub.sources': 'مصدر كل مجموعة بيانات وترخيصها وطريقة جمعها وحدودها',
  },
  en: {
    'vw.sub.pulse': 'The world right now: conflicts by severity and region, what needs attention, and rankings',
    'vw.sub.network': 'Who is allied with whom, and who competes — {n} documented or assessed ties',
    'vw.sub.timeline': 'Each event in its category lane, and running conflicts by duration, 1900 to today',
    'vw.sub.compare': 'Figures, composition, memberships and the direct relationship side by side',
    'vw.sub.sources': 'Where each dataset comes from, its licence, how it was made and its limits',
  },
});

const ANIM = 220;

// ---- theme as the page shows it
// Compare reads resolved colours (traditionColor), so the body remounts when <html data-theme> or the OS scheme changes,
// not on the store's theme key: the store changes first and the attribute follows a moment later.
const darkQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);
function subscribeTheme(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = darkQuery();
  mq?.addEventListener?.('change', cb);
  return () => { mo.disconnect(); mq?.removeEventListener?.('change', cb); };
}
const themeSnapshot = () => `${document.documentElement.dataset.theme ?? 'system'}|${darkQuery()?.matches ? 'dark' : 'light'}`;

function ViewBody({ id }: { id: ViewId }) {
  switch (id) {
    case 'pulse': return <PulseView />;
    case 'network': return <NetworkView />;
    case 'timeline': return <TimelineView />;
    case 'compare': return <CompareView />;
    case 'sources': return <SourcesView />;
  }
}

/** A view that throws while rendering shows the "no data" line instead of taking the app down. */
class ViewBoundary extends Component<{ id: ViewId; fallback: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error(`[atlas] view "${this.props.id}" failed to mount`, err); }
  render() { return this.state.failed ? <p className="empty">{this.props.fallback}</p> : this.props.children; }
}

export function ViewPanel() {
  const db = useDb();
  const { t, pick, lang } = useT();
  const view = useAtlas((s) => s.view);
  const pageTheme = useSyncExternalStore(subscribeTheme, themeSnapshot, () => 'system|light');
  // the view drawn in the panel: follows `view` at once, but outlives it for the closing transition
  const [shown, setShown] = useState<ViewId | null>(view);
  if (view && view !== shown) setShown(view);

  const hostRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const live = useRef<{ visible: boolean; opener: Element | null }>({ visible: false, opener: null });

  // is-open is set by hand (React never sees a className here), so a fresh open can start the transition from closed
  useLayoutEffect(() => {
    const host = hostRef.current, s = live.current;
    if (!host) return;
    if (view) {
      const fresh = !s.visible;
      s.visible = true;
      if (fresh) {
        s.opener = document.activeElement;
        if (!reducedMotion()) {
          host.classList.remove('is-open');
          void host.offsetWidth; // start the transition from the closed state
        }
      }
      host.classList.add('is-open');
      titleRef.current?.focus({ preventScroll: true });
    } else if (s.visible) {
      hideTip();
      host.classList.remove('is-open');
      const opener = s.opener as HTMLElement | null;
      if (host.contains(document.activeElement) && opener?.isConnected) opener.focus({ preventScroll: true });
      s.opener = null;
    }
  }, [view]);

  useEffect(() => {
    if (view || !shown) return;
    const timer = setTimeout(() => { live.current.visible = false; setShown(null); }, reducedMotion() ? 0 : ANIM);
    return () => clearTimeout(timer);
  }, [view, shown]);

  // a language or theme switch redraws the open view from the top, as v2's host did
  const bodyKey = shown ? `${shown}|${lang}|${pageTheme}` : '';
  useLayoutEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [bodyKey]);

  const v = shown ? VIEWS.find((x) => x.id === shown) : undefined;
  return (
    <section id="viewpanel" ref={hostRef} hidden={!shown} data-view={shown ?? undefined}>
      <div className="vp-scrim" onClick={() => atlas.closeView()} />
      <div className="vp-card" role="dialog" aria-labelledby="vp-title">
        <header className="vp-head">
          {v && (
            <>
              <span className="vp-icon"><Icon name={v.icon} size={20} /></span>
              <div className="vp-titles">
                <h2 className="vp-title" id="vp-title" tabIndex={-1} ref={titleRef}>{pick(v)}</h2>
                <p className="vp-sub">{t(`vw.sub.${v.id}`, { n: db.relations.edges.length })}</p>
              </div>
              <button className="btn icon ghost vp-close" type="button" aria-label={t('close')} data-tip={esc(t('close'))} onClick={() => atlas.closeView()}>
                <Icon name="close" size={18} />
              </button>
            </>
          )}
        </header>
        <div className="vp-body scroll" ref={bodyRef}>
          {shown && <ViewBoundary key={bodyKey} id={shown} fallback={t('noData')}><ViewBody id={shown} /></ViewBoundary>}
        </div>
      </div>
    </section>
  );
}
