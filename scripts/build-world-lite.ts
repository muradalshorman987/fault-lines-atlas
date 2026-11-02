// Builds public/world-lite.json, the small world the living loader draws while the atlas data loads (spec 2026-11-02).
// Natural Earth countries are projected with Equal Earth into a fixed viewBox. Rings are cut into arcs at the points
// where neighbours meet, each arc is simplified once, and rings are stitched back from the simplified arcs, so a
// shared border is the same line in both countries. Conflict anchors and a few bloc constellations come from the model.
// Run `npm run build:world-lite` after changing countries.json, the conflict files or relations.json.

import fs from 'node:fs';
import path from 'node:path';
import { geoEqualEarth, geoGraticule, geoStream, type GeoProjection, type GeoStream } from 'd3';
import type { Geometry } from 'geojson';
import { build } from '../src/data/build';
import { FILES } from '../src/data/files';
import type { RawData } from '../src/data/types';
import type { WorldLite, XY } from '../src/features/boot/worldLite';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'public/data');
const OUT = path.join(ROOT, 'public/world-lite.json');

const WIDTH = 1000;          // viewBox width; the height follows from the land's extent
const PAD = 6;               // viewBox units around the land
const TOLERANCE = 1.15;      // Douglas–Peucker tolerance, viewBox units
const MIN_AREA = 3;          // rings smaller than this (square viewBox units) are dropped
const SOUTH_LIMIT = -58;     // Antarctica and the far-south islands stay out of the backdrop
const BLOCS = ['nato', 'arab-league', 'brics', 'sco'];
const MAX_LABELS = 6;
// Name boxes in viewBox units, for 12px text at desktop size (the loader shows fewer names on phones).
const CHAR_W = 4.6, LINE_H = 11, MAX_W = 105, LABEL_OFF = 5;
const FOCUS: XY = [45, 25];  // lon/lat narrow screens centre on
const CONTINENTS: Record<string, string> = {
  'North America': 'north-america', 'South America': 'south-america', Europe: 'europe', Africa: 'africa', Asia: 'asia', Oceania: 'oceania',
};

// ---------------------------------------------------------------- projection

/** Projected rings of a geometry (antimeridian cut by d3), without the closing point or repeated points. */
function project(proj: GeoProjection, geometry: Geometry): XY[][] {
  const rings: XY[][] = [];
  let cur: XY[] = [];
  const sink: GeoStream = {
    point(x, y) {
      const last = cur[cur.length - 1];
      if (!last || last[0] !== x || last[1] !== y) cur.push([x, y]);
    },
    lineStart() { cur = []; },
    lineEnd() {
      const first = cur[0], last = cur[cur.length - 1];
      if (first && last && cur.length > 1 && first[0] === last[0] && first[1] === last[1]) cur.pop();
      if (cur.length > 2) rings.push(cur);
    },
    polygonStart() { /* rings arrive through lineStart/lineEnd */ },
    polygonEnd() { /* nothing to close */ },
    sphere() { /* not drawn */ },
  };
  geoStream(geometry, proj.stream(sink));
  return rings;
}

// ---------------------------------------------------------------- arcs

const key = (p: XY) => `${p[0]},${p[1]}`;

/** Points where more than two distinct neighbours meet: the ends of shared borders. */
function junctions(rings: XY[][]): Set<string> {
  const near = new Map<string, Set<string>>();
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const k = key(r[i]!);
      let s = near.get(k);
      if (!s) near.set(k, (s = new Set()));
      s.add(key(r[(i + r.length - 1) % r.length]!));
      s.add(key(r[(i + 1) % r.length]!));
    }
  }
  return new Set([...near].filter(([, s]) => s.size > 2).map(([k]) => k));
}

interface ArcRef { arc: number; reversed: boolean }

/** Cut every ring into arcs between junctions; identical arcs (either direction) are stored once. */
function cutArcs(rings: XY[][], junction: Set<string>) {
  const arcs: XY[][] = [];
  const byKey = new Map<string, number>();
  const intern = (pts: XY[], closed: boolean): ArcRef => {
    let fwd = pts, back = [...pts].reverse();
    if (closed) {
      // A ring with no junction: start both directions at its smallest point so rotations match.
      const turn = (a: XY[]) => { let m = 0; a.forEach((p, i) => { if (key(p) < key(a[m]!)) m = i; }); return [...a.slice(m), ...a.slice(0, m)]; };
      fwd = turn(pts.slice(0, -1)); back = turn([...fwd].reverse());
      fwd.push(fwd[0]!); back.push(back[0]!);
    }
    const kf = fwd.map(key).join(';'), kb = back.map(key).join(';');
    const reversed = kb < kf;
    const k = reversed ? kb : kf;
    let id = byKey.get(k);
    if (id === undefined) { id = arcs.length; arcs.push(reversed ? back : fwd); byKey.set(k, id); }
    return { arc: id, reversed };
  };
  const refs = rings.map((r) => {
    const start = r.findIndex((p) => junction.has(key(p)));
    if (start < 0) return [intern([...r, r[0]!], true)];
    const ring = [...r.slice(start), ...r.slice(0, start), r[start]!];
    const out: ArcRef[] = [];
    let from = 0;
    for (let i = 1; i < ring.length; i++) {
      if (i === ring.length - 1 || junction.has(key(ring[i]!))) { out.push(intern(ring.slice(from, i + 1), false)); from = i; }
    }
    return out;
  });
  return { arcs, refs };
}

/** Douglas–Peucker, keeping both ends. */
function simplify(pts: XY[], tol: number): XY[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a]!, [bx, by] = pts[b]!;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let far = -1, best = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > best) { best = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const round = (n: number) => Math.round(n * 2) / 2; // half-unit grid
const area = (r: XY[]) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]!; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

// ---------------------------------------------------------------- path text

/** Shortest decimal form: 0.5 → .5, -0.5 → -.5, 3.0 → 3. */
const num = (n: number) => String(Math.round(n * 100) / 100).replace(/^(-?)0\./, '$1.');

/** Join numbers the way SVG parses them: a separator only where the next number has no sign of its own. */
function seq(nums: number[]): string {
  let s = '';
  for (const n of nums) {
    const t = num(n);
    s += s && !t.startsWith('-') && !(t.startsWith('.') && /\.\d*$/.test(s)) ? ' ' + t : t;
  }
  return s;
}

/** A closed ring as M x y l dx dy … z (relative steps keep the numbers short). */
function ringPath(r: XY[]): string {
  const [x0, y0] = r[0]!;
  const steps: number[] = [];
  for (let i = 1; i < r.length; i++) steps.push(r[i]![0] - r[i - 1]![0], r[i]![1] - r[i - 1]![1]);
  return `M${seq([x0, y0])}l${seq(steps)}z`;
}

function linePath(lines: XY[][]): string {
  return lines.filter((l) => l.length > 1).map((l) => {
    const steps: number[] = [];
    for (let i = 1; i < l.length; i++) steps.push(l[i]![0] - l[i - 1]![0], l[i]![1] - l[i - 1]![1]);
    return `M${seq(l[0]!)}l${seq(steps)}`;
  }).join('');
}

type Box = [number, number, number, number]; // x0 y0 x1 y1

function labelBox(x: number, y: number, len: number, side: 'above' | 'below'): Box {
  const w = Math.min(len * CHAR_W, MAX_W), h = Math.ceil((len * CHAR_W) / MAX_W) * LINE_H;
  return side === 'above' ? [x - w / 2, y - LABEL_OFF - h, x + w / 2, y - LABEL_OFF] : [x - w / 2, y + LABEL_OFF, x + w / 2, y + LABEL_OFF + h];
}
const overlaps = (a: Box, b: Box, m = 3) => a[0] < b[2] + m && b[0] < a[2] + m && a[1] < b[3] + m && b[1] < a[3] + m;

/** Minimum spanning tree over points (Prim); returns index pairs. */
function spanningTree(pts: XY[]): [number, number][] {
  if (pts.length < 2) return [];
  const inTree = new Set([0]);
  const edges: [number, number][] = [];
  while (inTree.size < pts.length) {
    let best: [number, number] | null = null, bestD = Infinity;
    for (const i of inTree) {
      for (let j = 0; j < pts.length; j++) {
        if (inTree.has(j)) continue;
        const d = Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1]);
        if (d < bestD) { bestD = d; best = [i, j]; }
      }
    }
    edges.push(best!);
    inTree.add(best![1]);
  }
  return edges;
}

// ---------------------------------------------------------------- build

function readRaw(): RawData {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(FILES)) out[k] = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
  return out as unknown as RawData;
}

export function buildWorldLite(raw: RawData): WorldLite {
  const db = build(raw);
  const features = raw.countries.features.filter((f) => CONTINENTS[String(f.properties.continent)]);

  // Fit Equal Earth to the width, then crop the viewBox to the land north of SOUTH_LIMIT.
  const proj = geoEqualEarth().precision(0).fitWidth(WIDTH, { type: 'Sphere' });
  const perFeature = features.map((f) => project(proj, f.geometry));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of perFeature.flat(2)) {
    if (proj.invert!(p)![1] <= SOUTH_LIMIT) continue;
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  minX -= PAD; maxX += PAD; minY -= PAD; maxY += PAD;
  const s = WIDTH / (maxX - minX);
  const tx = (p: XY): XY => [(p[0] - minX) * s, (p[1] - minY) * s];
  const height = Math.ceil((maxY - minY) * s);
  const at = (lonlat: [number, number]): XY => { const p = tx(proj(lonlat)!); return [round(p[0]), round(p[1])]; };

  // Rings (moved into the viewBox), cut into shared arcs, simplified once, rebuilt.
  const rings: XY[][] = [], owner: number[] = [];
  perFeature.forEach((rs, fi) => { for (const r of rs) { rings.push(r.map(tx)); owner.push(fi); } });
  const { arcs, refs } = cutArcs(rings, junctions(rings));
  const simple = arcs.map((a) => {
    const out: XY[] = [];
    for (const p of simplify(a, TOLERANCE)) {
      const q: XY = [round(p[0]), round(p[1])];
      const last = out[out.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
    }
    return out;
  });
  const byContinent = new Map<string, { x: number; d: string }[]>();
  refs.forEach((rr, ri) => {
    const pts: XY[] = [];
    for (const { arc, reversed } of rr) {
      const a = reversed ? [...simple[arc]!].reverse() : simple[arc]!;
      for (const p of a) { const l = pts[pts.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) pts.push(p); }
    }
    if (pts.length > 1 && key(pts[0]!) === key(pts[pts.length - 1]!)) pts.pop();
    if (pts.length < 3 || area(pts) < MIN_AREA) return;
    const cont = CONTINENTS[String(features[owner[ri]!]!.properties.continent)]!;
    if (proj.invert!([pts[0]![0] / s + minX, pts[0]![1] / s + minY])![1] < SOUTH_LIMIT) return;
    let list = byContinent.get(cont);
    if (!list) byContinent.set(cont, (list = []));
    list.push({ x: Math.min(...pts.map((p) => p[0])), d: ringPath(pts) });
  });
  const land = [...byContinent].map(([id, list]) => ({ id, x: Math.min(...list.map((r) => r.x)), d: list.sort((a, b) => a.x - b.x).map((r) => r.d).join('') }))
    .sort((a, b) => a.x - b.x).map(({ id, d }) => ({ id, d }));

  // Graticule every 30°, clipped to the viewBox by the page.
  const grat = project(proj, geoGraticule().step([30, 30])()).map((l) => simplify(l.map(tx), 0.4).map((p): XY => [round(p[0]), round(p[1])]));

  // Conflicts, most severe first. Names go to the most severe file of each region first, then to the next most
  // severe, each above or below its dot where it overlaps no other name.
  const conflicts: WorldLite['conflicts'] = [];
  for (const c of db.conflicts) {
    const a = db.anchorOf('conflict', c.id);
    if (!a) continue;
    const [x, y] = at(a);
    conflicts.push({ id: c.id, sev: c.severity, x, y, ar: c.name.ar, en: c.name.en });
  }
  const firstOfRegion = new Set([...new Map(db.conflicts.map((c) => [c.region, c.id] as const).reverse()).values()]);
  const boxes: Box[] = [];
  for (const row of [...conflicts.filter((r) => firstOfRegion.has(r.id)), ...conflicts.filter((r) => !firstOfRegion.has(r.id))]) {
    if (boxes.length >= MAX_LABELS) break;
    const len = Math.max(row.ar.length, row.en.length);
    for (const side of ['above', 'below'] as const) {
      const b = labelBox(row.x, row.y, len, side);
      if (b[0] >= 0 && b[2] <= WIDTH && b[1] >= 0 && b[3] <= height && !boxes.some((o) => overlaps(o, b))) { row.label = side; boxes.push(b); break; }
    }
  }

  const blocs = BLOCS.map((id) => db.relations.blocById.get(id)).filter((b) => !!b).map((b) => {
    const pts = b.members.map((iso) => db.anchorOf('country', iso)).filter((a): a is [number, number] => !!a).map(at);
    const d = linePath(spanningTree(pts).map(([i, j]) => [pts[i]!, pts[j]!]));
    // The name sits at the member nearest the constellation's centre.
    const cx = pts.reduce((n, p) => n + p[0], 0) / pts.length, cy = pts.reduce((n, p) => n + p[1], 0) / pts.length;
    const at0 = pts.reduce((best, p) => (Math.hypot(p[0] - cx, p[1] - cy) < Math.hypot(best[0] - cx, best[1] - cy) ? p : best), pts[0]!);
    return { id: b.id, ar: b.ar, en: b.en, at: at0, pts, d };
  });

  const [fx, fy] = at(FOCUS);
  return { v: 1, viewBox: [0, 0, WIDTH, height], focus: [fx, fy], graticule: linePath(grat), land, conflicts, blocs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const out = buildWorldLite(readRaw());
  const text = JSON.stringify(out) + '\n';
  fs.writeFileSync(OUT, text);
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`world-lite.json: ${kb(Buffer.byteLength(text))} (land ${kb(out.land.reduce((n, l) => n + l.d.length, 0))}, ` +
    `${out.conflicts.length} conflicts, ${out.blocs.length} blocs, viewBox ${out.viewBox.join(' ')})`);
}
