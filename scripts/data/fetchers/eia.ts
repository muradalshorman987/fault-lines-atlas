// U.S. Energy Information Administration, API v2 /international: crude oil and dry natural gas production by country.
// Public domain (US Government work). Needs a free key in EIA_API_KEY (https://www.eia.gov/opendata/register.php);
// without it the source is skipped and the last file stays. The key is sent only to api.eia.gov and never logged.
//
// Only the atlas resource types oil and gas (D12): coal is not one of them. Reserves are not offered by the
// /international route's activity facets, so only production is fetched.

import { atlasIso } from '../refs';
import type { Fetcher, GeneratedFile, Records } from '../types';

const API = 'https://api.eia.gov/v2/international/data/';

export const EIA_SERIES = [
  { type: 'oil', productId: 57, unit: 'TBPD', unitLabel: 'thousand barrels per day', label: { ar: 'إنتاج النفط الخام', en: 'Crude oil production' } },
  { type: 'gas', productId: 26, unit: 'BCM', unitLabel: 'billion cubic metres', label: { ar: 'إنتاج الغاز الطبيعي الجاف', en: 'Dry natural gas production' } },
] as const;
type EiaType = (typeof EIA_SERIES)[number]['type'];

export interface EiaRow { countryRegionId: string; countryRegionTypeId?: string; period: string; value: string | number | null }

/** The latest year with a numeric value per country ("NA" and "--" are not values). */
export function eiaRecords(rows: Partial<Record<EiaType, EiaRow[]>>, isos: Set<string>): Records {
  const out: Records = {};
  for (const [type, list] of Object.entries(rows) as [EiaType, EiaRow[]][]) {
    const id = `prod:${type}`;
    for (const r of list) {
      const iso = atlasIso(r.countryRegionId), year = parseInt(r.period, 10);
      const value = typeof r.value === 'number' ? r.value : /^-?\d+(\.\d+)?$/.test(String(r.value ?? '').trim()) ? Number(r.value) : NaN;
      if (!isos.has(iso) || !year || !Number.isFinite(value)) continue;
      const prev = out[iso]?.[id];
      if (prev && prev.year >= year) continue;
      (out[iso] ??= {})[id] = { value: Math.round(value * 1000) / 1000, year };
    }
  }
  return out;
}

export const eia: Fetcher = {
  id: 'eia',
  name: 'EIA',
  async run({ http, refs, now, env }) {
    const key = env.EIA_API_KEY?.trim();
    if (!key) return { skip: 'EIA_API_KEY is not set' };
    const rows: Partial<Record<EiaType, EiaRow[]>> = {};
    const start = now.getUTCFullYear() - 6;
    for (const s of EIA_SERIES) {
      const list: EiaRow[] = [];
      for (let offset = 0, total = 1; offset < total;) { // the API caps a page at 5000 rows; step by what it sent
        const q = new URLSearchParams({
          api_key: key, frequency: 'annual', 'data[0]': 'value', 'facets[productId][]': String(s.productId), 'facets[activityId][]': '1',
          'facets[unit][]': s.unit, 'facets[countryRegionTypeId][]': 'c', start: String(start), offset: String(offset), length: '5000',
        });
        const body = await http.json<{ response?: { total?: string | number; data?: EiaRow[] } }>(`${API}?${q}`);
        const data = body.response?.data;
        if (!Array.isArray(data)) throw new Error(`EIA product ${s.productId}: unexpected answer`);
        total = Number(body.response?.total) || 0;
        list.push(...data);
        if (!data.length) break;
        offset += data.length;
      }
      rows[s.type] = list;
    }
    const file: GeneratedFile = {
      source: 'eia',
      name: 'EIA',
      licence: 'Public domain (US Government work)',
      url: 'https://www.eia.gov/international/data/world',
      fetchedAt: now.toISOString(),
      keys: 'iso3',
      citation: 'U.S. Energy Information Administration, International Energy Statistics, via API v2 (/international).',
      indicators: Object.fromEntries(EIA_SERIES.map((s) => [`prod:${s.type}`, { label: s.label, unit: s.unitLabel }])),
      records: eiaRecords(rows, refs.isos),
    };
    return file;
  },
};
