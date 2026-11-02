// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { eia, eiaRecords } from '../scripts/data/fetchers/eia';
import { HttpError, redact } from '../scripts/data/http';
import { fakeCtx, fakeHttp } from './data-fakes';

const isos = new Set(['SAU', 'QAT', 'KOS']);
const row = (country: string, period: string, value: string) => ({ countryRegionId: country, countryRegionTypeId: 'c', period, value });

describe('EIA', () => {
  test('is skipped cleanly when EIA_API_KEY is not set', async () => {
    const http = fakeHttp({});
    expect(await eia.run(fakeCtx({ http, isos }))).toEqual({ skip: 'EIA_API_KEY is not set' });
    expect(http.calls).toEqual([]);
  });

  test('keeps the latest numeric year per country; NA, "--" and unknown codes are skipped', () => {
    const records = eiaRecords({
      oil: [row('SAU', '2025', '9548.75'), row('SAU', '2024', '9208.67'), row('QAT', '2025', 'NA'), row('QAT', '2024', '1300.5'), row('WORL', '2025', '80000')],
      gas: [row('QAT', '2024', '170.1'), row('XKS', '2024', '--')],
    }, isos);
    expect(records).toEqual({
      SAU: { 'prod:oil': { value: 9548.75, year: 2025 } },
      QAT: { 'prod:oil': { value: 1300.5, year: 2024 }, 'prod:gas': { value: 170.1, year: 2024 } },
    });
  });

  test('reads every page, and the key never appears in an error', async () => {
    const page = (offset: number) => ({ response: { total: '3', data: offset === 0 ? [row('SAU', '2025', '1'), row('QAT', '2025', '2')] : [row('KOS', '2025', '3')] } });
    const http = fakeHttp({ 'api.eia.gov': (url) => page(Number(new URL(url).searchParams.get('offset'))) });
    const file = await eia.run(fakeCtx({ http, isos, env: { EIA_API_KEY: 'secret-key-123' } }));
    if ('skip' in file) throw new Error('skipped');
    expect(file.records.KOS).toBeDefined();
    expect(Object.keys(file.indicators)).toEqual(['prod:oil', 'prod:gas']);

    http.routes['api.eia.gov'] = (url) => { throw new HttpError(500, url, 'boom'); };
    const err = await eia.run(fakeCtx({ http, isos, env: { EIA_API_KEY: 'secret-key-123' } })).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain('secret-key-123');
    expect(redact('https://api.eia.gov/v2/x?api_key=abc&frequency=annual')).toBe('https://api.eia.gov/v2/x?api_key=***&frequency=annual');
  });
});
