// The models a visitor can pick. IDs come from the claude-api skill's model table (cached 2026-10-06).
// Sonnet is the default because the visitor pays: it is the balanced choice; Haiku is cheaper, Opus about twice the cost.

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'ask.m.sonnet', fallback: true },
  { id: 'claude-haiku-5-5', label: 'ask.m.haiku', fallback: false }, // no server-side fallback for Haiku 5.5
  { id: 'claude-opus-5-5', label: 'ask.m.opus', fallback: true },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];
export const DEFAULT_MODEL: ModelId = 'claude-sonnet-5-5';
const MODEL_STORAGE = 'atlas-v3-ask-model';

export const isModelId = (v: unknown): v is ModelId => MODELS.some((m) => m.id === v);
export const modelInfo = (id: ModelId) => MODELS.find((m) => m.id === id) ?? MODELS[0];

/** The visitor's last pick (not sensitive, so it is always remembered). */
export function loadModel(): ModelId {
  try {
    const v = localStorage.getItem(MODEL_STORAGE);
    return isModelId(v) ? v : DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL; // storage blocked: use the default
  }
}

export function saveModel(id: ModelId): void {
  try { localStorage.setItem(MODEL_STORAGE, id); } catch { /* storage blocked: the pick lasts for this visit */ }
}
