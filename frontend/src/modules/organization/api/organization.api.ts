import { http } from '@/core/http/http-client';
import type { OrganizationProfile, OrgOverview, SecurityPolicy, SsoSettings, SsoSettingsInput, Subscription } from '../types';

export const organizationApi = {
  get: () => http.get<OrganizationProfile>('/organizations/current'),
  update: (body: Partial<OrganizationProfile>) => http.patch<OrganizationProfile>('/organizations/current', body),
  securityPolicy: () => http.get<SecurityPolicy>('/organizations/current/security-policy'),
  updateSecurityPolicy: (body: Partial<SecurityPolicy>) => http.put<SecurityPolicy>('/organizations/current/security-policy', body),
  sso: () => http.get<SsoSettings>('/organizations/current/sso'),
  updateSso: (body: SsoSettingsInput) => http.put<SsoSettings>('/organizations/current/sso', body),
  subscription: () => http.get<Subscription>('/organizations/current/subscription'),
  overview: () => http.get<OrgOverview>('/organizations/current/overview'),
  uploadLogo: (file: File) => http.upload<{ logoUrl: string }>('/organizations/current/logo', file),
  removeLogo: () => http.delete<{ removed: boolean }>('/organizations/current/logo'),
};
