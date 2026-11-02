// Fetches every data file and builds the model. Progress is reported per file (0–1).
// Core files must all load. Generated open-data files load after them and are optional: a missing, unreachable
// or malformed one is skipped, so the atlas falls back to Natural Earth's figures (D10).

import { build } from './build';
import { FILES, GENERATED } from './files';
import { isGeneratedFile, type GeneratedFile } from './join';
import type { DB, RawData } from './types';

export async function loadAll(onProgress: (p: number, file: string) => void = () => {}, base = import.meta.env.BASE_URL + 'data/'): Promise<DB> {
  const entries = Object.entries(FILES);
  const total = entries.length + Object.keys(GENERATED).length;
  const raw: Record<string, unknown> = {};
  let done = 0;
  await Promise.all(entries.map(async ([key, file]) => {
    const res = await fetch(base + file);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    raw[key] = await res.json();
    onProgress(++done / total, file);
  }));
  const generated = await loadGenerated(base, (file) => onProgress(++done / total, file));
  return build(raw as unknown as RawData, generated);
}

/** The generated files that loaded and look right, in GENERATED order. Never throws. */
export async function loadGenerated(base: string, onEach: (file: string) => void = () => {}): Promise<GeneratedFile[]> {
  const got = await Promise.all(Object.values(GENERATED).map(async (file) => {
    try {
      const res = await fetch(base + file);
      if (!res.ok) return null;
      const data: unknown = await res.json();
      return isGeneratedFile(data) ? data : null;
    } catch {
      return null; // unreachable or not JSON (e.g. an HTML fallback page): the file is optional, so skip it
    } finally {
      onEach(file);
    }
  }));
  return got.filter((f): f is GeneratedFile => f !== null);
}
