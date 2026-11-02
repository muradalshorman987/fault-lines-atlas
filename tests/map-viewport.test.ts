import * as d3 from 'd3';
import { beforeAll, describe, expect, test } from 'vitest';
import { build } from '../src/data/build';
import type { DB } from '../src/data/types';
import { countryBoxes, visibleCountries, visibleInBounds, type BoxItem, type ViewItem, type ViewSpec } from '../src/features/map/engine/viewport';
import { readRaw } from './helpers/readRaw';

let db: DB;
let items: ViewItem[];
let boxes: BoxItem[];
beforeAll(() => {
  db = build(readRaw());
  items = db.features.map((f) => ({ iso3: f.properties.iso3, feature: f }));
  boxes = countryBoxes(items);
});

const W = 800, H = 600;
/** A globe centred on [lon, lat]: d3 rotates by the opposite angles. */
const globe = (lon: number, lat: number, scale: number): ViewSpec => ({ mode: 'globe', rotate: [-lon, -lat], scale, translate: [W / 2, H / 2], width: W, height: H });
/** A flat Equal Earth map whose centre shows [lon, lat]. */
function flat(lon: number, lat: number, scale: number): ViewSpec {
  const p = d3.geoEqualEarth().scale(scale).translate([0, 0])([lon, lat])!;
  return { mode: 'flat', rotate: [0, 0], scale, translate: [W / 2 - p[0], H / 2 - p[1]], width: W, height: H };
}

describe('visibleCountries (canvas engine)', () => {
  test('the whole globe over the Middle East shows the near hemisphere only', () => {
    const v = visibleCountries(globe(35, 25, 250), items);
    for (const iso of ['SAU', 'EGY', 'IRN', 'TUR', 'FRA', 'IND']) expect(v).toContain(iso);
    // New England (≈82° away) and Brazil's eastern tip (≈76°) are on the near side; these are not
    for (const iso of ['MEX', 'PER', 'CHL', 'ARG', 'NZL']) expect(v).not.toContain(iso);
    expect(v).toContain('USA');
  });

  test('turning the globe to the Americas swaps the hemispheres', () => {
    const v = visibleCountries(globe(-80, 10, 250), items);
    for (const iso of ['USA', 'BRA', 'COL']) expect(v).toContain(iso);
    for (const iso of ['SAU', 'IND', 'CHN']) expect(v).not.toContain(iso);
  });

  test('a close-up keeps only what falls inside the canvas', () => {
    // 2000 px per radian: France is ~35° from the centre, i.e. well beyond the 400 px half-width
    const v = visibleCountries(globe(45, 24, 2000), items);
    expect(v).toContain('SAU');
    for (const iso of ['FRA', 'GBR', 'CHN', 'ZAF']) expect(v).not.toContain(iso);
  });

  test('the flat map over Europe keeps Europe and drops the far side of the world', () => {
    const v = visibleCountries(flat(10, 50, 1400), items);
    for (const iso of ['FRA', 'DEU', 'POL']) expect(v).toContain(iso);
    for (const iso of ['AUS', 'BRA', 'USA', 'ZAF']) expect(v).not.toContain(iso);
  });

  test('the whole flat world shows every country with geometry', () => {
    const scale = d3.geoEqualEarth().fitExtent([[14, 14], [W - 14, H - 14]], { type: 'Sphere' }).scale();
    const v = visibleCountries(flat(0, 0, scale), items);
    expect(v.length).toBe(items.length);
  });

  test('the result is sorted and has no duplicates', () => {
    const v = visibleCountries(globe(35, 25, 250), items);
    expect([...v].sort()).toEqual(v);
    expect(new Set(v).size).toBe(v.length);
  });
});

describe('visibleInBounds (detailed map)', () => {
  test('a box over Europe keeps Europe', () => {
    const v = visibleInBounds([[-10, 35], [30, 60]], boxes);
    for (const iso of ['FRA', 'DEU', 'ITA']) expect(v).toContain(iso);
    for (const iso of ['AUS', 'USA', 'BRA']) expect(v).not.toContain(iso);
  });

  test('Chukotka, east of 180°, still counts as Russia', () => {
    expect(visibleInBounds([[-179, 64], [-172, 68]], boxes)).toContain('RUS');
  });

  test('a box that crosses the antimeridian matches views on either side of it', () => {
    const across: BoxItem[] = [{ iso3: 'XXA', bbox: [[170, -25], [-170, -10]] }];
    expect(visibleInBounds([[175, -20], [178, -15]], across)).toEqual(['XXA']);
    expect(visibleInBounds([[-175, -20], [-172, -15]], across)).toEqual(['XXA']);
    expect(visibleInBounds([[-160, -20], [-150, -15]], across)).toEqual([]);
  });

  test('a view across the antimeridian works with east past 180 or west past −180', () => {
    for (const b of [[[170, -25], [190, -10]], [[-190, -25], [-170, -10]]] as [[number, number], [number, number]][]) {
      const v = visibleInBounds(b, boxes);
      expect(v).toContain('FJI');
      expect(v).not.toContain('AUS');
    }
  });

  test('a view wider than the world shows everything, each country once', () => {
    const all = new Set(boxes.map((b) => b.iso3));
    expect(visibleInBounds([[-400, -85], [400, 85]], boxes)).toEqual([...all].sort());
  });

  test("a close-up of Cairo is Egypt only: France's overseas parts have boxes of their own", () => {
    expect(visibleInBounds([[31.1, 29.9], [31.4, 30.2]], boxes)).toEqual(['EGY']);
    // and France still shows over Réunion
    expect(visibleInBounds([[55.1, -21.5], [55.9, -20.8]], boxes)).toContain('FRA');
  });
});
