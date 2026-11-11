export const CUSTOM_FIELD_TYPES = ['TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTI_SELECT', 'EMAIL', 'URL'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export const CUSTOM_FIELD_ENTITIES = ['EMPLOYEE'] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];
export const CUSTOM_FIELD_MAX_PER_ENTITY = 60;
export const CUSTOM_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** A value as stored: text, number, yes/no, a date (YYYY-MM-DD) or several options. */
export type CustomFieldValue = string | number | boolean | string[] | null;
