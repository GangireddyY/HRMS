import { INR_LOCALE, appLocale } from '@/core/locale/locale';

/**
 * The organization's currency (from the access context) for every amount in the app. Rupees keep Indian digit
 * grouping (₹1,23,456); other currencies follow the region setting.
 */
let current = 'INR';

export function setAppCurrency(code: string | null | undefined): void {
  current = code && /^[A-Z]{3}$/.test(code) ? code : 'INR';
}
export const appCurrency = () => current;

/** "₹1,23,456", "$123,456", "€123.456,00" (decimals); "—" for nothing. */
export function formatAmount(n: number | null | undefined, opts: { decimals?: boolean; currency?: string } = {}): string {
  if (n === null || n === undefined) return '—';
  const currency = opts.currency ?? current;
  const digits = opts.decimals ? 2 : 0;
  const text = new Intl.NumberFormat(currency === 'INR' ? INR_LOCALE : appLocale(), { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(n));
  return n < 0 ? `−${text}` : text;
}

/** The currency's symbol on its own, for field labels ("Annual CTC (₹)"). */
export function currencySymbol(currency = current): string {
  return new Intl.NumberFormat(currency === 'INR' ? INR_LOCALE : appLocale(), { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
}
