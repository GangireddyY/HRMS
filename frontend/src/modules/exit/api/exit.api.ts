import type { ClearanceDepartment, ClearanceStatus, DailyRateBasis, ExitLetterType, ExitReason, ExitStatus, ExitType } from '@contracts';
import { http, type ListQuery } from '@/core/http/http-client';
import type { Adjustment, AlumniDetails, AlumniRow, ExitDetail, ExitLetter, ExitLetterSummary, ExitSummary, LetterDraft, MyAlumni, Settlement } from '../types';

export const exitApi = {
  resign: (body: { reason: ExitReason; reasonDetail: string | null; requestedLastDay: string | null }) => http.post<ExitDetail>('/exits/resign', body),
  mine: () => http.get<{ current: ExitDetail | null; history: { id: string; type: ExitType; status: ExitStatus; submittedOn: string; lastWorkingDay: string | null; closedReason: string | null }[] }>('/exits/mine'),
  withdraw: (id: string) => http.post<ExitDetail>(`/exits/${id}/withdraw`),
  feedback: (id: string, body: { wouldRecommend: number; wouldRejoin: boolean; liked: string | null; improve: string | null }) => http.post<ExitDetail>(`/exits/${id}/feedback`, body),

  list: (q: ListQuery & { view?: 'all' | 'approve'; status?: ExitStatus | 'OPEN' }) => http.page<ExitSummary>('/exits', q),
  get: (id: string) => http.get<ExitDetail>(`/exits/${id}`),
  initiate: (body: { employeeId: string; type: ExitType; reason: ExitReason; reasonDetail: string | null; noticeGivenOn: string; lastWorkingDay: string; noticeDays?: number; waiveNotice: boolean }) =>
    http.post<ExitDetail>('/exits', body),
  approve: (id: string, body: { lastWorkingDay: string; waiveNotice: boolean; note: string | null }) => http.post<ExitDetail>(`/exits/${id}/approve`, body),
  update: (id: string, body: { lastWorkingDay?: string; waiveNotice?: boolean; eligibleForRehire?: boolean | null; rehireNote?: string | null }) => http.patch<ExitDetail>(`/exits/${id}`, body),
  addClearance: (id: string, body: { department: ClearanceDepartment; title: string }) => http.post<ExitDetail>(`/exits/${id}/clearance`, body),
  updateClearance: (id: string, itemId: string, body: { status: ClearanceStatus; recoveryAmount?: number; note?: string | null }) => http.patch<ExitDetail>(`/exits/${id}/clearance/${itemId}`, body),
  complete: (id: string) => http.post<ExitDetail>(`/exits/${id}/complete`),
  cancel: (id: string, reason: string) => http.post<ExitDetail>(`/exits/${id}/cancel`, { reason }),

  settlement: (id: string) => http.get<Settlement | null>(`/exits/${id}/settlement`),
  calculate: (id: string, body: { encashmentBasis?: DailyRateBasis; noticeBasis?: DailyRateBasis; includeGratuity?: boolean; gratuityNote?: string | null; adjustments?: Adjustment[] }) => http.post<Settlement>(`/exits/${id}/settlement`, body),
  submitSettlement: (id: string) => http.post<Settlement>(`/exits/${id}/settlement/submit`),
  returnSettlement: (id: string, note: string) => http.post<Settlement>(`/exits/${id}/settlement/return`, { note }),
  approveSettlement: (id: string) => http.post<Settlement>(`/exits/${id}/settlement/approve`),
  paySettlement: (id: string, body: { paidOn: string; reference: string }) => http.post<Settlement>(`/exits/${id}/settlement/pay`, body),

  letters: (id: string) => http.get<ExitLetterSummary[]>(`/exits/${id}/letters`),
  letterDraft: (id: string, type: ExitLetterType) => http.get<LetterDraft>(`/exits/${id}/letters/draft`, { type }),
  issueLetter: (id: string, body: LetterDraft) => http.post<ExitLetter>(`/exits/${id}/letters`, body),
  letter: (id: string, letterId: string) => http.get<ExitLetter>(`/exits/${id}/letters/${letterId}`),
  revokeLetter: (id: string, letterId: string, reason: string) => http.post<ExitLetter>(`/exits/${id}/letters/${letterId}/revoke`, { reason }),
};

export const alumniApi = {
  list: (q: ListQuery & { rehire?: 'yes' | 'no' | 'undecided'; optedIn?: boolean; openToOpportunities?: boolean }) => http.page<AlumniRow>('/alumni', q),
  mine: () => http.get<MyAlumni>('/alumni/me'),
  update: (body: Omit<AlumniDetails, 'updatedAt'>) => http.put<MyAlumni>('/alumni/me', body),
};
