import type { PolicyCategory, PolicyStatus } from '@contracts';
import { downloadFile, http, type ListQuery } from '@/core/http/http-client';
import type { AckCounts, AckState, Calendar, MyPolicy, Obligation, ObligationInput, PersonAck, PolicyDetail, PolicyInput, PolicyReading, PolicySummary } from '../types';

export const complianceApi = {
  mine: () => http.get<MyPolicy[]>('/compliance/policies/mine'),
  read: (id: string) => http.get<PolicyReading>(`/compliance/policies/${id}/read`),
  acknowledge: (id: string, versionId: string) => http.post<PolicyReading>(`/compliance/policies/${id}/acknowledge`, { versionId }),
  downloadVersion: (policyId: string, versionId: string, name: string) => downloadFile(`/compliance/policies/${policyId}/versions/${versionId}/file`, undefined, name),

  policies: (q: ListQuery & { status?: PolicyStatus; category?: PolicyCategory }) => http.page<PolicySummary>('/compliance/policies', q),
  policy: (id: string) => http.get<PolicyDetail>(`/compliance/policies/${id}`),
  createPolicy: (body: PolicyInput) => http.post<PolicyDetail>('/compliance/policies', body),
  updatePolicy: (id: string, body: Partial<PolicyInput>) => http.patch<PolicyDetail>(`/compliance/policies/${id}`, body),
  removePolicy: (id: string) => http.delete<{ deleted: boolean }>(`/compliance/policies/${id}`),
  saveDraft: (id: string, body: { content?: string | null; changeSummary?: string | null; reacknowledge?: boolean; effectiveFrom?: string | null }) => http.put<PolicyDetail>(`/compliance/policies/${id}/draft`, body),
  discardDraft: (id: string) => http.delete<PolicyDetail>(`/compliance/policies/${id}/draft`),
  uploadDraftFile: (id: string, file: File) => http.upload<PolicyDetail>(`/compliance/policies/${id}/draft/file`, file, { fileName: file.name }),
  removeDraftFile: (id: string) => http.delete<PolicyDetail>(`/compliance/policies/${id}/draft/file`),
  publish: (id: string) => http.post<PolicyDetail>(`/compliance/policies/${id}/publish`),
  retire: (id: string) => http.post<PolicyDetail>(`/compliance/policies/${id}/retire`),
  reviewed: (id: string) => http.post<PolicyDetail>(`/compliance/policies/${id}/reviewed`),
  tracking: (id: string, q: ListQuery & { state?: AckState }) => http.get<{ items: PersonAck[]; meta: { page: number; pageSize: number; total: number; totalPages: number }; counts: AckCounts }>(`/compliance/policies/${id}/acknowledgements`, q),
  trackingCsv: (p: { id: string; title: string }) => downloadFile(`/compliance/policies/${p.id}/acknowledgements.csv`, undefined, `${p.title} acknowledgements.csv`),
  remind: (id: string) => http.post<{ reminded: number; withoutLogin: number }>(`/compliance/policies/${id}/remind`),

  calendar: (q: { from: string; to: string; overdue?: boolean }) => http.get<Calendar>('/compliance/calendar', q),
  obligations: () => http.get<Obligation[]>('/compliance/obligations'),
  createObligation: (body: ObligationInput) => http.post<Obligation>('/compliance/obligations', body),
  updateObligation: (id: string, body: Partial<ObligationInput>) => http.patch<Obligation>(`/compliance/obligations/${id}`, body),
  removeObligation: (id: string) => http.delete<{ deleted: boolean }>(`/compliance/obligations/${id}`),
  addRecommended: () => http.post<{ added: number }>('/compliance/obligations/recommended'),
  file: (obligationId: string, body: { dueOn: string; completedOn: string; reference: string | null; note: string | null }, file: File | null) =>
    file
      ? http.upload<{ dueOn: string }>(`/compliance/obligations/${obligationId}/filings`, file, { fileName: file.name, fields: { ...body, reference: body.reference ?? undefined, note: body.note ?? undefined } })
      : http.post<{ dueOn: string }>(`/compliance/obligations/${obligationId}/filings`, body),
  unfile: (filingId: string) => http.delete<{ deleted: boolean }>(`/compliance/filings/${filingId}`),
  downloadFiling: (filingId: string, name: string) => downloadFile(`/compliance/filings/${filingId}/file`, undefined, name),
};
