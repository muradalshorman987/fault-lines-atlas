// Country figures as shown on screen, shared by the dossier (Brief, Summary) and the Compare view.
// D10: a generated figure (db.figures, or a popSource/gdpSource the build sets) wins; Natural Earth is the fallback.

import type { Figure } from './figures';
import type { Country, DB } from './types';

/** A figure as shown: its value, its year, and the generated source's display name (null = Natural Earth). */
export interface Shown { value: number; year: number | null; source: string | null; srcId: string | null }

export const sourceOf = (db: DB, id: string | null | undefined) => (id ? db.figures.sources.find((s) => s.id === id) ?? null : null);
const sourceName = (db: DB, id: string) => sourceOf(db, id)?.name ?? id;
const shown = (db: DB, f: Figure, value = f.value): Shown => ({ value, year: f.year, source: sourceName(db, f.source), srcId: f.source });
const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** A generated GDP figure in million USD: World Bank values are plain US$ unless the unit says millions. */
export const figureMd = (f: Figure) => (/million|^m(?:usd|\$)?$/i.test(f.unit ?? '') ? f.value : f.value / 1e6);

export function popOf(db: DB, c: Country): Shown | null {
  const f = db.figures.country(c.iso3).population;
  if (f && ok(f.value)) return shown(db, f);
  if (!ok(c.pop)) return null;
  const s = c.popSource;
  return { value: c.pop, year: c.popYear ?? null, source: s ? sourceName(db, s) : null, srcId: s ?? null };
}

/** GDP in million USD (the unit Natural Earth uses and fmt.gdp expects). */
export function gdpOf(db: DB, c: Country): Shown | null {
  const f = db.figures.country(c.iso3).gdp;
  if (f && ok(f.value)) return shown(db, f, figureMd(f));
  if (!ok(c.gdp) || !c.gdp) return null;
  const s = c.gdpSource;
  return { value: c.gdp, year: c.gdpYear ?? null, source: s ? sourceName(db, s) : null, srcId: s ?? null };
}

export function gdpPerCapOf(db: DB, c: Country): Shown | null {
  const f = db.figures.country(c.iso3).gdpPerCapita;
  if (f && ok(f.value)) return shown(db, f);
  const g = gdpOf(db, c), p = popOf(db, c);
  if (g?.srcId && p?.value) return { ...g, value: (g.value * 1e6) / p.value };
  if (!ok(c.gdpPerCap)) return null;
  const s = c.gdpSource;
  return { value: c.gdpPerCap, year: c.gdpYear ?? null, source: s ? sourceName(db, s) : null, srcId: s ?? null };
}

/** Refugees from the state plus people displaced inside it; null when neither figure exists. */
export function displacedOf(db: DB, c: Country): Shown | null {
  const f = db.figures.country(c.iso3);
  const parts = [f.refugeesFrom, f.idps].filter((x): x is Figure => !!x && ok(x.value));
  if (!parts.length) return null;
  const first = parts[0]!;
  return { ...shown(db, first), value: parts.reduce((s, x) => s + x.value, 0), year: Math.max(...parts.map((x) => x.year)) };
}
