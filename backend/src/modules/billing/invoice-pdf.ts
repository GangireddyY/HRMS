import PDFDocument from 'pdfkit';
import type { BillTo, InvoiceLine, InvoiceStatus } from '../../contracts';

export interface InvoicePdfInput {
  number: string | null;
  status: InvoiceStatus;
  issueDate: string | null;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  billTo: BillTo;
  lines: InvoiceLine[];
  subtotal: number;
  discount: number;
  taxRatePct: number;
  tax: number;
  total: number;
  amountPaid: number;
  notes: string | null;
}

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const PANEL = '#f1f5f9';
const BRAND = '#4f46e5';
/** The standard PDF fonts cover Latin-1 only. */
const latin = (s: string) => [...s].map((ch) => (ch.charCodeAt(0) <= 0xff || '–—‘’“”•…'.includes(ch) ? ch : '?')).join('');
const money = (n: number, currency: string) => `${currency === 'INR' ? 'Rs' : currency} ${n.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

/** A4 tax invoice: biller and customer, the period, line items, discount, tax and the balance due. */
export function invoicePdf(p: InvoicePdfInput, biller: { name: string; address: string | null; taxId: string | null }): Promise<Buffer> {
  const pdf = new PDFDocument({ size: 'A4', margin: 40, info: { Title: latin(`Invoice ${p.number ?? 'draft'}`), Author: latin(biller.name), Creator: 'HRMS' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  const left = pdf.page.margins.left;
  const width = pdf.page.width - left - pdf.page.margins.right;
  const right = left + width;

  // Heading: biller on the left, the invoice's facts on the right.
  pdf.font('Helvetica-Bold').fontSize(16).fillColor(BRAND).text(latin(biller.name), left, 40, { width: width / 2 });
  pdf.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  if (biller.address) pdf.text(latin(biller.address), { width: width / 2 });
  if (biller.taxId) pdf.text(latin(`GSTIN ${biller.taxId}`), { width: width / 2 });
  const title = p.status === 'DRAFT' ? 'DRAFT INVOICE' : p.status === 'VOID' ? 'INVOICE (VOID)' : 'TAX INVOICE';
  pdf.font('Helvetica-Bold').fontSize(14).fillColor(INK).text(title, left + width / 2, 40, { width: width / 2, align: 'right' });
  const facts: [string, string][] = [
    ['Invoice no.', p.number ?? '—'],
    ['Issued', day(p.issueDate)],
    ['Due', day(p.dueDate)],
    ...(p.periodStart ? ([['Period', `${day(p.periodStart)} – ${day(p.periodEnd)}`]] as [string, string][]) : []),
  ];
  let y = 62;
  for (const [k, v] of facts) {
    pdf.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(k, left + width / 2, y, { width: width / 4, align: 'right' });
    pdf.font('Helvetica-Bold').fillColor(INK).text(latin(v), left + (3 * width) / 4, y, { width: width / 4, align: 'right' });
    y += 13;
  }

  // Bill to
  y = Math.max(y, pdf.y) + 18;
  pdf.roundedRect(left, y, width, 66, 6).fill(PANEL);
  pdf.font('Helvetica').fontSize(8).fillColor(MUTED).text('BILL TO', left + 12, y + 10);
  pdf.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(latin(p.billTo.name), left + 12, y + 22, { width: width - 24 });
  const contact = [p.billTo.address, p.billTo.email, p.billTo.taxId ? `GSTIN ${p.billTo.taxId}` : null].filter(Boolean).join('  ·  ');
  pdf.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(latin(contact), left + 12, y + 37, { width: width - 24, height: 24, ellipsis: true });
  y += 84;

  // Lines
  const cols = { desc: left + 8, qty: left + width * 0.6, rate: left + width * 0.72, amount: right - 8 };
  pdf.rect(left, y, width, 20).fill(INK);
  pdf.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
  pdf.text('Description', cols.desc, y + 6);
  pdf.text('Qty', cols.qty - 40, y + 6, { width: 40, align: 'right' });
  pdf.text('Rate', cols.rate, y + 6, { width: cols.amount - cols.rate - 90, align: 'right' });
  pdf.text('Amount', cols.amount - 90, y + 6, { width: 90, align: 'right' });
  y += 20;
  for (const l of p.lines) {
    pdf.font('Helvetica').fontSize(9).fillColor(INK);
    const h = Math.max(pdf.heightOfString(latin(l.description), { width: cols.qty - cols.desc - 50 }), 11);
    pdf.text(latin(l.description), cols.desc, y + 7, { width: cols.qty - cols.desc - 50 });
    pdf.text(String(l.quantity), cols.qty - 40, y + 7, { width: 40, align: 'right' });
    pdf.text(money(l.unitPrice, p.currency), cols.rate, y + 7, { width: cols.amount - cols.rate - 90, align: 'right' });
    pdf.text(money(l.amount, p.currency), cols.amount - 90, y + 7, { width: 90, align: 'right' });
    y += h + 14;
    pdf.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
  }

  // Totals
  y += 10;
  const totals: [string, number, boolean?][] = [
    ['Subtotal', p.subtotal],
    ...(p.discount ? ([['Discount', -p.discount]] as [string, number][]) : []),
    [`Tax (GST ${p.taxRatePct}%)`, p.tax],
    ['Total', p.total, true],
    ...(p.amountPaid ? ([['Paid', -p.amountPaid]] as [string, number][]) : []),
    ...(p.status !== 'VOID' ? ([['Balance due', Math.max(0, Math.round((p.total - p.amountPaid) * 100) / 100), true]] as [string, number, boolean][]) : []),
  ];
  for (const [label, amount, strong] of totals) {
    pdf.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 10.5 : 9).fillColor(strong ? INK : MUTED);
    pdf.text(label, left + width * 0.5, y, { width: width * 0.3, align: 'right' });
    pdf.fillColor(INK).text(money(amount, p.currency), left + width * 0.8, y, { width: width * 0.2 - 8, align: 'right' });
    y += strong ? 17 : 14;
  }

  if (p.notes) {
    y += 14;
    pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('NOTES', left, y);
    pdf.font('Helvetica').fontSize(9).fillColor(INK).text(latin(p.notes), left, y + 12, { width });
  }
  pdf.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('This is a computer-generated invoice.', left, pdf.page.height - 60, { width, align: 'center' });
  pdf.end();
  return done;
}
