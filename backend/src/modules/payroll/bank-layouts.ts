import type { BankFileFormat } from '../../contracts';
import { csvCell } from '../../common/utils/csv';

export interface BankPayment {
  name: string;
  code: string;
  account: string;
  ifsc: string;
  bank: string;
  amount: string;
}

/** Within the same bank the transfer is internal; otherwise NEFT. */
const sameBank = (ifsc: string, prefix: string) => ifsc.startsWith(prefix);

/** Bulk-upload layouts. Banks revise their templates: check the current one with the bank before the first upload. */
export const BANK_LAYOUTS: Record<BankFileFormat, { header: string[]; row: (p: BankPayment, o: { narration: string; date: string }) => (string | number)[] }> = {
  GENERIC: { header: ['Beneficiary name', 'Employee code', 'Account number', 'IFSC', 'Bank', 'Amount', 'Narration'], row: (p, o) => [p.name, p.code, p.account, p.ifsc, p.bank, p.amount, o.narration] },
  HDFC: {
    header: ['Transaction Type', 'Beneficiary Code', 'Beneficiary Account Number', 'Instrument Amount', 'Beneficiary Name', 'Customer Reference Number', 'Payment Details', 'Transaction Date', 'IFSC Code', 'Beneficiary Bank Name'],
    row: (p, o) => [sameBank(p.ifsc, 'HDFC') ? 'I' : 'N', p.code, p.account, p.amount, p.name.slice(0, 40), `${p.code}-${o.narration.replace(/\s+/g, '')}`.slice(0, 20), o.narration, o.date, p.ifsc, p.bank],
  },
  ICICI: {
    header: ['Payment Mode', 'Beneficiary Name', 'Beneficiary Account No', 'Beneficiary IFSC', 'Amount', 'Value Date', 'Remarks', 'Employee Code'],
    row: (p, o) => [sameBank(p.ifsc, 'ICIC') ? 'FT' : 'NEFT', p.name, p.account, p.ifsc, p.amount, o.date, o.narration, p.code],
  },
  SBI: {
    header: ['Beneficiary Name', 'Beneficiary Account Number', 'IFSC', 'Amount', 'Transfer Type', 'Remarks', 'Employee Code'],
    row: (p, o) => [p.name, p.account, p.ifsc, p.amount, sameBank(p.ifsc, 'SBIN') ? 'INTRA' : 'NEFT', o.narration, p.code],
  },
  AXIS: {
    header: ['Payment Mode', 'Amount', 'Value Date', 'Beneficiary Name', 'Beneficiary Account Number', 'IFSC Code', 'Customer Reference', 'Remarks'],
    row: (p, o) => [sameBank(p.ifsc, 'UTIB') ? 'FT' : 'NEFT', p.amount, o.date, p.name, p.account, p.ifsc, p.code, o.narration],
  },
};

/** The CSV (CRLF) for the payments in a layout; `date` is the value date as YYYY-MM-DD. */
export function bankCsv(payments: BankPayment[], format: BankFileFormat, narration: string, date: string): string {
  const layout = BANK_LAYOUTS[format];
  const ddmmyyyy = `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
  const rows = payments.map((p) => layout.row(p, { narration, date: ddmmyyyy }).map(csvCell).join(','));
  return [layout.header.map(csvCell).join(','), ...rows].join('\r\n') + '\r\n';
}
