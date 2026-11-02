// Invariants of the curated data: they hold for any correct edit, so contributors can add, fix or remove records
// without touching this file. Exact numbers are never pinned here; the model is checked against the files it was built from.

import { beforeAll, describe, expect, test } from 'vitest';
import { build } from '../src/data/build';
import { CONFLICT_FILES } from '../src/data/files';
import type { Conflict, DB, Kind, RawData, Site } from '../src/data/types';
import { readRaw } from './helpers/readRaw';

let raw: RawData;
let db: DB;
beforeAll(() => { raw = readRaw(); db = build(raw); });

const ISO_ALIAS: Record<string, string> = { XKX: 'KOS' }; // the same alias build() applies
const fix = (iso: string) => ISO_ALIAS[iso] ?? iso;
const conflictsInFiles = () => CONFLICT_FILES.flatMap((k) => raw[k].conflicts);
const dupes = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);

describe('the model counts what the files hold', () => {
  test('every stat equals the length of its source list', () => {
    expect(db.stats).toEqual({
      countries: new Set(raw.countries.features.map((f) => f.properties.iso3)).size,
      conflicts: conflictsInFiles().length,
      groups: new Set(raw.ethnic.features.map((f) => f.properties.groupId)).size,
      religionCountries: new Set(Object.keys(raw.religions.countries).map(fix)).size,
      edges: raw.relations.edges.length,
      blocs: raw.relations.blocs.length,
      events: raw.timeline.events.length,
      chokepoints: raw.choke.points.length,
      sites: raw.resources.sites.length,
      disputed: raw.disputed.features.length,
    });
  });

  test('ids are unique within each kind, across all five conflict files', () => {
    expect(dupes(conflictsInFiles().map((c) => c.id))).toEqual([]);
    expect(dupes(raw.timeline.events.map((e) => e.id))).toEqual([]);
    expect(dupes(raw.choke.points.map((p) => p.id))).toEqual([]);
    expect(dupes(raw.resources.sites.map((s) => s.id))).toEqual([]);
    expect(dupes(raw.relations.blocs.map((b) => b.id))).toEqual([]);
  });

  test('every record in the files can be looked up', () => {
    for (const c of conflictsInFiles()) expect(db.exists('conflict', c.id), `conflict ${c.id}`).toBe(true);
    for (const e of raw.timeline.events) expect(db.exists('event', e.id), `event ${e.id}`).toBe(true);
    for (const p of raw.choke.points) expect(db.exists('choke', p.id), `choke ${p.id}`).toBe(true);
    for (const s of raw.resources.sites) expect(db.exists('site', s.id), `site ${s.id}`).toBe(true);
    for (const b of raw.relations.blocs) expect(db.exists('bloc', b.id), `bloc ${b.id}`).toBe(true);
  });
});

describe('corrections (shown on the Sources page)', () => {
  test('every correction has a unique id and says where and what, in both languages', () => {
    const list = raw.corrections ?? [];
    expect(db.corrections).toHaveLength(list.length);
    expect(dupes(list.map((c) => c.id))).toEqual([]);
    for (const c of list) {
      expect(c.id, 'correction id').toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      for (const lang of ['ar', 'en'] as const) {
        expect(c.where[lang]?.trim(), `${c.id}.where.${lang}`).toBeTruthy();
        expect(c.what[lang]?.trim(), `${c.id}.what.${lang}`).toBeTruthy();
      }
    }
  });

  // Guards against undoing a published correction by accident. If you change one of these records on purpose,
  // update the matching entry in corrections.json and this check together.
  test('the corrections stay applied to the records they fixed', () => {
    const c = db.get('conflict', 'lebanon-israel') as Conflict & { territorialClaims: { en: string } };
    expect(c.territorialClaims.en).toContain('has held the Shebaa Farms since 1967');
    expect(db.relations.blocById.get('brics')?.members).toContain('IDN');
    expect(db.resources.sites.find((x: Site) => /Hpakant/.test(x.en))?.type).toBe('jade');
  });
});

describe('unverified flags', () => {
  /** Every record the files mark `"unverified": true`, as the model names it. */
  function flaggedInFiles(): [Kind, string][] {
    return [
      ...conflictsInFiles().filter((c) => c.unverified === true).map((c): [Kind, string] => ['conflict', c.id]),
      ...raw.timeline.events.filter((e) => e.unverified === true).map((e): [Kind, string] => ['event', e.id]),
      ...raw.choke.points.filter((p) => p.unverified === true).map((p): [Kind, string] => ['choke', p.id]),
      ...Object.entries(raw.intel.countries).filter(([, v]) => v.unverified === true).map(([iso]): [Kind, string] => ['country', fix(iso)]),
    ];
  }

  /** Every record the model reports as unverified. */
  function flaggedInModel(): [Kind, string][] {
    const ids: [Kind, string[]][] = [
      ['conflict', db.conflicts.map((c) => c.id)],
      ['event', db.timeline.events.map((e) => e.id)],
      ['choke', db.chokepoints.map((p) => p.id)],
      ['country', [...db.countries.keys()]],
      ['site', db.resources.sites.map((s) => s.id)],
      ['bloc', db.relations.blocs.map((b) => b.id)],
      ['group', [...db.ethnic.groups.keys()]],
      ['religion', db.religion.traditions.map((t) => t.id)],
    ];
    return ids.flatMap(([kind, list]) => list.filter((id) => db.isUnverified(kind, id)).map((id): [Kind, string] => [kind, id]));
  }

  test('every flag points to a record on the map', () => {
    for (const [kind, id] of flaggedInFiles()) expect(db.exists(kind, id), `${kind} ${id}`).toBe(true);
  });

  test('the model flags exactly the records the files flag', () => {
    const key = ([kind, id]: [Kind, string]) => `${kind}:${id}`;
    expect(flaggedInModel().map(key).sort()).toEqual(flaggedInFiles().map(key).sort());
  });
});
