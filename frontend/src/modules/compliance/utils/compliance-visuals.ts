import type { Component } from 'vue';
import { Ban, BadgeIndianRupee, Briefcase, CalendarDays, FileText, Gift, HandCoins, HeartPulse, Landmark, Laptop, Lock, Plane, Receipt, Scale, ShieldCheck, Users } from '@lucide/vue';
import type { ComplianceCategory, PolicyCategory } from '@contracts';
import { localIso } from './compliance-format';

/** Icon and tile colours per policy category (full class names, so Tailwind keeps them). */
export const POLICY_VISUALS: Record<PolicyCategory, { icon: Component; tile: string }> = {
  CODE_OF_CONDUCT: { icon: Scale, tile: 'bg-indigo-50 text-indigo-600 ring-indigo-600/15 dark:bg-indigo-500/15 dark:text-indigo-300' },
  HR: { icon: Users, tile: 'bg-sky-50 text-sky-600 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300' },
  LEAVE: { icon: CalendarDays, tile: 'bg-teal-50 text-teal-600 ring-teal-600/15 dark:bg-teal-500/15 dark:text-teal-300' },
  IT_SECURITY: { icon: Laptop, tile: 'bg-violet-50 text-violet-600 ring-violet-600/15 dark:bg-violet-500/15 dark:text-violet-300' },
  DATA_PRIVACY: { icon: Lock, tile: 'bg-cyan-50 text-cyan-700 ring-cyan-600/15 dark:bg-cyan-500/15 dark:text-cyan-300' },
  HEALTH_SAFETY: { icon: HeartPulse, tile: 'bg-rose-50 text-rose-600 ring-rose-600/15 dark:bg-rose-500/15 dark:text-rose-300' },
  ANTI_BRIBERY: { icon: Ban, tile: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/15 dark:text-amber-300' },
  POSH: { icon: ShieldCheck, tile: 'bg-pink-50 text-pink-600 ring-pink-600/15 dark:bg-pink-500/15 dark:text-pink-300' },
  TRAVEL: { icon: Plane, tile: 'bg-emerald-50 text-emerald-600 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300' },
  OTHER: { icon: FileText, tile: 'bg-slate-100 text-slate-600 ring-slate-600/15 dark:bg-slate-500/20 dark:text-slate-300' },
};

/** Icon and tile colours per statutory obligation category. */
export const OBLIGATION_VISUALS: Record<ComplianceCategory, { icon: Component; tile: string }> = {
  PF: { icon: Landmark, tile: 'bg-indigo-50 text-indigo-600 ring-indigo-600/15 dark:bg-indigo-500/15 dark:text-indigo-300' },
  ESI: { icon: HeartPulse, tile: 'bg-rose-50 text-rose-600 ring-rose-600/15 dark:bg-rose-500/15 dark:text-rose-300' },
  TDS: { icon: Receipt, tile: 'bg-sky-50 text-sky-600 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300' },
  PT: { icon: BadgeIndianRupee, tile: 'bg-teal-50 text-teal-600 ring-teal-600/15 dark:bg-teal-500/15 dark:text-teal-300' },
  LWF: { icon: HandCoins, tile: 'bg-emerald-50 text-emerald-600 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300' },
  GRATUITY: { icon: Gift, tile: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/15 dark:text-amber-300' },
  POSH: { icon: ShieldCheck, tile: 'bg-pink-50 text-pink-600 ring-pink-600/15 dark:bg-pink-500/15 dark:text-pink-300' },
  LABOUR: { icon: Briefcase, tile: 'bg-violet-50 text-violet-600 ring-violet-600/15 dark:bg-violet-500/15 dark:text-violet-300' },
  OTHER: { icon: FileText, tile: 'bg-slate-100 text-slate-600 ring-slate-600/15 dark:bg-slate-500/20 dark:text-slate-300' },
};

/** Whole days from today to a date (negative when it has passed). */
export const daysFromToday = (iso: string) => Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(localIso(new Date()))) / 86_400_000);

/** "in 3 days", "today", "2 days ago"; months once it is more than ~2 months away. */
export function relativeDays(iso: string): string {
  const d = daysFromToday(iso);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  const abs = Math.abs(d);
  const text = abs >= 60 ? `${Math.round(abs / 30)} months` : `${abs} days`;
  return d > 0 ? `in ${text}` : `${text} ago`;
}

/** Acknowledgement rate as a whole percentage (0 without an audience). */
export const ackPct = (s: { audience: number; acknowledged: number } | null | undefined) => (s?.audience ? Math.round((s.acknowledged / s.audience) * 100) : 0);
export const ackBar = (pct: number, overdue = 0) => (pct >= 90 ? 'bg-success' : overdue > 0 ? 'bg-danger' : pct >= 50 ? 'bg-brand-500' : 'bg-warning');
