// The pipeline's HTTP client: Node fetch with an identifying User-Agent, a timeout and a few retries.
// Errors never carry an API key: every URL in a message goes through redact().
// Behind a TLS-inspecting proxy, run with NODE_OPTIONS=--use-system-ca (never turn TLS checks off).

import type { Http } from './types';

export const USER_AGENT = 'FaultLinesAtlas-data/1.0 (+https://github.com/muradalshorman987/fault-lines-atlas)';

/** Hides secret query parameters (api_key, key, token) in a URL. */
export const redact = (url: string) => url.replace(/([?&](?:api_key|apikey|key|token)=)[^&#]*/gi, '$1***');

export class HttpError extends Error {
  override name = 'HttpError';
  constructor(readonly status: number, url: string, readonly bodyStart = '') {
    super(`HTTP ${status} from ${redact(url)}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const transient = (e: unknown) => !(e instanceof HttpError) || e.status === 429 || e.status >= 500;

export function createHttp({ timeoutMs = 120_000, retries = 2, accept = 'application/json, text/csv, */*' } = {}): Http {
  async function get(url: string, timeout = timeoutMs): Promise<Response> {
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await sleep(1500 * attempt);
      try {
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(timeout) });
        if (res.ok) return res;
        const body = (await res.text().catch(() => '')).slice(0, 2000);
        throw new HttpError(res.status, url, body);
      } catch (e) {
        last = e instanceof HttpError ? e : new Error(`${(e as Error).message} (${redact(url)})`);
        if (!transient(e)) break;
      }
    }
    throw last;
  }
  return {
    json: async <T>(url: string) => (await (await get(url)).json()) as T,
    text: async (url: string) => (await get(url)).text(),
    stream: async (url: string) => {
      const res = await get(url, 15 * 60_000); // bulk downloads (UCDP GED is ~40 MB zipped)
      if (!res.body) throw new Error(`empty body from ${redact(url)}`);
      return res.body;
    },
  };
}
