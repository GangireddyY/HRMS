import type { Component } from 'vue';
import { Briefcase, CodeXml, HeartHandshake, Languages, Sparkles, Wrench } from '@lucide/vue';
import type { SkillCategory } from '@contracts';

/** Icon and colours per skill category (full class names, so Tailwind keeps them). */
export const CATEGORY_VISUALS: Record<SkillCategory, { icon: Component; tile: string; dot: string }> = {
  TECHNICAL: { icon: CodeXml, tile: 'bg-indigo-50 text-indigo-600 ring-indigo-600/15 dark:bg-indigo-500/15 dark:text-indigo-300', dot: 'bg-indigo-500' },
  TOOL: { icon: Wrench, tile: 'bg-sky-50 text-sky-600 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300', dot: 'bg-sky-500' },
  DOMAIN: { icon: Briefcase, tile: 'bg-amber-50 text-amber-600 ring-amber-600/15 dark:bg-amber-500/15 dark:text-amber-300', dot: 'bg-amber-500' },
  SOFT: { icon: HeartHandshake, tile: 'bg-pink-50 text-pink-600 ring-pink-600/15 dark:bg-pink-500/15 dark:text-pink-300', dot: 'bg-pink-500' },
  LANGUAGE: { icon: Languages, tile: 'bg-emerald-50 text-emerald-600 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300', dot: 'bg-emerald-500' },
  OTHER: { icon: Sparkles, tile: 'bg-slate-100 text-slate-600 ring-slate-600/15 dark:bg-slate-500/20 dark:text-slate-300', dot: 'bg-slate-500' },
};
