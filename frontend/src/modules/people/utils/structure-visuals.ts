import type { Component } from 'vue';
import { BadgeCheck, Building2, CircleDollarSign, Layers, MapPin } from '@lucide/vue';
import type { StructureKind } from '@/modules/people/api/people.api';

export interface StructureVisual {
  icon: Component;
  /** Icon tile: soft background and icon colour. */
  tile: string;
  /** Accent strip along the top of a card. */
  strip: string;
}

// Full class names, so Tailwind keeps them.
export const STRUCTURE_VISUALS: Record<StructureKind, StructureVisual> = {
  departments: {
    icon: Building2,
    tile: 'bg-indigo-50 text-indigo-600 ring-indigo-600/15 dark:bg-indigo-500/15 dark:text-indigo-300',
    strip: 'from-indigo-400 to-indigo-600',
  },
  designations: {
    icon: BadgeCheck,
    tile: 'bg-violet-50 text-violet-600 ring-violet-600/15 dark:bg-violet-500/15 dark:text-violet-300',
    strip: 'from-violet-400 to-violet-600',
  },
  locations: {
    icon: MapPin,
    tile: 'bg-emerald-50 text-emerald-600 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300',
    strip: 'from-emerald-400 to-emerald-600',
  },
  grades: {
    icon: Layers,
    tile: 'bg-amber-50 text-amber-600 ring-amber-600/15 dark:bg-amber-500/15 dark:text-amber-300',
    strip: 'from-amber-300 to-amber-500',
  },
  'cost-centers': {
    icon: CircleDollarSign,
    tile: 'bg-teal-50 text-teal-600 ring-teal-600/15 dark:bg-teal-500/15 dark:text-teal-300',
    strip: 'from-teal-400 to-teal-600',
  },
};
