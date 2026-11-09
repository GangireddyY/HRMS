import type { Component } from 'vue';
import {
  Award,
  Bell,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileText,
  GraduationCap,
  HandCoins,
  HeartHandshake,
  Hourglass,
  House,
  LogOut,
  Megaphone,
  ReceiptText,
  Scale,
  ScrollText,
  ShieldCheck,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  UserSearch,
  Wallet,
} from '@lucide/vue';
import type { NotificationRow } from '@/modules/notifications/types';

export type NotificationTone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'special' | 'neutral';

/** Icon tile colours per tone, from theme tokens so they follow the palette and dark mode. */
export const TONE_TILE: Record<NotificationTone, string> = {
  brand: 'bg-accent-soft text-accent-fg ring-brand-600/15',
  success: 'bg-success-soft text-success-fg ring-success/20',
  warning: 'bg-warning-soft text-warning-fg ring-warning/25',
  danger: 'bg-danger-soft text-danger-fg ring-danger/20',
  info: 'bg-info-soft text-info-fg ring-info/20',
  special: 'bg-special-soft text-special-fg ring-special/20',
  neutral: 'bg-surface-muted text-fg-muted ring-line',
};

interface Visual {
  label: string;
  icon: Component;
  tone: NotificationTone;
}

/** The product area of a notification: the prefix of its type (`leave.request` → leave). */
const AREAS: Record<string, Visual> = {
  attendance: { label: 'Attendance', icon: Clock, tone: 'info' },
  benefits: { label: 'Benefits', icon: HeartHandshake, tone: 'success' },
  compliance: { label: 'Policies', icon: ScrollText, tone: 'warning' },
  engagement: { label: 'Engagement', icon: Megaphone, tone: 'special' },
  exit: { label: 'Exits', icon: LogOut, tone: 'warning' },
  grievance: { label: 'Grievances', icon: Scale, tone: 'danger' },
  leave: { label: 'Leave', icon: CalendarDays, tone: 'info' },
  onboarding: { label: 'Onboarding', icon: ClipboardCheck, tone: 'brand' },
  payroll: { label: 'Payroll', icon: Wallet, tone: 'success' },
  performance: { label: 'Performance', icon: Target, tone: 'brand' },
  probation: { label: 'Probation', icon: Hourglass, tone: 'warning' },
  recruitment: { label: 'Hiring', icon: UserSearch, tone: 'info' },
  security: { label: 'Security', icon: ShieldCheck, tone: 'danger' },
  training: { label: 'Learning', icon: GraduationCap, tone: 'brand' },
};

/** Specific types that read better with their own icon (or tone) than their area's. */
const TYPES: Record<string, Partial<Visual>> = {
  'attendance.overtime': { icon: Timer },
  'attendance.wfh': { icon: House },
  'engagement.recognition': { icon: Award, tone: 'success' },
  'engagement.survey': { icon: ClipboardList },
  'exit.letter': { icon: FileText },
  'exit.settlement': { icon: ReceiptText },
  'payroll.loan': { icon: HandCoins },
  'payroll.payslip': { icon: ReceiptText },
  'performance.hike': { icon: TrendingUp, tone: 'success' },
  'training.completed': { icon: Trophy, tone: 'success' },
};

const FALLBACK: Visual = { label: 'Updates', icon: Bell, tone: 'neutral' };

export function notificationVisual(n: Pick<NotificationRow, 'type'>): Visual {
  const area = AREAS[n.type.split('.')[0]!] ?? FALLBACK;
  return { ...area, ...TYPES[n.type] };
}

const ACTION = /\b(asked|waiting for your|please read|acknowledge|requested|assigned to you|have your say|choose another)\b/i;

/** Notifications that ask the reader to do something (approve, acknowledge, respond), rather than just inform. */
export function needsAction(n: Pick<NotificationRow, 'title' | 'body' | 'readAt'>): boolean {
  return !n.readAt && ACTION.test(`${n.title} ${n.body ?? ''}`);
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const fullDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export const notificationTime = (iso: string) => clock.format(new Date(iso));

function dayLabel(d: Date, now = new Date()): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return weekday.format(d);
  return fullDate.format(d);
}

/** Groups notifications (already newest first) by calendar day: Today, Yesterday, weekday names, then dates. */
export function groupByDay<T extends Pick<NotificationRow, 'createdAt'>>(rows: T[]): { key: string; label: string; items: T[] }[] {
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const row of rows) {
    const d = new Date(row.createdAt);
    const key = dayKey(d);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(row);
    else groups.push({ key, label: dayLabel(d), items: [row] });
  }
  return groups;
}
