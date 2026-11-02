// USGS Mineral Commodity Summaries data release: mine production and reserves by country, for the resource types the
// atlas already lists (D12). US Government work, public domain (CC0). https://doi.org/10.5066/P1WKQ63T
//
// The release lives on ScienceBase, which (as of Nov 2026) answers scripts with a Cloudflare challenge. That is recorded
// as "unavailable" and the last good file stays. To refresh by hand, download the CSV in a browser and run
//   USGS_MCS_CSV=path/to/MCS2026_ALLchapters_Reconcile.csv npm run data:update -- --only usgs
// Each year, point USGS_ITEM at the new release's ScienceBase item (see docs/DATA.md).

import fs from 'node:fs';
import { csvRecords } from '../csv';
import { HttpError } from '../http';
import { normName } from '../refs';
import { SourceUnavailable, type AtlasRefs, type Fetcher, type GeneratedFile, type Records } from '../types';

/** ScienceBase item of the MCS 2026 world-production table (MCS2026_ALLchapters_Reconcile.csv). */
export const USGS_ITEM = '69837e43b66b01367d7ec7c7';

/** MCS commodity names → atlas resource types. Uranium, jade, oil and gas are not in the MCS; EIA covers oil and gas. */
const COMMODITIES: [RegExp, string][] = [
  [/^lithium/i, 'lithium'], [/^cobalt/i, 'cobalt'], [/^tantalum/i, 'coltan'], [/^rare earth/i, 'rare-earths'],
  [/^phosphate rock/i, 'phosphate'], [/^gold/i, 'gold'], [/^copper/i, 'copper'], [/^potash/i, 'potash'],
  [/^bromine/i, 'bromine'], [/^nickel/i, 'nickel'], [/^uranium/i, 'uranium'],
];

/** MCS spellings that differ from Natural Earth's names. */
const COUNTRY_ALIAS: Record<string, string> = {
  'burma': 'MMR', 'congo kinshasa': 'COD', 'congo brazzaville': 'COG', 'korea north': 'PRK', 'korea republic of': 'KOR',
  'korea south': 'KOR', 'russia': 'RUS', 'turkey': 'TUR', 'turkiye': 'TUR', 'laos': 'LAO', 'vietnam': 'VNM', 'iran': 'IRN',
  'syria': 'SYR', 'bolivia': 'BOL', 'tanzania': 'TZA', 'cote d ivoire': 'CIV', 'czechia': 'CZE', 'czech republic': 'CZE',
  'united states': 'USA', 'united kingdom': 'GBR', 'venezuela': 'VEN', 'kyrgyzstan': 'KGZ', 'moldova': 'MDA',
  'macedonia': 'MKD', 'north macedonia': 'MKD', 'eswatini': 'SWZ', 'swaziland': 'SWZ', 'brunei': 'BRN',
};

const numeric = (v: string) => (/^-?[\d,]+(\.\d+)?$/.test(v.trim()) ? Number(v.replace(/,/g, '')) : null);

export function usgsRecords(rows: Record<string, string>[], refs: Pick<AtlasRefs, 'isos' | 'names' | 'resourceTypes'>) {
  const records: Records = {};
  const indicators: GeneratedFile['indicators'] = {};
  for (const r of rows) {
    const type = COMMODITIES.find(([re]) => re.test(r.Commodity ?? ''))?.[1];
    const label = type ? refs.resourceTypes.get(type) : undefined;
    if (!type || !label) continue;
    const stat = `${r.Statistics ?? ''} ${r.Statistics_detail ?? ''}`;
    const kind = /reserve/i.test(stat) ? 'reserves' : /mine production/i.test(stat) ? 'prod' : null;
    if (!kind) continue; // refinery, smelter, consumption, prices…
    const name = normName(r.Country ?? '');
    const iso = COUNTRY_ALIAS[name] ?? refs.names.get(name);
    const value = numeric(r.Value ?? ''), year = parseInt(r.Year ?? '', 10);
    if (!iso || !refs.isos.has(iso) || value === null || !year) continue; // world totals, "Other countries", W, NA, XX
    const id = `${kind}:${type}`;
    const prev = records[iso]?.[id];
    if (prev && prev.year >= year) continue;
    (records[iso] ??= {})[id] = { value, year };
    indicators[id] ??= {
      label: kind === 'prod' ? { ar: `إنتاج ${label.ar}`, en: `${label.en} production` } : { ar: `احتياطيات ${label.ar}`, en: `${label.en} reserves` },
      unit: (r.Unit ?? '').trim(),
    };
  }
  return { indicators, records };
}

const isChallenge = (e: unknown) => e instanceof HttpError && (e.status === 403 || e.status === 503) && /just a moment|cloudflare|cf-chl/i.test(e.bodyStart);

export const usgs: Fetcher = {
  id: 'usgs',
  name: 'USGS',
  async run({ http, refs, now, env }) {
    let text: string;
    const manual = env.USGS_MCS_CSV;
    try {
      if (manual) text = /^https?:\/\//.test(manual) ? await http.text(manual) : fs.readFileSync(manual, 'utf8');
      else {
        const item = await http.json<{ files?: { name: string; url?: string; downloadUri?: string }[] }>(`https://www.sciencebase.gov/catalog/item/${USGS_ITEM}?format=json`);
        const f = item.files?.find((x) => /\.csv$/i.test(x.name) && /reconcile|world/i.test(x.name));
        const url = f?.url ?? f?.downloadUri;
        if (!url) throw new Error(`ScienceBase item ${USGS_ITEM} lists no world-production CSV`);
        text = await http.text(url);
      }
    } catch (e) {
      if (isChallenge(e)) throw new SourceUnavailable('ScienceBase answers scripts with a Cloudflare challenge (HTTP 403); set USGS_MCS_CSV to a downloaded copy');
      throw e;
    }
    const { indicators, records } = usgsRecords(csvRecords(text), refs);
    if (!Object.keys(records).length) throw new Error('the MCS CSV produced no figures for the atlas resource types; its columns may have changed');
    const file: GeneratedFile = {
      source: 'usgs',
      name: 'USGS',
      licence: 'Public domain (US Government work, CC0)',
      url: 'https://doi.org/10.5066/P1WKQ63T',
      fetchedAt: now.toISOString(),
      keys: 'iso3',
      citation: 'U.S. Geological Survey, Mineral Commodity Summaries 2026 data release, https://doi.org/10.5066/P1WKQ63T.',
      indicators,
      records,
    };
    return file;
  },
};
