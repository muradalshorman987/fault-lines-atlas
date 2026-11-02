// Ask Claude with the visitor's own key (spec §7, M6): key dialog, request shape, streaming, tool loop,
// safe rendering, errors, Stop, and the append-only history that keeps Claude's thinking blocks valid.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { on } from '../src/app/events';
import { atlas } from '../src/app/store';
import { DbContext } from '../src/app/useT';
import { build } from '../src/data/build';
import type { DB } from '../src/data/types';
import { AskPanel } from '../src/features/ask';
import { API_URL, API_VERSION } from '../src/features/ask/api';
import { MAX_QUESTIONS, MAX_TOOL_ROUNDS } from '../src/features/ask/conversation';
import { KEY_STORAGE, keyStore, resetKeyMemory } from '../src/features/ask/key';
import { DEFAULT_MODEL } from '../src/features/ask/models';
import '../src/i18n/core';
import { translate } from '../src/i18n/strings';
import { readRaw } from './helpers/readRaw';

const KEY = 'sk-ant-api03-TEST-0123456789abcdefghijklmnop';
let db: DB;
beforeAll(() => { db = build(readRaw()); });

// ------------------------------------------------------------------ SSE fakes

const enc = new TextEncoder();
const ev = (type: string, data: Record<string, unknown> = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const start = (model = 'claude-sonnet-5-5') =>
  ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } });
const thinking = (index: number, sig: string) => [
  ev('content_block_start', { index, content_block: { type: 'thinking', thinking: '' } }),
  ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: sig } }),
  ev('content_block_stop', { index }),
];
const finish = (stop: string) => [ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 9 } }), ev('message_stop')];

function textReply(text: string, stop = 'end_turn'): string[] {
  return [
    start(), ...thinking(0, 'sig-text'),
    ev('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }),
    ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text } }),
    ev('content_block_stop', { index: 1 }),
    ...finish(stop),
  ];
}
function toolReply(id: string, name: string, input: Record<string, unknown>): string[] {
  const json = JSON.stringify(input);
  const half = Math.floor(json.length / 2);
  return [
    start(), ...thinking(0, `sig-${id}`),
    ev('content_block_start', { index: 1, content_block: { type: 'tool_use', id, name, input: {} } }),
    ev('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: json.slice(0, half) } }),
    ev('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: json.slice(half) } }),
    ev('content_block_stop', { index: 1 }),
    ...finish('tool_use'),
  ];
}

/** A finished SSE body, cut at odd byte offsets so the parser has to join events across chunks. */
function streamOf(events: string[]): ReadableStream<Uint8Array> {
  const bytes = enc.encode(events.join(''));
  return new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
      c.close();
    },
  });
}
/** A body the test feeds by hand. */
function liveStream() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { ctl = c; } });
  return { body, push: (...events: string[]) => ctl.enqueue(enc.encode(events.join(''))), close: () => ctl.close() };
}
const sse = (body: ReadableStream<Uint8Array>) => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
const apiError = (status: number, type: string, message: string) =>
  new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status, headers: { 'content-type': 'application/json' } });

type Reply = Response | (() => Response | Promise<Response>) | Error;
let queue: Reply[] = [];
const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
  const next = queue.shift();
  if (!next) throw new Error('no reply queued');
  if (next instanceof Error) throw next;
  return typeof next === 'function' ? next() : next;
});
const reply = (...r: Reply[]) => { queue.push(...r); };

interface Sent { url: string; headers: Record<string, string>; body: Record<string, unknown>; signal: AbortSignal | null }
function sent(i: number): Sent {
  const call = fetchMock.mock.calls[i];
  if (!call) throw new Error(`no request #${i}`);
  const [url, init] = call;
  return {
    url: String(url),
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    signal: init?.signal ?? null,
  };
}
type Msg = { role: string; content: string | Record<string, unknown>[] };
const msgs = (i: number) => sent(i).body.messages as Msg[];

// ------------------------------------------------------------------ UI helpers

const en = (key: string, vars?: Record<string, string | number>) => translate('en', key, vars);
const panel = () => document.getElementById('ask')!;
const q = <E extends Element = HTMLElement>(sel: string) => panel().querySelector<E>(sel);
const mount = () => {
  const r = render(<DbContext.Provider value={db}><AskPanel /></DbContext.Provider>);
  act(() => { atlas.set({ ask: true }); });
  return r;
};
function saveKey(key = KEY, remember = false) {
  fireEvent.change(q('[data-k="ask-key-input"]')!, { target: { value: key } });
  const box = q<HTMLInputElement>('[data-k="ask-key-remember"]')!;
  if (box.checked !== remember) fireEvent.click(box);
  fireEvent.click(q('[data-k="ask-key-save"]')!);
}
async function askText(text: string) {
  fireEvent.change(q('#ask-input')!, { target: { value: text } });
  fireEvent.click(q('[data-k="ask-send"]')!);
  await waitFor(() => expect(q('[data-k="ask-stop"]')).toBeNull());
}
const ready = () => { mount(); saveKey(); };

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  queue = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  keyStore.forget();
  atlas.set({ lang: 'en' });
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
});
afterEach(() => {
  // The key must never reach the console, whatever the test did.
  for (const spy of consoleSpies) expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  keyStore.forget();
  localStorage.clear();
  atlas.reset();
});

// ------------------------------------------------------------------ tests

describe('panel and key dialog', () => {
  test('mounting marks Ask ready (the key is the visitor\'s own, so it is always available) and the panel follows state.ask', () => {
    render(<DbContext.Provider value={db}><AskPanel /></DbContext.Provider>);
    expect(atlas.get().askReady).toBe(true);
    expect(panel()).toHaveAttribute('hidden');
    act(() => { atlas.set({ ask: true }); });
    expect(panel()).not.toHaveAttribute('hidden');
    expect(panel().querySelector('[role="dialog"]')).toHaveAccessibleName(en('ask.title'));
  });

  test('a first open shows the key dialog with where to get a key, the cost and where the key goes', () => {
    mount();
    expect(q('[data-k="ask-key-form"]')).not.toBeNull();
    expect(q('#ask-input')).toBeNull();
    const text = q('[data-k="ask-key-form"]')!.textContent!;
    expect(text).toContain(en('ask.k.cost'));
    expect(text).toContain(en('ask.k.where'));
    const link = q<HTMLAnchorElement>('[data-k="ask-key-get"]')!;
    expect(link.href).toMatch(/^https:\/\/platform\.claude\.com\//);
    expect(link.rel).toContain('noopener');
    expect(q<HTMLInputElement>('[data-k="ask-key-input"]')!.type).toBe('password');
    expect(q<HTMLInputElement>('[data-k="ask-key-remember"]')!.checked).toBe(false);
  });

  test('the dialog is bilingual: Arabic by default', () => {
    atlas.set({ lang: 'ar' });
    mount();
    expect(q('[data-k="ask-key-form"]')!.textContent).toContain(translate('ar', 'ask.k.cost'));
  });

  test('saving without "remember" keeps the key in memory only', () => {
    ready();
    expect(localStorage.getItem(KEY_STORAGE)).toBeNull();
    expect(JSON.stringify({ ...localStorage })).not.toContain(KEY);
    expect(q('#ask-input')).not.toBeNull();
    expect(keyStore.getSnapshot()).toEqual({ key: KEY, remembered: false });
  });

  test('saving with "remember" stores it; a later visit finds it; "forget" clears it everywhere', () => {
    mount();
    saveKey(KEY, true);
    expect(localStorage.getItem(KEY_STORAGE)).toBe(KEY);
    resetKeyMemory(); // a new page load
    expect(keyStore.getSnapshot()).toEqual({ key: KEY, remembered: true });
    fireEvent.click(q('[data-k="ask-settings"]')!);
    fireEvent.click(q('[data-k="ask-key-forget"]')!);
    expect(localStorage.getItem(KEY_STORAGE)).toBeNull();
    expect(keyStore.getSnapshot().key).toBeNull();
    expect(q('[data-k="ask-key-form"]')).not.toBeNull();
    expect(q('[data-k="ask-key-forget"]')).toBeNull();
  });

  test('saving again without "remember" removes a stored key', () => {
    mount();
    saveKey(KEY, true);
    fireEvent.click(q('[data-k="ask-settings"]')!);
    saveKey(KEY + 'x', false);
    expect(localStorage.getItem(KEY_STORAGE)).toBeNull();
    expect(keyStore.getSnapshot().key).toBe(KEY + 'x');
  });

  test('an obviously wrong key is refused before any request', () => {
    mount();
    saveKey('my key');
    expect(q('[data-k="ask-key-error"]')!.textContent).toBe(en('ask.k.bad'));
    expect(keyStore.getSnapshot().key).toBeNull();
  });

  test('a stored key that cannot be read (storage blocked) leaves Ask usable with the dialog', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    resetKeyMemory();
    mount();
    expect(q('[data-k="ask-key-form"]')).not.toBeNull();
  });

  test('Escape in the question box closes the panel', () => {
    ready();
    fireEvent.keyDown(q('#ask-input')!, { key: 'Escape' });
    expect(atlas.get().ask).toBe(false);
  });
});

describe('the request', () => {
  test('goes only to the Messages API, with the browser-access headers, the chosen model and streaming', async () => {
    ready();
    reply(sse(streamOf(textReply('Hi'))));
    await askText('What is going on in Sudan?');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const r = sent(0);
    expect(r.url).toBe(API_URL);
    expect(API_URL).toBe('https://api.anthropic.com/v1/messages');
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('POST');
    expect(r.headers['x-api-key']).toBe(KEY);
    expect(r.headers['anthropic-version']).toBe(API_VERSION);
    expect(r.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(r.headers['content-type']).toBe('application/json');
    expect(r.body.model).toBe(DEFAULT_MODEL);
    expect(r.body.stream).toBe(true);
    expect(r.body).not.toHaveProperty('temperature');
    expect((r.body.tools as { name: string }[]).map((t) => t.name).sort()).toEqual(['get_record', 'list_records', 'search_atlas', 'show_on_map']);
    expect(r.body.tool_choice).toEqual({ type: 'auto' });
    const first = msgs(0)[0]!;
    expect(first.role).toBe('user');
    expect(String(first.content)).toContain('What is going on in Sudan?');
    expect(String(first.content)).toContain('interface language: English');
    // The key travels in one header of this one request, never in the body, the URL or the page address.
    expect(String(fetchMock.mock.calls[0]![1]!.body)).not.toContain(KEY);
    expect(r.url).not.toContain(KEY);
    expect(location.href).not.toContain(KEY);
  });

  test('the key appears in no other request', async () => {
    ready();
    reply(sse(streamOf(toolReply('tu_1', 'search_atlas', { query: 'Sudan' }))), sse(streamOf(textReply('ok'))));
    await askText('Sudan?');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls) {
      const all = JSON.stringify([String(url), [...new Headers(init?.headers).entries()], init?.body]);
      if (all.includes(KEY)) expect(String(url)).toBe(API_URL);
    }
  });

  test('the model picker changes the model; Sonnet and Opus opt into server-side fallback, Haiku does not', async () => {
    ready();
    reply(sse(streamOf(textReply('a'))), sse(streamOf(textReply('b'))));
    await askText('one');
    expect(sent(0).body.fallbacks).toBe('default');
    expect(sent(0).headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    fireEvent.click(q('[data-k="ask-settings"]')!);
    fireEvent.change(q('[data-k="ask-model"]')!, { target: { value: 'claude-haiku-5-5' } });
    fireEvent.click(q('[data-k="ask-key-back"]')!);
    await askText('two');
    expect(sent(1).body.model).toBe('claude-haiku-5-5');
    expect(sent(1).body).not.toHaveProperty('fallbacks');
    expect(sent(1).headers['anthropic-beta']).toBeUndefined();
    expect(localStorage.getItem('atlas-v3-ask-model')).toBe('claude-haiku-5-5');
  });

  test('history is append-only: the system prompt, the tools and every earlier message are sent back unchanged', async () => {
    ready();
    reply(sse(streamOf(textReply('first answer'))), sse(streamOf(textReply('second answer'))));
    await askText('first');
    act(() => { atlas.set({ lang: 'ar' }); atlas.select('country', 'SAU', { fly: false }); }); // context changes between questions
    await askText('second');
    const a = sent(0).body, b = sent(1).body;
    expect(b.system).toEqual(a.system);
    expect(b.tools).toEqual(a.tools);
    const m0 = msgs(0), m1 = msgs(1);
    expect(m1.slice(0, m0.length)).toEqual(m0);
    expect(m1[m0.length]).toEqual({ role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'sig-text' }, { type: 'text', text: 'first answer' }] });
    expect(String(m1[m0.length + 1]!.content)).toContain('interface language: Arabic');
    expect(String(m1[m0.length + 1]!.content)).toContain('country:SAU');
  });
});

describe('streaming and rendering', () => {
  test('streamed text renders progressively', async () => {
    ready();
    const s = liveStream();
    reply(sse(s.body));
    fireEvent.change(q('#ask-input')!, { target: { value: 'hello?' } });
    fireEvent.click(q('[data-k="ask-send"]')!);
    s.push(start(), ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }));
    s.push(ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Hello ' } }));
    await waitFor(() => expect(q('.ask-msg.live')?.textContent).toContain('Hello'));
    expect(q('.ask-msg.live')!.textContent).not.toContain('world');
    s.push(ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'world' } }));
    await waitFor(() => expect(q('.ask-msg.live')?.textContent).toContain('Hello world'));
    s.push(ev('content_block_stop', { index: 0 }), ...finish('end_turn'));
    s.close();
    await waitFor(() => expect(q('[data-k="ask-stop"]')).toBeNull());
    expect(q('.ask-msg.live')).toBeNull();
    expect([...panel().querySelectorAll('.ask-msg.ai')].at(-1)!.textContent).toContain('Hello world');
  });

  test('[[kind:id]] becomes a button that selects; unknown refs stay plain text; HTML in an answer is text', async () => {
    ready();
    const flights: unknown[] = [];
    const off = on('flyto', (f) => flights.push(f));
    reply(sse(streamOf(textReply('See [[conflict:sudan]] and [[conflict:nope]] or [[planet:mars]].\n\n<script>alert(1)</script> <img src=x onerror=alert(2)> **bold**\n\n- one\n- two'))));
    await askText('x');
    const refs = panel().querySelectorAll<HTMLButtonElement>('.ask-ref');
    expect(refs).toHaveLength(1);
    expect(refs[0]!.textContent).toBe(db.nameOf('conflict', 'sudan', 'en'));
    const answer = [...panel().querySelectorAll('.ask-msg.ai')].at(-1)!;
    expect(answer.textContent).toContain('nope');
    expect(answer.textContent).toContain('mars');
    expect(answer.querySelector('script, img')).toBeNull();
    expect(answer.textContent).toContain('<script>alert(1)</script>');
    expect(answer.querySelector('strong')!.textContent).toBe('bold');
    expect(answer.querySelectorAll('ul li')).toHaveLength(2);
    expect(flights).toEqual([]);
    fireEvent.click(refs[0]!);
    off();
    expect(atlas.get().selection).toEqual({ kind: 'conflict', id: 'sudan' });
    expect(flights).toEqual([{ kind: 'conflict', id: 'sudan' }]);
  });

  test('suggestions follow the selection and ask on click', async () => {
    atlas.select('country', 'SAU', { fly: false });
    ready();
    const sugg = [...panel().querySelectorAll<HTMLButtonElement>('.ask-s')];
    expect(sugg[0]!.textContent).toBe(en('ask.s.country', { name: db.nameOf('country', 'SAU', 'en') }));
    reply(sse(streamOf(textReply('ok'))));
    fireEvent.click(sugg[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(msgs(0)[0]!.content)).toContain(sugg[0]!.textContent!);
  });
});

describe('tool loop', () => {
  test('a tool_use runs the tool and sends a tool_result; show_on_map selects and flies', async () => {
    ready();
    const flights: unknown[] = [];
    const off = on('flyto', (f) => flights.push(f));
    reply(sse(streamOf(toolReply('tu_1', 'show_on_map', { kind: 'conflict', id: 'sudan' }))), sse(streamOf(textReply('Shown.'))));
    await askText('Show me Sudan');
    off();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(atlas.get().selection).toEqual({ kind: 'conflict', id: 'sudan' });
    expect(flights).toEqual([{ kind: 'conflict', id: 'sudan' }]);
    const m = msgs(1);
    expect(m.at(-2)).toEqual({
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '', signature: 'sig-tu_1' }, { type: 'tool_use', id: 'tu_1', name: 'show_on_map', input: { kind: 'conflict', id: 'sudan' } }],
    });
    const result = (m.at(-1)!.content as Record<string, unknown>[])[0]!;
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' });
    expect(result.is_error).toBeUndefined();
    expect(String(result.content)).toContain('conflict:sudan');
  });

  test('search_atlas, get_record and list_records answer from the atlas as compact JSON; a bad ref is a tool error', async () => {
    ready();
    reply(
      sse(streamOf(toolReply('t1', 'search_atlas', { query: 'Sudan' }))),
      sse(streamOf(toolReply('t2', 'get_record', { kind: 'conflict', id: 'sudan' }))),
      sse(streamOf(toolReply('t3', 'list_records', { kind: 'conflict', severity: 'war' }))),
      sse(streamOf(toolReply('t4', 'get_record', { kind: 'conflict', id: 'atlantis' }))),
      sse(streamOf(textReply('done'))),
    );
    await askText('Tell me about Sudan');
    const result = (i: number) => (msgs(i).at(-1)!.content as Record<string, unknown>[])[0]!;
    const search = JSON.parse(String(result(1).content)) as { matches: { ref: string }[] };
    expect(search.matches.map((m) => m.ref)).toContain('conflict:sudan');
    const rec = JSON.parse(String(result(2).content)) as Record<string, unknown>;
    expect(rec.ref).toBe('conflict:sudan');
    expect(rec.name).toBe(db.nameOf('conflict', 'sudan', 'en'));
    expect(rec.status_as_of).toBeTruthy();
    expect(String(result(2).content).length).toBeLessThan(20000);
    const list = JSON.parse(String(result(3).content)) as { count: number; records: { severity: string }[] };
    expect(list.count).toBe(db.conflicts.filter((c) => c.severity === 'war').length);
    expect(list.records.every((r) => r.severity === 'Active war')).toBe(true);
    expect(result(4).is_error).toBe(true);
    expect(String(result(4).content)).toMatch(/no atlas record/);
  });

  test('a tool input that is not valid JSON (streamed eagerly, so unvalidated) comes back as an error result', async () => {
    ready();
    const broken = [
      start(), ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'tb', name: 'get_record', input: {} } }),
      ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"kind": "conflict", "id": ' } }),
      ev('content_block_stop', { index: 0 }), ...finish('tool_use'),
    ];
    reply(sse(streamOf(broken)), sse(streamOf(textReply('ok'))));
    await askText('x');
    const m = msgs(1);
    expect((m.at(-2)!.content as Record<string, unknown>[])[0]).toEqual({ type: 'tool_use', id: 'tb', name: 'get_record', input: {} });
    expect((m.at(-1)!.content as Record<string, unknown>[])[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tb', is_error: true });
    expect(atlas.get().selection).toBeNull();
  });

  test('after the last allowed tool round the request forbids tools so Claude answers', async () => {
    ready();
    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) reply(sse(streamOf(toolReply(`t${i}`, 'search_atlas', { query: 'Iran' }))));
    reply(sse(streamOf(textReply('final'))));
    await askText('loop');
    expect(fetchMock).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) expect(sent(i).body.tool_choice).toEqual({ type: 'auto' });
    expect(sent(MAX_TOOL_ROUNDS).body.tool_choice).toEqual({ type: 'none' });
    expect(sent(MAX_TOOL_ROUNDS).body.tools).toEqual(sent(0).body.tools);
    expect(panel().textContent).toContain('final');
  });
});

describe('errors, Stop and limits', () => {
  test('a 401 shows the bad-key message with a way to change the key', async () => {
    ready();
    reply(apiError(401, 'authentication_error', 'invalid x-api-key'));
    await askText('hi');
    expect(q('.ask-err')!.textContent).toContain(en('ask.e.key'));
    expect(q('[data-k="ask-retry"]')).toBeNull();
    fireEvent.click(q('[data-k="ask-change-key"]')!);
    expect(q('[data-k="ask-key-form"]')).not.toBeNull();
  });

  test.each([
    [429, 'rate_limit_error', 'ask.e.rate'],
    [529, 'overloaded_error', 'ask.e.overloaded'],
    [500, 'api_error', 'ask.e.other'],
  ])('a %i shows its own message and a retry that resends the same question', async (status, type, key) => {
    ready();
    reply(apiError(status, type, 'nope'), sse(streamOf(textReply('recovered'))));
    await askText('hi');
    expect(q('.ask-err')!.textContent).toContain(en(key, { status }));
    fireEvent.click(q('[data-k="ask-retry"]')!);
    await waitFor(() => expect(panel().textContent).toContain('recovered'));
    expect(msgs(1)).toEqual(msgs(0));
  });

  test('a network failure and an error event mid-stream are reported, keeping the text so far', async () => {
    ready();
    reply(new TypeError('Failed to fetch'));
    await askText('one');
    expect(q('.ask-err')!.textContent).toContain(en('ask.e.net'));
    reply(sse(streamOf([start(), ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Partial' } }),
      ev('error', { error: { type: 'overloaded_error', message: 'Overloaded' } })])));
    fireEvent.click(q('[data-k="ask-retry"]')!);
    await waitFor(() => expect(q('.ask-err')?.textContent).toContain(en('ask.e.overloaded')));
    expect(q('.ask-msg.live')!.textContent).toContain('Partial');
  });

  test('a 400 shows Anthropic\'s own explanation (e.g. no credit left) as text', async () => {
    ready();
    reply(apiError(400, 'invalid_request_error', 'Your credit balance is too low <b>x</b>'));
    await askText('hi');
    expect(q('.ask-err')!.textContent).toContain('Your credit balance is too low <b>x</b>');
    expect(q('.ask-err b')).toBeNull();
  });

  test('Stop aborts the request, keeps what arrived and leaves the conversation as it was', async () => {
    ready();
    const s = liveStream();
    reply(sse(s.body));
    fireEvent.change(q('#ask-input')!, { target: { value: 'long one' } });
    fireEvent.click(q('[data-k="ask-send"]')!);
    s.push(start(), ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Partial answer' } }));
    await waitFor(() => expect(q('.ask-msg.live')?.textContent).toContain('Partial answer'));
    expect(q<HTMLTextAreaElement>('#ask-input')!.disabled).toBe(true);
    fireEvent.click(q('[data-k="ask-stop"]')!);
    expect(sent(0).signal!.aborted).toBe(true);
    await waitFor(() => expect(q('[data-k="ask-stop"]')).toBeNull());
    expect(q('.ask-err')!.textContent).toContain(en('ask.stopped'));
    expect(q('.ask-msg.live')!.textContent).toContain('Partial answer');
    expect(q<HTMLTextAreaElement>('#ask-input')!.disabled).toBe(false);
    // The next question starts from the history before the stopped one.
    reply(sse(streamOf(textReply('fresh'))));
    await askText('next');
    expect(msgs(1)).toHaveLength(1);
    expect(panel().textContent).toContain('Partial answer'); // still on screen
  });

  test('a refusal is reported and the refused question leaves the history', async () => {
    ready();
    reply(sse(streamOf([start(), ...finish('refusal')])), sse(streamOf(textReply('fine'))));
    await askText('bad');
    expect(q('.ask-err')!.textContent).toContain(en('ask.e.refused'));
    await askText('good');
    expect(msgs(1)).toHaveLength(1);
    expect(String(msgs(1)[0]!.content)).toContain('good');
  });

  test(`a conversation stops at ${MAX_QUESTIONS} questions; "new conversation" starts again`, async () => {
    ready();
    for (let i = 0; i < MAX_QUESTIONS; i++) {
      reply(sse(streamOf(textReply(`a${i}`))));
      await askText(`q${i}`);
    }
    expect(q<HTMLTextAreaElement>('#ask-input')!.disabled).toBe(true);
    expect(panel().textContent).toContain(en('ask.e.turns', { n: MAX_QUESTIONS }));
    fireEvent.click(q('[data-k="ask-new"]')!);
    expect(q<HTMLTextAreaElement>('#ask-input')!.disabled).toBe(false);
    reply(sse(streamOf(textReply('again'))));
    await askText('again');
    expect(msgs(MAX_QUESTIONS)).toHaveLength(1);
  });

  test('"new conversation" during an answer aborts it and leaves nothing of it behind', async () => {
    ready();
    reply(sse(streamOf(textReply('kept'))));
    await askText('first');
    const s = liveStream();
    reply(sse(s.body));
    fireEvent.change(q('#ask-input')!, { target: { value: 'second' } });
    fireEvent.click(q('[data-k="ask-send"]')!);
    s.push(start(), ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Half' } }));
    await waitFor(() => expect(q('.ask-msg.live')?.textContent).toContain('Half'));
    fireEvent.click(q('[data-k="ask-new"]')!);
    expect(sent(1).signal!.aborted).toBe(true);
    await waitFor(() => expect(q('[data-k="ask-stop"]')).toBeNull());
    expect(q('.ask-msg')).toBeNull();
    expect(q('.ask-empty')).not.toBeNull();
    reply(sse(streamOf(textReply('fresh'))));
    await askText('third');
    expect(msgs(2)).toHaveLength(1);
  });

  test('forgetting the key aborts a running answer', async () => {
    ready();
    const s = liveStream();
    reply(sse(s.body));
    fireEvent.change(q('#ask-input')!, { target: { value: 'x' } });
    fireEvent.click(q('[data-k="ask-send"]')!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(q('[data-k="ask-settings"]')!);
    fireEvent.click(q('[data-k="ask-key-forget"]')!);
    expect(sent(0).signal!.aborted).toBe(true);
    await screen.findByText(en('ask.k.h'));
  });
});
