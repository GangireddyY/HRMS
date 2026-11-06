import { csvCell, CsvError, parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses plain rows with CRLF and LF line endings', () => {
    expect(parseCsv('a,b,c\r\n1,2,3\n4,5,6')).toEqual([['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6']]);
  });

  it('handles quotes, doubled quotes, commas and line breaks inside quotes', () => {
    expect(parseCsv('name,note\n"Rao, Asha","said ""hi""\nthen left"\n')).toEqual([['name', 'note'], ['Rao, Asha', 'said "hi"\nthen left']]);
  });

  it('strips the byte-order mark, keeps empty fields and skips blank lines', () => {
    expect(parseCsv('\uFEFFa,b\n\n1,\n,2\n\n')).toEqual([['a', 'b'], ['1', ''], ['', '2']]);
  });

  it('rejects unterminated quotes and too many rows', () => {
    expect(() => parseCsv('a\n"open')).toThrow(CsvError);
    expect(() => parseCsv('h\n1\n2\n3', 2)).toThrow('more than 2 rows');
  });
});

describe('csvCell', () => {
  it('quotes when needed and neutralises formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell(null)).toBe('');
  });
});
