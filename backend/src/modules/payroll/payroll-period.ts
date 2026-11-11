import type { TaxProofSection } from '../../contracts';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const periodLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Accepted proofs per section (Form 12BB). */
export type VerifiedDeductions = Record<TaxProofSection, number>;

/** Position of a calendar month in the financial year (April = 1 … March = 12). */
export const fyMonthIndex = (month: number) => (month >= 4 ? month - 3 : month + 9);

/** Whether tax for a run month uses accepted proofs only (from the cut-off month to March). */
export function proofsApply(proofsFromMonth: number | null | undefined, month: number): boolean {
  return !!proofsFromMonth && fyMonthIndex(month) >= fyMonthIndex(proofsFromMonth);
}
