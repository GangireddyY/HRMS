import type { HolidayCountry, OvertimeStatus, RegularizationStatus } from '@contracts';
import { http, type ListQuery, type Page } from '@/core/http/http-client';
import type { AttendanceCalendar, AttendancePeriod, AttendanceRecord, DailyRow, DailySummary, Device, Holiday, OfficialHolidays, Overtime, Regularization, RosterRow, Rotation, RotationStep, Shift, TodayAttendance, WorkFromHome } from '../types';

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

  overtime: (q: ListQuery & { view: 'mine' | 'team'; status?: OvertimeStatus; month?: string }) => http.page<Overtime>('/attendance/overtime', q),
  approveOvertime: (id: string, body: { minutes?: number; note?: string | null }) => http.post<Overtime>(`/attendance/overtime/${id}/approve`, body),
  rejectOvertime: (id: string, note: string) => http.post<Overtime>(`/attendance/overtime/${id}/reject`, { note }),

  workFromHome: (q: ListQuery & { view: 'mine' | 'team'; status?: RegularizationStatus }) => http.page<WorkFromHome>('/attendance/work-from-home', q),
  requestWorkFromHome: (body: { startDate: string; endDate: string; reason: string }) => http.post<WorkFromHome>('/attendance/work-from-home', body),
  approveWorkFromHome: (id: string, note?: string | null) => http.post<WorkFromHome>(`/attendance/work-from-home/${id}/approve`, { note }),
  rejectWorkFromHome: (id: string, note: string) => http.post<WorkFromHome>(`/attendance/work-from-home/${id}/reject`, { note }),
  cancelWorkFromHome: (id: string) => http.post<WorkFromHome>(`/attendance/work-from-home/${id}/cancel`),

  periods: (year: number) => http.get<AttendancePeriod[]>('/attendance/periods', { year }),
  close: (year: number, month: number) => http.post<AttendancePeriod>(`/attendance/periods/${year}/${month}/close`),
  reopen: (year: number, month: number) => http.post<AttendancePeriod>(`/attendance/periods/${year}/${month}/reopen`),

  shifts: () => http.get<Shift[]>('/attendance/shifts'),
  createShift: (body: Partial<Shift>) => http.post<Shift>('/attendance/shifts', body),
  updateShift: (id: string, body: Partial<Shift>) => http.patch<Shift>(`/attendance/shifts/${id}`, body),
  removeShift: (id: string) => http.delete<{ deleted: boolean }>(`/attendance/shifts/${id}`),

  rotations: () => http.get<Rotation[]>('/attendance/rotations'),
  createRotation: (body: { name: string; pattern: RotationStep[]; isActive?: boolean }) => http.post<Rotation>('/attendance/rotations', body),
  updateRotation: (id: string, body: { name?: string; pattern?: RotationStep[]; isActive?: boolean }) => http.patch<Rotation>(`/attendance/rotations/${id}`, body),
  removeRotation: (id: string) => http.delete<{ deleted: boolean }>(`/attendance/rotations/${id}`),
  async roster(q: ListQuery & { from: string; to: string; departmentId?: string }): Promise<{ days: string[]; shifts: { id: string; name: string; startTime: string; endTime: string; isActive: boolean }[]; page: Page<RosterRow> }> {
    const res = await http.get<{ days: string[]; shifts: { id: string; name: string; startTime: string; endTime: string; isActive: boolean }[]; page: { items: RosterRow[]; meta: Page<RosterRow>['meta'] } }>('/attendance/roster', q);
    return res;
  },
  assignRoster: (body: { employeeIds: string[]; from: string; to: string; shiftId: string | null }) => http.post<{ employees: number }>('/attendance/roster/assign', body),
  applyRotation: (body: { employeeIds: string[]; from: string; to: string; rotationId: string; offset?: number }) => http.post<{ employees: number }>('/attendance/roster/apply-rotation', body),
  clearRoster: (body: { employeeIds: string[]; from: string; to: string }) => http.post<{ employees: number }>('/attendance/roster/clear', body),

  devices: () => http.get<Device[]>('/attendance/devices'),
  createDevice: (body: { name: string; locationId: string | null; serialNumber: string | null }) => http.post<Device>('/attendance/devices', body),
  updateDevice: (id: string, body: { name?: string; locationId?: string | null; serialNumber?: string | null; isActive?: boolean }) => http.patch<Device>(`/attendance/devices/${id}`, body),
  rotateDeviceKey: (id: string) => http.post<Device>(`/attendance/devices/${id}/rotate-key`),
  removeDevice: (id: string) => http.delete<{ deleted: boolean }>(`/attendance/devices/${id}`),
  setBiometricCode: (employeeId: string, biometricCode: string | null) => http.put<{ employeeId: string; biometricCode: string | null }>(`/attendance/employees/${employeeId}/biometric-code`, { biometricCode }),

  holidays: (year: number) => http.get<Holiday[]>('/holidays', { year }),
  createHoliday: (body: Omit<Holiday, 'id'>) => http.post<Holiday>('/holidays', body),
  updateHoliday: (id: string, body: Partial<Holiday>) => http.patch<Holiday>(`/holidays/${id}`, body),
  removeHoliday: (id: string) => http.delete<{ deleted: boolean }>(`/holidays/${id}`),
  officialHolidays: (year: number, country?: HolidayCountry) => http.get<OfficialHolidays>('/holidays/official', { year, country }),
  importHolidays: (body: { country?: HolidayCountry; holidays: Omit<Holiday, 'id'>[] }) => http.post<{ created: number; skipped: number }>('/holidays/import', body),
};
