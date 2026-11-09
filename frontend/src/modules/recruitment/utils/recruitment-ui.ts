import type { Component } from 'vue';
import { Building2, CircleDot, CircleX, ClipboardList, FileSignature, Filter, Globe, Handshake, Inbox, MessageSquareText, Network, Search, Undo2, UserCheck } from '@lucide/vue';
import type { ApplicationStage, CandidateSource } from '@contracts';
import { appLocale } from '@/core/locale/locale';

/** One icon per concept, shared by the hiring team's pages. */
export const SOURCE_ICON: Record<CandidateSource, Component> = {
  CAREERS: Globe,
  REFERRAL: Handshake,
  JOB_BOARD: ClipboardList,
  LINKEDIN: Network,
  AGENCY: Building2,
  DIRECT: Search,
  OTHER: CircleDot,
};
export const STAGE_ICON: Record<ApplicationStage, Component> = {
  APPLIED: Inbox,
  SCREENING: Filter,
  INTERVIEW: MessageSquareText,
  OFFER: FileSignature,
  HIRED: UserCheck,
  REJECTED: CircleX,
  WITHDRAWN: Undo2,
};
/** Soft background + text for stage icon tiles and pills. */
export const stageSoft: Record<ApplicationStage, string> = {
  APPLIED: 'bg-surface-muted text-fg-muted',
  SCREENING: 'bg-info-soft text-info-fg',
  INTERVIEW: 'bg-special-soft text-special-fg',
  OFFER: 'bg-accent-soft text-accent-fg',
  HIRED: 'bg-success-soft text-success-fg',
  REJECTED: 'bg-danger-soft text-danger-fg',
  WITHDRAWN: 'bg-warning-soft text-warning-fg',
};

const DAY = 86_400_000;
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Calendar days from today to a date ("YYYY-MM-DD" or ISO): negative when in the past. */
export function daysUntil(value: string): number {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Math.round((midnight(d) - midnight(new Date())) / DAY);
}
/** Whole days since a timestamp. */
export const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** "Today", "Tomorrow", "In 3 days", "2 days overdue" (or "2 days ago" when `overdue` is false). */
export function dueText(value: string, overdue = true): string {
  const n = daysUntil(value);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n > 1) return `In ${plural(n, 'day')}`;
  return overdue ? `${plural(-n, 'day')} overdue` : `${plural(-n, 'day')} ago`;
}
/** Text classes for a due date: overdue red, within a week amber. */
export function dueTone(value: string): string {
  const n = daysUntil(value);
  return n < 0 ? 'text-danger-fg' : n <= 7 ? 'text-warning-fg' : 'text-fg-muted';
}

/** Time in the current stage, with the nudge a recruiter would want (a week is slow, two is stuck). */
export function stageAge(iso: string): { days: number; label: string; tone: 'fresh' | 'slow' | 'stuck' } {
  const days = daysSince(iso);
  return { days, label: days === 0 ? 'Today' : `${days}d`, tone: days >= 14 ? 'stuck' : days >= 7 ? 'slow' : 'fresh' };
}
export const ageClass = { fresh: 'bg-surface-muted text-fg-muted', slow: 'bg-warning-soft text-warning-fg', stuck: 'bg-danger-soft text-danger-fg' } as const;

/** Short time of day in the user's locale. */
export const timeOfDay = (iso: string) => new Date(iso).toLocaleTimeString(appLocale(), { hour: 'numeric', minute: '2-digit' });
/** "Mon 12 Nov" style day label. */
export const shortDay = (iso: string) => new Date(iso).toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
