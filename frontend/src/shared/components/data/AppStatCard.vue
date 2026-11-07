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

const toneClasses: Record<Tone, { chip: string }> = {
  brand: { chip: 'bg-brand-50 text-brand-600 dark:bg-brand-500/12 dark:text-brand-300' },
  success: { chip: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/12 dark:text-emerald-300' },
  warning: { chip: 'bg-amber-50 text-amber-600 dark:bg-amber-500/12 dark:text-amber-300' },
  danger: { chip: 'bg-red-50 text-red-600 dark:bg-red-500/12 dark:text-red-300' },
  info: { chip: 'bg-sky-50 text-sky-600 dark:bg-sky-500/12 dark:text-sky-300' },
};
</script>

<template>
  <component
    :is="to ? RouterLink : 'div'"
    :to="to"
    :class="['card group relative block overflow-hidden px-4 py-3', to && 'transition hover:border-line-strong hover:bg-surface-muted/40']"
  >
    <div class="flex items-center justify-between gap-3">
      <p class="truncate text-xs font-medium text-fg-muted">{{ label }}</p>
      <div v-if="icon" :class="['flex h-7 w-7 shrink-0 items-center justify-center rounded-md', toneClasses[tone].chip]">
        <component :is="icon" :size="15" aria-hidden="true" />
      </div>
    </div>
    <div class="mt-1">
      <div v-if="loading" class="h-7 w-20 animate-pulse rounded-md bg-surface-muted" />
      <p v-else class="text-2xl font-semibold tracking-tight tabular-nums text-fg">{{ value ?? '—' }}</p>
      <div v-if="hint || trend || to" class="mt-1 flex items-center gap-2 text-xs">
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
