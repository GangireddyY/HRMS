import type { AccessContext, AppearancePreferences, AuthUser, LoginResult, PasswordPolicy, TokenRefreshResult } from '@contracts';
import { API_BASE, http, type ListQuery } from '@/core/http/http-client';
import type { LoginEventRow } from '@/modules/audit/types';
import type { MfaSetup, MfaStatus, SessionRow, TokenInspection } from '../types';

export const authApi = {
  login: (body: { email: string; password: string; organizationId?: string }) => http.post<LoginResult>('/auth/login', body, { anonymous: true }),
  verifyMfa: (body: { challengeToken: string; code?: string; recoveryCode?: string }) => http.post<LoginResult>('/auth/mfa/verify', body, { anonymous: true }),
  refresh: () => http.post<TokenRefreshResult>('/auth/refresh', {}, { anonymous: true }),
  ssoDiscover: (email: string) =>
    http.post<{ organizationSlug: string; organizationName: string; buttonLabel: string; required: boolean } | null>('/auth/sso/discover', { email }, { anonymous: true }),
  /** Full-page navigation to the organization's identity provider (comes back signed in). */
  ssoStartUrl: (slug: string, opts: { email?: string; returnTo?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.email) q.set('email', opts.email);
    if (opts.returnTo) q.set('returnTo', opts.returnTo);
    return `${API_BASE}/auth/sso/start/${encodeURIComponent(slug)}${q.size ? `?${q}` : ''}`;
  },
  logout: () => http.post<{ loggedOut: boolean }>('/auth/logout', {}, { anonymous: true }),
  forgotPassword: (email: string) => http.post<{ message: string }>('/auth/forgot-password', { email }, { anonymous: true }),
  inspectToken: (token: string, purpose: 'PASSWORD_RESET' | 'INVITATION') => http.post<TokenInspection>('/auth/tokens/inspect', { token, purpose }, { anonymous: true }),
  resetPassword: (token: string, password: string) => http.post<{ message: string }>('/auth/reset-password', { token, password }, { anonymous: true }),
  acceptInvitation: (body: { token: string; password: string; firstName?: string; lastName?: string }) => http.post<{ email: string }>('/auth/accept-invitation', body, { anonymous: true }),
  registerOrganization: (body: unknown) => http.post<LoginResult>('/auth/register-organization', body, { anonymous: true }),
  me: () => http.get<AccessContext>('/auth/me'),
  updateProfile: (body: { firstName?: string; lastName?: string; phone?: string | null }) => http.patch<AuthUser>('/auth/me', body),
  updatePreferences: (body: Partial<Record<keyof AppearancePreferences, string | null>>) => http.patch<AppearancePreferences>('/auth/me/preferences', body),
  uploadAvatar: (file: File) => http.upload<{ avatarUrl: string }>('/auth/me/avatar', file, { fileName: file.name }),
  removeAvatar: () => http.delete<{ removed: boolean }>('/auth/me/avatar'),
  passwordPolicy: () => http.get<PasswordPolicy>('/auth/password-policy'),
  changePassword: (currentPassword: string, newPassword: string) => http.post<{ message: string }>('/auth/change-password', { currentPassword, newPassword }),
  switchOrganization: (organizationId: string) => http.post<{ accessToken: string; expiresIn: number; context: AccessContext }>('/auth/switch-organization', { organizationId }),
  mfaStatus: () => http.get<MfaStatus>('/auth/mfa'),
  mfaSetup: () => http.post<MfaSetup>('/auth/mfa/setup'),
  mfaEnable: (code: string) => http.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code }),
  mfaDisable: (password: string, code: string) => http.post<{ enabled: false }>('/auth/mfa/disable', { password, code }),
  regenerateRecoveryCodes: (code: string) => http.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { code }),
  sessions: () => http.get<SessionRow[]>('/auth/sessions'),
  revokeSession: (id: string) => http.delete<{ revoked: boolean }>(`/auth/sessions/${id}`),
  revokeOtherSessions: () => http.post<{ revoked: number }>('/auth/sessions/revoke-others'),
  loginHistory: (q: ListQuery) => http.page<LoginEventRow>('/auth/login-history', q),
};
