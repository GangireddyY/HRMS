import type { CourseCategory, CourseDelivery, CourseStatus, EnrollmentStatus } from '@contracts';
import { http, type ListQuery } from '@/core/http/http-client';
import type { Assessment, CourseDetail, CourseInput, CourseRow, Enrollment, EnrollmentDetail, Question, RosterRow } from '../types';

export interface SessionInput {
  startsAt: string;
  endsAt: string;
  location?: string | null;
  trainer?: string | null;
  capacity?: number | null;
}

export const trainingApi = {
  courses: (q: ListQuery & { category?: CourseCategory; delivery?: CourseDelivery; status?: CourseStatus; manage?: boolean }) => http.page<CourseRow>('/training/courses', q),
  course: (id: string) => http.get<CourseDetail>(`/training/courses/${id}`),
  createCourse: (body: CourseInput) => http.post<CourseDetail>('/training/courses', body),
  updateCourse: (id: string, body: Partial<CourseInput>) => http.patch<CourseDetail>(`/training/courses/${id}`, body),
  removeCourse: (id: string) => http.delete<{ deleted: boolean }>(`/training/courses/${id}`),
  publish: (id: string) => http.post<CourseDetail>(`/training/courses/${id}/publish`),
  archive: (id: string) => http.post<CourseDetail>(`/training/courses/${id}/archive`),
  setQuestions: (id: string, questions: Question[]) => http.put<CourseDetail>(`/training/courses/${id}/questions`, { questions: questions.map(({ prompt, options, correctIndex }) => ({ prompt, options, correctIndex })) }),
  roster: (id: string, sessionId?: string) => http.get<RosterRow[]>(`/training/courses/${id}/roster`, { sessionId }),
  createSession: (courseId: string, body: SessionInput) => http.post<CourseDetail>(`/training/courses/${courseId}/sessions`, body),
  updateSession: (id: string, body: Partial<SessionInput>) => http.patch<CourseDetail>(`/training/sessions/${id}`, body),
  cancelSession: (id: string) => http.post<CourseDetail>(`/training/sessions/${id}/cancel`),
  attendance: (sessionId: string, entries: { enrollmentId: string; attended: boolean }[]) => http.put<RosterRow[]>(`/training/sessions/${sessionId}/attendance`, { entries }),

  enroll: (courseId: string, sessionId?: string | null) => http.post<EnrollmentDetail>(`/training/courses/${courseId}/enroll`, { sessionId: sessionId ?? null }),
  assign: (body: { courseId: string; employeeIds?: string[]; departmentIds?: string[]; dueDate?: string | null; sessionId?: string | null }) =>
    http.post<{ assigned: number; skipped: { employeeId: string; name: string; reason: string }[] }>('/training/assignments', body),
  enrollments: (q: ListQuery & { view?: 'mine' | 'team'; courseId?: string; status?: EnrollmentStatus; overdue?: boolean }) => http.page<Enrollment>('/training/enrollments', q),
  certifications: (q: ListQuery & { state?: 'EXPIRING' | 'EXPIRED' }) => http.page<Enrollment>('/training/certifications', q),
  enrollment: (id: string) => http.get<EnrollmentDetail>(`/training/enrollments/${id}`),
  cancel: (id: string, reason?: string | null) => http.post<EnrollmentDetail>(`/training/enrollments/${id}/cancel`, { reason }),
  changeSession: (id: string, sessionId: string) => http.post<EnrollmentDetail>(`/training/enrollments/${id}/session`, { sessionId }),
  start: (id: string) => http.post<EnrollmentDetail>(`/training/enrollments/${id}/start`),
  markDone: (id: string) => http.post<EnrollmentDetail>(`/training/enrollments/${id}/done`),
  assessment: (id: string) => http.get<Assessment>(`/training/enrollments/${id}/assessment`),
  attempt: (id: string, answers: Record<string, number>) => http.post<{ result: { correct: number; total: number; score: number; passed: boolean }; enrollment: EnrollmentDetail }>(`/training/enrollments/${id}/attempts`, { answers }),
  feedback: (id: string, rating: number, comment: string | null) => http.post<EnrollmentDetail>(`/training/enrollments/${id}/feedback`, { rating, comment }),
};
