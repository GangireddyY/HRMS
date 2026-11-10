import type { LeaveEncashmentStatus, LeaveRequestStatus } from '@contracts';
import { http, type ListQuery } from '@/core/http/http-client';
import type {
  AdjustmentInput,
  BalanceOverview,
  Balances,
  CompOffEligibility,
  CompOffRequest,
  Encashment,
  EncashmentOption,
  LeaveCalendar,
  LeaveQuote,
  LeaveRequest,
  LeaveRequestInput,
  LeaveSettings,
  LeaveType,
  LeaveTypeInput,
  LedgerEntry,
} from '../types';

export interface LeaveRequestQuery extends ListQuery {
  view?: 'mine' | 'team' | 'all';
  status?: LeaveRequestStatus;
  employeeId?: string;
  leaveTypeId?: string;
  from?: string;
  to?: string;
}

export const leaveApi = {
  types: () => http.get<LeaveType[]>('/leave/types'),
  createType: (body: Partial<LeaveTypeInput>) => http.post<LeaveType>('/leave/types', body),
  updateType: (id: string, body: Partial<LeaveTypeInput>) => http.patch<LeaveType>(`/leave/types/${id}`, body),
  removeType: (id: string) => http.delete<{ deleted: boolean }>(`/leave/types/${id}`),
  addRecommended: () => http.post<{ added: number; types: LeaveType[] }>('/leave/types/recommended'),
  settings: () => http.get<LeaveSettings>('/leave/settings'),
  updateSettings: (leaveYearStartMonth: number) => http.put<LeaveSettings>('/leave/settings', { leaveYearStartMonth }),

  balances: (employeeId?: string, year?: number) => http.get<Balances>('/leave/balances', { employeeId, year }),
  async overview(q: ListQuery & { year?: number; departmentId?: string }): Promise<BalanceOverview> {
    const res = await http.get<Omit<BalanceOverview, 'items' | 'meta'> & { page: { items: BalanceOverview['items']; meta: BalanceOverview['meta'] } }>('/leave/balances/overview', q);
    return { year: res.year, currentYear: res.currentYear, types: res.types, items: res.page.items, meta: res.page.meta };
  },
  ledger: (q: { employeeId?: string; year?: number; leaveTypeId?: string }) => http.get<LedgerEntry[]>('/leave/ledger', q),
  adjust: (body: AdjustmentInput) => http.post<{ id: string }>('/leave/adjustments', body),
  runAccruals: () => http.post<{ employees: number; entries: number; year: number }>('/leave/accruals/run'),

  quote: (body: LeaveRequestInput) => http.post<LeaveQuote>('/leave/requests/quote', body),
  apply: (body: LeaveRequestInput & { reason: string }) => http.post<LeaveRequest>('/leave/requests', body),
  requests: (q: LeaveRequestQuery) => http.page<LeaveRequest>('/leave/requests', q),
  approve: (id: string, note?: string) => http.post<LeaveRequest>(`/leave/requests/${id}/approve`, { note }),
  reject: (id: string, note: string) => http.post<LeaveRequest>(`/leave/requests/${id}/reject`, { note }),
  cancel: (id: string, reason?: string) => http.post<LeaveRequest>(`/leave/requests/${id}/cancel`, { reason }),
  calendar: (month: string, departmentId?: string) => http.get<LeaveCalendar>('/leave/calendar', { month, departmentId }),

  compOffEligible: () => http.get<CompOffEligibility>('/leave/comp-offs/eligible'),
  requestCompOff: (body: { workDate: string; days: number; reason: string }) => http.post<CompOffRequest>('/leave/comp-offs', body),
  compOffs: (q: ListQuery & { view?: 'mine' | 'team'; status?: LeaveRequestStatus }) => http.page<CompOffRequest>('/leave/comp-offs', q),
  approveCompOff: (id: string, note?: string) => http.post<CompOffRequest>(`/leave/comp-offs/${id}/approve`, { note }),
  rejectCompOff: (id: string, note: string) => http.post<CompOffRequest>(`/leave/comp-offs/${id}/reject`, { note }),
  cancelCompOff: (id: string) => http.post<CompOffRequest>(`/leave/comp-offs/${id}/cancel`),

  encashmentOptions: () => http.get<{ year: number; types: EncashmentOption[] }>('/leave/encashments/options'),
  requestEncashment: (body: { leaveTypeId: string; days: number; reason?: string | null }) => http.post<Encashment>('/leave/encashments', body),
  encashments: (q: ListQuery & { view?: 'mine' | 'all'; status?: LeaveEncashmentStatus }) => http.page<Encashment>('/leave/encashments', q),
  approveEncashment: (id: string, note?: string) => http.post<Encashment>(`/leave/encashments/${id}/approve`, { note }),
  rejectEncashment: (id: string, note: string) => http.post<Encashment>(`/leave/encashments/${id}/reject`, { note }),
  cancelEncashment: (id: string) => http.post<Encashment>(`/leave/encashments/${id}/cancel`),
};
