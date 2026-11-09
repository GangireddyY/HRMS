import type { Component } from 'vue';
import { Crown, Package, Rocket, Sprout } from '@lucide/vue';

export interface PlanVisual {
  icon: Component;
  /** Icon tile: soft background, icon colour and inset ring. */
  tile: string;
  /** Accent strip along the top of a plan card. */
  strip: string;
  /** Solid colour for bars and dots. */
  bar: string;
}

// Full class names, so Tailwind keeps them.
const PLANS: Record<string, PlanVisual> = {
  starter: {
    icon: Sprout,
    tile: 'bg-emerald-50 text-emerald-600 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300',
    strip: 'from-emerald-400 to-emerald-600',
    bar: 'bg-emerald-500',
  },
  growth: {
    icon: Rocket,
    tile: 'bg-sky-50 text-sky-600 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300',
    strip: 'from-sky-400 to-sky-600',
    bar: 'bg-sky-500',
  },
  enterprise: {
    icon: Crown,
    tile: 'bg-amber-50 text-amber-600 ring-amber-600/15 dark:bg-amber-500/15 dark:text-amber-300',
    strip: 'from-amber-300 to-amber-500',
    bar: 'bg-amber-500',
  },
};
const OTHER: PlanVisual = {
  icon: Package,
  tile: 'bg-violet-50 text-violet-600 ring-violet-600/15 dark:bg-violet-500/15 dark:text-violet-300',
  strip: 'from-violet-400 to-violet-600',
  bar: 'bg-violet-500',
};

/** Icon and colours for a subscription plan, by its code; plans without their own look share one. */
export function planVisual(code: string | null | undefined): PlanVisual {
  return (code && PLANS[code]) || OTHER;
}

const ORG_GRADIENTS = [
  'from-indigo-400 to-indigo-600',
  'from-emerald-400 to-teal-600',
  'from-sky-400 to-blue-600',
  'from-amber-400 to-orange-600',
  'from-rose-400 to-pink-600',
  'from-violet-400 to-purple-600',
  'from-teal-400 to-cyan-600',
  'from-fuchsia-400 to-fuchsia-600',
];

/** A tenant's monogram tile: up to two initials on a gradient that is stable for the same name. */
export function orgMonogram(name: string): { initials: string; gradient: string } {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return { initials: initials || '?', gradient: ORG_GRADIENTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % ORG_GRADIENTS.length]! };
}

/** Dot colour per organization status, matching `organizationTone`. */
export const ORG_STATUS_BAR: Record<string, string> = { ACTIVE: 'bg-success', PENDING: 'bg-warning', SUSPENDED: 'bg-danger', DEACTIVATED: 'bg-fg-subtle' };
