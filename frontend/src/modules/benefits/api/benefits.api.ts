import type { BenefitEnrollmentStatus, BenefitPlanStatus, LifeEvent } from '@contracts';
import { downloadFile, http, type ListQuery } from '@/core/http/http-client';
import type { Enrollment, MyBenefits, Plan, PlanInput } from '../types';

export const benefitsApi = {
  mine: () => http.get<MyBenefits>('/benefits/me'),
  enroll: (planId: string, body: { optionId: string; dependentIds: string[]; lifeEvent?: LifeEvent | null; lifeEventDate?: string | null; note?: string | null }) =>
    http.post<Enrollment>(`/benefits/plans/${planId}/enroll`, body),
  waive: (planId: string, note: string | null) => http.post<Enrollment>(`/benefits/plans/${planId}/waive`, { note }),
  cancel: (id: string) => http.post<Enrollment>(`/benefits/enrollments/${id}/cancel`),

  plans: (q: ListQuery & { status?: BenefitPlanStatus }) => http.page<Plan>('/benefits/plans', q),
  plan: (id: string) => http.get<Plan>(`/benefits/plans/${id}`),
  createPlan: (body: PlanInput) => http.post<Plan>('/benefits/plans', body),
  updatePlan: (id: string, body: Partial<PlanInput>) => http.patch<Plan>(`/benefits/plans/${id}`, body),
  removePlan: (id: string) => http.delete<{ deleted: boolean }>(`/benefits/plans/${id}`),
  activate: (id: string) => http.post<Plan>(`/benefits/plans/${id}/activate`),
  archive: (id: string) => http.post<Plan>(`/benefits/plans/${id}/archive`),
  enrollEligible: (id: string) => http.post<{ enrolled: number }>(`/benefits/plans/${id}/enroll-eligible`),
  census: (plan: Plan) => downloadFile(`/benefits/plans/${plan.id}/census`, undefined, `${plan.name} census.csv`),

  enrollments: (q: ListQuery & { planId?: string; status?: BenefitEnrollmentStatus }) => http.page<Enrollment>('/benefits/enrollments', q),
  approve: (id: string, note: string | null) => http.post<Enrollment>(`/benefits/enrollments/${id}/approve`, { note }),
  reject: (id: string, note: string) => http.post<Enrollment>(`/benefits/enrollments/${id}/reject`, { note }),
  end: (id: string, effectiveTo: string, note: string | null) => http.post<Enrollment>(`/benefits/enrollments/${id}/end`, { effectiveTo, note }),
};
