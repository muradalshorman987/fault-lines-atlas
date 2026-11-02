// Pure helpers for the detailed map: the OpenFreeMap styles, label language, and the paint, filters and camera
// targets derived from the canvas engine's scene. No MapLibre import at runtime (types only).

import * as d3 from 'd3';
import type { Geometry } from 'geojson';
import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl';
import type { Lang } from '../../../i18n/format';
import type { Palette } from '../../../ui/palette';
import type { Bounds, LonLat } from '../engine/geo';
import type { Outline, Scene } from '../engine/scene';

/** OpenFreeMap (no key): Positron for light, Dark for dark; both quiet enough to carry the lens colours. */
export const STYLE_URL = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;

export const SOURCE = 'atlas-countries';
export const POINT_SOURCE = 'atlas-hl-point';
export const LAYER = {
  fill: 'atlas-fill',
  borders: 'atlas-borders',
  outlineDash: 'atlas-outline-dash',
  outline: 'atlas-outline',
  hl: 'atlas-hl',
  hover: 'atlas-hover',
  hlPoint: 'atlas-hl-point',
} as const;
/** Sources the atlas adds itself; errors and tiles from these are not the basemap's. */
export const isOwnSource = (id: unknown) => typeof id === 'string' && id.startsWith('atlas-');

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** Label text: Arabic names (falling back to the local name) or English ones. */
export function labelField(lang: Lang): ExpressionSpecification {
  return lang === 'ar'
    ? ['coalesce', ['get', 'name:ar'], ['get', 'name']]
    : ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];
}

/** Does a text-field show a place name (and not a road number or a house number)? */
export const isNameField = (v: unknown): boolean => /"name/.test(JSON.stringify(v ?? null));

const SPACE_RGB = /^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/;

/** A colour MapLibre parses for sure: the theme tokens use hex and the space-separated CSS Color 4 rgb(). */
export function glColor(c: string | null | undefined, fallback = TRANSPARENT): string {
  if (!c) return fallback;
  const x = d3.color(c);
  if (x) return x.formatRgb();
  const m = SPACE_RGB.exec(c.trim());
  if (!m) return fallback;
  const a = m[4] == null ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})`;
}

/** A `match` on iso3, or the plain fallback when there is nothing to match (MapLibre needs one pair at least). */
export function matchIso<V extends string | number>(pairs: Iterable<[string, V]>, fallback: V): ExpressionSpecification | V {
  const flat: (string | V)[] = [];
  for (const [iso, v] of pairs) flat.push(iso, v);
  return flat.length ? (['match', ['get', 'iso3'], ...flat, fallback] as unknown as ExpressionSpecification) : fallback;
}

export const isoFilter = (iso3: readonly string[]): FilterSpecification => ['in', ['get', 'iso3'], ['literal', [...iso3]]];

/** Land fills fade as the streets come in. */
export const FILL_OPACITY: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 2, 0.62, 6, 0.45, 10, 0.25, 14, 0.12];

interface LinePaint { filter: FilterSpecification; color: ExpressionSpecification | string; width: ExpressionSpecification | number }
export interface ScenePaint { fill: ExpressionSpecification | string; outline: LinePaint; outlineDash: LinePaint }

/**
 * Fill and outlines for the detailed map from the engine's scene, so both maps show the same lens.
 * Countries the lens does not colour stay clear (the basemap shows through); when a selection emphasises some
 * states, the others step back the way the canvas map dims them.
 */
export function scenePaint(sc: Scene, P: Palette, isos: Iterable<string>): ScenePaint {
  const dimTo = P.dark ? d3.interpolateLab(P.landMuted, P.ocean)(0.25) : P.landMuted;
  const fills: [string, string][] = [];
  for (const iso of isos) {
    const col = sc.fill.get(iso);
    const back = !!sc.emph && !sc.emph.has(iso);
    if (col) fills.push([iso, glColor(back ? d3.interpolateLab(col, dimTo)(0.5) : col)]);
    else if (back) fills.push([iso, glColor(dimTo)]);
  }
  // later outlines draw over earlier ones on the canvas, so the last one per country wins here
  const last = new Map<string, Outline>();
  for (const o of sc.outlines) for (const iso of o.iso3) last.set(iso, o);
  const solid = [...last].filter(([, o]) => !o.dash?.length), dashed = [...last].filter(([, o]) => !!o.dash?.length);
  const lines = (list: [string, Outline][]): LinePaint => ({
    filter: isoFilter(list.map(([iso]) => iso)),
    color: matchIso(list.map(([iso, o]): [string, string] => [iso, glColor(o.color)]), glColor(P.sel)),
    width: matchIso(list.map(([iso, o]): [string, number] => [iso, o.width + 0.5]), 2),
  });
  return { fill: matchIso(fills, TRANSPARENT), outline: lines(solid), outlineDash: lines(dashed) };
}

/**
 * Longitude/latitude box around some geometries and points, for fitBounds. When the shapes straddle the
 * antimeridian the east edge runs past 180 so the box stays the short way round.
 */
export function boundsOf(geoms: (Geometry | null | undefined)[], points: LonLat[] = []): Bounds | null {
  const parts: Geometry[] = geoms.filter((g): g is Geometry => !!g);
  if (points.length) parts.push({ type: 'MultiPoint', coordinates: points });
  if (!parts.length) return null;
  const [[w, s], [e, n]] = d3.geoBounds({ type: 'GeometryCollection', geometries: parts });
  if (![w, s, e, n].every(Number.isFinite)) return null;
  return [[w, s], [e < w ? e + 360 : e, n]];
}
