import type { Component } from 'vue';
import { Ambulance, Bus, Dumbbell, Gift, HeartPulse, ShieldCheck, UtensilsCrossed } from '@lucide/vue';
import type { BenefitType } from '@contracts';

/** Icon and colours per benefit type (full class names, so Tailwind keeps them). */
export const BENEFIT_TYPE_VISUALS: Record<BenefitType, { icon: Component; tile: string }> = {
  HEALTH: { icon: HeartPulse, tile: 'bg-rose-50 text-rose-600 ring-rose-600/15 dark:bg-rose-500/15 dark:text-rose-300' },
  LIFE: { icon: ShieldCheck, tile: 'bg-violet-50 text-violet-600 ring-violet-600/15 dark:bg-violet-500/15 dark:text-violet-300' },
  ACCIDENT: { icon: Ambulance, tile: 'bg-amber-50 text-amber-600 ring-amber-600/15 dark:bg-amber-500/15 dark:text-amber-300' },
  WELLNESS: { icon: Dumbbell, tile: 'bg-emerald-50 text-emerald-600 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300' },
  MEAL: { icon: UtensilsCrossed, tile: 'bg-orange-50 text-orange-600 ring-orange-600/15 dark:bg-orange-500/15 dark:text-orange-300' },
  TRANSPORT: { icon: Bus, tile: 'bg-sky-50 text-sky-600 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300' },
  OTHER: { icon: Gift, tile: 'bg-slate-100 text-slate-600 ring-slate-600/15 dark:bg-slate-500/20 dark:text-slate-300' },
};

/** Whole days from today to a `YYYY-MM-DD` date in local time (0 = today, negative = past). */
export function daysUntil(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const now = new Date();
  return Math.round((new Date(y!, m! - 1, d!).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
}
