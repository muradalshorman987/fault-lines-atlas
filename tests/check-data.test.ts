import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { checkData } from '../scripts/check-data';
import { formatJson } from '../scripts/format-json';
import { build } from '../src/data/build';
import { DATA_DIR, readRaw } from './helpers/readRaw';

describe('check-data', () => {
  test('the repository data is clean', () => expect(checkData(DATA_DIR)).toEqual([]));

  describe('a contributor typo', () => {
    let dir: string;
    let ci: number, cj: number, ek: number;
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-check-'));
      fs.cpSync(DATA_DIR, dir, { recursive: true });
      const af = path.join(dir, 'curated/conflicts/africa.json');
      const africa = JSON.parse(fs.readFileSync(af, 'utf8'));
      ci = africa.conflicts.findIndex((c: { id: string }) => c.id === 'sudan');
      cj = africa.conflicts[ci].countries.push('SDX') - 1;
      fs.writeFileSync(af, formatJson(africa));
      const tf = path.join(dir, 'curated/timeline.json');
      const tl = JSON.parse(fs.readFileSync(tf, 'utf8'));
      ek = tl.events.findIndex((e: { id: string }) => e.id === 'halabja');
      tl.events[ek].conflictIds = ['nope'];
      fs.writeFileSync(tf, formatJson(tl));
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('is reported with file, path and value', () => {
      const lines = checkData(dir).map((p) => `${p.file} › ${p.path} › ${JSON.stringify(p.value)}`);
      expect(lines).toEqual([
        `conflicts/africa.json › conflicts[${ci}].countries[${cj}] › "SDX"`,
        `timeline.json › events[${ek}].conflictIds[0] › "nope"`,
      ]);
    });

    test('does not break the model build', () => expect(() => build(readRaw(dir))).not.toThrow());
  });

  describe('generated files and the ucdp field', () => {
    let dir: string;
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-check-'));
      fs.cpSync(DATA_DIR, dir, { recursive: true });
      fs.mkdirSync(path.join(dir, 'generated'), { recursive: true });
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
    const write = (rel: string, data: unknown) => fs.writeFileSync(path.join(dir, rel), typeof data === 'string' ? data : formatJson(data));
    const lines = () => checkData(dir).map((p) => `${p.file} › ${p.path} › ${p.message}`);
    const good = {
      source: 'test', name: 'Test', licence: 'CC BY 4.0', url: 'https://example.org/', fetchedAt: '2026-11-02T04:00:00.000Z', keys: 'iso3',
      indicators: { population: { label: { ar: 'السكان', en: 'Population' }, unit: 'people' } },
      records: { SAU: { population: { value: 1, year: 2025 } } },
    };

    test('a well-formed generated file passes', () => {
      write('generated/test.json', good);
      expect(lines().filter((l) => l.startsWith('generated/'))).toEqual([]);
    });

    test('a malformed generated file is reported with file and path', () => {
      write('generated/test.json', {
        ...good,
        records: { SDX: { population: { value: 1, year: 2025 } }, SAU: { population: { value: 'many', year: 2025 }, area: { value: 2, year: 2025 } } },
      });
      expect(lines()).toEqual(expect.arrayContaining([
        'generated/test.json › records.SAU.population.value › Invalid input: expected number, received string',
      ]));
      write('generated/test.json', { ...good, records: { SDX: { population: { value: 1, year: 2025 } }, SAU: { area: { value: 2, year: 2025 } } } });
      expect(lines()).toEqual(expect.arrayContaining([
        'generated/test.json › records.SDX › unknown country code',
        'generated/test.json › records.SAU.area › indicator not declared in "indicators"',
      ]));
    });

    test('a generated file named after another source, or not JSON, is reported', () => {
      write('generated/test.json', { ...good, source: 'other' });
      expect(lines()).toContain('generated/test.json › source › must match the file name ("test")');
      write('generated/test.json', '{ nope');
      expect(lines().some((l) => l.startsWith('generated/test.json ›  › not valid JSON'))).toBe(true);
      fs.rmSync(path.join(dir, 'generated/test.json'));
    });

    test('a conflict file keyed by an unknown conflict, and a bad ucdp id, are reported', () => {
      write('generated/conf.json', { ...good, source: 'conf', keys: 'conflict', records: { nope: { population: { value: 1, year: 2025 } } } });
      const af = path.join(dir, 'curated/conflicts/africa.json');
      const africa = JSON.parse(fs.readFileSync(af, 'utf8'));
      const i = africa.conflicts.findIndex((c: { id: string }) => c.id === 'sudan');
      const before = africa.conflicts[i].ucdp;
      africa.conflicts[i].ucdp = ['309'];
      write('curated/conflicts/africa.json', africa);
      expect(lines()).toContain(`conflicts/africa.json › conflicts[${i}].ucdp[0] › Invalid input: expected number, received string`);
      africa.conflicts[i].ucdp = before;
      write('curated/conflicts/africa.json', africa);
      expect(lines()).toContain('generated/conf.json › records.nope › unknown conflict id');
      fs.rmSync(path.join(dir, 'generated/conf.json'));
    });
  });

  test('a hand-edited file still gets its link errors reported', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-check-'));
    try {
      fs.cpSync(DATA_DIR, dir, { recursive: true });
      const tf = path.join(dir, 'curated/timeline.json');
      const tl = JSON.parse(fs.readFileSync(tf, 'utf8'));
      const k = tl.events.findIndex((e: { id: string }) => e.id === 'halabja');
      tl.events[k].countries = ['IRX'];
      fs.writeFileSync(tf, JSON.stringify(tl, null, 2));
      const lines = checkData(dir).map((p) => `${p.file} › ${p.path} › ${p.message}`);
      expect(lines).toContain('timeline.json ›  › not in the canonical layout; run npm run format-data');
      expect(lines).toContain(`timeline.json › events[${k}].countries[0] › unknown country code`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
