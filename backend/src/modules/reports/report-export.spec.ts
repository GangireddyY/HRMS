import ExcelJS from 'exceljs';
import { displayValue, reportCsv, reportPdf, reportXlsx, type ExportDocument } from './report-export';

const doc = (rows = 3): ExportDocument => ({
  title: 'Payroll cost report',
  organization: 'Acme Ltd',
  period: 'Dec 2025 – Nov 2026',
  generated: 'Generated 6 Nov 2026, 10:00 am by Hema Person',
  summary: [
    { label: 'Cost to company', value: 1234567.5, format: 'money' },
    { label: 'Women', value: 42.5, format: 'percent' },
    { label: 'Median days to hire', value: null, format: 'days' },
  ],
  tables: [
    {
      key: 'month',
      title: 'By month: approved/paid runs [all]',
      columns: [
        { key: 'name', label: 'Month' },
        { key: 'people', label: 'People', format: 'number' },
        { key: 'gross', label: 'Gross', format: 'money' },
        { key: 'share', label: 'Share', format: 'percent' },
        { key: 'paidOn', label: 'Paid on', format: 'date' },
      ],
      rows: Array.from({ length: rows }, (_, i) => ({ name: i === 0 ? '=HYPERLINK("http://x")' : `Month ${i}`, people: 10 + i, gross: 100000.25 * (i + 1), share: 12.5, paidOn: '2026-10-31' })),
    },
    { key: 'empty', title: 'By month: approved/paid runs [all]', columns: [{ key: 'name', label: 'Name' }], rows: [] },
  ],
});

describe('report export', () => {
  it('formats values the way the screens show them', () => {
    expect(displayValue(1234567.5, 'money')).toBe('₹12,34,568');
    expect(displayValue(1234567.5, 'money', 'Rs ')).toBe('Rs 12,34,568');
    expect(displayValue(42.55, 'percent')).toBe('42.6%');
    expect(displayValue(2.25, 'years')).toBe('2.3 years');
    expect(displayValue('2026-04-01', 'date')).toBe('1 Apr 2026');
    expect(displayValue(null, 'number')).toBe('—');
  });

  it('writes CSV with a BOM, each table under its title', () => {
    const csv = reportCsv(doc(1).tables).toString('utf8');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Month,People,Gross,Share,Paid on');
  });

  it('builds a workbook with a summary sheet and typed, formatted cells per table', async () => {
    const wb = new ExcelJS.Workbook();
    const file = await reportXlsx(doc());
    await wb.xlsx.load(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
    // Sheet names lose the characters Excel forbids, fit in 31 characters and stay unique.
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'By month approved paid runs all', 'By month approved paid runs (2)']);
    const [summary, table] = wb.worksheets as [ExcelJS.Worksheet, ExcelJS.Worksheet];
    expect(summary.getCell('A1').value).toBe('Payroll cost report');
    expect(summary.getRow(6).values).toEqual([undefined, 'Cost to company', 1234567.5]);
    expect(summary.getCell('B7')).toMatchObject({ value: 0.425, numFmt: '0.0%' });

    expect(table.getRow(1).values).toEqual([undefined, 'Month', 'People', 'Gross', 'Share', 'Paid on']);
    expect(table.getCell('A2').value).toBe('=HYPERLINK("http://x")');
    expect(table.getCell('A2').formula).toBeUndefined();
    expect(table.getCell('C2')).toMatchObject({ value: 100000.25, numFmt: '"₹"#,##0.00' });
    expect(table.getCell('D2')).toMatchObject({ value: 0.125, numFmt: '0.0%' });
    expect(table.getCell('E2').value).toEqual(new Date(Date.UTC(2026, 9, 31)));
    expect(table.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('lays out a PDF across pages when a table is long', async () => {
    const short = await reportPdf(doc(3));
    const long = await reportPdf(doc(120));
    const pages = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(short.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(short)).toBe(1);
    expect(pages(long)).toBeGreaterThanOrEqual(4);
  });
});
