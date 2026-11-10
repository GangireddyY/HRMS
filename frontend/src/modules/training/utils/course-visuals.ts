import type { Component } from 'vue';
import { BookOpen, CodeXml, Compass, GraduationCap, HardHat, HeartHandshake, MonitorPlay, Rocket, ShieldCheck, Sparkles } from '@lucide/vue';
import type { CourseCategory, CourseDelivery } from '@contracts';
import { appLocale } from '@/core/locale/locale';

/** Icon and colours per course category (full class names, so Tailwind keeps them). Same palette as My learning. */
export const COURSE_VISUALS: Record<CourseCategory, { icon: Component; tile: string; bar: string }> = {
  TECHNICAL: { icon: CodeXml, tile: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300', bar: 'bg-indigo-500' },
  SOFT_SKILLS: { icon: HeartHandshake, tile: 'bg-pink-50 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300', bar: 'bg-pink-500' },
  LEADERSHIP: { icon: Compass, tile: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300', bar: 'bg-amber-500' },
  COMPLIANCE: { icon: ShieldCheck, tile: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300', bar: 'bg-emerald-500' },
  ONBOARDING: { icon: Rocket, tile: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300', bar: 'bg-sky-500' },
  SAFETY: { icon: HardHat, tile: 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300', bar: 'bg-orange-500' },
  OTHER: { icon: Sparkles, tile: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300', bar: 'bg-slate-500' },
};
export const DELIVERY_ICON: Record<CourseDelivery, Component> = { CLASSROOM: GraduationCap, VIRTUAL: MonitorPlay, SELF_PACED: BookOpen };

const DAY = 86_400_000;
const rtf = new Intl.RelativeTimeFormat(appLocale(), { numeric: 'auto' });
const startOfToday = () => new Date(new Date().toDateString()).getTime();
/** Whole days from today to a date (or the date part of a timestamp); negative in the past. */
export const daysUntil = (iso: string) => Math.round((new Date(`${iso.slice(0, 10)}T00:00:00`).getTime() - startOfToday()) / DAY);
/** "today", "in 3 days", "2 weeks ago", "in 3 months". */
export function relativeDay(iso: string): string {
  const n = daysUntil(iso);
  if (Math.abs(n) < 14) return rtf.format(n, 'day');
  if (Math.abs(n) < 60) return rtf.format(Math.round(n / 7), 'week');
  return rtf.format(Math.round(n / 30), 'month');
}
/** "Overdue by 3 days" for a past due date. */
export function overdueBy(iso: string): string {
  const n = Math.max(1, -daysUntil(iso));
  return n < 14 ? `Overdue by ${n} day${n === 1 ? '' : 's'}` : n < 60 ? `Overdue by ${Math.round(n / 7)} weeks` : `Overdue by ${Math.round(n / 30)} months`;
}
/** Calendar tile parts for a timestamp. */
export function dateTile(iso: string) {
  const d = new Date(iso);
  return { day: d.getDate(), month: d.toLocaleDateString(appLocale(), { month: 'short' }), weekday: d.toLocaleDateString(appLocale(), { weekday: 'short' }), time: d.toLocaleTimeString(appLocale(), { hour: 'numeric', minute: '2-digit' }) };
}
/** Today's date as YYYY-MM-DD in local time, for comparing with date-only fields. */
export { localToday as todayIso } from '@/shared/utils/dates';
export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
