import type { CycleStatus, HikeStatus, PipProgress, PipStatus, ReviewStage } from '@contracts';
import { http, type ListQuery } from '@/core/http/http-client';
import type { AssessmentInput, Colleague, Compensation, CompensationInput, Cycle, CycleDetail, CycleInput, FeedbackRequest, GoalInput, HikeInput, HikeList, HikeRow, PipDetail, PipInput, PipRow, ReviewDetail, ReviewRow } from '../types';

export const performanceApi = {
  cycles: (q: ListQuery & { status?: CycleStatus }) => http.page<Cycle>('/performance/cycles', q),
  cycle: (id: string) => http.get<CycleDetail>(`/performance/cycles/${id}`),
  createCycle: (body: CycleInput) => http.post<CycleDetail>('/performance/cycles', body),
  updateCycle: (id: string, body: Partial<CycleInput>) => http.patch<CycleDetail>(`/performance/cycles/${id}`, body),
  removeCycle: (id: string) => http.delete<{ deleted: boolean }>(`/performance/cycles/${id}`),
  launch: (id: string) => http.post<CycleDetail>(`/performance/cycles/${id}/launch`),
  addParticipants: (id: string, employeeIds: string[]) => http.post<CycleDetail>(`/performance/cycles/${id}/participants`, { employeeIds }),
  release: (id: string) => http.post<CycleDetail>(`/performance/cycles/${id}/release`),
  closeCycle: (id: string) => http.post<CycleDetail>(`/performance/cycles/${id}/close`),

  reviews: (q: ListQuery & { cycleId?: string; view?: 'mine' | 'team' | 'all'; stage?: ReviewStage }) => http.page<ReviewRow>('/performance/reviews', q),
  review: (id: string) => http.get<ReviewDetail>(`/performance/reviews/${id}`),
  addGoal: (id: string, body: GoalInput) => http.post<ReviewDetail>(`/performance/reviews/${id}/goals`, body),
  updateGoal: (id: string, goalId: string, body: Partial<GoalInput>) => http.patch<ReviewDetail>(`/performance/reviews/${id}/goals/${goalId}`, body),
  removeGoal: (id: string, goalId: string) => http.delete<ReviewDetail>(`/performance/reviews/${id}/goals/${goalId}`),
  progress: (id: string, goalId: string, progress: number, progressNote: string | null) => http.put<ReviewDetail>(`/performance/reviews/${id}/goals/${goalId}/progress`, { progress, progressNote }),
  submitGoals: (id: string) => http.post<ReviewDetail>(`/performance/reviews/${id}/goals/submit`),
  approveGoals: (id: string) => http.post<ReviewDetail>(`/performance/reviews/${id}/goals/approve`),
  returnGoals: (id: string, note: string) => http.post<ReviewDetail>(`/performance/reviews/${id}/goals/return`, { note }),
  selfAssessment: (id: string, body: AssessmentInput) => http.put<ReviewDetail>(`/performance/reviews/${id}/self-assessment`, body),
  managerReview: (id: string, body: AssessmentInput) => http.put<ReviewDetail>(`/performance/reviews/${id}/manager-review`, body),
  calibrate: (id: string, rating: number, note: string) => http.post<ReviewDetail>(`/performance/reviews/${id}/calibrate`, { rating, note }),
  acknowledge: (id: string, comment: string | null) => http.post<ReviewDetail>(`/performance/reviews/${id}/acknowledge`, { comment }),
  reassign: (id: string, reviewerId: string) => http.post<ReviewDetail>(`/performance/reviews/${id}/reviewer`, { reviewerId }),
  requestFeedback: (id: string, employeeIds: string[]) => http.post<ReviewDetail>(`/performance/reviews/${id}/feedback-requests`, { employeeIds }),
  colleagues: (search?: string) => http.get<Colleague[]>('/performance/colleagues', { search: search || undefined }),

  compensation: (cycleId: string) => http.get<Compensation>(`/performance/cycles/${cycleId}/compensation`),
  setCompensation: (cycleId: string, body: CompensationInput) => http.put<Compensation>(`/performance/cycles/${cycleId}/compensation`, body),
  hikes: (cycleId: string, q: { view?: 'mine' | 'all'; status?: HikeStatus }) => http.get<HikeList>(`/performance/cycles/${cycleId}/hikes`, q),
  recommendHike: (reviewId: string, body: HikeInput) => http.put<HikeRow>(`/performance/reviews/${reviewId}/hike`, body),
  submitHike: (id: string) => http.post<HikeRow>(`/performance/hikes/${id}/submit`),
  approveHike: (id: string, body: { percent?: number; note?: string | null }) => http.post<HikeRow>(`/performance/hikes/${id}/approve`, body),
  rejectHike: (id: string, note: string) => http.post<HikeRow>(`/performance/hikes/${id}/reject`, { note }),
  applyHikes: (cycleId: string) => http.post<{ applied: number; failed: { employee: string; reason: string }[] }>(`/performance/cycles/${cycleId}/hikes/apply`),

  myFeedback: () => http.get<FeedbackRequest[]>('/performance/feedback'),
  giveFeedback: (id: string, body: { rating: number | null; strengths: string; improvements: string }) => http.post<FeedbackRequest>(`/performance/feedback/${id}`, body),
  declineFeedback: (id: string) => http.post<FeedbackRequest>(`/performance/feedback/${id}/decline`),

  pips: (q: ListQuery & { view?: 'mine' | 'managed'; status?: PipStatus }) => http.page<PipRow>('/performance/pips', q),
  pip: (id: string) => http.get<PipDetail>(`/performance/pips/${id}`),
  createPip: (body: PipInput) => http.post<PipDetail>('/performance/pips', body),
  updatePip: (id: string, body: { objectives?: { title: string; measure?: string | null }[]; endDate?: string; reason?: string }) => http.patch<PipDetail>(`/performance/pips/${id}`, body),
  checkIn: (id: string, body: { checkInDate: string; progress: PipProgress; note: string }) => http.post<PipDetail>(`/performance/pips/${id}/check-ins`, body),
  closePip: (id: string, body: { outcome: 'SUCCESSFUL' | 'UNSUCCESSFUL' | 'CANCELLED'; note: string; objectivesMet?: boolean[] }) => http.post<PipDetail>(`/performance/pips/${id}/close`, body),
  acknowledgePip: (id: string, comment: string | null) => http.post<PipDetail>(`/performance/pips/${id}/acknowledge`, { comment }),
};
