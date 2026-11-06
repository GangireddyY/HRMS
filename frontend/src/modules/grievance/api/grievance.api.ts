import type { GrievanceCategory, GrievanceOutcome, GrievancePriority, GrievanceStatus, GrievanceVisibility } from '@contracts';
import { downloadFile, http, type ListQuery } from '@/core/http/http-client';
import type { Colleague } from '@/modules/performance/types';
import type { CaseDetail, CaseFile, CaseRow, CaseSummary, GrievanceInput, GrievanceView, Handler, PoshReport, ViewStats } from '../types';

export const grievanceApi = {
  create: (body: GrievanceInput) => http.post<CaseDetail>('/grievances', body),
  mine: (q: ListQuery) => http.page<CaseSummary>('/grievances/mine', q),
  colleagues: (search?: string) => http.get<Colleague[]>('/grievances/colleagues', { search: search || undefined }),
  committee: () => http.get<{ name: string }[]>('/grievances/committee'),

  list: (q: ListQuery & { view?: GrievanceView; status?: GrievanceStatus | 'OPEN'; category?: GrievanceCategory; priority?: GrievancePriority; overdue?: boolean; unassigned?: boolean }) =>
    http.page<CaseRow>('/grievances', q),
  stats: () => http.get<Partial<Record<GrievanceView, ViewStats>>>('/grievances/stats'),
  poshReport: (year?: number) => http.get<PoshReport>('/grievances/posh-report', { year }),

  get: (id: string) => http.get<CaseDetail>(`/grievances/${id}`),
  handlers: (id: string) => http.get<Handler[]>(`/grievances/${id}/handlers`),
  assign: (id: string, assigneeUserId: string | null) => http.post<CaseDetail>(`/grievances/${id}/assign`, { assigneeUserId }),
  setPriority: (id: string, priority: GrievancePriority) => http.patch<CaseDetail>(`/grievances/${id}`, { priority }),
  acknowledge: (id: string) => http.post<CaseDetail>(`/grievances/${id}/acknowledge`),
  investigate: (id: string) => http.post<CaseDetail>(`/grievances/${id}/investigate`),
  resolve: (id: string, body: { outcome: GrievanceOutcome; summary: string; actions: string | null }) => http.post<CaseDetail>(`/grievances/${id}/resolve`, body),
  close: (id: string) => http.post<CaseDetail>(`/grievances/${id}/close`),

  withdraw: (id: string, reason: string | null) => http.post<CaseDetail>(`/grievances/${id}/withdraw`, { reason }),
  accept: (id: string) => http.post<CaseDetail>(`/grievances/${id}/accept`),
  reopen: (id: string, reason: string) => http.post<CaseDetail>(`/grievances/${id}/reopen`, { reason }),

  addNote: (id: string, body: string, visibility: GrievanceVisibility) => http.post<CaseDetail>(`/grievances/${id}/notes`, { body, visibility }),
  upload: (id: string, file: File, visibility: GrievanceVisibility) => http.upload<CaseDetail>(`/grievances/${id}/attachments`, file, { fileName: file.name, fields: { visibility } }),
  download: (id: string, file: CaseFile) => downloadFile(`/grievances/${id}/attachments/${file.id}`, undefined, file.fileName),
};
