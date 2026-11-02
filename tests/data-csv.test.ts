// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { CsvParser, csvRecords, parseCsv } from '../scripts/data/csv';

describe('CSV parser', () => {
  test('plain, quoted, escaped quotes, embedded commas and newlines, CRLF', () => {
    const text = 'a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"two\nlines",\n';
    expect(parseCsv(text)).toEqual([['a', 'b', 'c'], ['1', 'x, y', 'say "hi"'], ['2', 'two\nlines', '']]);
  });

  test('a last line without a newline is still a row', () => expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]));

  test('chunks can split anywhere, even inside quotes and escaped quotes', () => {
    const text = 'id,note\n1,"a ""b"", c"\n2,plain\n3,"multi\nline"\n';
    const whole = parseCsv(text);
    for (let size = 1; size <= 7; size++) {
      const rows: string[][] = [];
      const p = new CsvParser((r) => rows.push(r));
      for (let i = 0; i < text.length; i += size) p.push(text.slice(i, i + size));
      p.end();
      expect(rows).toEqual(whole);
    }
  });

  test('records are keyed by the header and a byte-order mark is dropped', () => {
    expect(csvRecords('\uFEFFname,value\nx,1\ny,2\n')).toEqual([{ name: 'x', value: '1' }, { name: 'y', value: '2' }]);
  });
});
