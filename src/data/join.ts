// Joins the generated open-data files (public/data/generated, written by scripts/data) onto the model (D5).
// The files are optional: a missing or malformed one is skipped, and Natural Earth stays the fallback (D10).

import type { Bi } from '../i18n/format';
import type { CountryFigureId, Figure, Figures, FigureSource } from './figures';

export interface GeneratedValue { value: number; year: number; series?: { year: number; value: number }[] }

/** One file per source, as spec §6 describes it. `keys` says whether records are keyed by ISO3 or by conflict id. */
export interface GeneratedFile {
  source: string;
  name: string;
  licence: string;
  url: string;
  fetchedAt: string;
  keys: 'iso3' | 'conflict';
  citation?: string;
  version?: string;
  indicators: Record<string, { label: Bi; unit: string }>;
  records: Record<string, Record<string, GeneratedValue>>;
}

const ISO_ALIAS: Record<string, string> = { XKX: 'KOS' };
const COUNTRY_IDS: readonly CountryFigureId[] = ['population', 'gdp', 'gdpPerCapita', 'refugeesFrom', 'refugeesIn', 'idps'];

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isValue = (v: unknown): v is GeneratedValue =>
  isObj(v) && isNum(v.value) && isNum(v.year)
  && (v.series === undefined || (Array.isArray(v.series) && v.series.every((p) => isObj(p) && isNum(p.year) && isNum(p.value))));

/** A light structural check (the browser has no zod; check-data validates the files fully before they ship). */
export function isGeneratedFile(x: unknown): x is GeneratedFile {
  if (!isObj(x)) return false;
  const { source, name, licence, url, fetchedAt, keys, indicators, records } = x;
  if (![source, name, licence, url, fetchedAt].every((s) => typeof s === 'string' && s)) return false;
  if (keys !== 'iso3' && keys !== 'conflict') return false;
  if (!isObj(indicators) || !isObj(records)) return false;
  return Object.values(records).every((r) => isObj(r) && Object.values(r).every(isValue));
}

/** db.figures: the first file (in GENERATED order) that has a value wins. */
export function buildFigures(files: readonly GeneratedFile[]): Figures {
  const countries = new Map<string, Partial<Record<CountryFigureId, Figure>>>();
  const deaths = new Map<string, { year: number; value: number }[]>();
  for (const f of files) {
    for (const [rawKey, rec] of Object.entries(f.records)) {
      if (f.keys === 'conflict') {
        const d = rec.deaths;
        if (d && !deaths.has(rawKey)) deaths.set(rawKey, d.series?.length ? d.series.map((p) => ({ year: p.year, value: p.value })) : [{ year: d.year, value: d.value }]);
        continue;
      }
      const iso = ISO_ALIAS[rawKey] ?? rawKey;
      const out = countries.get(iso) ?? {};
      for (const id of COUNTRY_IDS) {
        const v = rec[id];
        if (!v || out[id]) continue;
        const unit = f.indicators[id]?.unit;
        out[id] = { value: v.value, year: v.year, source: f.source, ...(unit ? { unit } : {}) };
      }
      if (Object.keys(out).length) countries.set(iso, out);
    }
  }
  const sources: FigureSource[] = files.map((f) => ({
    id: f.source, name: f.name, licence: f.licence, url: f.url, fetchedAt: f.fetchedAt, ...(f.citation ? { citation: f.citation } : {}),
  }));
  return {
    country: (iso3) => ({ ...countries.get(ISO_ALIAS[iso3] ?? iso3) }),
    conflictDeaths: (id) => [...(deaths.get(id) ?? [])],
    sources,
  };
}
