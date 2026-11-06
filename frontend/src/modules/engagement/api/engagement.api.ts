import type { AnnouncementCategory, AnnouncementStatus, RecognitionBadge, RsvpResponse, SuggestionCategory, SuggestionStatus, SurveyStatus } from '@contracts';
import { http, type ListQuery } from '@/core/http/http-client';
import type { Colleague } from '@/modules/performance/types';
import type { Announcement, AnnouncementInput, Recognition, RecognitionStats, SuggestionItem, SurveyDetail, SurveyInput, SurveyResults, SurveySummary, Tracking } from '../types';

export const engagementApi = {
  announcements: (q: ListQuery & { manage?: boolean; status?: AnnouncementStatus; category?: AnnouncementCategory }) => http.page<Announcement>('/engagement/announcements', q),
  announcement: (id: string) => http.get<Announcement>(`/engagement/announcements/${id}`),
  createAnnouncement: (body: AnnouncementInput) => http.post<Announcement>('/engagement/announcements', body),
  updateAnnouncement: (id: string, body: Partial<AnnouncementInput>) => http.patch<Announcement>(`/engagement/announcements/${id}`, body),
  removeAnnouncement: (id: string) => http.delete<{ deleted: boolean }>(`/engagement/announcements/${id}`),
  publish: (id: string) => http.post<Announcement>(`/engagement/announcements/${id}/publish`),
  archive: (id: string) => http.post<Announcement>(`/engagement/announcements/${id}/archive`),
  tracking: (id: string) => http.get<Tracking>(`/engagement/announcements/${id}/tracking`),
  acknowledge: (id: string) => http.post<Announcement>(`/engagement/announcements/${id}/acknowledge`),
  rsvp: (id: string, response: RsvpResponse) => http.post<Announcement>(`/engagement/announcements/${id}/rsvp`, { response }),

  surveys: (q: ListQuery & { manage?: boolean; status?: SurveyStatus }) => http.page<SurveySummary>('/engagement/surveys', q),
  survey: (id: string) => http.get<SurveyDetail>(`/engagement/surveys/${id}`),
  createSurvey: (body: SurveyInput) => http.post<SurveyDetail>('/engagement/surveys', body),
  updateSurvey: (id: string, body: Partial<SurveyInput>) => http.patch<SurveyDetail>(`/engagement/surveys/${id}`, body),
  removeSurvey: (id: string) => http.delete<{ deleted: boolean }>(`/engagement/surveys/${id}`),
  openSurvey: (id: string) => http.post<SurveyDetail>(`/engagement/surveys/${id}/open`),
  closeSurvey: (id: string) => http.post<SurveyDetail>(`/engagement/surveys/${id}/close`),
  respond: (id: string, answers: Record<string, number | string>) => http.post<SurveyDetail>(`/engagement/surveys/${id}/responses`, { answers }),
  results: (id: string) => http.get<SurveyResults>(`/engagement/surveys/${id}/results`),

  recognitions: (q: ListQuery & { employeeId?: string }) => http.page<Recognition>('/engagement/recognitions', q),
  recognitionStats: () => http.get<RecognitionStats>('/engagement/recognitions/stats'),
  recognize: (body: { recipientIds: string[]; badge: RecognitionBadge; message: string }) => http.post<Recognition>('/engagement/recognitions', body),
  removeRecognition: (id: string) => http.delete<{ deleted: boolean }>(`/engagement/recognitions/${id}`),
  colleagues: (search?: string) => http.get<Colleague[]>('/engagement/colleagues', { search: search || undefined }),

  suggestions: (q: ListQuery & { view?: 'mine' | 'all'; status?: SuggestionStatus }) => http.page<SuggestionItem>('/engagement/suggestions', q),
  suggest: (body: { title: string; body: string; category: SuggestionCategory; anonymous: boolean }) => http.post<SuggestionItem>('/engagement/suggestions', body),
  reviewSuggestion: (id: string, status: SuggestionStatus, response: string | null) => http.patch<SuggestionItem>(`/engagement/suggestions/${id}`, { status, response }),
};
