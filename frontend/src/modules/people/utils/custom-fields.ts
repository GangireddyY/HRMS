import type { CustomFieldType, CustomFieldValue } from '@contracts';
import { formatDate } from '@/shared/utils/format';

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: 'Short text',
  LONG_TEXT: 'Long text',
  NUMBER: 'Number',
  DATE: 'Date',
  BOOLEAN: 'Yes / no',
  SELECT: 'One choice',
  MULTI_SELECT: 'Several choices',
  EMAIL: 'Email',
  URL: 'Web address',
};

/** How a value reads on a profile. */
export function customFieldText(type: CustomFieldType, value: CustomFieldValue): string {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'BOOLEAN') return value ? 'Yes' : 'No';
  if (type === 'DATE' && typeof value === 'string') return formatDate(value);
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  return String(value);
}

/** Fields grouped by section (fields without one go under "Additional details"). */
export function bySection<T extends { section: string | null }>(fields: T[]): { section: string; fields: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const f of fields) {
    const key = f.section?.trim() || 'Additional details';
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return [...groups.entries()].map(([section, list]) => ({ section, fields: list }));
}
