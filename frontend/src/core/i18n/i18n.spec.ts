import { afterEach, describe, expect, it } from 'vitest';
import { formatAmount, currencySymbol, setAppCurrency } from '@/core/locale/currency';
import { en } from './en';
import { registerCatalog, setLanguage, t } from './i18n';

describe('i18n', () => {
  afterEach(() => setLanguage('en'));

  it('fills placeholders and picks plural forms', () => {
    expect(t('table.results', { count: 1 })).toBe('1 result');
    expect(t('table.results', { count: 3 })).toBe('3 results');
    expect(t('table.deleteView', { name: 'Engineering' })).toBe('Delete view Engineering');
  });

  it('falls back to English for missing translations and unknown languages', () => {
    registerCatalog('hi', { 'common.save': 'सहेजें' });
    setLanguage('hi');
    expect(t('common.save')).toBe('सहेजें');
    expect(t('common.cancel')).toBe('Cancel');
    setLanguage('xx');
    expect(t('common.save')).toBe('Save');
  });

  it('has no empty messages', () => {
    for (const [key, text] of Object.entries(en)) expect(text.trim(), key).not.toBe('');
  });
});

describe('currency', () => {
  afterEach(() => setAppCurrency('INR'));

  it("uses the organization's currency, with Indian grouping for rupees", () => {
    expect(formatAmount(123456)).toBe('₹1,23,456');
    expect(formatAmount(-500)).toBe('−₹500');
    expect(formatAmount(null)).toBe('—');
    setAppCurrency('USD');
    expect(formatAmount(123456.5, { decimals: true })).toMatch(/123,456\.50/);
    expect(currencySymbol()).toBe('$');
    setAppCurrency('bogus');
    expect(formatAmount(10)).toBe('₹10');
  });
});
