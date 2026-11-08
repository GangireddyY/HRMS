import { appLocale } from '@/core/locale/locale';
import type { SelectOption } from '@/shared/components';

export const COMPANY_SIZE_OPTIONS: SelectOption<string>[] = ['1-10', '11-50', '51-200', '201-1000', '1001-5000', '5000+'].map((v) => ({ label: `${v} employees`, value: v }));

export const COUNTRY_OPTIONS: SelectOption<string>[] = [
  { label: 'India', value: 'IN' },
  { label: 'United States', value: 'US' },
  { label: 'United Kingdom', value: 'GB' },
  { label: 'United Arab Emirates', value: 'AE' },
  { label: 'Singapore', value: 'SG' },
  { label: 'Australia', value: 'AU' },
  { label: 'Canada', value: 'CA' },
  { label: 'Germany', value: 'DE' },
];

export const CURRENCY_OPTIONS: SelectOption<string>[] = ['INR', 'USD', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'EUR'].map((v) => ({ label: v, value: v }));

export const DATE_FORMAT_OPTIONS: SelectOption<string>[] = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY'].map((v) => ({ label: v, value: v }));

export const MONTH_OPTIONS: SelectOption<number>[] = Array.from({ length: 12 }, (_, i) => ({
  label: new Date(2000, i, 1).toLocaleString(appLocale(), { month: 'long' }),
  value: i + 1,
}));

/**
 * Current IANA names that some browsers still list under a legacy alias (Chromium returns
 * Asia/Calcutta, Europe/Kiev, …), so a saved canonical value always has a matching option.
 */
const CANONICAL_ZONES = ['UTC', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Ho_Chi_Minh', 'Asia/Yangon', 'Europe/Kyiv', 'America/Nuuk', 'Atlantic/Faroe', 'Pacific/Kanton'];

/** IANA time zones supported by the browser plus canonical names and the currently saved value. */
export function timezoneOptions(current?: string | null): SelectOption<string>[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const supported = intl.supportedValuesOf?.('timeZone') ?? ['America/New_York', 'Europe/London', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'];
  const zones = [...new Set([...supported, ...CANONICAL_ZONES, ...(current ? [current] : [])])].sort();
  return zones.map((z) => ({ label: z.replace(/_/g, ' '), value: z }));
}
