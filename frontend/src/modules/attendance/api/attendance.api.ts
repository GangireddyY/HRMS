import { http, type ListQuery, type Page } from '@/core/http/http-client';
import type { AttendanceCalendar, AttendancePeriod, AttendanceRecord, DailyRow, DailySummary, Holiday, Regularization, Shift, TodayAttendance } from '../types';

export interface DailyQuery extends ListQuery {
  date?: string;
  departmentId?: string;
  status?: string;
}

export const attendanceApi = {
  today: () => http.get<TodayAttendance>('/attendance/today'),
  punchIn: (body: { latitude?: number; longitude?: number }) => http.post<TodayAttendance>('/attendance/punch-in', body),
  punchOut: () => http.post<TodayAttendance>('/attendance/punch-out'),
  calendar: (month: string, employeeId?: string) => http.get<AttendanceCalendar>('/attendance/calendar', { month, employeeId }),
  async daily(q: DailyQuery): Promise<{ date: string; summary: DailySummary; page: Page<DailyRow> }> {
    const res = await http.get<{ date: string; summary: DailySummary; page: { items: DailyRow[]; meta: Page<DailyRow>['meta'] } }>('/attendance/daily', q);
    return { date: res.date, summary: res.summary, page: res.page };
  },
  upsertRecord: (body: { employeeId: string; workDate: string; checkIn: string; checkOut: string | null; note: string }) => http.put<AttendanceRecord>('/attendance/records', body),

  regularizations: (q: ListQuery & { view: 'mine' | 'team'; status?: string }) => http.page<Regularization>('/attendance/regularizations', q),
  requestRegularization: (body: { workDate: string; checkIn: string; checkOut: string; reason: string }) => http.post<Regularization>('/attendance/regularizations', body),
  approve: (id: string, note?: string) => http.post<Regularization>(`/attendance/regularizations/${id}/approve`, { note }),
  reject: (id: string, note?: string) => http.post<Regularization>(`/attendance/regularizations/${id}/reject`, { note }),
  cancel: (id: string) => http.post<Regularization>(`/attendance/regularizations/${id}/cancel`),

  periods: (year: number) => http.get<AttendancePeriod[]>('/attendance/periods', { year }),
  close: (year: number, month: number) => http.post<AttendancePeriod>(`/attendance/periods/${year}/${month}/close`),
  reopen: (year: number, month: number) => http.post<AttendancePeriod>(`/attendance/periods/${year}/${month}/reopen`),

  shifts: () => http.get<Shift[]>('/attendance/shifts'),
  createShift: (body: Partial<Shift>) => http.post<Shift>('/attendance/shifts', body),
  updateShift: (id: string, body: Partial<Shift>) => http.patch<Shift>(`/attendance/shifts/${id}`, body),
  removeShift: (id: string) => http.delete<{ deleted: boolean }>(`/attendance/shifts/${id}`),

  holidays: (year: number) => http.get<Holiday[]>('/holidays', { year }),
  createHoliday: (body: Omit<Holiday, 'id'>) => http.post<Holiday>('/holidays', body),
  updateHoliday: (id: string, body: Partial<Holiday>) => http.patch<Holiday>(`/holidays/${id}`, body),
  removeHoliday: (id: string) => http.delete<{ deleted: boolean }>(`/holidays/${id}`),
};
