// App state. Features read it with useAtlas(selector) and change it through `atlas`; they never import each other.

import { create } from 'zustand';
import { SEVERITY, type LensId, type ViewId } from '../config';
import type { Kind } from '../data/types';
import { emit } from './events';
import { loadPrefs, savePrefs, type Prefs } from './prefs';

export interface Filters {
  severity: Set<string>;
  relTypes: Set<string>;
  relKinds: Set<string>;
  bloc: string | null;
  resourceClass: string | null;
  religionMode: 'majority' | 'share' | 'diversity';
  religionTradition: string;
  overviewMode: 'continent' | 'income' | 'population' | 'gdp';
  timelineCats: Set<string> | null;
  ethnicFamily: string | null;
  region: string | null;        // conflict-file region id (middle-east, europe, asia, africa, americas)
  inView: boolean;              // pulse figures follow what the map shows
}
export interface Layers { labels: boolean; graticule: boolean; boundaries: boolean; disputed: boolean; ethnic: boolean; conflicts: boolean; arcs: boolean }

export interface AtlasState extends Prefs {
  lens: LensId;
  selection: { kind: Kind; id: string } | null;
  view: ViewId | null;
  compare: [string | null, string | null];
  year: number;
  yearFilter: boolean;
  playing: boolean;
  tour: { id: string; step: number } | null;
  ask: boolean;
  askReady: boolean;
  filters: Filters;
  layers: Layers;
}

export const initialState = (): AtlasState => ({
  lang: 'ar', theme: 'system', projection: 'globe',
  lens: 'overview', selection: null, view: null, compare: [null, null],
  year: 2026, yearFilter: false, playing: false, tour: null, ask: false, askReady: false,
  filters: {
    severity: new Set(SEVERITY.map((s) => s.id)),
    relTypes: new Set(['alliance', 'military', 'economic', 'influence', 'proxy', 'rivalry', 'territorial', 'diplomatic']),
    relKinds: new Set(['treaty', 'assessed']),
    bloc: null, resourceClass: null, religionMode: 'majority', religionTradition: 'sunni',
    overviewMode: 'continent', timelineCats: null, ethnicFamily: null, region: null, inView: false,
  },
  layers: { labels: true, graticule: true, boundaries: true, disputed: true, ethnic: false, conflicts: false, arcs: false },
});

export const useAtlas = create<AtlasState>()(() => ({ ...initialState(), ...loadPrefs() }));

useAtlas.subscribe((s, prev) => {
  if (s.lang !== prev.lang || s.theme !== prev.theme || s.projection !== prev.projection) savePrefs(s);
});

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Set && b instanceof Set) return a.size === b.size && [...a].every((x) => b.has(x));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

const isPhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;

export const atlas = {
  get: (): AtlasState => useAtlas.getState(),

  /** Apply the keys that actually change; returns them. */
  set(patch: Partial<AtlasState>): string[] {
    const s = useAtlas.getState();
    const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => !sameValue(s[k as keyof AtlasState], v)));
    const keys = Object.keys(changed);
    if (keys.length) useAtlas.setState(changed);
    return keys;
  },

  setFilter<K extends keyof Filters>(key: K, value: Filters[K]): void {
    useAtlas.setState({ filters: { ...useAtlas.getState().filters, [key]: value } });
  },

  toggleInSet(key: 'severity' | 'relTypes' | 'relKinds' | 'timelineCats', item: string): void {
    const next = new Set(useAtlas.getState().filters[key] ?? []);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    atlas.setFilter(key, next);
  },

  setLayer(key: keyof Layers, on: boolean): void {
    useAtlas.setState({ layers: { ...useAtlas.getState().layers, [key]: on } });
  },

  /** Select a record; kind=null clears. Flies the map unless {fly:false}. */
  select(kind: Kind | null, id?: string, { fly = true }: { fly?: boolean } = {}): void {
    // On phones the dossier sheet and a view panel cannot share the screen: picking a record leaves the view.
    const selection = kind && id != null ? { kind, id } : null;
    atlas.set(selection && isPhone() && useAtlas.getState().view ? { selection, view: null } : { selection });
    if (selection && fly) emit('flyto', selection);
  },

  openView: (id: ViewId) => { atlas.set({ view: id }); },
  closeView: () => { atlas.set({ view: null }); },

  /** Back to the defaults, preferences included. Used by tests. */
  reset: () => { useAtlas.setState(initialState(), true); },
};
