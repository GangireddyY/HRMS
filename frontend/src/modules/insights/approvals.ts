import type { Component } from 'vue';
import { Banknote, BadgeCheck, Briefcase, CalendarCheck, CalendarClock, Clock, HandCoins, House, LogOut, Receipt, Timer } from '@lucide/vue';
import type { useAuthStore } from '@/core/auth/auth.store';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import { exitApi } from '@/modules/exit/api/exit.api';
import { leaveApi } from '@/modules/leave/api/leave.api';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import { loansApi, payrollApi } from '@/modules/payroll/api/payroll.api';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';

type Auth = ReturnType<typeof useAuthStore>;

export interface ApprovalCount {
  key: string;
  label: string;
  count: number;
  to: string;
  icon: Component;
}

interface Source extends Omit<ApprovalCount, 'count'> {
  allowed: (auth: Auth) => boolean;
  count: () => Promise<number>;
}

const total = (p: Promise<{ meta: { total: number } }>) => p.then((r) => r.meta.total);
const ONE = { page: 1, pageSize: 1 };

/** Everything that can wait for someone's decision, with who may decide it. */
const SOURCES: Source[] = [
  { key: 'leave', label: 'Leave requests', to: '/hr/leave/requests', icon: CalendarCheck, allowed: (a) => a.can('leave.approve') && a.hasFeature('leave'), count: () => total(leaveApi.requests({ ...ONE, view: 'team', status: 'PENDING' })) },
  { key: 'regularizations', label: 'Attendance corrections', to: '/hr/attendance/regularizations', icon: Clock, allowed: (a) => a.can('attendance.regularize.approve') && a.hasFeature('attendance'), count: () => total(attendanceApi.regularizations({ ...ONE, view: 'team', status: 'PENDING' })) },
  { key: 'wfh', label: 'Work from home', to: '/hr/attendance/regularizations?tab=wfh', icon: House, allowed: (a) => a.can('attendance.regularize.approve') && a.hasFeature('attendance'), count: () => total(attendanceApi.workFromHome({ ...ONE, view: 'team', status: 'PENDING' })) },
  { key: 'overtime', label: 'Overtime', to: '/hr/attendance/regularizations?tab=overtime', icon: Timer, allowed: (a) => a.can('attendance.regularize.approve') && a.hasFeature('attendance'), count: () => total(attendanceApi.overtime({ ...ONE, view: 'team', status: 'PENDING' })) },
  { key: 'timesheets', label: 'Timesheets', to: '/hr/attendance/timesheets', icon: CalendarClock, allowed: (a) => a.can('attendance.timesheet.approve') && a.hasFeature('attendance'), count: () => total(attendanceApi.timesheets({ ...ONE, view: 'team', status: 'SUBMITTED' })) },
  { key: 'claims', label: 'Expense claims', to: '/hr/payroll/reimbursements', icon: Receipt, allowed: (a) => a.can('payroll.reimbursement.approve') && a.hasFeature('payroll'), count: () => total(payrollApi.claims({ ...ONE, view: 'approve', status: 'PENDING' })) },
  { key: 'loans', label: 'Loans & advances', to: '/hr/payroll/loans', icon: HandCoins, allowed: (a) => a.can('payroll.loan.approve') && a.hasFeature('payroll'), count: () => total(loansApi.list({ ...ONE, view: 'approve' })) },
  { key: 'payroll', label: 'Payroll runs to approve', to: '/hr/payroll/runs', icon: Banknote, allowed: (a) => a.can('payroll.approve') && a.hasFeature('payroll'), count: () => total(payrollApi.runs({ ...ONE, status: 'SUBMITTED' })) },
  { key: 'requisitions', label: 'Hiring requests', to: '/hr/recruitment/requisitions', icon: Briefcase, allowed: (a) => a.can('recruitment.requisition.approve') && a.hasFeature('recruitment'), count: () => total(recruitmentApi.requisitions({ ...ONE, view: 'approve' })) },
  { key: 'exits', label: 'Resignations', to: '/hr/exits', icon: LogOut, allowed: (a) => (a.can('exit.approve') || a.can('exit.manage')) && a.hasFeature('exit'), count: () => total(exitApi.list({ ...ONE, view: 'approve' })) },
  { key: 'probation', label: 'Probation confirmations', to: '/hr/onboarding/probation', icon: BadgeCheck, allowed: (a) => a.can('onboarding.confirmation.approve') && a.hasFeature('onboarding'), count: () => total(onboardingApi.reviews({ ...ONE, view: 'approve' })) },
];

/** Counts of what's waiting for this user's decision, for the kinds they may decide (failed lookups count as 0). */
export async function loadApprovals(auth: Auth): Promise<ApprovalCount[]> {
  const sources = SOURCES.filter((s) => s.allowed(auth));
  const results = await Promise.allSettled(sources.map((s) => s.count()));
  return sources.map(({ allowed: _a, count: _c, ...s }, i) => ({ ...s, count: results[i]!.status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<number>).value : 0 }));
}

export const canApproveAnything = (auth: Auth) => SOURCES.some((s) => s.allowed(auth));

/** Today in the browser, as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface Absence {
  id: string;
  employee: { id: string; name: string; department: string | null };
  leaveType: string;
  startDate: string;
  endDate: string;
}

/** Approved leave overlapping the next `days` days (from the leave calendars of the months involved). */
export async function loadAbsences(days = 7): Promise<Absence[]> {
  const from = localToday();
  const to = addDaysIso(from, days - 1);
  const months = [...new Set([from.slice(0, 7), to.slice(0, 7)])];
  const calendars = await Promise.all(months.map((m) => leaveApi.calendar(m)));
  const seen = new Set<string>();
  const out: Absence[] = [];
  for (const c of calendars) {
    for (const e of c.entries) {
      if (e.status !== 'APPROVED' || e.endDate < from || e.startDate > to || seen.has(e.id)) continue;
      seen.add(e.id);
      out.push({ id: e.id, employee: { id: e.employee.id, name: e.employee.name, department: e.employee.department }, leaveType: e.leaveType.name, startDate: e.startDate, endDate: e.endDate });
    }
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export const daysUntil = (date: string) => Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${localToday()}T00:00:00`).getTime()) / 86_400_000);
