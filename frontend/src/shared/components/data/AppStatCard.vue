<script setup lang="ts">
import type { Component } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from '@lucide/vue';

type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info';

withDefaults(
  defineProps<{
    label: string;
    value: string | number | null | undefined;
    hint?: string;
    icon?: Component;
    loading?: boolean;
    tone?: Tone;
    /** Optional change indicator, e.g. { label: '+12%', direction: 'up' }. */
    trend?: { label: string; direction: 'up' | 'down' };
    to?: RouteLocationRaw;
  }>(),
  { tone: 'brand' },
);

const toneClasses: Record<Tone, { chip: string; glow: string }> = {
  brand: { chip: 'bg-brand-50 text-brand-600 ring-brand-600/10 dark:bg-brand-500/12 dark:text-brand-300 dark:ring-brand-400/20', glow: 'bg-brand-500/10' },
  success: { chip: 'bg-emerald-50 text-emerald-600 ring-emerald-600/10 dark:bg-emerald-500/12 dark:text-emerald-300 dark:ring-emerald-400/20', glow: 'bg-emerald-500/10' },
  warning: { chip: 'bg-amber-50 text-amber-600 ring-amber-600/10 dark:bg-amber-500/12 dark:text-amber-300 dark:ring-amber-400/20', glow: 'bg-amber-500/10' },
  danger: { chip: 'bg-red-50 text-red-600 ring-red-600/10 dark:bg-red-500/12 dark:text-red-300 dark:ring-red-400/20', glow: 'bg-red-500/10' },
  info: { chip: 'bg-sky-50 text-sky-600 ring-sky-600/10 dark:bg-sky-500/12 dark:text-sky-300 dark:ring-sky-400/20', glow: 'bg-sky-500/10' },
};
</script>

<template>
  <component
    :is="to ? RouterLink : 'div'"
    :to="to"
    :class="['card group relative block overflow-hidden p-5', to && 'transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop']"
  >
    <div :class="['pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full blur-2xl', toneClasses[tone].glow]" aria-hidden="true" />
    <div class="relative flex items-start justify-between gap-3">
      <p class="text-sm font-medium text-fg-muted">{{ label }}</p>
      <div v-if="icon" :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', toneClasses[tone].chip]">
        <component :is="icon" :size="18" aria-hidden="true" />
      </div>
    </div>
    <div class="relative mt-3">
      <div v-if="loading" class="h-8 w-20 animate-pulse rounded-lg bg-surface-muted" />
      <p v-else class="text-3xl font-semibold tracking-tight tabular-nums text-fg">{{ value ?? '—' }}</p>
      <div v-if="hint || trend || to" class="mt-2 flex items-center gap-2 text-xs">
        <span
          v-if="trend"
          :class="[
            'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium',
            trend.direction === 'up' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-500/12 dark:text-red-300',
          ]"
        >
          <ArrowUpRight v-if="trend.direction === 'up'" :size="12" aria-hidden="true" />
          <ArrowDownRight v-else :size="12" aria-hidden="true" />
          {{ trend.label }}
        </span>
        <span v-if="hint" class="text-fg-subtle">{{ hint }}</span>
        <ArrowRight v-if="to" :size="14" class="ml-auto text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-fg" aria-hidden="true" />
      </div>
    </div>
  </component>
</template>
