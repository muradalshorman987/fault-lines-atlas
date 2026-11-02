// UNHCR Refugee Data Finder API: refugees and other people in need of international protection, by country of origin
// and of asylum, and internally displaced people, for the latest year that has data. Licence CC BY 4.0.
// UNRWA-registered Palestine refugees are outside UNHCR's statistics and are not included.
// https://api.unhcr.org/docs/refugee-statistics.html

import { atlasIso } from '../refs';
import type { Fetcher, GeneratedFile, Http, Records } from '../types';

const API = 'https://api.unhcr.org/population/v1/population/';

/** UNHCR sends counts as numbers, numeric strings, or "-" for not applicable. */
export const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

interface FromRow { coo_iso?: string; refugees?: unknown; oip?: unknown; idps?: unknown }
interface InRow { coa_iso?: string; refugees?: unknown; oip?: unknown }
interface Page<T> { page: number; maxPages: number; items: T[] }

/** Refugees under UNHCR's mandate plus other people in need of international protection (oip): UNHCR counts most
 *  Venezuelans abroad as oip, so refugees alone would show about 0.4 million instead of about 6.5 million. */
const inNeed = (r: { refugees?: unknown; oip?: unknown }) => (num(r.refugees) ?? 0) + (num(r.oip) ?? 0);

/** Zero counts are left out: the atlas shows "no figure" rather than ranking every state at zero. */
export function unhcrRecords(from: FromRow[], into: InRow[], year: number, isos: Set<string>): Records {
  const out: Records = {};
  const put = (code: string | undefined, id: string, v: number | null) => {
    const iso = atlasIso(code ?? '');
    if (!isos.has(iso) || !v) return;
    (out[iso] ??= {})[id] = { value: v, year };
  };
  for (const r of from) { put(r.coo_iso, 'refugeesFrom', inNeed(r)); put(r.coo_iso, 'idps', num(r.idps)); }
  for (const r of into) put(r.coa_iso, 'refugeesIn', inNeed(r));
  return out;
}

async function all<T>(http: Http, year: number, by: 'coo_all' | 'coa_all'): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const body = await http.json<Page<T>>(`${API}?limit=1000&yearFrom=${year}&yearTo=${year}&${by}=true&page=${page}`);
    if (!body || !Array.isArray(body.items)) throw new Error(`UNHCR ${by} ${year}: unexpected answer`);
    pages = Number(body.maxPages) || 1;
    items.push(...body.items);
  }
  return items;
}

/** The newest year (this year back to three years ago) for which the API returns any rows. */
async function latestYear(http: Http, now: Date): Promise<number> {
  for (let y = now.getUTCFullYear(); y >= now.getUTCFullYear() - 3; y--) {
    const body = await http.json<Page<unknown>>(`${API}?limit=1&yearFrom=${y}&yearTo=${y}&coo_all=true&page=1`);
    if (body?.items?.length) return y;
  }
  throw new Error('UNHCR: no data for the last four years');
}

export const unhcr: Fetcher = {
  id: 'unhcr',
  name: 'UNHCR',
  async run({ http, refs, now }) {
    const year = await latestYear(http, now);
    const from = await all<FromRow>(http, year, 'coo_all');
    const into = await all<InRow>(http, year, 'coa_all');
    const file: GeneratedFile = {
      source: 'unhcr',
      name: 'UNHCR',
      licence: 'CC BY 4.0',
      url: 'https://www.unhcr.org/refugee-statistics/',
      fetchedAt: now.toISOString(),
      keys: 'iso3',
      citation: 'UNHCR Refugee Data Finder (Refugee Population Statistics Database), via the UNHCR population API. '
        + 'Refugee figures are refugees under UNHCR’s mandate plus other people in need of international protection. '
        + 'Palestine refugees registered with UNRWA are not included (they fall under UNRWA’s mandate, not UNHCR’s).',
      indicators: {
        refugeesFrom: {
          label: { ar: 'اللاجئون وغيرهم ممّن يحتاجون إلى حماية دولية، من هذه الدولة (المفوضية)', en: 'Refugees and others in need of international protection, from this state (UNHCR)' },
          unit: 'people',
        },
        refugeesIn: {
          label: { ar: 'اللاجئون وغيرهم ممّن يحتاجون إلى حماية دولية، المستضافون (المفوضية)', en: 'Refugees and others in need of international protection, hosted (UNHCR)' },
          unit: 'people',
        },
        idps: { label: { ar: 'النازحون داخلياً', en: 'Internally displaced people' }, unit: 'people' },
      },
      records: unhcrRecords(from, into, year, refs.isos),
    };
    return file;
  },
};
