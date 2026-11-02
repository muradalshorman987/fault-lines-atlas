// World Bank Indicators API v2: population, GDP and GDP per capita (current US$), the latest non-empty year per country.
// Licence CC BY 4.0. https://datahelpdesk.worldbank.org/knowledgebase/articles/889392

import { atlasIso } from '../refs';
import type { Fetcher, GeneratedFile, Records } from '../types';

export const WB_INDICATORS = {
  population: { code: 'SP.POP.TOTL', label: { ar: 'السكان', en: 'Population' }, unit: 'people' },
  gdp: { code: 'NY.GDP.MKTP.CD', label: { ar: 'الناتج المحلي الإجمالي (دولار أمريكي جارٍ)', en: 'GDP (current US$)' }, unit: 'USD' },
  gdpPerCapita: { code: 'NY.GDP.PCAP.CD', label: { ar: 'نصيب الفرد من الناتج (دولار أمريكي جارٍ)', en: 'GDP per capita (current US$)' }, unit: 'USD' },
} as const;
type WbId = keyof typeof WB_INDICATORS;

export interface WbRow { countryiso3code: string; date: string; value: number | null }

/** Whole dollars and people for big values, cents below a million: the API's 15 significant digits only add churn. */
const tidy = (v: number) => (Math.abs(v) >= 1e6 ? Math.round(v) : Math.round(v * 100) / 100);

/** Records keyed by atlas ISO3; aggregates (WLD, ARB…) and countries the atlas lacks are dropped. */
export function wbRecords(rows: Partial<Record<WbId, WbRow[]>>, isos: Set<string>): Records {
  const out: Records = {};
  for (const [id, list] of Object.entries(rows) as [WbId, WbRow[]][]) {
    for (const r of list) {
      const iso = atlasIso(r.countryiso3code ?? '');
      const year = parseInt(r.date, 10);
      if (!isos.has(iso) || typeof r.value !== 'number' || !Number.isFinite(r.value) || !year) continue;
      const prev = out[iso]?.[id];
      if (prev && prev.year >= year) continue;
      (out[iso] ??= {})[id] = { value: tidy(r.value), year };
    }
  }
  return out;
}

const API = 'https://api.worldbank.org/v2/country/all/indicator/';

export const worldbank: Fetcher = {
  id: 'worldbank',
  name: 'World Bank',
  async run({ http, refs, now }) {
    const rows: Partial<Record<WbId, WbRow[]>> = {};
    for (const [id, ind] of Object.entries(WB_INDICATORS) as [WbId, (typeof WB_INDICATORS)[WbId]][]) {
      const list: WbRow[] = [];
      for (let page = 1, pages = 1; page <= pages; page++) {
        const body = await http.json<unknown>(`${API}${ind.code}?format=json&mrnev=1&per_page=1000&page=${page}`);
        if (!Array.isArray(body) || body.length < 2 || !Array.isArray(body[1])) {
          throw new Error(`World Bank ${ind.code}: unexpected answer ${JSON.stringify(body).slice(0, 200)}`);
        }
        pages = Number((body[0] as { pages?: number }).pages) || 1;
        list.push(...(body[1] as WbRow[]));
      }
      rows[id] = list;
    }
    const file: GeneratedFile = {
      source: 'worldbank',
      name: 'World Bank',
      licence: 'CC BY 4.0',
      url: 'https://data.worldbank.org/',
      fetchedAt: now.toISOString(),
      keys: 'iso3',
      citation: 'World Bank, World Development Indicators (SP.POP.TOTL, NY.GDP.MKTP.CD, NY.GDP.PCAP.CD), via the Indicators API v2.',
      indicators: Object.fromEntries(Object.entries(WB_INDICATORS).map(([id, i]) => [id, { label: i.label, unit: i.unit }])),
      records: wbRecords(rows, refs.isos),
    };
    return file;
  },
};
