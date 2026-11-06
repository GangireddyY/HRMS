import { http, type ListQuery } from '@/core/http/http-client';
import type { AuditEntry, LoginEventRow } from '../types';

export interface AuditQuery extends ListQuery {
  action?: string;
  entityType?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
  organizationId?: string;
}

export const auditApi = {
  list: (q: AuditQuery) => http.page<AuditEntry>('/audit-logs', q),
  loginEvents: (q: ListQuery & { outcome?: string; from?: string; to?: string }) => http.page<LoginEventRow>('/login-events', q),
};
