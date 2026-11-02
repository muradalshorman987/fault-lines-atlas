import { act, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { atlas } from '../src/app/store';
import { DbContext } from '../src/app/useT';
import { build } from '../src/data/build';
import type { GeneratedFile } from '../src/data/join';
import type { DB } from '../src/data/types';
import { SourcesView } from '../src/features/views/sources';
import '../src/i18n/core';
import { readRaw } from './helpers/readRaw';

const gen = (source: string, name: string, extra: Partial<GeneratedFile> = {}): GeneratedFile => ({
  source, name, licence: 'CC BY 4.0', url: `https://example.org/${source}`, fetchedAt: '2026-11-02T04:00:00.000Z', keys: 'iso3',
  indicators: {}, records: {}, ...extra,
});

let withData: DB, without: DB;
beforeAll(() => {
  const raw = readRaw();
  withData = build(raw, [gen('worldbank', 'World Bank'), gen('ucdp', 'UCDP', { keys: 'conflict', citation: 'Sundberg, Ralph and Erik Melander (2013)' })]);
  without = build(raw);
});
afterEach(() => atlas.reset());

const view = (db: DB) => render(<DbContext.Provider value={db}><SourcesView /></DbContext.Provider>);

describe('Sources view: open data', () => {
  test('lists each generated source with its licence, link and fetch date', () => {
    act(() => { atlas.set({ lang: 'en' }); });
    const { container } = view(withData);
    const items = [...container.querySelectorAll('.src-gen > li')];
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('World Bank');
    expect(items[0]).toHaveTextContent('CC BY 4.0');
    expect(items[0]).toHaveTextContent('2 Nov 2026');
    expect(items[0]!.querySelector('a')).toHaveAttribute('href', 'https://example.org/worldbank');
    expect(items[1]).toHaveTextContent('Sundberg, Ralph and Erik Melander (2013)');
  });

  test('is labelled in Arabic too', () => {
    const { container } = view(withData);
    expect(container.querySelector('#src-gen-h')).toHaveTextContent('بيانات مفتوحة');
  });

  test('is absent until the pipeline has produced a file', () => {
    const { container } = view(without);
    expect(container.querySelector('.src-gen')).toBeNull();
  });
});
