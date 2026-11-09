import type { Component } from 'vue';
import { Building2, CalendarDays, CircleCheckBig, CircleX, Eye, Gift, Inbox, Lightbulb, Megaphone, Package, PartyPopper, ScrollText, Siren, ThumbsUp, Users, Workflow } from '@lucide/vue';
import type { AnnouncementCategory, SuggestionCategory, SuggestionStatus } from '@contracts';

/** Icon tiles for the HR engagement pages (full class names, so Tailwind keeps them). */
export const ANNOUNCEMENT_VISUALS: Record<AnnouncementCategory, { icon: Component; tile: string }> = {
  GENERAL: { icon: Megaphone, tile: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' },
  POLICY: { icon: ScrollText, tile: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' },
  EVENT: { icon: CalendarDays, tile: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' },
  CELEBRATION: { icon: PartyPopper, tile: 'bg-pink-50 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300' },
  ALERT: { icon: Siren, tile: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' },
};

export const SUGGESTION_VISUALS: Record<SuggestionCategory, { icon: Component; tile: string }> = {
  WORKPLACE: { icon: Building2, tile: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' },
  PROCESS: { icon: Workflow, tile: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' },
  PRODUCT: { icon: Package, tile: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' },
  CULTURE: { icon: Users, tile: 'bg-pink-50 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300' },
  BENEFITS: { icon: Gift, tile: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  OTHER: { icon: Lightbulb, tile: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300' },
};

/** The review workflow in order; Declined is the off-ramp. */
export const SUGGESTION_FLOW: { status: SuggestionStatus; icon: Component; hint: string }[] = [
  { status: 'NEW', icon: Inbox, hint: 'Waiting for a first look' },
  { status: 'UNDER_REVIEW', icon: Eye, hint: 'Being looked into' },
  { status: 'ACCEPTED', icon: ThumbsUp, hint: 'Agreed, not done yet' },
  { status: 'IMPLEMENTED', icon: CircleCheckBig, hint: 'Done — tell people' },
  { status: 'DECLINED', icon: CircleX, hint: 'Not going ahead' },
];
