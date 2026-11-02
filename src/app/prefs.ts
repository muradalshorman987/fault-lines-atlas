// Per-viewer preferences (best effort: the app works without storage). Same key as v2, so returning visitors keep theirs.

export type Prefs = { lang: 'ar' | 'en'; theme: 'system' | 'dark' | 'light'; projection: 'globe' | 'flat' | 'detailed' };
const KEY = 'atlas-v2-prefs';

export function loadPrefs(): Partial<Prefs> {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
    const out: Partial<Prefs> = {};
    if (p.lang === 'ar' || p.lang === 'en') out.lang = p.lang;
    if (p.theme === 'system' || p.theme === 'dark' || p.theme === 'light') out.theme = p.theme;
    if (p.projection === 'globe' || p.projection === 'flat' || p.projection === 'detailed') out.projection = p.projection;
    return out;
  } catch {
    return {}; // storage blocked or the value is not JSON: use the defaults
  }
}

export function savePrefs({ lang, theme, projection }: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ lang, theme, projection }));
  } catch {
    // storage blocked (private window): the choice lasts this visit only
  }
}
