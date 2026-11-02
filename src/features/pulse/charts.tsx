// Pulse charts: a card with a table toggle (the accessible twin), clickable distribution bars, and the region × severity matrix.
// Marks carry data-hl (map emphasis, handled by the view) and data-tip (escaped HTML, with the click verb and its icon).

import { useState, type CSSProperties, type ReactNode } from 'react';
import { useT } from '../../app/useT';
import { esc, icon } from '../../ui/dom';
import { Icon } from '../../ui/Icon';

export type Verb = 'filter' | 'unfilter' | 'select' | 'go';
export const VERB_ICON: Record<Verb, string> = { filter: 'filter', unfilter: 'close', select: 'target', go: 'compass' };

/** Tooltip HTML: bold title, optional value, then the click verb with its icon. Escapes every argument once. */
export function tipHtml(title: string, value: string | null, verb: Verb, verbText: string): string {
  return `<b>${esc(title)}</b>${value ? ` ${esc(value)}` : ''}<span class="tip-sub pl-tipverb">${icon(VERB_ICON[verb], 14)}${esc(verbText)}</span>`;
}

/** A chart card: heading, optional note, the chart, and a "Table" toggle that swaps the chart for its table. */
export function Card({ id, title, note, table, children, className = '' }: {
  id: string; title: string; note?: ReactNode; table?: ReactNode; children: ReactNode; className?: string;
}) {
  const { t } = useT();
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`pl-card ${className}`} id={id} aria-labelledby={`${id}-h`}>
      <header className="pl-card-h">
        <h3 id={`${id}-h`}>{title}</h3>
        {table != null && (
          <button type="button" className="btn ghost pl-tbl-btn" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
            <Icon name="menu" size={14} />{t('pl.table')}
          </button>
        )}
      </header>
      {note != null && <p className="pl-note">{note}</p>}
      {asTable ? table : children}
    </section>
  );
}

export function DataTable({ caption, head, rows, foot }: {
  caption: string; head: string[]; rows: (string | number)[][]; foot?: (string | number)[];
}) {
  return (
    <div className="pl-table-wrap">
      <table className="pl-table">
        <caption className="vh">{caption}</caption>
        <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((v, j) => (j === 0 ? <th key={j} scope="row">{v}</th> : <td key={j} className="num">{v}</td>))}</tr>
          ))}
        </tbody>
        {foot && <tfoot><tr>{foot.map((v, j) => (j === 0 ? <th key={j} scope="row">{v}</th> : <td key={j} className="num">{v}</td>))}</tr></tfoot>}
      </table>
    </div>
  );
}

export interface DistRow {
  id: string; label: string; n: number; isos: string[];
  /** Mark colour (a token); `swatch` repeats it beside the label when colour carries identity (severity). */
  color: string; swatch?: boolean;
  active: boolean;
}

/** Horizontal bars, one per category; each bar is a button that filters (or clears its filter when active). */
export function DistBars({ rows, label, attr, anyActive, onPick }: {
  rows: DistRow[]; label: string; attr: 'sev' | 'region' | 'dim'; anyActive: boolean; onPick: (id: string) => void;
}) {
  const { t, fmt } = useT();
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="pl-bars" role="list" aria-label={label}>
      {rows.map((r) => {
        const verb: Verb = r.active ? 'unfilter' : 'filter';
        const data = { [`data-${attr}`]: r.id };
        return (
          <li key={r.id}>
            <button type="button" className="pl-bar-row" {...data} aria-pressed={r.active}
              data-dim={anyActive && !r.active ? '' : undefined} disabled={!r.n && !r.active}
              data-hl={r.isos.length ? r.isos.join(' ') : undefined}
              data-tip={tipHtml(r.label, t('pl.files', { n: fmt.num(r.n) }), verb, t(`pl.v.${verb}`))}
              onClick={() => onPick(r.id)}>
              <span className="pl-bar-label">{r.swatch && <i className="sw" style={{ background: r.color }} />}{r.label}</span>
              <span className="pl-bar-track"><span className="pl-bar" style={{ inlineSize: `${(r.n / max) * 100}%`, background: r.color }} /></span>
              <span className="pl-bar-val">{fmt.num(r.n)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export interface MatrixCell { n: number; isos: string[] }

/** Rows × columns of counts, each cell's fill a step on the sequential ramp (--seq-0 → --seq-1); a click filters by both. */
export function Matrix({ label, rows, cols, cell, max, mark, onPick }: {
  label: string;
  rows: { id: string; label: string; color: string }[];
  cols: { id: string; label: string }[];
  cell: (row: string, col: string) => MatrixCell;
  max: number;
  /** pressed: the filter is exactly this cell; dim: the cell is outside the active filters. */
  mark: (row: string, col: string) => { pressed: boolean; dim: boolean };
  onPick: (row: string, col: string) => void;
}) {
  const { t, fmt } = useT();
  return (
    <div className="pl-mx-wrap">
      <table className="pl-mx">
        <caption className="vh">{label}</caption>
        <thead>
          <tr>
            <td />
            {cols.map((c) => <th key={c.id} scope="col">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row"><i className="sw" style={{ background: r.color }} />{r.label}</th>
              {cols.map((c) => {
                const { n, isos } = cell(r.id, c.id);
                const { pressed: on, dim } = mark(r.id, c.id);
                if (!n) return <td key={c.id} className="pl-cell-0" aria-label={`${r.label} · ${c.label}: 0`}><span aria-hidden="true">·</span></td>;
                // intensity: a floor so a single file still reads as filled; the label flips ink past the midpoint
                const k = 0.18 + 0.82 * (n / Math.max(1, max));
                const verb: Verb = on ? 'unfilter' : 'filter';
                return (
                  <td key={c.id}>
                    <button type="button" className={`pl-cell${k >= 0.55 ? ' hi' : ''}`} data-cell={`${c.id}|${r.id}`}
                      style={{ '--k': `${Math.round(k * 100)}%` } as CSSProperties}
                      aria-pressed={on} data-dim={dim ? '' : undefined}
                      aria-label={`${r.label} · ${c.label}: ${fmt.num(n)}`}
                      data-hl={isos.join(' ')}
                      data-tip={tipHtml(`${c.label} · ${r.label}`, t('pl.files', { n: fmt.num(n) }), verb, t(`pl.v.${verb}`))}
                      onClick={() => onPick(r.id, c.id)}>
                      {fmt.num(n)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pl-scale" aria-hidden="true">
        <span>{t('pl.c.fewer')}</span><i className="pl-scale-ramp" aria-hidden="true" /><span>{t('pl.c.more')}</span>
      </p>
    </div>
  );
}
