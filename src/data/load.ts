// Fetches every data file and builds the model. Progress is reported per file (0–1).
// Core files must all load. Generated open-data files load after them and are optional: only those _status.json lists
// are requested, and a missing, unreachable or malformed one is skipped, so the atlas falls back to Natural Earth (D10).

import { build } from './build';
import { FILES, GENERATED, GENERATED_STATUS } from './files';
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

/** Source ids that _status.json lists with a file in place (a `fetchedAt` date). Empty when the status file is missing or odd. */
async function presentSources(base: string): Promise<Set<string>> {
  try {
    const res = await fetch(base + GENERATED_STATUS);
    if (!res.ok) return new Set();
    const data: unknown = await res.json();
    const sources = data && typeof data === 'object' && !Array.isArray(data) ? (data as { sources?: unknown }).sources : null;
    if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return new Set();
    return new Set(Object.entries(sources)
      .filter(([, s]) => !!s && typeof s === 'object' && typeof (s as { fetchedAt?: unknown }).fetchedAt === 'string')
      .map(([id]) => id));
  } catch {
    return new Set(); // unreachable or not JSON: load no generated files, the atlas falls back to Natural Earth
  }
}

/** The generated files that _status.json lists, loaded and checked, in GENERATED order. Never throws.
 *  `onEach` fires once per GENERATED entry, requested or skipped, so progress still ends at 1. */
export async function loadGenerated(base: string, onEach: (file: string) => void = () => {}): Promise<GeneratedFile[]> {
  const present = await presentSources(base);
  const got = await Promise.all(Object.entries(GENERATED).map(async ([id, file]) => {
    if (!present.has(id)) { onEach(file); return null; }
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
