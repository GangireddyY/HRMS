import type { Component } from 'vue';
import { Briefcase, ClipboardList, Crown, KeyRound, Landmark, Network, ScanSearch, ShieldAlert, Target, UserRound, UserSearch, UsersRound, Wallet } from '@lucide/vue';

export interface RoleVisual {
  icon: Component;
  /** Icon tile: soft background and icon colour. */
  tile: string;
  /** Accent strip along the top of a role card. */
  strip: string;
}

const visual = (icon: Component, color: string): RoleVisual => ({ icon, tile: TILES[color]!, strip: STRIPS[color]! });

// Full class names, so Tailwind keeps them.
const TILES: Record<string, string> = {
  rose: 'bg-rose-50 text-rose-600 ring-rose-600/15 dark:bg-rose-500/15 dark:text-rose-300',
  amber: 'bg-amber-50 text-amber-600 ring-amber-600/15 dark:bg-amber-500/15 dark:text-amber-300',
  violet: 'bg-violet-50 text-violet-600 ring-violet-600/15 dark:bg-violet-500/15 dark:text-violet-300',
  pink: 'bg-pink-50 text-pink-600 ring-pink-600/15 dark:bg-pink-500/15 dark:text-pink-300',
  sky: 'bg-sky-50 text-sky-600 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300',
  cyan: 'bg-cyan-50 text-cyan-600 ring-cyan-600/15 dark:bg-cyan-500/15 dark:text-cyan-300',
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300',
  teal: 'bg-teal-50 text-teal-600 ring-teal-600/15 dark:bg-teal-500/15 dark:text-teal-300',
  indigo: 'bg-indigo-50 text-indigo-600 ring-indigo-600/15 dark:bg-indigo-500/15 dark:text-indigo-300',
  orange: 'bg-orange-50 text-orange-600 ring-orange-600/15 dark:bg-orange-500/15 dark:text-orange-300',
  slate: 'bg-slate-100 text-slate-600 ring-slate-600/15 dark:bg-slate-500/20 dark:text-slate-300',
  fuchsia: 'bg-fuchsia-50 text-fuchsia-600 ring-fuchsia-600/15 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
  brand: 'bg-accent-soft text-accent-fg ring-brand-600/15 dark:ring-brand-400/25',
};
const STRIPS: Record<string, string> = {
  rose: 'from-rose-400 to-rose-600',
  amber: 'from-amber-300 to-amber-500',
  violet: 'from-violet-400 to-violet-600',
  pink: 'from-pink-400 to-pink-600',
  sky: 'from-sky-400 to-sky-600',
  cyan: 'from-cyan-400 to-cyan-600',
  emerald: 'from-emerald-400 to-emerald-600',
  teal: 'from-teal-400 to-teal-600',
  indigo: 'from-indigo-400 to-indigo-600',
  orange: 'from-orange-400 to-orange-600',
  slate: 'from-slate-400 to-slate-600',
  fuchsia: 'from-fuchsia-400 to-fuchsia-600',
  brand: 'from-brand-400 to-brand-600',
};

const BY_KEY: Record<string, RoleVisual> = {
  super_admin: visual(ShieldAlert, 'rose'),
  org_admin: visual(Crown, 'amber'),
  hr_director: visual(Briefcase, 'violet'),
  hr_manager: visual(UsersRound, 'pink'),
  hr_executive: visual(ClipboardList, 'sky'),
  recruiter: visual(UserSearch, 'cyan'),
  payroll_manager: visual(Wallet, 'emerald'),
  finance_manager: visual(Landmark, 'teal'),
  department_manager: visual(Network, 'indigo'),
  team_lead: visual(Target, 'orange'),
  employee: visual(UserRound, 'slate'),
  auditor: visual(ScanSearch, 'fuchsia'),
};
const CUSTOM = visual(KeyRound, 'brand');

/** Icon and colours for a role; custom roles share one look. */
export function roleVisual(key: string): RoleVisual {
  return BY_KEY[key] ?? CUSTOM;
}
