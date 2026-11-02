// "Ask Claude" with the visitor's own Anthropic key (spec §7, M6). A column docked beside the lens rail: the
// visitor asks, Claude reads the atlas through four page tools and answers with links into the map.
// The key goes only from this browser to api.anthropic.com (api.ts); see key.ts for where it is kept.

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { emit } from '../../app/events';
import { atlas, useAtlas, type AtlasState } from '../../app/store';
import { useDb, useT } from '../../app/useT';
import type { DB } from '../../data/types';
import { esc } from '../../ui/dom';
import { Icon } from '../../ui/Icon';
import { Answer } from './Answer';
import { AskError, type MessageParam } from './api';
import { askQuestion, MAX_QUESTIONS } from './conversation';
import { isPlausibleKey, keyStore, useKey } from './key';
import { loadModel, MODELS, saveModel, type ModelId } from './models';
import { questionText, systemPrompt } from './prompt';
import './strings';
import { runTool } from './tools';
import './ask.css';

const KEY_URL = 'https://platform.claude.com/settings/keys';

type Tx = ReturnType<typeof useT>;
interface Note { key: string; vars?: Record<string, string | number>; retry?: boolean; changeKey?: boolean }
interface LogItem { who: 'me' | 'ai'; text: string; note?: Note }
interface Live { text: string; progress: string; error: Note | null }

function errorNote(err: unknown): Note {
  if (!(err instanceof AskError)) {
    console.error('[ask] the answer failed', err); // a bug in the page (tools, rendering), never an API reply
    return { key: 'ask.e.other', vars: { status: '—' }, retry: true };
  }
  switch (err.kind) {
    case 'aborted': return { key: 'ask.stopped' };
    case 'key': return { key: 'ask.e.key', changeKey: true };
    case 'permission': return { key: 'ask.e.perm', changeKey: true };
    case 'rate': return { key: 'ask.e.rate', retry: true };
    case 'overloaded': return { key: 'ask.e.overloaded', retry: true };
    case 'large': return { key: 'ask.e.large' };
    case 'bad_request': return { key: 'ask.e.bad', vars: { msg: err.message || String(err.status) } };
    case 'network': return { key: 'ask.e.net', retry: true };
    default: return { key: 'ask.e.other', vars: { status: err.status ?? '—' }, retry: true };
  }
}

function suggestions(db: DB, tx: Tx, sel: AtlasState['selection']): string[] {
  const { t, lang } = tx;
  const s = sel && db.exists(sel.kind, sel.id) ? sel : null;
  const name = s ? db.nameOf(s.kind, s.id, lang) : null;
  const out: string[] = [];
  if (name && s?.kind === 'country') out.push(t('ask.s.country', { name }), t('ask.s.countryRel', { name }));
  else if (name && s?.kind === 'conflict') out.push(t('ask.s.conflict', { name }), t('ask.s.conflictExt', { name }));
  else if (name) out.push(t('ask.s.other', { name }));
  out.push(t('ask.s.hot'), t('ask.s.choke'), t('ask.s.compare'), t('ask.s.kurds'));
  return out.slice(0, 5);
}

function NoteLine({ note, tx, onRetry, onChangeKey }: { note: Note; tx: Tx; onRetry?: () => void; onChangeKey?: () => void }) {
  return (
    <p className="ask-err" role={note.key === 'ask.stopped' ? undefined : 'alert'}>
      <Icon name="alert" size={14} />
      <span>{tx.t(note.key, note.vars)}</span>
      {note.retry && onRetry && <button type="button" className="btn ghost" data-k="ask-retry" onClick={onRetry}>{tx.t('ask.retry')}</button>}
      {note.changeKey && onChangeKey && <button type="button" className="btn ghost" data-k="ask-change-key" onClick={onChangeKey}>{tx.t('ask.changeKey')}</button>}
    </p>
  );
}

/** Where the visitor sets, replaces or forgets the key and picks the model. */
function KeyPanel({ tx, model, onModel, onDone, onForget }: {
  tx: Tx; model: ModelId; onModel: (m: ModelId) => void; onDone: () => void; onForget: () => void;
}) {
  const { t } = tx;
  const current = useKey();
  const [value, setValue] = useState('');
  const [remember, setRemember] = useState(current.remembered);
  const [bad, setBad] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const key = value.trim();
    if (!key && current.key) { keyStore.save(current.key, remember); onDone(); return; } // only the "remember" choice changed
    if (!isPlausibleKey(key)) { setBad(true); return; }
    keyStore.save(key, remember);
    setValue('');
    onDone();
  };

  return (
    <form className="ask-key scroll" data-k="ask-key-form" onSubmit={save} noValidate>
      <h3 className="ask-key-h"><Icon name="lock" size={16} />{t('ask.k.h')}</h3>
      <p>{t('ask.k.cost')}</p>
      <p>{t('ask.k.where')}</p>
      <p>
        <a data-k="ask-key-get" href={KEY_URL} target="_blank" rel="noopener noreferrer">
          {t('ask.k.get')}<Icon name="external" size={13} />
        </a>
      </p>
      {current.key && (
        <div className="ask-key-status">
          <Icon name="check" size={14} />
          <span>{t(current.remembered ? 'ask.k.remembered' : 'ask.k.inMemory')}</span>
          <button type="button" className="btn ghost" data-k="ask-key-forget" onClick={onForget}>{t('ask.k.forget')}</button>
        </div>
      )}
      <label className="ask-field" htmlFor="ask-key-input">
        <span>{t(current.key ? 'ask.k.replace' : 'ask.k.label')}</span>
        <input ref={inputRef} id="ask-key-input" data-k="ask-key-input" type="password" value={value} placeholder="sk-ant-…"
          autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} dir="ltr"
          aria-invalid={bad || undefined} aria-describedby={bad ? 'ask-key-error' : undefined}
          onChange={(e) => { setValue(e.target.value); setBad(false); }} />
      </label>
      {bad && <p className="ask-key-err" id="ask-key-error" data-k="ask-key-error" role="alert">{t('ask.k.bad')}</p>}
      <label className="ask-check">
        <input type="checkbox" data-k="ask-key-remember" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>{t('ask.k.remember')}</span>
      </label>
      <p className="ask-hint">{t('ask.k.rememberHint')}</p>
      <label className="ask-field" htmlFor="ask-model">
        <span>{t('ask.k.model')}</span>
        <select id="ask-model" data-k="ask-model" value={model} onChange={(e) => onModel(e.target.value as ModelId)}>
          {MODELS.map((m) => <option key={m.id} value={m.id}>{t(m.label)}</option>)}
        </select>
      </label>
      <p className="ask-hint">{t('ask.k.tip')}</p>
      <div className="ask-key-actions">
        {current.key && <button type="button" className="btn ghost" data-k="ask-key-back" onClick={onDone}>{t('ask.k.back')}</button>}
        <button type="submit" className="btn primary" data-k="ask-key-save">{t('ask.k.save')}</button>
      </div>
    </form>
  );
}

export function AskPanel() {
  const db = useDb();
  const tx = useT();
  const { t, lang } = tx;
  const open = useAtlas((s) => s.ask);
  const selection = useAtlas((s) => s.selection);
  const keyState = useKey();
  const [model, setModel] = useState<ModelId>(loadModel);
  const [settings, setSettings] = useState(false);
  const [log, setLog] = useState<LogItem[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(0);
  const [draft, setDraft] = useState('');
  const ctlRef = useRef<AbortController | null>(null);
  const historyRef = useRef<MessageParam[]>([]); // committed, append-only
  const systemRef = useRef<string | null>(null); // frozen for the conversation
  const pendingRef = useRef<MessageParam | null>(null); // the question a retry resends
  const convRef = useRef(0); // bumped by "new conversation": a call from an older one must not touch the new one
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const mode = !keyState.key || settings ? 'key' : 'chat';
  const full = asked >= MAX_QUESTIONS;

  // With the visitor's own key Ask is always available: show the shell's button.
  useEffect(() => {
    atlas.set({ askReady: true });
    return () => { ctlRef.current?.abort(); atlas.set({ askReady: false }); };
  }, []);

  useEffect(() => { if (open && mode === 'chat') inputRef.current?.focus(); }, [open, mode]);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [log, live]);

  const close = () => {
    const inside = document.getElementById('ask')?.contains(document.activeElement);
    atlas.set({ ask: false });
    if (inside) document.querySelector<HTMLElement>('#topbar [data-k="ask"]')?.focus();
  };

  async function ask(q: string | null) {
    const key = keyStore.getSnapshot().key;
    if (ctlRef.current || !key) return;
    let question: MessageParam;
    if (q) {
      if (asked >= MAX_QUESTIONS) return;
      question = { role: 'user', content: questionText(db, atlas.get(), q) };
      pendingRef.current = question;
      // The previous unfinished answer (stopped or failed) stays on screen as it was.
      setLog((l) => [...l, ...(live && (live.text || live.error) ? [{ who: 'ai' as const, text: live.text, note: live.error ?? undefined }] : []), { who: 'me', text: q }]);
      setDraft('');
    } else {
      if (!pendingRef.current) return;
      question = pendingRef.current;
    }
    systemRef.current ??= systemPrompt(db);
    const ctl = new AbortController();
    const conv = convRef.current;
    ctlRef.current = ctl;
    setBusy(true);
    setLive({ text: '', progress: '', error: null });
    let shown = '';
    try {
      const res = await askQuestion({
        key, model, system: systemRef.current, history: historyRef.current, question, signal: ctl.signal,
        runTool: (name, input) => runTool(name, input, { db, lang: atlas.get().lang, progress: (p) => setLive((l) => l && { ...l, progress: p }) }),
        onText: (text) => { shown = text; setLive((l) => l && { ...l, text, progress: '' }); },
      });
      if (conv !== convRef.current) return;
      if (res.stopReason === 'refusal') {
        pendingRef.current = null;
        setLive({ text: '', progress: '', error: { key: 'ask.e.refused' } });
      } else if (!res.complete) {
        setLive({ text: res.text || shown, progress: '', error: { key: res.stopReason === 'max_tokens' ? 'ask.cut' : 'ask.e.other', vars: { status: res.stopReason ?? '—' } } });
      } else {
        historyRef.current = res.messages;
        pendingRef.current = null;
        setAsked((n) => n + 1);
        setLog((l) => [...l, { who: 'ai', text: res.text, note: res.stopReason === 'max_tokens' ? { key: 'ask.cut' } : undefined }]);
        setLive(null);
      }
    } catch (err) {
      const note = errorNote(err);
      if (conv === convRef.current) setLive({ text: shown, progress: '', error: note });
    } finally {
      if (ctlRef.current === ctl) ctlRef.current = null;
      setBusy(false);
    }
  }

  const stop = () => { ctlRef.current?.abort(); };
  const newConversation = () => {
    convRef.current++;
    ctlRef.current?.abort();
    historyRef.current = [];
    systemRef.current = null;
    pendingRef.current = null;
    setLog([]);
    setLive(null);
    setAsked(0);
    inputRef.current?.focus();
  };
  const forget = () => {
    ctlRef.current?.abort();
    keyStore.forget();
    setSettings(false);
    emit('toast', t('ask.k.forgotten'));
  };
  const pickModel = (m: ModelId) => { setModel(m); saveModel(m); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    if (q && !busy) void ask(q);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    const el = e.target as HTMLElement;
    if (el.id === 'ask-input' && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const q = draft.trim();
      if (q && !busy) void ask(q);
    }
  };

  if (!open) return <div id="ask" hidden />;

  const empty = !log.length && !live;
  return (
    <div id="ask">
      <section className="ask" role="dialog" aria-modal="false" aria-labelledby="ask-h" onKeyDown={onKeyDown}>
        <header className="ask-head">
          <span className="ask-mark"><Icon name="spark" size={18} /></span>
          <div className="ask-tt">
            <h2 id="ask-h">{t('ask.title')}</h2>
            <p>{t('ask.sub', { date: tx.fmt.date(db.conflictsAsOf) })}</p>
          </div>
          {mode === 'chat' && (
            <button type="button" className="btn ghost icon" data-k="ask-new" aria-label={t('ask.new')} data-tip={esc(t('ask.new'))}
              disabled={empty} onClick={newConversation}><Icon name="plus" size={17} /></button>
          )}
          {keyState.key && (
            <button type="button" className="btn ghost icon" data-k="ask-settings" aria-label={t('ask.settings')} data-tip={esc(t('ask.settings'))}
              aria-pressed={mode === 'key'} onClick={() => setSettings((v) => !v)}><Icon name="lock" size={16} /></button>
          )}
          <button type="button" className="btn ghost icon" data-k="ask-close" aria-label={t('close')} data-tip={esc(t('close'))} onClick={close}>
            <Icon name="close" size={17} />
          </button>
        </header>

        {mode === 'key' ? (
          <KeyPanel tx={tx} model={model} onModel={pickModel} onForget={forget} onDone={() => setSettings(false)} />
        ) : (
          <>
            <div className="ask-log scroll" id="ask-log" ref={logRef} aria-live="polite">
              {empty ? (
                <div className="ask-empty">
                  <p className="ask-empty-h">{t('ask.emptyH')}</p>
                  <p className="ask-empty-p">{t('ask.emptyP')}</p>
                  <ul className="ask-sugg">
                    {suggestions(db, tx, selection).map((s) => (
                      <li key={s}>
                        <button type="button" className="ask-s" onClick={() => void ask(s)}>
                          <span className="flip"><Icon name="chevron" size={14} /></span><span>{s}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  {log.map((m, i) => (m.who === 'me' ? (
                    <div key={i} className="ask-msg me"><span className="ask-who">{t('ask.you')}</span><p>{m.text}</p></div>
                  ) : (
                    <div key={i} className="ask-msg ai">
                      <span className="ask-who"><Icon name="spark" size={13} />{t('ask.claude')}</span>
                      {m.text && <Answer text={m.text} db={db} lang={lang} />}
                      {m.note && <NoteLine note={m.note} tx={tx} />}
                    </div>
                  )))}
                  {live && (
                    <div className="ask-msg ai live">
                      <span className="ask-who"><Icon name="spark" size={13} />{t('ask.claude')}</span>
                      {live.text && <Answer text={live.text} db={db} lang={lang} />}
                      {busy && (
                        <p className="ask-prog"><span className="dots" aria-hidden="true"><i /><i /><i /></span>{live.progress || t('ask.thinking')}</p>
                      )}
                      {live.error && (
                        <NoteLine note={live.error} tx={tx} onRetry={() => void ask(null)} onChangeKey={() => setSettings(true)} />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            {full && <p className="ask-limit" role="status">{t('ask.e.turns', { n: MAX_QUESTIONS })}</p>}
            <form className="ask-form" onSubmit={submit}>
              <label className="vh" htmlFor="ask-input">{t('ask.title')}</label>
              <textarea ref={inputRef} id="ask-input" rows={2} maxLength={1200} placeholder={t('ask.ph')} value={draft}
                disabled={busy || full} onChange={(e) => setDraft(e.target.value)} />
              {busy ? (
                <button type="button" className="btn ask-stop" data-k="ask-stop" onClick={stop}>
                  <Icon name="pause" size={16} /><span>{t('ask.stop')}</span>
                </button>
              ) : (
                <button type="submit" className="btn primary ask-send" data-k="ask-send" disabled={full}>
                  <span className="flip"><Icon name="chevron" size={16} /></span><span>{t('ask.send')}</span>
                </button>
              )}
            </form>
            <p className="ask-foot"><Icon name="info" size={13} /><span>{t('ask.foot')}</span></p>
          </>
        )}
      </section>
    </div>
  );
}
