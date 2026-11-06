import { ValidateIf } from 'class-validator';

export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
/** Empty strings clear optional fields. */
export const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value);
export const emptyToNullUpper = ({ value }: { value: unknown }) => {
  const v = emptyToNull({ value });
  return typeof v === 'string' ? v.toUpperCase() : v;
};
/** Validate only when a value is present (null and undefined pass). */
export const optionalNullable = ValidateIf((_o, v) => v !== null && v !== undefined);
