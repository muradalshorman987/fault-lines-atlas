// One question: stream Claude's reply, run the tools it asks for, send the results back, until it answers.
// The history is append-only (claude-api skill, preserved thinking): `system` and `tools` never change during a
// conversation and earlier messages are sent back byte for byte, thinking blocks included. A question that fails
// or is stopped is simply not committed, so the next one starts from the last good history.

import { isToolUse, streamMessage, type Block, type JsonObject, type MessageParam } from './api';
import { modelInfo, type ModelId } from './models';
import { TOOL_DEFS, type ToolOutcome } from './tools';

/** Questions per conversation. Past this the visitor starts a new conversation (trimming would edit history). */
export const MAX_QUESTIONS = 10;
/** Tool rounds per question. After them the request forbids tools, so Claude answers with what it has. */
export const MAX_TOOL_ROUNDS = 5;
/** A cost cap per request, which the visitor pays for; a ~220-word answer plus thinking fits easily. */
export const MAX_TOKENS = 16000;
/** Thinking depth: medium keeps cost down while leaving room to search and read before answering. */
export const EFFORT = 'medium';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface QuestionOptions {
  key: string;
  model: ModelId;
  system: string;
  /** The committed conversation before this question. Not modified. */
  history: MessageParam[];
  question: MessageParam;
  signal: AbortSignal;
  runTool: (name: string, input: JsonObject) => ToolOutcome;
  /** The visible answer so far (all text blocks of this question). */
  onText: (text: string) => void;
}

export interface QuestionResult {
  /** history + question + every round of this question; commit it when `complete`. */
  messages: MessageParam[];
  text: string;
  stopReason: string | null;
  /** The last assistant turn has no pending tool call, so the history is valid to continue from. */
  complete: boolean;
}

export function requestBody(model: ModelId, system: string, messages: MessageParam[], allowTools: boolean): JsonObject {
  const body: JsonObject = {
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages: messages as unknown as JsonObject[],
    tools: TOOL_DEFS,
    tool_choice: { type: allowTools ? 'auto' : 'none' },
    output_config: { effort: EFFORT },
    cache_control: { type: 'ephemeral' }, // each tool round re-sends the conversation: cache its prefix
  };
  if (modelInfo(model).fallback) body.fallbacks = 'default';
  return body;
}

/**
 * The assistant turn as it goes back to the API. After a mid-output server-side fallback, the declined model's
 * thinking and tool calls before the last `fallback` block are not echoed (claude-api skill, refusal fallbacks).
 */
export function echoContent(content: Block[]): Block[] {
  const lastFallback = content.map((b) => b.type).lastIndexOf('fallback');
  return content.filter((b, i) => {
    if (b.type === 'text') return !!b.text; // the API rejects empty text blocks
    return i > lastFallback || b.type === 'fallback';
  });
}

export async function askQuestion(o: QuestionOptions): Promise<QuestionResult> {
  const messages: MessageParam[] = [...o.history, o.question];
  const done: string[] = []; // text of earlier rounds
  const betas = modelInfo(o.model).fallback ? [FALLBACK_BETA] : [];
  for (let round = 0; ; round++) {
    const current = new Map<number, string>();
    const visible = () => [...done, ...[...current.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t)].filter((t) => t.trim()).join('\n\n');
    const res = await streamMessage({
      key: o.key,
      body: requestBody(o.model, o.system, messages, round < MAX_TOOL_ROUNDS),
      betas,
      signal: o.signal,
      onText: (index, delta) => { current.set(index, (current.get(index) ?? '') + delta); o.onText(visible()); },
    });
    const content = echoContent(res.content);
    done.push(...content.filter((b) => b.type === 'text').map((b) => String(b.text)));
    const text = () => done.filter((t) => t.trim()).join('\n\n');
    const uses = content.filter(isToolUse);
    // Nothing came back (e.g. a refusal before any output): there is no assistant turn to keep.
    if (!content.length) return { messages, text: text(), stopReason: res.stopReason, complete: false };
    messages.push({ role: 'assistant', content });

    if (res.stopReason === 'tool_use' && uses.length) {
      // Every tool_use gets its result, all in one user message.
      const results: Block[] = uses.map((u) => {
        const out: ToolOutcome = res.badInput.has(u.id)
          ? { content: 'INVALID_JSON: the input was not a JSON object. Call the tool again with valid input.', isError: true }
          : o.runTool(u.name, u.input);
        const block: Block = { type: 'tool_result', tool_use_id: u.id, content: out.content };
        if (out.isError) block.is_error = true;
        return block;
      });
      messages.push({ role: 'user', content: results });
      continue;
    }
    return { messages, text: text(), stopReason: res.stopReason, complete: uses.length === 0 };
  }
}
