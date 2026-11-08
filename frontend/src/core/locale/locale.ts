/** Region formats (dates, times, numbers), clock style and layout direction, saved per browser. */
export const REGIONS = [
  { key: 'auto', label: 'Browser default' },
  { key: 'en-IN', label: 'English (India)' },
  { key: 'en-GB', label: 'English (United Kingdom)' },
  { key: 'en-US', label: 'English (United States)' },
  { key: 'en-AE', label: 'English (United Arab Emirates)' },
  { key: 'en-SG', label: 'English (Singapore)' },
  { key: 'en-AU', label: 'English (Australia)' },
  { key: 'de-DE', label: 'Deutsch (Deutschland)' },
  { key: 'fr-FR', label: 'Français (France)' },
  { key: 'es-ES', label: 'Español (España)' },
  { key: 'ar-AE', label: 'العربية (الإمارات)' },
  { key: 'hi-IN', label: 'हिन्दी (भारत)' },
  { key: 'ja-JP', label: '日本語 (日本)' },
] as const;

export type Region = (typeof REGIONS)[number]['key'];
export type HourCycle = 'auto' | 'h12' | 'h23';
export type Direction = 'auto' | 'ltr' | 'rtl';
export interface LocalePrefs {
  region: Region;
  hourCycle: HourCycle;
  direction: Direction;
}

/** Also read by the pre-paint script in index.html; change both together. */
export const LOCALE_STORAGE_KEYS = { region: 'hrms.region', hourCycle: 'hrms.hourCycle', direction: 'hrms.direction' } as const;
export const DEFAULT_LOCALE_PREFS: LocalePrefs = { region: 'auto', hourCycle: 'auto', direction: 'auto' };

/** Rupee amounts keep Indian digit grouping (lakhs and crores, ₹16,00,000) whatever the format region. */
export const INR_LOCALE = 'en-IN';

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readLocalePrefs(): LocalePrefs {
  const region = read(LOCALE_STORAGE_KEYS.region);
  const hourCycle = read(LOCALE_STORAGE_KEYS.hourCycle);
  const direction = read(LOCALE_STORAGE_KEYS.direction);
  return {
    region: REGIONS.some((r) => r.key === region) ? (region as Region) : DEFAULT_LOCALE_PREFS.region,
    hourCycle: hourCycle === 'h12' || hourCycle === 'h23' ? hourCycle : 'auto',
    direction: direction === 'ltr' || direction === 'rtl' ? direction : 'auto',
  };
}

export function saveLocalePrefs(prefs: LocalePrefs): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEYS.region, prefs.region);
    localStorage.setItem(LOCALE_STORAGE_KEYS.hourCycle, prefs.hourCycle);
    localStorage.setItem(LOCALE_STORAGE_KEYS.direction, prefs.direction);
  } catch {
    // Storage can be unavailable; the defaults apply.
  }
  cached = null;
}

function baseTag(prefs: LocalePrefs): string {
  const tag = prefs.region === 'auto' ? (typeof navigator !== 'undefined' && navigator.language) || 'en-IN' : prefs.region;
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? 'en-IN';
  } catch {
    return 'en-IN';
  }
}

let cached: string | null = null;

/** The locale every formatter uses, e.g. `en-IN` or `en-US-u-hc-h23` when the clock style is fixed. */
export function appLocale(): string {
  if (cached) return cached;
  const prefs = readLocalePrefs();
  const base = baseTag(prefs);
  cached = prefs.hourCycle === 'auto' ? base : `${base}-u-hc-${prefs.hourCycle}`;
  return cached;
}

export function resolveDirection(prefs: LocalePrefs = readLocalePrefs()): 'ltr' | 'rtl' {
  if (prefs.direction !== 'auto') return prefs.direction;
  return RTL_LANGUAGES.has(baseTag(prefs).split('-')[0]!) ? 'rtl' : 'ltr';
}

/**
 * Sets `dir` and `lang` on the document. Interface text is English, so `lang` stays English (with the region when
 * it is an English one) so screen readers keep an English voice whatever the format region.
 */
export function applyLocale(root: HTMLElement, prefs: LocalePrefs = readLocalePrefs()): void {
  const base = baseTag(prefs);
  root.lang = base.startsWith('en') ? base : 'en';
  root.dir = resolveDirection(prefs);
}

/** Formats minutes since midnight as a clock time in the app locale ("14:30" or "2:30 pm"). */
export function formatClockMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return new Intl.DateTimeFormat(appLocale(), { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, Math.floor(m / 60), m % 60)));
}
