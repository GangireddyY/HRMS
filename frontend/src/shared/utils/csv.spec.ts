import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csv', () => {
  it('quotes, escapes and neutralizes spreadsheet formulas', () => {
    expect(csvCell('Asha')).toBe('Asha');
    expect(csvCell('Rao, Asha')).toBe('"Rao, Asha"');
    expect(csvCell('6" ruler')).toBe('"6"" ruler"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+91 98450')).toBe("'+91 98450");
    expect(csvCell(-42)).toBe('-42');
    expect(csvCell(null)).toBe('');
  });

  it('exports labelled columns using their export values', () => {
    const csv = toCsv(
      [
        { key: 'name', label: 'Name' },
        { key: 'dept', label: 'Department', exportValue: (r: { dept: { name: string } }) => r.dept.name },
        { key: 'actions', label: '' },
        { key: 'secret', label: 'Hidden', noExport: true },
      ] as never,
      [{ name: 'Asha', dept: { name: 'Engineering' }, secret: 'x' }] as never,
    );
    expect(csv).toBe('Name,Department\r\nAsha,Engineering\r\n');
  });
});
