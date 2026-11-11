/** Legal entities (companies an organization employs people through) and currencies. */

export const COUNTRY_PATTERN = /^[A-Z]{2}$/;
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;
/** Indian statutory payroll (PF, ESI, PT, LWF, TDS) applies to entities in this country only. */
export const STATUTORY_COUNTRY = 'IN';
export const MAX_REGISTRATIONS = 8;

export interface LegalEntityRegistration {
  /** e.g. "PAN", "TAN", "GSTIN", "EIN", "Company number". */
  label: string;
  value: string;
}

export interface LegalEntityView {
  id: string;
  name: string;
  legalName: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** ISO 4217; employees of the entity are paid and claim expenses in it. */
  currency: string;
  registrations: LegalEntityRegistration[];
  address: { line1: string | null; line2: string | null; city: string | null; state: string | null; postalCode: string | null };
  isDefault: boolean;
  /** Indian statutory payroll applies. */
  statutory: boolean;
  employees: number;
  payGroups: number;
}

export interface ExchangeRateView {
  id: string;
  currency: string;
  /** Units of the organization's base currency for one unit of `currency`. */
  rate: number;
  effectiveOn: string;
  source: string | null;
}

/** Currencies offered in pickers (any ISO 4217 code is accepted). */
export const COMMON_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY', 'CHF', 'SAR', 'ZAR', 'MYR', 'NZD', 'HKD', 'LKR', 'BDT', 'NPR'] as const;

/** Converts through the base currency: `rates` maps a currency to base units per unit (base = 1). */
export function convertAmount(amount: number, from: string, to: string, rates: Map<string, number>): number | null {
  if (from === to) return amount;
  const a = rates.get(from);
  const b = rates.get(to);
  if (!a || !b) return null;
  return Math.round(((amount * a) / b) * 100) / 100;
}
