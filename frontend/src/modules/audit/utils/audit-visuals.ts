import type { Component } from 'vue';
import type { AuditEntry } from '@/modules/audit/types';
import { humanize } from '@/shared/utils/format';
import {
  Archive,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  Clock,
  FileSignature,
  GraduationCap,
  HeartHandshake,
  Hourglass,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  Megaphone,
  MessagesSquare,
  Monitor,
  PartyPopper,
  Scale,
  ScrollText,
  Server,
  Shield,
  ShieldCheck,
  ShieldX,
  Smartphone,
  Target,
  Terminal,
  UserRound,
  UserSearch,
  Users,
  Wallet,
} from '@lucide/vue';

export type EventTone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Icon tile colours per tone, from theme tokens so they follow the palette and dark mode. */
export const TONE_TILE: Record<EventTone, string> = {
  brand: 'bg-accent-soft text-accent-fg',
  success: 'bg-success-soft text-success-fg',
  warning: 'bg-warning-soft text-warning-fg',
  danger: 'bg-danger-soft text-danger-fg',
  info: 'bg-info-soft text-info-fg',
  neutral: 'bg-surface-muted text-fg-muted',
};

/** The product area of an audit action (its prefix before the first dot). */
const AREAS: Record<string, { label: string; icon: Component }> = {
  application: { label: 'Hiring', icon: UserSearch },
  attendance: { label: 'Attendance', icon: Clock },
  audit: { label: 'Audit', icon: Archive },
  auth: { label: 'Sign-in & security', icon: KeyRound },
  benefits: { label: 'Benefits', icon: HeartHandshake },
  candidate: { label: 'Hiring', icon: UserSearch },
  compliance: { label: 'Compliance', icon: ShieldCheck },
  employee: { label: 'People', icon: UserRound },
  engagement: { label: 'Engagement', icon: Megaphone },
  exit: { label: 'Exits', icon: LogOut },
  grievance: { label: 'Grievances', icon: Scale },
  holiday: { label: 'Holidays', icon: PartyPopper },
  interview: { label: 'Interviews', icon: MessagesSquare },
  job: { label: 'Jobs', icon: Briefcase },
  leave: { label: 'Leave', icon: CalendarDays },
  leave_type: { label: 'Leave types', icon: CalendarDays },
  offer: { label: 'Offers', icon: FileSignature },
  onboarding: { label: 'Onboarding', icon: ClipboardCheck },
  onboarding_template: { label: 'Onboarding', icon: ClipboardCheck },
  organization: { label: 'Organization', icon: Building2 },
  payroll: { label: 'Payroll', icon: Wallet },
  performance: { label: 'Performance', icon: Target },
  platform: { label: 'Platform', icon: Server },
  probation: { label: 'Probation', icon: Hourglass },
  reports: { label: 'Reports', icon: ChartColumn },
  requisition: { label: 'Requisitions', icon: Briefcase },
  role: { label: 'Roles & permissions', icon: Shield },
  roster: { label: 'Rosters', icon: CalendarClock },
  rotation: { label: 'Rosters', icon: CalendarClock },
  shift: { label: 'Shifts', icon: CalendarClock },
  skill: { label: 'Skills', icon: GraduationCap },
  training: { label: 'Training', icon: GraduationCap },
  user: { label: 'Users', icon: Users },
};

const sentence = (s: string) => {
  const text = s.replace(/[._]/g, ' ').trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : '';
};

export function auditArea(action: string): { label: string; icon: Component } {
  const prefix = action.split('.')[0] ?? '';
  return AREAS[prefix] ?? { label: sentence(prefix) || 'System', icon: ScrollText };
}

/** "onboarding.task_completed" reads as "Task completed" under the Onboarding area. */
export function auditTitle(action: string): string {
  const rest = action.split('.').slice(1).join(' ');
  return sentence(rest || action);
}

/** The event's own summary, or for plain edits the fields that changed. */
export function auditSummary(entry: Pick<AuditEntry, 'summary' | 'changes' | 'entityType'>): string {
  if (entry.summary) return entry.summary.replace(/"([^"]*)"/g, '“$1”');
  const fields = Object.keys(entry.changes ?? {}).map((f) => humanize(f.replace(/([a-z])([A-Z])/g, '$1 $2')).toLowerCase());
  if (!fields.length) return `${humanize(entry.entityType)} record`;
  return `Changed ${fields.slice(0, 3).join(', ')}${fields.length > 3 ? ` and ${fields.length - 3} more` : ''}`;
}

/** Colour by what happened: removals and security alarms red, approvals and completions green, pending asks amber. */
export function auditTone(action: string): EventTone {
  const verb = action.split('.').slice(1).join('.');
  if (/reuse|delete|purge|revoke|terminat|reject|lock|suspend|fail|disable|deactivat|withdraw/.test(verb)) return 'danger';
  if (/creat|approv|complet|verif|activat|publish|paid|hire|enable|accept|filed|resolv|restor|signed/.test(verb)) return 'success';
  if (/request|submit|pending|escalat|skip|cancel|expir|overdue|remind/.test(verb)) return 'warning';
  if (/login|password|mfa|token/.test(verb)) return 'brand';
  return 'info';
}

export const OUTCOME_VISUAL: Record<string, { icon: Component; tone: EventTone; label: string }> = {
  SUCCESS: { icon: ShieldCheck, tone: 'success', label: 'Signed in' },
  FAILURE: { icon: ShieldX, tone: 'danger', label: 'Sign-in failed' },
  LOCKED: { icon: Lock, tone: 'danger', label: 'Account locked' },
  MFA_CHALLENGE: { icon: KeyRound, tone: 'info', label: 'Asked for 2FA code' },
};

export function deviceIcon(userAgent: string | null | undefined): Component {
  if (!userAgent) return Monitor;
  if (/Android|iPhone|iPad|Mobile/.test(userAgent)) return Smartphone;
  if (/curl|node|axios|supertest|Postman/i.test(userAgent)) return Terminal;
  return /Macintosh|Windows|Linux|X11/.test(userAgent) ? Laptop : Monitor;
}

/** Loopback addresses read as "This server" rather than a cryptic "::1". */
export function describeIp(ip: string | null | undefined): string {
  if (!ip) return 'Unknown';
  return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1' ? 'Local (this server)' : ip.replace(/^::ffff:/, '');
}

export const reasonText = (reason: string) => sentence(reason.toLowerCase());
