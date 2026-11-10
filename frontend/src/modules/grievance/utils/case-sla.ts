import type { Component } from 'vue';
import { Building2, FileText, HeartPulse, MessageSquare, Scale, ShieldAlert, ShieldCheck, Users, Wallet } from '@lucide/vue';
import { OPEN_GRIEVANCE_STATUSES, type GrievanceCategory } from '@contracts';
import type { CaseSummary } from '@/modules/grievance/types';
import { daysBetween as days, localToday } from '@/shared/utils/dates';
import { plural } from '@/shared/utils/text';

/** Icon and tile colours per category (full class names, so Tailwind keeps them). */
export const CATEGORY_VISUALS: Record<GrievanceCategory, { icon: Component; tile: string }> = {
  WORKPLACE: { icon: Building2, tile: 'bg-sky-50 text-sky-600 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300' },
  MANAGER: { icon: Users, tile: 'bg-indigo-50 text-indigo-600 ring-indigo-600/15 dark:bg-indigo-500/15 dark:text-indigo-300' },
  PAY_BENEFITS: { icon: Wallet, tile: 'bg-emerald-50 text-emerald-600 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300' },
  DISCRIMINATION: { icon: Scale, tile: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/15 dark:text-amber-300' },
  HARASSMENT: { icon: ShieldAlert, tile: 'bg-rose-50 text-rose-600 ring-rose-600/15 dark:bg-rose-500/15 dark:text-rose-300' },
  SAFETY: { icon: HeartPulse, tile: 'bg-orange-50 text-orange-600 ring-orange-600/15 dark:bg-orange-500/15 dark:text-orange-300' },
  POLICY: { icon: FileText, tile: 'bg-teal-50 text-teal-600 ring-teal-600/15 dark:bg-teal-500/15 dark:text-teal-300' },
  OTHER: { icon: MessageSquare, tile: 'bg-slate-100 text-slate-600 ring-slate-600/15 dark:bg-slate-500/20 dark:text-slate-300' },
  POSH: { icon: ShieldCheck, tile: 'bg-violet-50 text-violet-600 ring-violet-600/15 dark:bg-violet-500/15 dark:text-violet-300' },
};

export const todayIso = localToday;
export { plural };
/** Whole days from one date to another (date parts only). */
export const daysBetween = (from: string, to: string) => days(from.slice(0, 10), to.slice(0, 10));
export const isOpenCase = (c: Pick<CaseSummary, 'status'>) => OPEN_GRIEVANCE_STATUSES.includes(c.status);

/** Days to look ahead for "due soon". */
export const DUE_SOON_DAYS = 7;

export type SlaState = 'overdue' | 'today' | 'soon' | 'ok' | 'done';
export interface Sla {
  state: SlaState;
  /** Days left until the target (negative once past it). */
  left: number;
  /** Share of the target time used, 0–100, for a progress bar. */
  used: number;
  text: string;
}

/** Where an open case stands against its target date; resolved, closed and withdrawn cases are `done`. */
export function caseSla(c: Pick<CaseSummary, 'status' | 'submittedOn' | 'dueOn' | 'overdue'>, today = todayIso()): Sla {
  const left = daysBetween(today, c.dueOn);
  const total = Math.max(1, daysBetween(c.submittedOn, c.dueOn));
  const used = Math.min(100, Math.max(3, (daysBetween(c.submittedOn, today) / total) * 100));
  if (!isOpenCase(c)) return { state: 'done', left, used: 100, text: '' };
  if (c.overdue || left < 0) return { state: 'overdue', left, used: 100, text: `${plural(Math.max(1, -left), 'day')} past target` };
  if (left === 0) return { state: 'today', left, used, text: 'Target date is today' };
  return { state: left <= DUE_SOON_DAYS ? 'soon' : 'ok', left, used, text: `${plural(left, 'day')} left` };
}

export const SLA_TEXT: Record<SlaState, string> = { overdue: 'text-danger-fg', today: 'text-warning-fg', soon: 'text-warning-fg', ok: 'text-fg-muted', done: 'text-fg-muted' };
export const SLA_BAR: Record<SlaState, string> = { overdue: 'bg-danger', today: 'bg-warning', soon: 'bg-warning', ok: 'bg-brand-500', done: 'bg-success' };
