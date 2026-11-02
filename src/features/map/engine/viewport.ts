// What the map shows: the countries inside the current view, for the `viewport` event ("figures follow the map").
// Pure functions: the canvas engine passes its projection parameters, the detailed map passes its bounds.

import * as d3 from 'd3';
import type { Feature, Geometry, Polygon } from 'geojson';
import type { Bounds, LonLat } from './geo';

/** The canvas engine's view: projection parameters and canvas size in CSS pixels. */
export interface ViewSpec {
  mode: 'globe' | 'flat';
  /** d3 rotation [λ, φ] (the globe's centre is [-λ, -φ]); ignored by the flat map. */
  rotate: [number, number];
  scale: number;
  translate: [number, number];
  width: number;
  height: number;
}
export interface ViewItem { iso3: string; feature: Feature }
export interface BoxItem { iso3: string; bbox: Bounds }

/**
 * The camera both maps share when the projection changes: centre and Web Mercator zoom (512 px tiles).
 * The canvas engine converts it to its own scale with scaleFromZoom / zoomFromScale.
 */
export interface MapView { center: LonLat; zoom: number }

/** Pixels per radian at the equator for a Web Mercator zoom, and back. */
export const scaleFromZoom = (zoom: number) => (512 * 2 ** zoom) / (2 * Math.PI);
export const zoomFromScale = (scale: number) => Math.log2((scale * 2 * Math.PI) / 512);

/**
 * Countries with some geometry inside the canvas: on the near hemisphere of the globe, or inside the frame of the
 * flat map. Each shape is clipped to the visible side and to the canvas; whatever survives is visible.
 */
export function visibleCountries(view: ViewSpec, items: Iterable<ViewItem>): string[] {
  const proj = view.mode === 'globe'
    ? d3.geoOrthographic().clipAngle(90).rotate([view.rotate[0], view.rotate[1], 0])
    : d3.geoEqualEarth();
  proj.scale(view.scale).translate(view.translate).clipExtent([[0, 0], [view.width, view.height]]).precision(1);
  const path = d3.geoPath(proj);
  const out: string[] = [];
  for (const { iso3, feature } of items) {
    const [[x0, y0], [x1, y1]] = path.bounds(feature);
    if (Number.isFinite(x0) && Number.isFinite(y0) && x1 >= x0 && y1 >= y0) out.push(iso3);
  }
  return out.sort();
}

/**
 * Longitude/latitude boxes of the countries, one per polygon so far-flung parts (France's overseas departments,
 * Alaska) do not stretch one box across half the world. West > east when a part crosses the antimeridian.
 */
export function countryBoxes(items: Iterable<ViewItem>): BoxItem[] {
  const out: BoxItem[] = [];
  for (const { iso3, feature } of items) {
    const g = feature.geometry;
    if (!g) continue;
    const parts: Geometry[] = g.type === 'MultiPolygon' ? g.coordinates.map((coordinates): Polygon => ({ type: 'Polygon', coordinates })) : [g];
    for (const part of parts) {
      const b = d3.geoBounds(part);
      if (Number.isFinite(b[0][0])) out.push({ iso3, bbox: b });
    }
  }
  return out;
}

/** [west, east] as an increasing interval (east may pass 180). */
const span = (w: number, e: number): [number, number] => (e < w ? [w, e + 360] : [w, e]);

function lonOverlap([a0, a1]: [number, number], [b0, b1]: [number, number]): boolean {
  for (const k of [-360, 0, 360]) if (a0 <= b1 + k && b0 + k <= a1) return true;
  return false;
}

/**
 * Countries whose box meets the view box. The view may run past ±180° (MapLibre's world copies); a view wider
 * than the world matches every box.
 */
export function visibleInBounds(bounds: Bounds, boxes: Iterable<BoxItem>): string[] {
  const [[w, s], [e, n]] = bounds;
  const whole = e - w >= 360;
  const shift = Math.floor((w + 180) / 360) * 360; // bring the west edge into [-180, 180)
  const view: [number, number] = [w - shift, e - shift];
  const out = new Set<string>();
  for (const { iso3, bbox } of boxes) {
    if (out.has(iso3)) continue;
    const [[bw, bs], [be, bn]] = bbox;
    if (bn < s || bs > n) continue;
    if (whole || lonOverlap(view, span(bw, be))) out.add(iso3);
  }
  return [...out].sort();
}
