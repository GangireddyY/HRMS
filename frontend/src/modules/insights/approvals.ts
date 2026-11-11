import type { Component } from 'vue';
import { ArrowLeftRight, Banknote, BadgeCheck, Briefcase, CalendarCheck, CalendarClock, CalendarHeart, Clock, HandCoins, House, Landmark, Laptop, LogOut, Luggage, Receipt, Timer, Wallet } from '@lucide/vue';
import { http } from '@/core/http/http-client';
import { employeesApi } from '@/modules/people/api/people.api';
import type { useAuthStore } from '@/core/auth/auth.store';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import { exitApi } from '@/modules/exit/api/exit.api';
import { leaveApi } from '@/modules/leave/api/leave.api';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import { loansApi, payrollApi } from '@/modules/payroll/api/payroll.api';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import { assetsApi, travelApi } from '@/modules/services/api/services.api';
import { addDaysIso, daysUntil, localToday } from '@/shared/utils/dates';

type Auth = ReturnType<typeof useAuthStore>;

export interface ApprovalCount {
  key: string;
  label: string;
  count: number;
  to: string;
  icon: Component;
  /** The count couldn't be loaded. */
  failed?: boolean;
}

interface Source extends Omit<ApprovalCount, 'count' | 'failed'> {
  allowed: (auth: Auth) => boolean;
  count: () => Promise<number>;
}

const total = (p: Promise<{ meta: { total: number } }>) => p.then((r) => r.meta.total);
const ONE = { page: 1, pageSize: 1 };

/** Everything that can wait for someone's decision, with who may decide it. */
const SOURCES: Source[] = [
  {
    key: 'bank-changes',
    label: 'Bank account changes',
    to: '/hr/employees/bank-changes',
    icon: Landmark,
    allowed: (a) => a.can('employee.update') && a.can('employee.sensitive.view'),
    count: () => employeesApi.bankChanges().then((rows) => rows.filter((r) => r.canReview).length),
  },
  {
    key: 'salary-revisions',
    label: 'Salary revisions',
    to: '/hr/payroll/salary-revisions',
    icon: Wallet,
    allowed: (a) => a.can('employee.salary.approve') && a.can('employee.salary.view') && a.hasFeature('payroll'),
    count: () => payrollApi.salaryRevisions().then((rows) => rows.filter((r) => r.canReview).length),
  },
  { key: 'leave', label: 'Leave requests', to: '/hr/leave/requests', icon: CalendarCheck, allowed: (a) => a.can('leave.approve') && a.hasFeature('leave'), count: () => total(leaveApi.requests({ ...ONE, view: 'team', status: 'PENDING' })) },
  { key: 'encashments', label: 'Leave encashment', to: '/hr/leave/balances', icon: Banknote, allowed: (a) => a.can('leave.allocate') && a.hasFeature('leave'), count: () => total(leaveApi.encashments({ ...ONE, view: 'all', status: 'PENDING' })) },
  { key: 'comp-off', label: 'Comp-off', to: '/hr/leave/requests?tab=comp-off', icon: CalendarHeart, allowed: (a) => a.can('leave.approve') && a.hasFeature('leave'), count: () => total(leaveApi.compOffs({ ...ONE, view: 'team', status: 'PENDING' })) },
  { key: 'regularizations', label: 'Attendance corrections', to: '/hr/attendance/regularizations', icon: Clock, allowed: (a) => a.can('attendance.regularize.approve') && a.hasFeature('attendance'), count: () => total(attendanceApi.regularizations({ ...ONE, view: 'team', status: 'PENDING' })) },
  { key: 'wfh', label: 'Work from home', to: '/hr/attendance/regularizations?tab=wfh', icon: House, allowed: (a) => a.can('attendance.regularize.approve') && a.hasFeature('attendance'), count: () => total(attendanceApi.workFromHome({ ...ONE, view: 'team', status: 'PENDING' })) },
  { key: 'overtime', label: 'Overtime', to: '/hr/attendance/regularizations?tab=overtime', icon: Timer, allowed: (a) => a.can('attendance.regularize.approve') && a.hasFeature('attendance'), count: () => total(attendanceApi.overtime({ ...ONE, view: 'team', status: 'PENDING' })) },
  { key: 'swaps', label: 'Shift swaps', to: '/hr/attendance/regularizations?tab=swaps', icon: ArrowLeftRight, allowed: (a) => a.can('attendance.regularize.approve') && a.hasFeature('attendance'), count: () => total(attendanceApi.swaps({ ...ONE, view: 'team', status: 'PENDING' })) },
  { key: 'timesheets', label: 'Timesheets', to: '/hr/attendance/timesheets', icon: CalendarClock, allowed: (a) => a.can('attendance.timesheet.approve') && a.hasFeature('attendance'), count: () => total(attendanceApi.timesheets({ ...ONE, view: 'team', status: 'SUBMITTED' })) },
  { key: 'claims', label: 'Expense claims', to: '/hr/payroll/reimbursements', icon: Receipt, allowed: (a) => a.can('payroll.reimbursement.approve') && a.hasFeature('payroll'), count: () => total(payrollApi.claims({ ...ONE, view: 'approve', status: 'PENDING' })) },
  { key: 'claims-finance', label: 'Expense claims · finance', to: '/hr/payroll/reimbursements?tab=finance', icon: Landmark, allowed: (a) => a.can('payroll.reimbursement.finance') && a.hasFeature('payroll'), count: () => total(payrollApi.claims({ ...ONE, view: 'finance' })) },
  { key: 'loans', label: 'Loans & advances', to: '/hr/payroll/loans', icon: HandCoins, allowed: (a) => a.can('payroll.loan.approve') && a.hasFeature('payroll'), count: () => total(loansApi.list({ ...ONE, view: 'approve' })) },
  { key: 'payroll', label: 'Payroll runs to approve', to: '/hr/payroll/runs', icon: Banknote, allowed: (a) => a.can('payroll.approve') && a.hasFeature('payroll'), count: () => total(payrollApi.runs({ ...ONE, status: 'SUBMITTED' })) },
  { key: 'requisitions', label: 'Hiring requests', to: '/hr/recruitment/requisitions', icon: Briefcase, allowed: (a) => a.can('recruitment.requisition.approve') && a.hasFeature('recruitment'), count: () => total(recruitmentApi.requisitions({ ...ONE, view: 'approve' })) },
  { key: 'exits', label: 'Resignations', to: '/hr/exits', icon: LogOut, allowed: (a) => (a.can('exit.approve') || a.can('exit.manage')) && a.hasFeature('exit'), count: () => total(exitApi.list({ ...ONE, view: 'approve' })) },
  { key: 'travel', label: 'Travel requests', to: '/hr/travel', icon: Luggage, allowed: (a) => a.can('travel.approve') && a.hasFeature('travel'), count: () => total(travelApi.list({ ...ONE, view: 'team', status: 'PENDING' })) },
  { key: 'asset-requests', label: 'Asset requests', to: '/hr/assets?tab=requests', icon: Laptop, allowed: (a) => a.can('assets.manage') && a.hasFeature('assets'), count: () => total(assetsApi.requests({ ...ONE, view: 'all', status: 'PENDING' })) },
  { key: 'probation', label: 'Probation confirmations', to: '/hr/onboarding/probation', icon: BadgeCheck, allowed: (a) => a.can('onboarding.confirmation.approve') && a.hasFeature('onboarding'), count: () => total(onboardingApi.reviews({ ...ONE, view: 'approve' })) },
];

/** Counts of what's waiting for this user's decision, for the kinds they may decide; a lookup that failed is `failed` (count 0). */
export async function loadApprovals(auth: Auth): Promise<ApprovalCount[]> {
  const sources = SOURCES.filter((s) => s.allowed(auth));
  if (!sources.length) return [];
  // One request for every count (the server applies the same scopes and approval cover as the lists).
  const counts = new Map((await http.get<{ key: string; count: number; failed?: boolean }[]>('/dashboard/approvals')).map((c) => [c.key, c]));
  return sources.map(({ allowed: _a, count: _c, ...s }) => {
    const c = counts.get(s.key);
    return c && !c.failed ? { ...s, count: c.count } : { ...s, count: 0, failed: true };
  });
}
export const canApproveAnything = (auth: Auth) => SOURCES.some((s) => s.allowed(auth));

export { addDaysIso, daysUntil, localToday };

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
