import type { MembershipStatus } from '@contracts';
import { http, type ListQuery } from '@/core/http/http-client';
import type { LoginEventRow } from '@/modules/audit/types';
import type { Member } from '../types';

export const usersApi = {
  list: (q: ListQuery & { status?: MembershipStatus; roleId?: string }) => http.page<Member>('/users', q),
  get: (id: string) => http.get<Member>(`/users/${id}`),
  invite: (body: { email: string; firstName: string; lastName: string; roleIds: string[] }) => http.post<Member>('/users/invitations', body),
  resendInvitation: (id: string) => http.post<{ resent: boolean }>(`/users/${id}/invitation/resend`),
  cancelInvitation: (id: string) => http.delete<{ cancelled: boolean }>(`/users/${id}/invitation`),
  setRoles: (id: string, roleIds: string[]) => http.put<Member>(`/users/${id}/roles`, { roleIds }),
  suspend: (id: string) => http.post<Member>(`/users/${id}/suspend`),
  reactivate: (id: string) => http.post<Member>(`/users/${id}/reactivate`),
  revokeSessions: (id: string) => http.post<{ revoked: number }>(`/users/${id}/sessions/revoke`),
  loginHistory: (id: string, q: ListQuery) => http.page<LoginEventRow>(`/users/${id}/login-history`, q),
};
