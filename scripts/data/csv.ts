// A small streaming CSV parser (RFC 4180: quoted fields, "" escapes, commas and newlines inside quotes, CRLF).
// It streams because UCDP's GED file is ~270 MB of CSV, too big to hold as one string.

export class CsvParser {
  private buf = '';
  constructor(private readonly onRow: (row: string[]) => void) {}

  push(chunk: string): void {
    this.buf += chunk;
    this.parse(false);
  }

  end(): void {
    this.parse(true);
    this.buf = '';
  }

  /** Emits every complete row in the buffer; an incomplete last row waits for more input unless `final`. */
  private parse(final: boolean): void {
    const s = this.buf, n = s.length;
    let start = 0; // start of the row being parsed
    rows: while (start < n) {
      const row: string[] = [];
      let i = start;
      for (;;) {
        let field: string;
        if (s.charCodeAt(i) === 34 /* " */) {
          field = '';
          let k = i + 1;
          for (;;) {
            const q = s.indexOf('"', k);
            if (q < 0) { if (!final) break rows; field += s.slice(k); i = n; break; }
            if (q + 1 >= n && !final) break rows; // can't tell yet whether this quote is escaped
            if (s.charCodeAt(q + 1) === 34) { field += s.slice(k, q + 1); k = q + 2; continue; }
            field += s.slice(k, q);
            i = q + 1;
            break;
          }
        } else {
          let j = i;
          while (j < n) { const c = s.charCodeAt(j); if (c === 44 || c === 10 || c === 13) break; j++; }
          if (j >= n && !final) break rows;
          field = s.slice(i, j);
          i = j;
        }
        row.push(field);
        if (i >= n) { if (!final) break rows; this.onRow(row); start = n; break rows; }
        const c = s.charCodeAt(i);
        if (c === 44) { i++; if (i >= n && !final) break rows; continue; }
        // end of row: \n, \r\n or \r
        if (c === 13) { if (i + 1 >= n && !final) break rows; i += s.charCodeAt(i + 1) === 10 ? 2 : 1; } else i++;
        this.onRow(row);
        start = i;
        continue rows;
      }
    }
    this.buf = s.slice(start);
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const p = new CsvParser((r) => rows.push(r));
  p.push(text);
  p.end();
  return rows;
}

/** Rows as objects keyed by the header row (a leading byte-order mark is dropped). */
export function csvRecords(text: string): Record<string, string>[] {
  const [head, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''));
  if (!head) return [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** Streams bytes through the parser; `onRecord` receives each row and a lookup of column index by header name. */
export async function streamCsv(
  chunks: AsyncIterable<string>,
  onRecord: (row: string[], col: (name: string) => number) => void,
): Promise<void> {
  let index: Map<string, number> | null = null;
  const col = (name: string) => {
    const i = index?.get(name);
    if (i === undefined) throw new Error(`CSV has no "${name}" column`);
    return i;
  };
  const p = new CsvParser((row) => {
    if (!index) { index = new Map(row.map((h, i) => [h.replace(/^\uFEFF/, '').trim(), i])); return; }
    if (row.length === 1 && row[0] === '') return; // blank line
    onRecord(row, col);
  });
  for await (const chunk of chunks) p.push(chunk);
  p.end();
}
