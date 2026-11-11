import PDFDocument from 'pdfkit';

export interface PayslipPdfInput {
  organization: { name: string; address: string | null } | null;
  period: string;
  employee: { name: string; employeeCode: string; designation?: string | null; department?: string | null; location?: string | null; dateOfJoining?: string | null; pan?: string | null; uan?: string | null; bank?: { name: string | null; accountLast4: string | null } | null };
  daysInMonth: number;
  payableDays: number;
  lopDays: number;
  earnings: { name: string; amount: number }[];
  deductions: { name: string; amount: number }[];
  employerContributions: { name: string; amount: number }[];
  gross: number;
  totalDeductions: number;
  netPay: number;
  /** ISO 4217; null = rupees. */
  currency?: string | null;
}

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const PANEL = '#f1f5f9';
/** The standard PDF fonts cover Latin-1 only (no rupee sign). */
const latin = (s: string) => [...s].map((ch) => (ch.charCodeAt(0) <= 0xff || '–—‘’“”•…'.includes(ch) ? ch : '?')).join('');
const moneyIn = (currency: string) => (n: number) =>
  currency === 'INR' ? `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? ONES[r]! : `${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ''}`;
  return [h ? `${ONES[h]} hundred` : '', rest].filter(Boolean).join(' ');
}
/** Rupees in words, Indian style (lakh, crore): 125000 → "One lakh twenty-five thousand rupees only". */
export function rupeesInWords(amount: number): string {
  let n = Math.round(amount);
  if (n === 0) return 'Zero rupees only';
  const parts: string[] = [];
  for (const [size, word] of [
    [10_000_000, 'crore'],
    [100_000, 'lakh'],
    [1000, 'thousand'],
  ] as const) {
    if (n >= size) {
      parts.push(`${below1000(Math.floor(n / size))} ${word}`);
      n %= size;
    }
  }
  if (n) parts.push(below1000(n));
  const text = `${parts.join(' ')} rupees only`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Other currencies, international scale: 1250000 USD → "One million two hundred fifty thousand USD only". */
export function amountInWords(amount: number, currency: string): string {
  if (currency === 'INR') return rupeesInWords(amount);
  let n = Math.round(amount);
  if (n === 0) return `Zero ${currency} only`;
  const parts: string[] = [];
  for (const [size, word] of [
    [1_000_000_000, 'billion'],
    [1_000_000, 'million'],
    [1000, 'thousand'],
  ] as const) {
    if (n >= size) {
      parts.push(`${below1000(Math.floor(n / size))} ${word}`);
      n %= size;
    }
  }
  if (n) parts.push(below1000(n));
  const text = `${parts.join(' ')} ${currency} only`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A4 payslip: organization, employee details, earnings and deductions side by side, net pay in figures and words. */
export function payslipPdf(p: PayslipPdfInput, opts: { password?: string } = {}): Promise<Buffer> {
  const currency = p.currency ?? 'INR';
  const money = moneyIn(currency);
  const pdf = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: { Title: latin(`Payslip ${p.period} - ${p.employee.name}`), Author: latin(p.organization?.name ?? ''), Creator: 'HRMS' },
    ...(opts.password ? { userPassword: opts.password, ownerPassword: `${opts.password}-owner-${Date.now()}`, pdfVersion: '1.7' as const, permissions: { printing: 'highResolution' as const, copying: false, modifying: false } } : {}),
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  const left = pdf.page.margins.left;
  const width = pdf.page.width - left - pdf.page.margins.right;

  // Heading
  pdf.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(latin(p.organization?.name ?? ''), left, 40, { width });
  if (p.organization?.address) pdf.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(latin(p.organization.address), { width });
  pdf.moveDown(0.6);
  pdf.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(latin(`Payslip for ${p.period}`), { width });
  pdf.moveTo(left, pdf.y + 6).lineTo(left + width, pdf.y + 6).strokeColor(LINE).stroke();
  pdf.y += 14;

  // Employee details, two columns
  const facts: [string, string][] = [
    ['Employee', p.employee.name],
    ['Employee code', p.employee.employeeCode],
    ['Designation', p.employee.designation ?? '—'],
    ['Department', p.employee.department ?? '—'],
    ['Location', p.employee.location ?? '—'],
    ['Date of joining', p.employee.dateOfJoining ?? '—'],
    ['PAN', p.employee.pan ?? '—'],
    ['UAN', p.employee.uan ?? '—'],
    ['Bank account', p.employee.bank?.accountLast4 ? `${p.employee.bank.name ?? ''} ••${p.employee.bank.accountLast4}`.trim() : '—'],
    ['Paid days', `${p.payableDays} of ${p.daysInMonth}${p.lopDays ? ` (loss of pay ${p.lopDays})` : ''}`],
  ];
  const colW = width / 2;
  const startY = pdf.y;
  facts.forEach(([k, v], i) => {
    const x = left + (i % 2) * colW;
    const y = startY + Math.floor(i / 2) * 16;
    pdf.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(latin(k), x, y, { width: 90, lineBreak: false });
    pdf.font('Helvetica').fontSize(8.5).fillColor(INK).text(latin(v), x + 92, y, { width: colW - 100, lineBreak: false, ellipsis: true });
  });
  pdf.y = startY + Math.ceil(facts.length / 2) * 16 + 12;

  // Earnings | Deductions
  const tableTop = pdf.y;
  const half = (width - 12) / 2;
  const column = (x: number, title: string, rows: { name: string; amount: number }[], total: [string, number]) => {
    let y = tableTop;
    pdf.rect(x, y, half, 20).fill(PANEL);
    pdf.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(latin(title), x + 8, y + 6, { width: half - 100, lineBreak: false });
    pdf.text('Amount', x + half - 98, y + 6, { width: 90, align: 'right', lineBreak: false });
    y += 20;
    pdf.font('Helvetica').fontSize(9).fillColor(INK);
    for (const r of rows) {
      pdf.text(latin(r.name), x + 8, y + 5, { width: half - 110, lineBreak: false, ellipsis: true });
      pdf.text(money(r.amount), x + half - 98, y + 5, { width: 90, align: 'right', lineBreak: false });
      y += 18;
      pdf.moveTo(x, y).lineTo(x + half, y).strokeColor(LINE).stroke();
    }
    return { y, total };
  };
  const a = column(left, 'Earnings', p.earnings, ['Gross earnings', p.gross]);
  const b = column(left + half + 12, 'Deductions', p.deductions, ['Total deductions', p.totalDeductions]);
  const totalsY = Math.max(a.y, b.y) + 4;
  for (const [x, t] of [
    [left, a.total],
    [left + half + 12, b.total],
  ] as const) {
    pdf.rect(x, totalsY, half, 20).fill(PANEL);
    pdf.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(latin(t[0]), x + 8, totalsY + 6, { width: half - 110, lineBreak: false });
    pdf.text(money(t[1]), x + half - 98, totalsY + 6, { width: 90, align: 'right', lineBreak: false });
  }
  pdf.y = totalsY + 34;

  // Net pay
  const netY = pdf.y;
  pdf.roundedRect(left, netY, width, 46, 4).fill('#ecfdf5');
  pdf.font('Helvetica').fontSize(9).fillColor(MUTED).text('Net pay', left + 12, netY + 8, { lineBreak: false });
  pdf.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(money(p.netPay), left + 12, netY + 20, { lineBreak: false });
  pdf.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(latin(amountInWords(p.netPay, currency)), left + width / 2, netY + 20, { width: width / 2 - 12, align: 'right' });
  pdf.y = netY + 60;

  if (p.employerContributions.length) {
    pdf.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Employer contributions (not part of net pay)', left, pdf.y, { width });
    pdf.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(latin(p.employerContributions.map((c) => `${c.name}: ${money(c.amount)}`).join('   ·   ')), { width });
    pdf.moveDown(1);
  }
  pdf.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('This is a computer-generated payslip and needs no signature.', left, pdf.page.height - 60, { width, align: 'center', lineBreak: false });
  pdf.end();
  return done;
}
