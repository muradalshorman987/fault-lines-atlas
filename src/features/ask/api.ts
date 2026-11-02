// One streaming call to the Anthropic Messages API, straight from the browser with the visitor's key (spec D6).
// Raw fetch + SSE rather than the SDK: one endpoint, no new dependency in a page that holds a secret.
// Event types and headers follow the claude-api skill (Messages API, streaming).

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2026-10-21';

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

/** A content block as the API sends it and as it goes back in the history. */
export type Block = JsonObject & { type: string };
export interface ToolUseBlock extends JsonObject { type: 'tool_use'; id: string; name: string; input: JsonObject }
export interface MessageParam { role: 'user' | 'assistant'; content: string | Block[] }

export const isToolUse = (b: Block): b is ToolUseBlock => b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string';

export type AskErrorKind = 'aborted' | 'key' | 'permission' | 'rate' | 'overloaded' | 'large' | 'bad_request' | 'server' | 'network';

export class AskError extends Error {
  readonly kind: AskErrorKind;
  readonly status: number | null;
  constructor(kind: AskErrorKind, status: number | null, message: string) {
    super(message);
    this.name = 'AskError';
    this.kind = kind;
    this.status = status;
  }
}

/** HTTP status and/or the API's error.type → what the panel tells the visitor. */
export function errorKind(status: number | null, type: string, message: string): AskErrorKind {
  if (status === 401 || type === 'authentication_error') return 'key';
  if (status === 403 || type === 'permission_error') return 'permission';
  if (status === 429 || type === 'rate_limit_error') return 'rate';
  if (status === 529 || type === 'overloaded_error') return 'overloaded';
  if (status === 413 || type === 'request_too_large' || /prompt is too long/i.test(message)) return 'large';
  if (status != null && status >= 400 && status < 500) return 'bad_request';
  return 'server';
}

export interface StreamResult {
  content: Block[];
  stopReason: string | null;
  model: string | null;
  /** tool_use ids whose streamed input was not a JSON object. */
  badInput: Set<string>;
}

export interface StreamOptions {
  key: string;
  body: JsonObject;
  signal: AbortSignal;
  /** Beta names for the anthropic-beta header. */
  betas?: string[];
  /** Called for each text delta with the block index it belongs to. */
  onText?: (index: number, delta: string) => void;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const aborted = () => new AskError('aborted', null, 'aborted');

/** Splits an SSE byte stream into {event, data} records. */
export class SseParser {
  private buf = '';
  push(chunk: string): { event: string; data: string }[] {
    this.buf = (this.buf + chunk).replace(/\r\n/g, '\n');
    const out: { event: string; data: string }[] = [];
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) >= 0) {
      const raw = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of raw.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const c = line.indexOf(':');
        const field = c < 0 ? line : line.slice(0, c);
        const value = c < 0 ? '' : line.slice(c + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
      if (data.length) out.push({ event, data: data.join('\n') });
    }
    return out;
  }
}

/** POST one streaming request and assemble the message from its events. Throws AskError. */
export async function streamMessage({ key, body, signal, betas, onText }: StreamOptions): Promise<StreamResult> {
  if (signal.aborted) throw aborted();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (betas?.length) headers['anthropic-beta'] = betas.join(',');

  let res: Response;
  try {
    res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }), signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    // fetch rejects on abort and on network/CORS failures; neither carries anything we need
    throw signal.aborted ? aborted() : new AskError('network', null, 'network');
  }
  if (!res.ok) {
    let type = '', message = '';
    try {
      const j: unknown = await res.json();
      if (isObj(j) && isObj(j.error)) { type = str(j.error.type); message = str(j.error.message); }
    } catch {
      // not a JSON error body (proxy page, empty body): the status decides
    }
    throw new AskError(errorKind(res.status, type, message), res.status, message.slice(0, 300));
  }
  if (!res.body) throw new AskError('server', res.status, 'empty body');

  const reader = res.body.getReader();
  const onAbort = () => { reader.cancel().catch(() => { /* the stream is already closed */ }); };
  signal.addEventListener('abort', onAbort, { once: true });

  const blocks: Block[] = [];
  const toolJson = new Map<number, string>();
  const badInput = new Set<string>();
  let stopReason: string | null = null;
  let model: string | null = null;
  let finished = false;
  const parser = new SseParser();
  const dec = new TextDecoder();

  const handle = (event: string, data: string) => {
    let e: unknown;
    try { e = JSON.parse(data); } catch { return; } // a malformed event is skipped, as the SDK does
    if (!isObj(e)) return;
    const type = str(e.type) || event;
    const index = typeof e.index === 'number' ? e.index : -1;
    switch (type) {
      case 'message_start':
        if (isObj(e.message)) model = str(e.message.model) || null;
        break;
      case 'content_block_start': {
        if (index < 0 || !isObj(e.content_block)) break;
        const b = structuredClone(e.content_block) as Block;
        if (b.type === 'tool_use') toolJson.set(index, '');
        if (b.type === 'text') b.text = str(b.text);
        if (b.type === 'thinking') { b.thinking = str(b.thinking); b.signature = str(b.signature); }
        blocks[index] = b;
        break;
      }
      case 'content_block_delta': {
        const b = blocks[index];
        const d = e.delta;
        if (!b || !isObj(d)) break;
        if (d.type === 'text_delta') { b.text = str(b.text) + str(d.text); onText?.(index, str(d.text)); }
        else if (d.type === 'input_json_delta') toolJson.set(index, (toolJson.get(index) ?? '') + str(d.partial_json));
        else if (d.type === 'thinking_delta') b.thinking = str(b.thinking) + str(d.thinking);
        else if (d.type === 'signature_delta') b.signature = str(d.signature);
        else if (d.type === 'citations_delta' && isObj(d.citation)) b.citations = [...(Array.isArray(b.citations) ? b.citations : []), d.citation as JsonObject];
        break;
      }
      case 'content_block_stop': {
        const b = blocks[index];
        if (b?.type === 'tool_use') {
          const raw = toolJson.get(index) ?? '';
          // With eager input streaming the API does not validate the input: a bad parse is flagged for the tool loop.
          let v: unknown;
          try { v = raw.trim() ? JSON.parse(raw) : {}; } catch { v = null; } // invalid JSON: reported below
          b.input = isObj(v) ? (v as JsonObject) : {};
          if (!isObj(v)) badInput.add(str(b.id));
        }
        break;
      }
      case 'message_delta':
        if (isObj(e.delta) && typeof e.delta.stop_reason === 'string') stopReason = e.delta.stop_reason;
        break;
      case 'message_stop':
        finished = true;
        break;
      case 'error': {
        const err = isObj(e.error) ? e.error : {};
        throw new AskError(errorKind(null, str(err.type), str(err.message)), null, str(err.message).slice(0, 300));
      }
      default: // ping and event types added later
    }
  };

  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        // the connection dropped, or Stop cancelled the read
        throw signal.aborted ? aborted() : new AskError('network', null, 'stream interrupted');
      }
      if (signal.aborted) throw aborted();
      if (chunk.done) break;
      for (const { event, data } of parser.push(dec.decode(chunk.value, { stream: true }))) handle(event, data);
    }
    for (const { event, data } of parser.push(dec.decode() + '\n\n')) handle(event, data);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  if (!finished && stopReason == null) throw new AskError('network', null, 'stream ended early');
  return { content: blocks.filter((b): b is Block => !!b), stopReason, model, badInput };
}
