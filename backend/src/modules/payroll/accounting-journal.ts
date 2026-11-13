import { LEDGER_SLOT_INFO, LEDGER_SLOTS, type AccountingSettingsView, type JournalLine, type LedgerGroup, type LedgerSlot } from '../../contracts';

/** Earning codes paid by the engine itself, besides the organization's salary components. */
export const ENGINE_EARNINGS = ['ARREARS', 'OVERTIME', 'ENCASHMENT', 'ADJUSTMENT'] as const;
export const UNASSIGNED_COST_CENTRE = 'Unassigned';

export interface JournalPayslip {
  department: string | null;
  earnings: { code: string; amount: number }[];
  deductions: { code: string; amount: number }[];
  employerContributions: { code: string; amount: number }[];
}

/** The override key of an earning line (per-line codes such as ADJ_1a2b3c4d share one). */
export function earningKey(code: string): string {
  if (code.startsWith('ADJ_')) return 'ADJUSTMENT';
  if (code.startsWith('ENCASH_')) return 'ENCASHMENT';
  return code;
}

function deductionSlot(code: string): LedgerSlot {
  if (code === 'PF') return 'PF_PAYABLE';
  if (code === 'ESI') return 'ESI_PAYABLE';
  if (code === 'PT') return 'PT_PAYABLE';
  if (code === 'LWF') return 'LWF_PAYABLE';
  if (code === 'TDS') return 'TDS_PAYABLE';
  if (code.startsWith('LOAN_')) return 'LOANS';
  if (code.startsWith('BEN_')) return 'BENEFITS';
  return 'OTHER_DEDUCTIONS';
}

function employerSlots(code: string): [LedgerSlot, LedgerSlot] {
  if (code === 'EPF' || code === 'EPS') return ['PF_EXPENSE', 'PF_PAYABLE'];
  if (code === 'ESI_ER') return ['ESI_EXPENSE', 'ESI_PAYABLE'];
  if (code === 'LWF_ER') return ['LWF_EXPENSE', 'LWF_PAYABLE'];
  return ['SALARY_EXPENSE', 'OTHER_DEDUCTIONS'];
}

/** Characters Tally refuses in master names are dropped; names are capped at 100 characters. */
export const tallyName = (name: string) =>
  name
    .replace(/[<>"\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || UNASSIGNED_COST_CENTRE;

/**
 * A balanced journal for a set of payslips, in paise to avoid rounding drift: earnings and employer contributions
 * are debited (split by department cost centre when switched on), deductions, employer contributions and net pay
 * credited. Lines on the same ledger are netted, debits first.
 */
export function buildJournal(payslips: JournalPayslip[], settings: AccountingSettingsView): { lines: JournalLine[]; groups: Map<string, LedgerGroup> } {
  const paise = (n: number) => Math.round(n * 100);
  const totals = new Map<string, number>();
  const centres = new Map<string, Map<string, number>>();
  const groups = new Map<string, LedgerGroup>();
  const order: string[] = [];
  const ledgerOf = (slot: LedgerSlot) => {
    const name = settings.ledgers[slot];
    if (!groups.has(name)) groups.set(name, LEDGER_SLOT_INFO[slot].group);
    return name;
  };
  const post = (ledger: string, amount: number, centre: string | null) => {
    if (!amount) return;
    if (!totals.has(ledger)) order.push(ledger);
    totals.set(ledger, (totals.get(ledger) ?? 0) + amount);
    if (centre !== null && amount > 0) {
      const m = centres.get(ledger) ?? new Map<string, number>();
      m.set(centre, (m.get(centre) ?? 0) + amount);
      centres.set(ledger, m);
    }
  };
  for (const p of payslips) {
    const centre = settings.costCentres ? tallyName(p.department ?? UNASSIGNED_COST_CENTRE) : null;
    let net = 0;
    for (const l of p.earnings) {
      const amount = paise(l.amount);
      net += amount;
      const own = settings.earningLedgers[earningKey(l.code)];
      const ledger = l.code === 'REIMBURSEMENT' ? ledgerOf('REIMBURSEMENT') : own ? own : ledgerOf('SALARY_EXPENSE');
      if (own && !groups.has(own)) groups.set(own, 'Indirect Expenses');
      post(ledger, amount, centre);
    }
    for (const l of p.deductions) {
      const amount = paise(l.amount);
      net -= amount;
      post(ledgerOf(deductionSlot(l.code)), -amount, null);
    }
    for (const l of p.employerContributions) {
      const amount = paise(l.amount);
      const [expense, payable] = employerSlots(l.code);
      post(ledgerOf(expense), amount, centre);
      post(ledgerOf(payable), -amount, null);
    }
    post(ledgerOf('SALARY_PAYABLE'), -net, null);
  }

  const lines: JournalLine[] = order
    .map((ledger) => {
      const amount = totals.get(ledger)!;
      const split = [...(centres.get(ledger) ?? new Map<string, number>()).entries()].sort(([a], [b]) => a.localeCompare(b));
      const allocated = split.reduce((n, [, v]) => n + v, 0);
      return {
        ledger,
        debit: amount > 0 ? amount / 100 : 0,
        credit: amount < 0 ? -amount / 100 : 0,
        // A ledger that also received credits can't be split cleanly; it posts without cost centres.
        costCentres: amount > 0 && allocated === amount ? split.map(([name, v]) => ({ name, amount: v / 100 })) : [],
      };
    })
    .filter((l) => l.debit || l.credit);
  return { lines: [...lines.filter((l) => l.debit), ...lines.filter((l) => l.credit)], groups };
}

/** Effective settings: stored values over the default ledger names. */
export function withDefaults(stored: (Partial<Omit<AccountingSettingsView, 'ledgers'>> & { ledgers?: Partial<Record<LedgerSlot, string>> }) | null): AccountingSettingsView {
  return {
    tallyCompany: stored?.tallyCompany ?? null,
    voucherType: stored?.voucherType ?? 'Journal',
    costCentres: stored?.costCentres ?? false,
    costCategory: stored?.costCategory ?? 'Primary Cost Category',
    ledgers: Object.fromEntries(LEDGER_SLOTS.map((s) => [s, stored?.ledgers?.[s] ?? LEDGER_SLOT_INFO[s].default])) as Record<LedgerSlot, string>,
    earningLedgers: { ...(stored?.earningLedgers ?? {}) },
  };
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const amount = (n: number) => n.toFixed(2);

function envelope(report: 'Vouchers' | 'All Masters', company: string | null, messages: string[]): string {
  const vars = company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xml(company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : '';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ENVELOPE>',
    '<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>',
    '<BODY><IMPORTDATA>',
    `<REQUESTDESC><REPORTNAME>${report}</REPORTNAME>${vars}</REQUESTDESC>`,
    '<REQUESTDATA>',
    ...messages.map((m) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${m}</TALLYMESSAGE>`),
    '</REQUESTDATA>',
    '</IMPORTDATA></BODY>',
    '</ENVELOPE>',
    '',
  ].join('\r\n');
}

/**
 * Tally import XML with one journal voucher. Debits are negative amounts with ISDEEMEDPOSITIVE=Yes (Tally's
 * convention). The REMOTEID is the run's, so importing the same file twice is refused by Tally instead of doubling
 * the entry.
 */
export function tallyVoucherXml(v: { remoteId: string; date: string; narration: string; lines: JournalLine[] }, settings: AccountingSettingsView): string {
  const entry = (l: JournalLine) => {
    const debit = l.debit > 0;
    const value = debit ? `-${amount(l.debit)}` : amount(l.credit);
    const allocations = l.costCentres.length
      ? `<CATEGORYALLOCATIONS.LIST><CATEGORY>${xml(settings.costCategory)}</CATEGORY><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>${l.costCentres
          .map((c) => `<COSTCENTREALLOCATIONS.LIST><NAME>${xml(c.name)}</NAME><AMOUNT>-${amount(c.amount)}</AMOUNT></COSTCENTREALLOCATIONS.LIST>`)
          .join('')}</CATEGORYALLOCATIONS.LIST>`
      : '';
    return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(l.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${value}</AMOUNT>${allocations}</ALLLEDGERENTRIES.LIST>`;
  };
  const date = v.date.replace(/-/g, '');
  const type = xml(settings.voucherType);
  const voucher = `<VOUCHER REMOTEID="${xml(v.remoteId)}" VCHTYPE="${type}" ACTION="Create"><DATE>${date}</DATE><EFFECTIVEDATE>${date}</EFFECTIVEDATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><NARRATION>${xml(v.narration)}</NARRATION>${v.lines.map(entry).join('')}</VOUCHER>`;
  return envelope('Vouchers', settings.tallyCompany, [voucher]);
}

/** Tally import XML creating the ledgers (and cost centres) a journal uses, under their usual groups. */
export function tallyMastersXml(lines: JournalLine[], groups: Map<string, LedgerGroup>, settings: AccountingSettingsView): string {
  const ledgers = lines.map(
    (l) => `<LEDGER NAME="${xml(l.ledger)}" ACTION="Create"><NAME.LIST><NAME>${xml(l.ledger)}</NAME></NAME.LIST><PARENT>${xml(groups.get(l.ledger) ?? 'Indirect Expenses')}</PARENT></LEDGER>`,
  );
  const names = [...new Set(lines.flatMap((l) => l.costCentres.map((c) => c.name)))].sort();
  const centres = names.map((n) => `<COSTCENTRE NAME="${xml(n)}" ACTION="Create"><NAME.LIST><NAME>${xml(n)}</NAME></NAME.LIST><CATEGORY>${xml(settings.costCategory)}</CATEGORY></COSTCENTRE>`);
  return envelope('All Masters', settings.tallyCompany, [...ledgers, ...centres]);
}
