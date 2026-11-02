// Shapes of the data files, for check-data and the open-data pipeline. Lives in scripts/ so zod never ships to the browser.
// Only the fields the app relies on are checked; any other field is allowed.

import { z } from 'zod';
import { SEVERITY } from '../src/config';

const bi = z.object({ ar: z.string(), en: z.string() });
const id = z.string().min(1);
const iso = z.string().regex(/^[A-Z]{3}$/, 'expected a three-letter ISO code');
const date = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'expected YYYY, YYYY-MM or YYYY-MM-DD');

export const conflictFile = z.looseObject({
  region: id,
  regionName: bi,
  conflicts: z.array(z.looseObject({
    id, name: bi, countries: z.array(iso), severity: z.enum(SEVERITY.map((s) => s.id) as [string, ...string[]]),
    externalPowers: z.array(z.looseObject({ iso3: iso })).optional(),
    sourceRefs: z.array(id).optional(),
    unverified: z.boolean().optional(),
    ucdp: z.array(z.number().int().positive()).optional(), // UCDP conflict ids (conflict_new_id) for the deaths series
  })),
});

export const SCHEMAS: Record<string, z.ZodType> = {
  'chokepoints.json': z.looseObject({
    points: z.array(z.looseObject({
      id, ar: z.string(), en: z.string(), borderStates: z.array(iso).optional(), conflictIds: z.array(id).optional(),
      unverified: z.boolean().optional(),
    })),
  }),
  'country_intel.json': z.looseObject({
    countries: z.record(iso, z.looseObject({ blocs: z.array(id).optional(), unverified: z.boolean().optional() })),
  }),
  'ethnic_groups.json': z.looseObject({
    type: z.literal('FeatureCollection'),
    features: z.array(z.looseObject({
      properties: z.looseObject({ groupId: id, nameAr: z.string(), nameEn: z.string(), family: id, countries: z.array(iso).optional() }),
    })),
  }),
  'relations.json': z.looseObject({
    edgeTypes: z.array(z.looseObject({ id })),
    blocs: z.array(z.looseObject({ id, ar: z.string(), en: z.string(), members: z.array(iso) })),
    edges: z.array(z.looseObject({ a: iso, b: iso, type: id, kind: z.enum(['treaty', 'assessed']) })),
    bilateral: z.record(z.string(), z.unknown()),
  }),
  'religions.json': z.looseObject({
    traditions: z.array(z.looseObject({ id, ar: z.string(), en: z.string() })),
    countries: z.record(iso, z.looseObject({ groups: z.record(id, z.number().min(0).max(100)) })),
  }),
  'resources.json': z.looseObject({
    types: z.array(z.looseObject({ id, ar: z.string(), en: z.string() })),
    entries: z.array(z.looseObject({ iso3: iso, type: id, conflictIds: z.array(id).optional() })),
    sites: z.array(z.looseObject({ id, iso3: iso, type: id, ar: z.string(), en: z.string() })),
  }),
  'sources.json': z.looseObject({
    datasets: z.array(z.looseObject({ id })),
    references: z.array(z.looseObject({ id })),
  }),
  'timeline.json': z.looseObject({
    categories: z.array(z.looseObject({ id })),
    events: z.array(z.looseObject({
      id, date, ar: z.string(), en: z.string(), countries: z.array(iso).optional(), conflictIds: z.array(id).optional(),
      unverified: z.boolean().optional(),
    })),
  }),
  'corrections.json': z.array(z.object({ id, where: bi, what: bi })),
};

// ---- generated files (public/data/generated, written by scripts/data; spec §6)

const year = z.number().int().min(1800).max(2200);
const datetime = z.iso.datetime({ message: 'expected an ISO date-time such as 2026-11-02T04:00:00.000Z' });

export const generatedFile = z.looseObject({
  source: id,
  name: z.string().min(1),
  licence: z.string().min(1),
  url: z.string().regex(/^https:\/\//, 'expected an https URL'),
  fetchedAt: datetime,
  keys: z.enum(['iso3', 'conflict']),
  citation: z.string().optional(),
  version: z.string().optional(),
  indicators: z.record(id, z.looseObject({ label: bi, unit: z.string() })),
  records: z.record(id, z.record(id, z.looseObject({
    value: z.number(),
    year,
    series: z.array(z.object({ year, value: z.number() })).optional(),
  }))),
});

const STATES = ['ok', 'unchanged', 'skipped', 'error', 'unavailable'] as const;
export type SourceState = (typeof STATES)[number];

/** _status.json: the last run of each source. `fetchedAt` is when the file in place was fetched (null: never). */
export const statusFile = z.looseObject({
  updatedAt: datetime,
  sources: z.record(id, z.looseObject({
    state: z.enum(STATES),
    checkedAt: datetime,
    fetchedAt: datetime.nullable(),
    message: z.string().optional(),
    records: z.number().int().min(0).optional(),
  })),
  drift: z.looseObject({
    state: z.enum(['ok', 'error']),
    checkedAt: datetime,
    differences: z.number().int().min(0).optional(),
    message: z.string().optional(),
  }).optional(),
});
