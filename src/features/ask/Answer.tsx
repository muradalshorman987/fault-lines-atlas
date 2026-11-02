// Claude's answer as React elements: paragraphs, "- " / "1." lists, **bold** and [[kind:id]] record buttons.
// Nothing is parsed as HTML; React escapes every string, so markup in an answer shows as text.

import { Fragment, type ReactNode } from 'react';
import { emit } from '../../app/events';
import { atlas } from '../../app/store';
import { KINDS, type Kind } from '../../config';
import type { DB } from '../../data/types';
import type { Lang } from '../../i18n/format';

const TOKEN = /\[\[([a-z]+):([A-Za-z0-9_-]+)\]\]|\*\*([^*\n]+)\*\*/g;
const REF = /\[\[([a-z]+):([A-Za-z0-9_-]+)\]\]/g;
const BULLET = /^\s*([-•*]|\d+[.)])\s+/;

const isKind = (v: string): v is Kind => (KINDS as readonly string[]).includes(v);

function RefButton({ kind, id, db, lang }: { kind: Kind; id: string; db: DB; lang: Lang }) {
  return (
    <button type="button" className="ask-ref" data-kind={kind} data-id={id}
      onClick={() => atlas.select(kind, id)}
      onPointerEnter={() => emit('highlight', { iso3: db.countriesOf(kind, id) })}
      onPointerLeave={() => emit('highlight', null)}>
      {db.nameOf(kind, id, lang)}
    </button>
  );
}

/** One record token: a button when the record exists, its id as plain text when it does not. */
function refNode(kind: string, id: string, db: DB, lang: Lang, key: number): ReactNode {
  return isKind(kind) && db.exists(kind, id) ? <RefButton key={key} kind={kind} id={id} db={db} lang={lang} /> : <Fragment key={key}>{id}</Fragment>;
}

function splitRefs(s: string, db: DB, lang: Lang): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(REF)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(refNode(m[1]!, m[2]!, db, lang, m.index));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function inline(s: string, db: DB, lang: Lang): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[3] != null) out.push(<strong key={m.index}>{splitRefs(m[3], db, lang)}</strong>);
    else out.push(refNode(m[1]!, m[2]!, db, lang, m.index));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function Answer({ text, db, lang }: { text: string; db: DB; lang: Lang }) {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  return (
    <div className="ask-md">
      {blocks.map((b, i) => {
        const lines = b.split('\n').filter((l) => l.trim());
        if (!lines.length) return null;
        if (lines.every((l) => BULLET.test(l))) {
          const items = lines.map((l, j) => <li key={j}>{inline(l.replace(BULLET, ''), db, lang)}</li>);
          return /^\s*\d/.test(lines[0]!) ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        return (
          <p key={i}>
            {lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l.replace(/^#+\s*/, ''), db, lang)}</Fragment>)}
          </p>
        );
      })}
    </div>
  );
}
