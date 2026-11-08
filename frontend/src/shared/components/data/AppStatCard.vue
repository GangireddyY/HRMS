<script setup lang="ts">
import type { Component } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from '@lucide/vue';
import AppSparkline from '@/shared/components/data/AppSparkline.vue';

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
    /** Recent values, oldest first, drawn as a sparkline under the figure. */
    spark?: number[];
    to?: RouteLocationRaw;
  }>(),
  { tone: 'brand' },
);

/** Featured-icon chips: a tinted tile inside a softer halo. */
const toneClasses: Record<Tone, { chip: string }> = {
  brand: { chip: 'bg-brand-100 text-accent-fg ring-4 ring-brand-50 dark:bg-brand-500/20 dark:ring-brand-500/8' },
  success: { chip: 'bg-success-soft text-success-fg ring-4 ring-success/20' },
  warning: { chip: 'bg-warning-soft text-warning-fg ring-4 ring-warning/20' },
  danger: { chip: 'bg-danger-soft text-danger-fg ring-4 ring-danger/20' },
  info: { chip: 'bg-info-soft text-info-fg ring-4 ring-info/20' },
};
</script>

<template>
  <component
    :is="to ? RouterLink : 'div'"
    :to="to"
    :class="['card group relative block overflow-hidden p-4', to && 'card-interactive']"
  >
    <div class="flex items-center justify-between gap-3">
      <p class="truncate text-sm font-medium text-fg-muted">{{ label }}</p>
      <div v-if="icon" :class="['me-1 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', toneClasses[tone].chip]">
        <component :is="icon" :size="16" aria-hidden="true" />
      </div>
    </div>
    <div class="mt-2">
      <div v-if="loading" class="skeleton h-9 w-20 rounded-md" />
      <p v-else class="text-3xl font-semibold tracking-tight tabular-nums text-fg">{{ value ?? '—' }}</p>
      <div v-if="hint || trend || to" class="mt-1 flex items-center gap-2 text-xs">
        <span
          v-if="trend"
          :class="[
            'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-medium',
            trend.direction === 'up' ? 'bg-success-soft text-success-fg' : 'bg-danger-soft text-danger-fg',
          ]"
        >
          <ArrowUpRight v-if="trend.direction === 'up'" :size="12" aria-hidden="true" />
          <ArrowDownRight v-else :size="12" aria-hidden="true" />
          {{ trend.label }}
        </span>
        <span v-if="hint" class="text-fg-subtle">{{ hint }}</span>
        <ArrowRight v-if="to" :size="14" class="ms-auto text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-fg" aria-hidden="true" />
      </div>
    </div>
    <AppSparkline v-if="spark && spark.length > 1 && !loading" :values="spark" :tone="tone" :height="28" class="mt-2 -mb-1" />
  </component>
</template>
