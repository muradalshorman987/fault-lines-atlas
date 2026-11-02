// Shape of public/world-lite.json: the small pre-projected world the living loader draws while the data loads.
// scripts/build-world-lite.ts writes it (npm run build:world-lite); every coordinate is already in viewBox units.

export type XY = [number, number];

export interface WorldLite {
  v: 1;
  /** [0, 0, width, height] in the units of every path and point below. */
  viewBox: [number, number, number, number];
  /** Where narrow screens centre the map (the Middle East). */
  focus: XY;
  /** Meridians and parallels every 30°. */
  graticule: string;
  /** Land per continent, west to east; shared borders are identical in both neighbours. */
  land: { id: string; d: string }[];
  /** Conflict anchors (db.anchorOf), most severe first; the few the loader names say where the name goes. */
  conflicts: { id: string; sev: string; x: number; y: number; ar: string; en: string; label?: 'above' | 'below' }[];
  /** Bloc "constellations": member anchors, the lines that join them (a minimum spanning tree) and where the name goes. */
  blocs: { id: string; ar: string; en: string; at: XY; pts: XY[]; d: string }[];
}

/** Fetches the outline; resolves to null when it is missing or malformed (the loader then runs without a map). */
export async function loadWorldLite(url = import.meta.env.BASE_URL + 'world-lite.json'): Promise<WorldLite | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const w = (await res.json()) as Partial<WorldLite>;
    return w && w.v === 1 && Array.isArray(w.viewBox) && Array.isArray(w.land) ? (w as WorldLite) : null;
  } catch {
    return null; // the outline is decoration: the loader still shows its stages and the data still loads
  }
}
