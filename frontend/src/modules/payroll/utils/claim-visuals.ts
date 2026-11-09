import type { Component } from 'vue';
import { Package, Plane, Receipt, Smartphone, Stethoscope, Truck, UtensilsCrossed } from '@lucide/vue';
import type { ReimbursementCategory } from '@contracts';

/** Icon and colours per expense category (full class names, so Tailwind keeps them). */
export const CLAIM_CATEGORY_VISUALS: Record<ReimbursementCategory, { icon: Component; tile: string; bar: string }> = {
  TRAVEL: { icon: Plane, tile: 'bg-sky-50 text-sky-600 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300', bar: 'bg-sky-500' },
  FOOD: { icon: UtensilsCrossed, tile: 'bg-orange-50 text-orange-600 ring-orange-600/15 dark:bg-orange-500/15 dark:text-orange-300', bar: 'bg-orange-500' },
  INTERNET_PHONE: { icon: Smartphone, tile: 'bg-indigo-50 text-indigo-600 ring-indigo-600/15 dark:bg-indigo-500/15 dark:text-indigo-300', bar: 'bg-indigo-500' },
  MEDICAL: { icon: Stethoscope, tile: 'bg-rose-50 text-rose-600 ring-rose-600/15 dark:bg-rose-500/15 dark:text-rose-300', bar: 'bg-rose-500' },
  RELOCATION: { icon: Truck, tile: 'bg-amber-50 text-amber-600 ring-amber-600/15 dark:bg-amber-500/15 dark:text-amber-300', bar: 'bg-amber-500' },
  OFFICE_SUPPLIES: { icon: Package, tile: 'bg-emerald-50 text-emerald-600 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300', bar: 'bg-emerald-500' },
  OTHER: { icon: Receipt, tile: 'bg-slate-100 text-slate-600 ring-slate-600/15 dark:bg-slate-500/20 dark:text-slate-300', bar: 'bg-slate-500' },
};
