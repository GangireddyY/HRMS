/**
 * RFC 4180 CSV parsing: quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF or LF,
 * and an optional UTF-8 byte-order mark. Returns rows of raw strings; blank lines are skipped.
 */
export function parseCsv(text: string, maxRows = Infinity): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endRow = () => {
    row.push(field);
    field = '';
    if (row.length > 1 || row[0] !== '') {
      rows.push(row);
      if (rows.length > maxRows) throw new CsvError(`The file has more than ${maxRows} rows`);
    }
    row = [];
  };

  for (; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else if (c === '\n') endRow();
    else field += c;
  }
  if (quoted) throw new CsvError('A quoted value is not closed');
  if (field !== '' || row.length) endRow();
  return rows;
}

export class CsvError extends Error {}

/** Quotes a value for CSV output and neutralises spreadsheet formulas (CSV injection). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
