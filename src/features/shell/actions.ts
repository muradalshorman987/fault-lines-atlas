// Commands the top bar, palette, phone menu and keyboard share.

import { emit } from '../../app/events';
import type { Prefs } from '../../app/prefs';
import { atlas } from '../../app/store';
import type { LensId, ViewId } from '../../config';
import type { Kind } from '../../data/types';
import { translate } from '../../i18n/strings';
import { copyText, shareLink } from '../../ui/dom';
import './strings';

type Theme = Prefs['theme'];

// Lens a selection kind belongs to (country keeps the current lens).
export const KIND_LENS: Partial<Record<Kind, LensId>> = { conflict: 'conflicts', group: 'ethnic', religion: 'religion', choke: 'chokepoints', disputed: 'disputed', event: 'history', bloc: 'powers', site: 'resources' };
export const KIND_ICON: Record<Kind, string> = { country: 'globe', conflict: 'flame', group: 'people', religion: 'pie', choke: 'anchor', disputed: 'hatch', event: 'clock', bloc: 'network', site: 'gem' };
const THEMES: readonly Theme[] = ['system', 'dark', 'light'];
export const THEME_ICON: Record<Theme, string> = { system: 'auto', dark: 'moon', light: 'sun' };

/** The modifier key as the platform names it. */
export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl';

const tr = (key: string, vars?: Record<string, string | number>) => translate(atlas.get().lang, key, vars);

export const nextTheme = (theme: Theme = atlas.get().theme): Theme => THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;

export const setLens = (id: LensId) => { atlas.set({ lens: id, view: null }); };
export const toggleView = (id: ViewId) => (atlas.get().view === id ? atlas.closeView() : atlas.openView(id));
export const toggleLang = () => { atlas.set({ lang: atlas.get().lang === 'ar' ? 'en' : 'ar' }); };
// Started from a menu: the tour card takes focus (v2 sent the same {id, focus} payload).
export const startTour = (id: string) => { emit('starttour', { id, focus: true }); };
// The "Start here" panel (features/welcome) listens for this; the shell never imports it.
export const openWelcome = () => { emit('welcome', null); };

export function cycleTheme(): void {
  const next = nextTheme();
  atlas.set({ theme: next });
  emit('toast', tr('sh.themeNow', { mode: tr('sh.theme.' + next) }));
}

export function toggleProjection(): void {
  const next = atlas.get().projection === 'globe' ? 'flat' : 'globe';
  atlas.set({ projection: next });
  emit('toast', tr(next === 'globe' ? 'sh.projGlobe' : 'sh.projFlat'));
}

export async function copyLink(): Promise<void> {
  const ok = await copyText(shareLink());
  emit('toast', tr(ok ? 'sh.linkCopied' : 'sh.linkFailed'));
}

/** Open a search result: switch to the lens its kind belongs to, then select it (the map flies there). */
export function pickRecord(kind: Kind, id: string): void {
  const lens = KIND_LENS[kind];
  if (lens && lens !== atlas.get().lens) atlas.set({ lens });
  atlas.select(kind, id);
}
