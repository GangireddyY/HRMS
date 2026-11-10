import { downloadFile, http } from '@/core/http/http-client';
import { localToday } from '@/shared/utils/dates';

export interface FormerEmployee {
  id: string;
  name: string;
  employeeCode: string;
  exitDate: string | null;
  /** Statutory records are kept until this day. */
  retainUntil: string | null;
  erasureLevel: 'PARTIAL' | 'FULL' | null;
  erasedAt: string | null;
  nextErasure: 'PARTIAL' | 'FULL';
}

export interface PrivacyOverview {
  exitedRetentionYears: number;
  candidateRetentionMonths: number;
  candidatesPurgedAt: string | null;
  formerEmployees: FormerEmployee[];
  candidatesDue: number;
}

const today = localToday;

export const privacyApi = {
  overview: () => http.get<PrivacyOverview>('/privacy'),
  updateSettings: (body: { exitedRetentionYears?: number; candidateRetentionMonths?: number }) => http.put<PrivacyOverview>('/privacy/settings', body),
  /** Both downloads need a fresh step-up; the HTTP client asks for it and retries. */
  exportMine: () => downloadFile('/privacy/me/export', undefined, `my-data-${today()}.json`),
  exportEmployee: (id: string) => downloadFile(`/privacy/employees/${id}/export`, undefined, `personal-data-${today()}.json`),
  erase: (id: string, confirm: string) => http.post<{ id: string; erasureLevel: 'PARTIAL' | 'FULL' }>(`/privacy/employees/${id}/erase`, { confirm }),
  purgeCandidates: () => http.post<{ anonymized: number }>('/privacy/candidates/purge'),
};
