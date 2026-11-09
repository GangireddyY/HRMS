import type { LogArchiveKind } from '@contracts';
import { downloadFile, http, type ListQuery } from '@/core/http/http-client';
import type { AuditEntry, LogArchive, LogArchivePreview, LoginEventRow } from '../types';

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

export const logArchivesApi = {
  list: (kind: LogArchiveKind) => http.get<LogArchive[]>('/log-archives', { kind }),
  preview: (kind: LogArchiveKind, before: string) => http.get<LogArchivePreview>('/log-archives/preview', { kind, before }),
  create: (kind: LogArchiveKind, before: string) => http.post<LogArchive>('/log-archives', { kind, before }),
  download: (a: LogArchive) => downloadFile(`/log-archives/${a.id}/file`, undefined, a.fileName),
  purge: (id: string, recordCount: number) => http.post<LogArchive>(`/log-archives/${id}/purge`, { recordCount }),
};
