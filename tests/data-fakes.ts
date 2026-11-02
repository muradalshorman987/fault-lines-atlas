// Fakes for the data-pipeline tests: an HTTP client that answers from routes, and a fetch context. No network.

import type { AtlasRefs, FetchContext, Http } from '../scripts/data/types';

type Body = unknown;
type Route = (url: string) => Body | Promise<Body>;

/** Answers each request from the first route whose key is part of the URL. A route that throws fails the request. */
export function fakeHttp(routes: Record<string, Route>): Http & { routes: Record<string, Route>; calls: string[] } {
  const calls: string[] = [];
  const answer = async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`no fake route for ${url}`);
    return routes[key]!(url);
  };
  const bytes = (b: Body) => (b instanceof Uint8Array ? b : new TextEncoder().encode(typeof b === 'string' ? b : JSON.stringify(b)));
  return {
    routes,
    calls,
    json: async <T>(url: string) => (await answer(url)) as T,
    text: async (url: string) => { const b = await answer(url); return typeof b === 'string' ? b : JSON.stringify(b); },
    stream: async (url: string) => {
      const data = bytes(await answer(url));
      return new ReadableStream<Uint8Array>({
        start(c) { for (let i = 0; i < data.length; i += 1000) c.enqueue(data.slice(i, i + 1000)); c.close(); },
      });
    },
  };
}

export function fakeRefs(over: Partial<AtlasRefs> = {}): AtlasRefs {
  return {
    isos: new Set(['SAU', 'KOS']),
    qidToIso: new Map(),
    names: new Map(),
    conflicts: [],
    resourceTypes: new Map([['oil', { ar: 'النفط', en: 'Oil' }], ['gas', { ar: 'الغاز الطبيعي', en: 'Natural gas' }]]),
    blocs: [],
    ...over,
  };
}

export function fakeCtx(o: { http: Http; env?: Record<string, string | undefined>; now?: Date } & Partial<AtlasRefs>): FetchContext {
  const { http, env = {}, now = new Date('2026-11-02T08:00:00Z'), ...refs } = o;
  return { http, env, now, refs: fakeRefs(refs), log: () => {} };
}
