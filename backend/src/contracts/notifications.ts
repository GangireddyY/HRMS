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
  { key: 'billing', label: 'Billing', description: 'Invoices and payments for your organization (billing admins)' },
] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number]['key'];

/** Off by default: frequent and not about a decision. */
export const DEFAULT_MUTED_CATEGORIES: EmailCategory[] = ['engagement'];

/** OFF: each notification is emailed as it happens; DAILY / WEEKLY: one summary email instead. */
export const EMAIL_DIGESTS = ['OFF', 'DAILY', 'WEEKLY'] as const;
export type EmailDigest = (typeof EMAIL_DIGESTS)[number];
export const EMAIL_DIGEST_LABELS: Record<EmailDigest, string> = { OFF: 'As they happen', DAILY: 'Daily summary', WEEKLY: 'Weekly summary' };
export const DEFAULT_DIGEST_HOUR = 9;
/** ISO weekday (1 = Monday). */
export const DEFAULT_DIGEST_DAY = 1;
/** E.164, e.g. +919876543210. */
export const WHATSAPP_NUMBER_PATTERN = /^\+[1-9]\d{7,14}$/;

export interface NotificationSettings {
  /** False: no notification emails at all. */
  email?: boolean;
  /** False: no browser (Web Push) notifications on any device. */
  push?: boolean;
  /** Categories not emailed (in-app only). Undefined means the defaults. */
  muted?: string[];
  emailDigest?: EmailDigest;
  /** Local hour (0–23) the digest goes out, in `timezone`. */
  digestHour?: number;
  /** Weekly digests: ISO weekday (1 = Monday … 7 = Sunday). */
  digestDay?: number;
  /** IANA timezone for digests (the browser's, when the setting was saved). */
  timezone?: string;
  /** When the last digest went out (maintained by the server). */
  lastDigestAt?: string;
  /** WhatsApp messages on (needs a verified number). */
  whatsapp?: boolean;
  whatsappNumber?: string | null;
  whatsappVerifiedAt?: string | null;
  /** False: no calendar invites (.ics) by email for leave, interviews and 1:1s. */
  calendarInvites?: boolean;
  /** A code sent to confirm a number, not yet entered (server only; never returned). */
  whatsappPending?: { number: string; codeHash: string; expiresAt: string; attempts: number; sentAt: string[] } | null;
}

export const categoryOf = (type: string) => type.split('.')[0]!;

/** WhatsApp follows the email categories, to a verified number, when switched on. */
export function wantsWhatsApp(settings: NotificationSettings | null | undefined, type: string): boolean {
  const category = categoryOf(type);
  if (!EMAIL_CATEGORIES.some((c) => c.key === category)) return false;
  if (!settings?.whatsapp || !settings.whatsappNumber || !settings.whatsappVerifiedAt) return false;
  return !(settings.muted ?? DEFAULT_MUTED_CATEGORIES).includes(category);
}

/** Emails held for a summary instead of sent one by one. */
export const digestsEmail = (settings: NotificationSettings | null | undefined) => settings?.email !== false && (settings?.emailDigest === 'DAILY' || settings?.emailDigest === 'WEEKLY');

/**
 * Whether a digest should go out at `now`: from the chosen local hour (on the chosen weekday for weekly ones), once per
 * local day, catching up later that day if the server was down at the hour.
 */
export function digestDue(settings: NotificationSettings | null | undefined, now: Date, fallbackTimeZone = 'UTC'): boolean {
  if (!digestsEmail(settings)) return false;
  const tz = settings!.timezone || fallbackTimeZone;
  const local = localParts(now, tz);
  if (local.hour < (settings!.digestHour ?? DEFAULT_DIGEST_HOUR)) return false;
  if (settings!.emailDigest === 'WEEKLY' && local.weekday !== (settings!.digestDay ?? DEFAULT_DIGEST_DAY)) return false;
  if (!settings!.lastDigestAt) return true;
  return localParts(new Date(settings!.lastDigestAt), tz).date !== local.date;
}

function localParts(instant: Date, timeZone: string): { date: string; hour: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(instant).map((p) => [p.type, p.value]),
  );
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday ?? '') + 1;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday };
}

/** What the settings endpoint returns. */
export interface NotificationSettingsView {
  email: boolean;
  push: boolean;
  muted: string[];
  emailDigest: EmailDigest;
  digestHour: number;
  digestDay: number;
  timezone: string | null;
  calendarInvites: boolean;
  whatsapp: { available: boolean; on: boolean; number: string | null; verified: boolean; pendingNumber: string | null };
  categories: { key: string; label: string; description: string }[];
}

/** Browser notifications follow the same categories as email (a muted category stays in the app). */
export function wantsPush(settings: NotificationSettings | null | undefined, type: string): boolean {
  const category = categoryOf(type);
  if (!EMAIL_CATEGORIES.some((c) => c.key === category)) return false;
  if (settings?.push === false) return false;
  return !(settings?.muted ?? DEFAULT_MUTED_CATEGORIES).includes(category);
}

export function wantsEmail(settings: NotificationSettings | null | undefined, type: string): boolean {
  const category = categoryOf(type);
  if (!EMAIL_CATEGORIES.some((c) => c.key === category)) return false;
  if (settings?.email === false) return false;
  return !(settings?.muted ?? DEFAULT_MUTED_CATEGORIES).includes(category);
}
