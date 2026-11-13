import type { ContributionRates, MembershipStatus, ModuleKey, OrganizationStatus, TaxRuleSet } from '@contracts';

export interface ContributionEntry extends ContributionRates {
  id: string;
  effectiveFrom: string;
  source: string | null;
  updatedAt: string;
  upcoming: boolean;
}

export interface TaxYear {
  financialYear: number;
  label: string;
  /** ENTERED = rules entered here; BUILT_IN = shipped with the release. */
  source: 'ENTERED' | 'BUILT_IN';
  /** False when the year borrows `rulesYear`'s rules because its own haven't been entered. */
  confirmed: boolean;
  rulesYear: number;
  rules: TaxRuleSet;
  note: string | null;
  updatedAt: string | null;
}

export interface StatutoryOverview {
  today: string;
  currentFinancialYear: number;
  contribution: { builtIn: ContributionRates; inForce: ContributionRates & { effectiveFrom: string | null }; entries: ContributionEntry[] };
  tax: TaxYear[];
}
import type { DailyLoginStat } from '@/modules/audit/types';
import type { OrganizationProfile } from '@/modules/organization/types';

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  maxUsers: number | null;
  monthlyPrice: number | null;
  currency: string;
  sortOrder: number;
  featureKeys: string[];
  organizationCount: number;
}

export interface PlatformOrgRow {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  country: string;
  createdAt: string;
  suspendedAt: string | null;
  plan: { id: string; code: string; name: string };
  userCount: number;
}

export interface PlatformOrgDetail extends OrganizationProfile {
  members: Partial<Record<MembershipStatus, number>>;
  admins: { membershipId: string; status: MembershipStatus; email: string; firstName: string; lastName: string; lastLoginAt: string | null }[];
  featureOverrides: { featureKey: string; enabled: boolean; reason: string | null; updatedAt: string }[];
  modules: { key: ModuleKey; name: string; core: boolean; entitled: boolean }[];
}

export interface PlatformDashboard {
  organizations: { total: number; active: number; pending: number; suspended: number; deactivated: number };
  plans: { code: string; name: string; organizations: number }[];
  activeUsers: number;
  activeSessions: number;
  recentOrganizations: { id: string; name: string; status: OrganizationStatus; createdAt: string; plan: { name: string } }[];
  loginActivity: DailyLoginStat[];
}
