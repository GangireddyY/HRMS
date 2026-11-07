import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ReportColumn, ReportTable, ReportValueFormat } from '../../contracts';
import { csvCell } from '../../common/utils/csv';

export interface ExportDocument {
  title: string;
  organization: string;
  /** e.g. "1 Apr 2026 – 6 Nov 2026". */
  period: string;
  generated: string;
  summary: { label: string; value: number | string | null; format: ReportValueFormat }[];
  tables: ReportTable[];
}

type Value = string | number | null | undefined;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const grouped = (digits: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits });

export const longDate = (iso: string) => {
  const m = ISO_DATE.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
};

/** A value as text, the way the screens show it ("Rs" because the PDF's standard fonts have no rupee sign). */
export function displayValue(v: Value, format: ReportValueFormat | undefined, rupee = '₹'): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return format === 'date' ? longDate(v) : v;
  switch (format) {
    case 'percent':
      return `${grouped(1).format(v)}%`;
    case 'money':
      return `${rupee}${grouped(0).format(v)}`;
    case 'years':
      return `${grouped(1).format(v)} years`;
    case 'days':
      return `${grouped(1).format(v)} days`;
    default:
      return grouped(1).format(v);
  }
}

// ---- CSV ------------------------------------------------------------------------------------------

/** Each table under its title (with a BOM so Excel reads it as UTF-8). */
export function reportCsv(tables: ReportTable[]): Buffer {
  const lines: string[] = [];
  for (const t of tables) {
    if (lines.length) lines.push('');
    lines.push(csvCell(t.title));
    lines.push(t.columns.map((c) => csvCell(c.label)).join(','));
    for (const r of t.rows) lines.push(t.columns.map((c) => csvCell(r[c.key])).join(','));
  }
  return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
}

// ---- Excel ----------------------------------------------------------------------------------------

function excelCell(v: Value, format: ReportValueFormat | undefined): { value: ExcelJS.CellValue; numFmt?: string } {
  if (v === null || v === undefined || v === '') return { value: null };
  if (typeof v === 'string') {
    const m = format === 'date' ? ISO_DATE.exec(v) : null;
    return m ? { value: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))), numFmt: 'dd mmm yyyy' } : { value: v };
  }
  switch (format) {
    case 'percent':
      return { value: Number((v / 100).toPrecision(12)), numFmt: '0.0%' };
    case 'money':
      return { value: v, numFmt: '"₹"#,##0.00' };
    case 'years':
    case 'days':
      return { value: v, numFmt: '#,##0.0' };
    default:
      return { value: v, numFmt: Number.isInteger(v) ? '#,##0' : '#,##0.0#' };
  }
}

/** Excel sheet names: at most 31 characters, none of []:*?/\ and unique in the workbook. */
function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 31 - ` (${i})`.length)} (${i})`;
  used.add(name.toLowerCase());
  return name;
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

/** A summary sheet, then one sheet per table with typed numbers, a frozen header and filters. */
export async function reportXlsx(doc: ExportDocument): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HRMS';
  wb.title = doc.title;
  wb.created = new Date();
  const used = new Set<string>();

  const summary = wb.addWorksheet(sheetName('Summary', used));
  summary.columns = [{ width: 36 }, { width: 24 }];
  summary.addRow([doc.title]).font = { bold: true, size: 14 };
  summary.addRow([doc.organization]);
  summary.addRow([doc.period]);
  summary.addRow([doc.generated]).font = { italic: true, color: { argb: 'FF64748B' } };
  summary.addRow([]);
  for (const s of doc.summary) {
    const row = summary.addRow([s.label]);
    const cell = excelCell(s.value, s.format);
    row.getCell(2).value = cell.value;
    if (cell.numFmt) row.getCell(2).numFmt = cell.numFmt;
    row.getCell(2).alignment = { horizontal: 'right' };
  }

  for (const t of doc.tables) {
    const ws = wb.addWorksheet(sheetName(t.title, used), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = t.columns.map((c) => ({ key: c.key, width: Math.min(50, Math.max(12, c.label.length + 2, ...t.rows.map((r) => displayValue(r[c.key], c.format).length + 2))) }));
    const header = ws.addRow(t.columns.map((c) => c.label));
    header.font = { bold: true };
    header.eachCell((cell, i) => {
      cell.fill = HEADER_FILL;
      cell.alignment = { horizontal: numeric(t.columns[i - 1]!) ? 'right' : 'left' };
    });
    for (const r of t.rows) {
      const row = ws.addRow([]);
      t.columns.forEach((c, i) => {
        const cell = excelCell(r[c.key], c.format);
        row.getCell(i + 1).value = cell.value;
        if (cell.numFmt) row.getCell(i + 1).numFmt = cell.numFmt;
      });
    }
    if (t.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- PDF ------------------------------------------------------------------------------------------

const INK = '#0f172a';
const MUTED = '#64748b';
const PANEL = '#f1f5f9';
const ZEBRA = '#f8fafc';
const ROW = 18;
const PAD = 6;
const numeric = (c: ReportColumn) => !!c.format && c.format !== 'date';

/** The PDF's standard fonts cover Latin-1 and common punctuation; anything else would print as garbage. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const latin = (s: string) => [...s].map((ch) => (ch.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRA.has(ch) ? ch : '?')).join('');
const pdfValue = (v: Value, format: ReportValueFormat | undefined) => latin(displayValue(v, format, 'Rs '));

function columnWidths(columns: ReportColumn[], width: number): number[] {
  const weights = columns.map((c, i) => (i === 0 && !numeric(c) ? 2.4 : c.format === 'date' ? 1.2 : 1));
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  return weights.map((w) => (w / total) * width);
}

function pdfTable(pdf: PDFKit.PDFDocument, t: ReportTable, left: number, width: number, bottom: () => number) {
  const widths = columnWidths(t.columns, width);
  const cells = (texts: string[], y: number) => {
    let x = left;
    t.columns.forEach((c, i) => {
      pdf.text(texts[i] ?? '', x + PAD, y + 5, { width: widths[i]! - 2 * PAD, align: numeric(c) ? 'right' : 'left', lineBreak: false, ellipsis: true });
      x += widths[i]!;
    });
    pdf.y = y + ROW;
  };
  const header = () => {
    const y = pdf.y;
    pdf.rect(left, y, width, ROW).fill(PANEL);
    pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(INK);
    cells(t.columns.map((c) => latin(c.label)), y);
  };

  if (pdf.y + 24 + ROW * 2 > bottom()) pdf.addPage();
  pdf.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(latin(t.title), left, pdf.y, { width });
  pdf.moveDown(0.3);
  header();
  if (!t.rows.length) {
    pdf.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('No data for this period', left + PAD, pdf.y + 5, { lineBreak: false });
    pdf.y += ROW;
  }
  t.rows.forEach((r, i) => {
    if (pdf.y + ROW > bottom()) {
      pdf.addPage();
      header();
    }
    const y = pdf.y;
    if (i % 2) pdf.rect(left, y, width, ROW).fill(ZEBRA);
    pdf.font('Helvetica').fontSize(8.5).fillColor(INK);
    cells(t.columns.map((c) => pdfValue(r[c.key], c.format)), y);
  });
  pdf.y += 16;
}

/** A4 landscape: heading, the headline figures, then every table (header repeated across pages), page numbers. */
export function reportPdf(doc: ExportDocument): Promise<Buffer> {
  const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: latin(doc.title), Author: latin(doc.organization), Creator: 'HRMS' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  const left = pdf.page.margins.left;
  const width = pdf.page.width - left - pdf.page.margins.right;
  const bottom = () => pdf.page.height - pdf.page.margins.bottom - 12;

  pdf.font('Helvetica').fontSize(9).fillColor(MUTED).text(latin(doc.organization), left, pdf.page.margins.top, { width });
  pdf.font('Helvetica-Bold').fontSize(18).fillColor(INK).text(latin(doc.title), { width });
  pdf.font('Helvetica').fontSize(10).fillColor(MUTED).text(latin(`${doc.period}  ·  ${doc.generated}`), { width });
  pdf.moveDown(1);

  if (doc.summary.length) {
    const gap = 8;
    const w = (width - gap * (doc.summary.length - 1)) / doc.summary.length;
    const y = pdf.y;
    doc.summary.forEach((s, i) => {
      const x = left + i * (w + gap);
      pdf.roundedRect(x, y, w, 46, 4).fill(PANEL);
      pdf.font('Helvetica').fontSize(8).fillColor(MUTED).text(latin(s.label), x + 8, y + 8, { width: w - 16, lineBreak: false, ellipsis: true });
      pdf.font('Helvetica-Bold').fontSize(14).fillColor(INK).text(pdfValue(s.value, s.format), x + 8, y + 22, { width: w - 16, lineBreak: false, ellipsis: true });
    });
    pdf.y = y + 46 + 18;
  }
  for (const t of doc.tables) pdfTable(pdf, t, left, width, bottom);

  const pages = pdf.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    pdf.switchToPage(pages.start + i);
    // Writing inside the bottom margin would otherwise start a new page.
    const margin = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0;
    pdf.font('Helvetica').fontSize(8).fillColor(MUTED).text(`${latin(doc.title)}  ·  Page ${i + 1} of ${pages.count}`, left, pdf.page.height - margin + 10, { width, align: 'right', lineBreak: false });
    pdf.page.margins.bottom = margin;
  }
  pdf.end();
  return done;
}
