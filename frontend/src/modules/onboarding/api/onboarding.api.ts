import type { OnboardingAssignee, OnboardingCaseStatus, DocumentCategory, ProbationRecommendation, ProbationReviewStatus } from '@contracts';
import { downloadFile, http, type ListQuery } from '@/core/http/http-client';
import type { CaseDetail, CaseSummary, ChecklistTemplate, JoinerRef, ProbationDue, ProbationReview, TeamTasks, TemplateTask } from '../types';

export interface CaseTaskInput {
  title: string;
  description?: string | null;
  assignee: OnboardingAssignee;
  documentCategory?: DocumentCategory | null;
  dueDate: string;
  isRequired?: boolean;
}

export const onboardingApi = {
  templates: () => http.get<ChecklistTemplate[]>('/onboarding/templates'),
  createTemplate: (body: { name: string; description?: string | null; isDefault?: boolean; isActive?: boolean; tasks: TemplateTask[] }) => http.post<ChecklistTemplate>('/onboarding/templates', body),
  updateTemplate: (id: string, body: Partial<{ name: string; description: string | null; isDefault: boolean; isActive: boolean; tasks: TemplateTask[] }>) =>
    http.put<ChecklistTemplate>(`/onboarding/templates/${id}`, body),
  removeTemplate: (id: string) => http.delete<{ deleted: boolean }>(`/onboarding/templates/${id}`),
  addRecommended: () => http.post<ChecklistTemplate>('/onboarding/templates/recommended'),

  cases: (q: ListQuery & { status?: OnboardingCaseStatus }) => http.page<CaseSummary>('/onboarding/cases', q),
  joiners: () => http.get<JoinerRef[]>('/onboarding/joiners'),
  start: (body: { employeeId: string; templateId?: string | null; buddyId?: string | null; notes?: string | null }) => http.post<CaseDetail>('/onboarding/cases', body),
  get: (id: string) => http.get<CaseDetail>(`/onboarding/cases/${id}`),
  update: (id: string, body: { buddyId?: string | null; notes?: string | null }) => http.patch<CaseDetail>(`/onboarding/cases/${id}`, body),
  complete: (id: string) => http.post<CaseDetail>(`/onboarding/cases/${id}/complete`),
  cancel: (id: string, reason: string) => http.post<CaseDetail>(`/onboarding/cases/${id}/cancel`, { reason }),
  addTask: (caseId: string, body: CaseTaskInput) => http.post<CaseDetail>(`/onboarding/cases/${caseId}/tasks`, body),
  updateTask: (taskId: string, body: Partial<CaseTaskInput>) => http.patch<CaseDetail>(`/onboarding/tasks/${taskId}`, body),
  removeTask: (taskId: string) => http.delete<CaseDetail>(`/onboarding/tasks/${taskId}`),
  completeTask: (taskId: string, note?: string | null) => http.post<CaseDetail>(`/onboarding/tasks/${taskId}/complete`, { note }),
  reopenTask: (taskId: string) => http.post<CaseDetail>(`/onboarding/tasks/${taskId}/reopen`),
  skipTask: (taskId: string, note: string) => http.post<CaseDetail>(`/onboarding/tasks/${taskId}/skip`, { note }),
  uploadDocument: (taskId: string, file: File) => http.upload<CaseDetail>(`/onboarding/tasks/${taskId}/document`, file, { fileName: file.name }),
  documentBlob: (taskId: string) => http.download(`/onboarding/tasks/${taskId}/document`),
  downloadDocument: (taskId: string, fileName: string) => downloadFile(`/onboarding/tasks/${taskId}/document`, undefined, fileName),
  verifyDocument: (taskId: string, status: 'VERIFIED' | 'REJECTED', note?: string | null) => http.post<CaseDetail>(`/onboarding/tasks/${taskId}/verify`, { status, note }),

  mine: () => http.get<CaseDetail | null>('/onboarding/me'),
  teamTasks: () => http.get<TeamTasks[]>('/onboarding/team-tasks'),

  probationDue: (days = 60) => http.get<ProbationDue[]>('/onboarding/probation', { days }),
  submitReview: (body: { employeeId: string; recommendation: ProbationRecommendation; extendTo?: string | null; comments: string }) => http.post<ProbationReview>('/onboarding/probation/reviews', body),
  reviews: (q: ListQuery & { view?: 'approve' | 'mine'; status?: ProbationReviewStatus }) => http.page<ProbationReview>('/onboarding/probation/reviews', q),
  approveReview: (id: string, note?: string | null) => http.post<ProbationReview>(`/onboarding/probation/reviews/${id}/approve`, { note }),
  rejectReview: (id: string, note: string) => http.post<ProbationReview>(`/onboarding/probation/reviews/${id}/reject`, { note }),
  cancelReview: (id: string) => http.post<ProbationReview>(`/onboarding/probation/reviews/${id}/cancel`),
};
