import type { OrganizationProfile } from '@/modules/organization/types';

export const PROFILE_KEYS = [
  'name', 'legalName', 'industry', 'companySize', 'email', 'phone', 'website', 'registrationNumber', 'taxId',
  'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country', 'timezone', 'currency', 'dateFormat', 'fiscalYearStartMonth',
] as const;

export type ProfileFields = Pick<OrganizationProfile, (typeof PROFILE_KEYS)[number]>;

export function toProfileFields(org: OrganizationProfile): ProfileFields {
  return Object.fromEntries(PROFILE_KEYS.map((k) => [k, org[k]])) as ProfileFields;
}

/** Only fields that changed; cleared fields are sent as empty strings (the API stores null). */
export function changedFields(before: ProfileFields, after: ProfileFields): Partial<ProfileFields> {
  const out: Record<string, unknown> = {};
  for (const k of PROFILE_KEYS) {
    if ((before[k] ?? '') !== (after[k] ?? '')) out[k] = after[k] ?? '';
  }
  return out as Partial<ProfileFields>;
}
