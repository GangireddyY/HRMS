<script setup lang="ts">
import { AlertTriangle, ArrowRight, CheckCircle2, Info, Sparkles, TrendingDown } from '@lucide/vue';
import type { RouteLocationRaw } from 'vue-router';
import AppEmptyState from '@/shared/components/feedback/AppEmptyState.vue';

export interface Insight {
  id: string;
  text: string;
  tone?: 'info' | 'warning' | 'success' | 'danger';
  to?: RouteLocationRaw;
  action?: string;
}

/**
 * Observations worked out from live data, most important first, each with an optional link to act on it.
 * Same anatomy as AppCard (header with icon tile, title and caption) with the assistant's gradient accent; fills the
 * height of its grid row.
 */
withDefaults(defineProps<{ items: Insight[]; loading?: boolean; title?: string; caption?: string }>(), { title: 'Insights', caption: 'Worked out from your live HR data' });

const ICON = { info: Info, warning: AlertTriangle, success: CheckCircle2, danger: TrendingDown } as const;
const TONE = {
  info: 'text-sky-600 dark:text-sky-300',
  warning: 'text-amber-600 dark:text-amber-300',
  success: 'text-emerald-600 dark:text-emerald-300',
  danger: 'text-red-600 dark:text-red-300',
} as const;
</script>

<template>
  <section class="ai-ring flex h-full flex-col overflow-hidden rounded-md shadow-card">
    <header class="flex min-h-12 shrink-0 items-center gap-3 border-b border-line/70 px-4 py-2">
      <span class="ai-chip flex h-8 w-8 shrink-0 items-center justify-center rounded-md"><Sparkles :size="16" aria-hidden="true" /></span>
      <div class="min-w-0">
        <h2 class="text-gradient text-sm font-semibold">{{ title }}</h2>
        <p class="text-xs text-fg-muted">{{ caption }}</p>
      </div>
    </header>
    <div v-if="loading" class="space-y-3 p-4">
      <div v-for="i in 3" :key="i" class="skeleton h-4 rounded" :style="{ width: `${90 - i * 12}%` }" />
    </div>
    <AppEmptyState v-else-if="!items.length" class="flex-1" compact :icon="Sparkles" title="Nothing needs your attention" description="New observations appear here as your data changes." />
    <ul v-else class="divide-y divide-line/60">
      <li v-for="i in items" :key="i.id">
        <component :is="i.to ? 'RouterLink' : 'div'" :to="i.to" :class="['group flex items-start gap-3 px-4 py-3', i.to && 'transition hover:bg-surface-muted/50']">
          <component :is="ICON[i.tone ?? 'info']" :size="16" :class="['mt-0.5 shrink-0', TONE[i.tone ?? 'info']]" aria-hidden="true" />
          <span class="min-w-0 flex-1 text-sm text-fg">{{ i.text }}</span>
          <span v-if="i.to" class="flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400">
            {{ i.action ?? 'Open' }}<ArrowRight :size="14" class="transition group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </component>
      </li>
    </ul>
  </section>
</template>
