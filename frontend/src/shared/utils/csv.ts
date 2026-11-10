import type { TableColumn } from '@/shared/components/types';

/** One CSV cell: quoted when needed, and text that a spreadsheet would run as a formula is made inert. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows as CSV for the columns that have a label (actions and other unlabelled columns are left out). */
export function toCsv<Row extends Record<string, unknown>>(columns: TableColumn<Row>[], rows: Row[]): string {
  const cols = columns.filter((c) => c.label && !c.noExport);
  const value = (c: TableColumn<Row>, r: Row) => (c.exportValue ? c.exportValue(r) : c.value ? c.value(r) : r[c.key]);
  return [cols.map((c) => csvCell(c.label)).join(','), ...rows.map((r) => cols.map((c) => csvCell(value(c, r))).join(','))].join('\r\n') + '\r\n';
}

/** Downloads text as a UTF-8 CSV file (with a BOM so Excel reads non-ASCII names correctly). */
export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName.endsWith('.csv') ? fileName : `${fileName}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
