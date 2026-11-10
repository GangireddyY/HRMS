import type { ModuleKey, OrganizationStatus } from '@contracts';
import type { DailyLoginStat } from '@/modules/audit/types';

export interface OrganizationProfile {
  id: string;
  name: string;
  legalName: string | null;
  slug: string;
  status: OrganizationStatus;
  industry: string | null;
  companySize: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  registrationNumber: string | null;
  taxId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  timezone: string;
  currency: string;
  locale: string;
  dateFormat: string;
  fiscalYearStartMonth: number;
  logoUrl: string | null;
  /** Lowercase `#rrggbb`; the app derives the Organization brand theme from it. */
  brandColor: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  createdAt: string;
  updatedAt: string;
  plan: { id: string; code: string; name: string };
}

export interface SsoSettings {
  enabled: boolean;
  issuer: string | null;
  clientId: string | null;
  hasClientSecret: boolean;
  emailDomains: string[];
  required: boolean;
  autoProvision: boolean;
  defaultRoleKey: string;
  buttonLabel: string | null;
  redirectUri: string;
  signInUrl: string | null;
  updatedAt: string | null;
}

export interface SsoSettingsInput {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret?: string | null;
  publicClient?: boolean;
  emailDomains: string[];
  required?: boolean;
  autoProvision?: boolean;
  defaultRoleKey?: string;
  buttonLabel?: string | null;
}

export interface SecurityPolicy {
  id: string;
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordRequireNumber: boolean;
  passwordRequireSymbol: boolean;
  passwordHistoryCount: number;
  passwordMaxAgeDays: number;
  lockoutThreshold: number;
  lockoutDurationMinutes: number;
  sessionIdleTimeoutMinutes: number;
  sessionMaxLifetimeHours: number;
  mfaRequired: boolean;
  updatedAt: string;
}

export interface Subscription {
  plan: { id: string; code: string; name: string; description: string | null; maxUsers: number | null };
  userCount: number;
  modules: { key: ModuleKey; name: string; description: string; core: boolean; entitled: boolean }[];
}

export interface OrgOverview {
  members: { active: number; invited: number; suspended: number };
  roles: number;
  activeSessions: number;
  mfaAdoption: number;
  loginActivity: DailyLoginStat[];
  recentActivity: { id: string; action: string; summary: string | null; entityType: string; createdAt: string; actor: { firstName: string; lastName: string } | null }[];
}
