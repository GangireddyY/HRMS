import { beforeEach, describe, expect, it } from 'vitest';
import { appLocale, applyLocale, formatClockMinutes, LOCALE_STORAGE_KEYS, readLocalePrefs, resolveDirection, saveLocalePrefs } from './locale';

describe('locale preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    saveLocalePrefs({ region: 'auto', hourCycle: 'auto', direction: 'auto' });
    localStorage.clear();
  });

  it('defaults to the browser region and ignores invalid stored values', () => {
    localStorage.setItem(LOCALE_STORAGE_KEYS.region, 'xx-YY');
    localStorage.setItem(LOCALE_STORAGE_KEYS.hourCycle, 'h99');
    expect(readLocalePrefs()).toEqual({ region: 'auto', hourCycle: 'auto', direction: 'auto' });
  });

  it('adds the clock style to the locale tag', () => {
    saveLocalePrefs({ region: 'en-US', hourCycle: 'h23', direction: 'auto' });
    expect(appLocale()).toBe('en-US-u-hc-h23');
    expect(formatClockMinutes(14 * 60 + 5)).toBe('14:05');
    saveLocalePrefs({ region: 'en-GB', hourCycle: 'h12', direction: 'auto' });
    expect(formatClockMinutes(14 * 60 + 5).toLowerCase()).toMatch(/^0?2:05\s?pm$/);
  });

  it('mirrors the layout for right-to-left regions unless overridden', () => {
    expect(resolveDirection({ region: 'ar-AE', hourCycle: 'auto', direction: 'auto' })).toBe('rtl');
    expect(resolveDirection({ region: 'ar-AE', hourCycle: 'auto', direction: 'ltr' })).toBe('ltr');
    expect(resolveDirection({ region: 'en-IN', hourCycle: 'auto', direction: 'rtl' })).toBe('rtl');
  });

  it('keeps an English lang attribute for non-English format regions', () => {
    const root = document.documentElement;
    applyLocale(root, { region: 'de-DE', hourCycle: 'auto', direction: 'auto' });
    expect(root.lang).toBe('en');
    expect(root.dir).toBe('ltr');
    applyLocale(root, { region: 'en-GB', hourCycle: 'auto', direction: 'auto' });
    expect(root.lang).toBe('en-GB');
  });
});
