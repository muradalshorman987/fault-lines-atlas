// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { blocDrift, fetchDrift, BLOC_QIDS } from '../scripts/data/fetchers/wikidata';
import { fakeCtx, fakeHttp } from './data-fakes';
import { readRaw } from './helpers/readRaw';

const now = new Date('2026-11-02T00:00:00Z');
const qidToIso = new Map([['Q851', 'SAU'], ['Q252', 'IDN'], ['Q858', 'SYR'], ['Q1036', 'UGA']]);
const blocs = [{ id: 'brics', en: 'BRICS', members: ['SAU'] }, { id: 'arab-league', en: 'Arab League', members: ['SAU', 'SYR'] }];
const b = (country: string, bloc: string, start?: string, end?: string) => ({
  country: { value: `http://www.wikidata.org/entity/${country}` }, bloc: { value: `http://www.wikidata.org/entity/${bloc}` },
  ...(start ? { start: { value: start } } : {}), ...(end ? { end: { value: end } } : {}),
});

describe('Wikidata bloc drift', () => {
  const rows = [
    b('Q252', BLOC_QIDS.brics!, '2025-01-06T00:00:00Z'),          // Indonesia joined: only in Wikidata
    b('Q858', BLOC_QIDS['arab-league']!, '1945-03-22T00:00:00Z', '2011-11-12T00:00:00Z'),
    b('Q858', BLOC_QIDS['arab-league']!, '2023-05-07T00:00:00Z'), // Syria re-admitted: current, no drift
    b('Q851', BLOC_QIDS['arab-league']!),
    b('Q1036', BLOC_QIDS['arab-league']!, '2030-01-01T00:00:00Z'), // a future start date is not membership yet
    b('Q999999', BLOC_QIDS.brics!),                               // not an atlas country
    { ...b('Q756617', BLOC_QIDS.brics!), iso: { value: 'BRA' } },   // another item for an atlas country: matched by its ISO code
  ];
  const refs = { qidToIso, blocs: [{ ...blocs[0]!, members: ['SAU', 'BRA'] }, blocs[1]!], isos: new Set(['SAU', 'IDN', 'SYR', 'UGA', 'BRA']) };

  test('lists members found only in Wikidata and only in the atlas, with dates', () => {
    expect(blocDrift(rows, refs, now)).toEqual([
      { bloc: 'brics', name: 'BRICS', qid: BLOC_QIDS.brics, onlyWikidata: [{ iso3: 'IDN', since: '2025-01-06' }], onlyAtlas: [{ iso3: 'SAU' }] },
    ]);
  });

  test('the query asks for membership (P463) statements and returns the drift', async () => {
    const http = fakeHttp({ 'query.wikidata.org/sparql': () => ({ results: { bindings: rows } }) });
    const drift = await fetchDrift(fakeCtx({ http, ...refs }));
    expect(drift.map((d) => d.bloc)).toEqual(['brics']);
    expect(decodeURIComponent(http.calls[0]!)).toContain('P463');
  });

  test('every curated bloc has a Wikidata item', () => {
    expect(Object.keys(BLOC_QIDS).sort()).toEqual(readRaw().relations.blocs.map((x) => x.id).sort());
  });
});
