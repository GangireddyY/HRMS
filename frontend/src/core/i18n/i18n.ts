import { ref } from 'vue';
import { en } from './en';

/**
 * Interface text. Strings live in catalogs keyed by id (`en.ts` is the source); `t()` fills `{name}` placeholders and
 * picks `one|other` plural forms by `{count}`. A missing translation falls back to English, a missing key shows the
 * key (and fails the catalog test). Dates, numbers and amounts are formatted by the region setting, not here.
 */
export type MessageKey = keyof typeof en;
type Catalog = Partial<Record<MessageKey, string>>;

const catalogs: Record<string, Catalog> = { en };
export const language = ref('en');

export function registerCatalog(lang: string, catalog: Catalog): void {
  catalogs[lang] = { ...catalogs[lang], ...catalog };
}

export function setLanguage(lang: string): void {
  language.value = catalogs[lang] ? lang : 'en';
}

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const template = catalogs[language.value]?.[key] ?? en[key] ?? key;
  // "{count} person|{count} people": the first form for one, the second otherwise.
  const forms = template.split('|');
  const text = forms.length > 1 ? forms[Number(params.count) === 1 ? 0 : 1]! : template;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}
