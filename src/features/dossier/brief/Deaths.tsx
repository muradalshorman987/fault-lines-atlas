// Conflict deaths per year (UCDP, from db.figures.conflictDeaths): one series of columns on a shared baseline.
// dataviz: single series so no legend; ≤ 24px columns with a 4px rounded data end, square at the baseline, 2px surface gaps;
// the latest year in the accent; peak and latest labelled once above the plot; a tooltip per column and a table view.

import { useId, useState } from 'react';
import { esc } from '../../../ui/dom';
import type { Kit } from '../parts';
import { SrcChip } from './Brief';
import './strings';
import '../brief.css';

type Point = { year: number; value: number };

/** Every year from the first to the last; years the source does not list stay empty (null). */
function fill(series: Point[]): { year: number; value: number | null }[] {
  const byYear = new Map(series.filter((p) => Number.isFinite(p.value)).map((p) => [p.year, p.value]));
  const years = [...byYear.keys()];
  if (!years.length) return [];
  const from = Math.min(...years), to = Math.max(...years);
  return Array.from({ length: to - from + 1 }, (_, i) => ({ year: from + i, value: byYear.get(from + i) ?? null }));
}

export function DeathsChart({ series, k }: { series: Point[]; k: Kit }) {
  const { t, fmt, db } = k;
  const [table, setTable] = useState(false);
  const tableId = `br-d-t${useId()}`;
  const bins = fill(series);
  const known = bins.filter((b): b is Point => b.value != null);
  if (!known.length) return null;
  const max = Math.max(1, ...known.map((b) => b.value));
  const peak = known.reduce((a, b) => (b.value > a.value ? b : a));
  const latest = known[known.length - 1]!;
  const first = bins[0]!.year, last = bins[bins.length - 1]!.year;
  const src = db.figures.sources.find((s) => s.id === 'ucdp');
  const range = first === last ? String(first) : `${first}–${last}`;

  return (
    <figure className="br-deaths">
      <p className="br-d-read">
        <span>{t('dz.br.d.peak')} <b className="data">{fmt.num(peak.value)}</b> <span className="br-d-y">{peak.year}</span></span>
        {latest.year !== peak.year ? <span>{t('dz.br.d.latest')} <b className="data">{fmt.num(latest.value)}</b> <span className="br-d-y">{latest.year}</span></span> : null}
      </p>
      <div className="br-d-plot" role="img" aria-label={t('dz.br.d.label', { from: first, to: last, max: fmt.num(peak.value), y: peak.year })}>
        {bins.map((b) => (
          <span key={b.year} className="br-d-slot"
            data-tip={b.value == null ? esc(t('dz.br.d.none', { y: b.year })) : `<b>${esc(fmt.num(b.value))}</b> <span class="tip-sub">${b.year}</span>`}>
            {b.value != null ? (
              <i className={`br-d-col${b.year === latest.year ? ' is-latest' : ''}`}
                style={{ blockSize: `${Math.max(b.value ? 2 : 0, (b.value / max) * 100).toFixed(2)}%` }} />
            ) : null}
          </span>
        ))}
      </div>
      <div className="br-d-x" aria-hidden="true"><span>{first}</span>{last !== first ? <span>{last}</span> : null}</div>
      <div className="br-d-cap">
        {src ? <SrcChip k={k} source={src.name} srcId={src.id} year={range} /> : null}
        <button type="button" className="btn ghost br-d-toggle" data-act="table" aria-expanded={table} aria-controls={tableId} onClick={() => setTable((x) => !x)}>
          {t('dz.br.d.table')}
        </button>
      </div>
      <table className="br-d-table" id={tableId} hidden={!table}>
        <thead><tr><th scope="col">{t('dz.br.d.year')}</th><th scope="col">{t('dz.br.d.deaths')}</th></tr></thead>
        <tbody>{known.map((b) => <tr key={b.year}><td className="data">{b.year}</td><td className="data">{fmt.num(b.value)}</td></tr>)}</tbody>
      </table>
      <p className="dz-note">{t('dz.br.d.note')}</p>
    </figure>
  );
}
