// Shared shapes for the open-data pipeline (scripts/data). The generated-file shape itself lives in src/data/join.ts,
// because the app reads the same files.

import type { Bi } from '../../src/i18n/format';
import type { GeneratedFile, GeneratedValue } from '../../src/data/join';

export type { GeneratedFile, GeneratedValue };
export type Records = GeneratedFile['records'];

/** What a fetcher needs to know about the atlas, read once from public/data (see refs.ts). */
export interface AtlasRefs {
  /** Natural Earth ISO3 codes the atlas has a country for. */
  isos: Set<string>;
  /** Wikidata item id → ISO3, from Natural Earth's wikidataid. */
  qidToIso: Map<string, string>;
  /** Normalised country name (normName) → ISO3, for sources that only give names. */
  names: Map<string, string>;
  conflicts: { id: string; started?: string; ucdp?: number[] }[];
  resourceTypes: Map<string, Bi>;
  blocs: { id: string; en: string; members: string[] }[];
}

export interface Http {
  json<T = unknown>(url: string): Promise<T>;
  text(url: string): Promise<string>;
  stream(url: string): Promise<ReadableStream<Uint8Array>>;
}

export interface FetchContext {
  now: Date;
  refs: AtlasRefs;
  env: Record<string, string | undefined>;
  http: Http;
  log(msg: string): void;
}

/** A fetcher returns the new file, or `{ skip }` when it is not configured (e.g. no API key). It throws on failure. */
export interface Fetcher {
  id: string;
  name: string;
  run(ctx: FetchContext): Promise<GeneratedFile | { skip: string }>;
}

/** The source refuses scripted access (e.g. a Cloudflare challenge). Recorded as "unavailable", not as a transient error. */
export class SourceUnavailable extends Error {
  override name = 'SourceUnavailable';
}
