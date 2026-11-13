import type { ContributionRates, OrganizationStatus, TaxRuleSet } from '@contracts';
import { http, type ListQuery } from '@/core/http/http-client';
import type { AuditQuery } from '@/modules/audit/api/audit.api';
import type { AuditEntry } from '@/modules/audit/types';
import type { Plan, PlatformDashboard, PlatformOrgDetail, PlatformOrgRow, StatutoryOverview } from '../types';

export const platformApi = {
  dashboard: () => http.get<PlatformDashboard>('/platform/dashboard'),
  organizations: (q: ListQuery & { status?: OrganizationStatus; planId?: string }) => http.page<PlatformOrgRow>('/platform/organizations', q),
  organization: (id: string) => http.get<PlatformOrgDetail>(`/platform/organizations/${id}`),
  createOrganization: (body: unknown) => http.post<PlatformOrgDetail>('/platform/organizations', body),
  updateOrganization: (id: string, body: unknown) => http.patch<PlatformOrgDetail>(`/platform/organizations/${id}`, body),
  activate: (id: string) => http.post<PlatformOrgDetail>(`/platform/organizations/${id}/activate`),
  suspend: (id: string, reason: string) => http.post<PlatformOrgDetail>(`/platform/organizations/${id}/suspend`, { reason }),
  deactivate: (id: string, reason: string) => http.post<PlatformOrgDetail>(`/platform/organizations/${id}/deactivate`, { reason }),
  setFeatures: (id: string, overrides: { featureKey: string; enabled: boolean | null; reason?: string }[]) =>
    http.put<PlatformOrgDetail>(`/platform/organizations/${id}/features`, { overrides }),
  resendAdminInvitation: (id: string, membershipId: string) => http.post<{ resent: boolean }>(`/platform/organizations/${id}/admins/${membershipId}/resend-invitation`),
  plans: () => http.get<Plan[]>('/platform/plans'),
  createPlan: (body: unknown) => http.post<Plan>('/platform/plans', body),
  updatePlan: (id: string, body: unknown) => http.patch<Plan>(`/platform/plans/${id}`, body),
  auditLogs: (q: AuditQuery) => http.page<AuditEntry>('/platform/audit-logs', q),
  statutoryRates: () => http.get<StatutoryOverview>('/platform/statutory-rates'),
  saveContribution: (body: ContributionRates & { effectiveFrom: string; source?: string | null }) => http.put<StatutoryOverview>('/platform/statutory-rates/contribution', body),
  removeContribution: (id: string) => http.delete<StatutoryOverview>(`/platform/statutory-rates/contribution/${id}`),
  saveTaxRules: (fy: number, body: { rules: TaxRuleSet; source?: string | null }) => http.put<StatutoryOverview>(`/platform/statutory-rates/tax/${fy}`, body),
  removeTaxRules: (fy: number) => http.delete<StatutoryOverview>(`/platform/statutory-rates/tax/${fy}`),
};
