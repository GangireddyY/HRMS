/**
 * Notification categories people can choose to receive by email (the part of the type before the first dot, e.g.
 * `leave.request` → `leave`). Security alerts are always emailed separately and aren't listed here.
 */
export const EMAIL_CATEGORIES = [
  { key: 'leave', label: 'Leave', description: 'Requests to approve, decisions on yours, balance changes' },
  { key: 'approvals', label: 'Approval cover', description: 'When a colleague asks you to approve on their behalf' },
  { key: 'attendance', label: 'Attendance & timesheets', description: 'Corrections, work from home, overtime, timesheet reminders' },
  { key: 'payroll', label: 'Payroll & expenses', description: 'Payslips, claims, loans, payroll runs to approve' },
  { key: 'performance', label: 'Performance', description: 'Reviews, feedback requests, salary increases' },
  { key: 'onboarding', label: 'Onboarding', description: 'Tasks and probation reviews' },
  { key: 'recruitment', label: 'Hiring', description: 'Interviews and hiring requests' },
  { key: 'training', label: 'Learning', description: 'Courses assigned, sessions changed' },
  { key: 'compliance', label: 'Policies', description: 'Policies to read and acknowledge' },
  { key: 'benefits', label: 'Benefits', description: 'Enrollment windows and decisions' },
  { key: 'exit', label: 'Exit', description: 'Resignations, letters and settlements' },
  { key: 'employee', label: 'Your records', description: 'Documents and profile changes' },
  { key: 'grievance', label: 'Grievances', description: 'Updates on cases (no details in the email)' },
  { key: 'helpdesk', label: 'Helpdesk', description: 'Replies to your tickets, tickets assigned to you' },
  { key: 'travel', label: 'Travel', description: 'Travel requests to approve, decisions and bookings' },
  { key: 'assets', label: 'Assets', description: 'Assets handed to you, requests and returns' },
  { key: 'engagement', label: 'Announcements & surveys', description: 'Company news, surveys, recognition' },
] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number]['key'];

/** Off by default: frequent and not about a decision. */
export const DEFAULT_MUTED_CATEGORIES: EmailCategory[] = ['engagement'];

export interface NotificationSettings {
  /** False: no notification emails at all. */
  email?: boolean;
  /** Categories not emailed (in-app only). Undefined means the defaults. */
  muted?: string[];
}

export const categoryOf = (type: string) => type.split('.')[0]!;

export function wantsEmail(settings: NotificationSettings | null | undefined, type: string): boolean {
  const category = categoryOf(type);
  if (!EMAIL_CATEGORIES.some((c) => c.key === category)) return false;
  if (settings?.email === false) return false;
  return !(settings?.muted ?? DEFAULT_MUTED_CATEGORIES).includes(category);
}
