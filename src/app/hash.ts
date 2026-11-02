// Share links: one plain token in the URL hash, e.g. #country-SAU, #conflict-sudan, #lens-religion,
// #view-network, #compare-SAU-IRN, #tour-energy. Same tokens as v2, so old links keep working.

import { KINDS, LENSES, SEVERITY, VIEWS, type LensId, type ViewId } from '../config';
import type { DB, Kind } from '../data/types';
import { emit } from './events';
import { atlas, useAtlas, type AtlasState, type Filters } from './store';

export type ParsedHash = { patch?: Partial<AtlasState>; fly?: { kind: Kind; id: string }; tour?: string };

export function hashToken(s: AtlasState): string {
  if (s.tour) return `tour-${s.tour.id}`;
  if (s.view === 'compare' && s.compare[0] && s.compare[1]) return `compare-${s.compare[0]}-${s.compare[1]}`;
  if (s.selection) return `${s.selection.kind}-${s.selection.id}`;
  if (s.view) return `view-${s.view}`;
  return `lens-${s.lens}`;
}

export function parseHash(token: string, db: DB): ParsedHash | null {
  const cut = token.indexOf('-');
  if (cut < 0) return null;
  const head = token.slice(0, cut), rest = token.slice(cut + 1);
  if (head === 'lens' && LENSES.some((l) => l.id === rest)) return { patch: { lens: rest as LensId, view: null, selection: null } };
  if (head === 'view' && VIEWS.some((v) => v.id === rest)) return { patch: { view: rest as ViewId } };
  if (head === 'compare') {
    const [a, b] = rest.split('-');
    if (a && b && db.countries.has(a) && db.countries.has(b)) return { patch: { view: 'compare', compare: [a, b] } };
    return null;
  }
  if (head === 'tour') return rest ? { tour: rest } : null;
  // A selection link shows that record on the map, so it closes any open view.
  if ((KINDS as readonly string[]).includes(head) && db.exists(head as Kind, rest)) {
    const sel = { kind: head as Kind, id: rest };
    return { patch: { selection: sel, view: null }, fly: sel };
  }
  return null;
}

function currentToken(): string {
  try {
    return decodeURIComponent(location.hash.slice(1));
  } catch {
    return ''; // a malformed escape (e.g. #%E0%A4%A) is treated as no link
  }
}

// The start link's map flight waits for the first frame; stop() must be able to cancel it.
let flyTimer: ReturnType<typeof setTimeout> | undefined;

/** Apply the current hash. Returns false when there is no valid token. */
export function applyHash(db: DB): boolean {
  const parsed = parseHash(currentToken(), db);
  if (!parsed) return false;
  if (parsed.tour) { emit('starttour', parsed.tour); return true; }
  if (parsed.patch) atlas.set(parsed.patch);
  const fly = parsed.fly;
  if (fly) { clearTimeout(flyTimer); flyTimer = setTimeout(() => emit('flyto', fly), 50); }
  return true;
}

// ---- filters in the query string (?region=africa&sev=war,armed-conflict&inview=1), next to the hash token.
// Only filters people share are written; a severity set equal to "all" is left out.

const ALL_SEV = SEVERITY.map((s) => s.id) as string[];

function applyQuery(db: DB): void {
  const q = new URLSearchParams(location.search);
  const regions = new Set(db.conflicts.map((c) => c.region));
  const region = q.get('region');
  if (region && regions.has(region)) atlas.setFilter('region', region);
  const sev = (q.get('sev') ?? '').split(',').filter((id) => ALL_SEV.includes(id));
  if (sev.length) atlas.setFilter('severity', new Set(sev));
  if (q.get('inview') === '1') atlas.setFilter('inView', true);
}

function queryFor(f: Filters): string {
  const q = new URLSearchParams();
  if (f.region) q.set('region', f.region);
  const sev = ALL_SEV.filter((id) => f.severity.has(id));
  if (sev.length !== ALL_SEV.length) q.set('sev', sev.join(','));
  if (f.inView) q.set('inview', '1');
  const s = q.toString().replace(/%2C/g, ',');
  return s ? '?' + s : '';
}

function writeUrl(url: string, fallbackHash?: string): void {
  try {
    history.replaceState(null, '', url);
  } catch {
    if (fallbackHash !== undefined) location.hash = fallbackHash; // history blocked (sandboxed frame): fall back to a plain hash write
  }
}

/** Apply the hash (and query filters) now and on every hashchange; keep both in step with state. Returns a stop function. */
export function startHashSync(db: DB): () => void {
  let writing = false;
  applyQuery(db);
  applyHash(db);
  const onHash = () => { if (!writing) applyHash(db); };
  addEventListener('hashchange', onHash);
  const unsub = useAtlas.subscribe((s, prev) => {
    if (s.filters !== prev.filters) {
      const query = queryFor(s.filters);
      if (query !== location.search) writeUrl(location.pathname + query + location.hash);
    }
    if (s.selection === prev.selection && s.view === prev.view && s.lens === prev.lens && s.compare === prev.compare && s.tour === prev.tour) return;
    const token = hashToken(s);
    if (currentToken() === token) return;
    writing = true;
    writeUrl('#' + token, token);
    setTimeout(() => { writing = false; }, 0);
  });
  return () => { removeEventListener('hashchange', onHash); unsub(); clearTimeout(flyTimer); };
}
