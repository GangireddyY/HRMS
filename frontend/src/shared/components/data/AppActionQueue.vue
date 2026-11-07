<script setup lang="ts">
import type { Component } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { CheckCircle2, ChevronRight } from '@lucide/vue';

export interface QueueItem {
  key: string;
  label: string;
  count: number;
  to: RouteLocationRaw;
  icon: Component;
}

/** Work waiting for the user, by kind, busiest first; only kinds with something waiting are shown. */
const props = withDefaults(defineProps<{ items: QueueItem[]; loading?: boolean; title?: string }>(), { title: 'Waiting for you' });
const total = () => props.items.reduce((n, i) => n + i.count, 0);
</script>

<template>
  <section class="card flex flex-col">
    <header class="flex items-center justify-between gap-2 border-b border-line/70 px-4 py-2.5">
      <h2 class="text-sm font-semibold text-fg">{{ title }}</h2>
      <span v-if="!loading && total()" class="rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums dark:bg-brand-500">{{ total() }}</span>
    </header>
    <div v-if="loading" class="space-y-2.5 p-4">
      <div v-for="i in 4" :key="i" class="h-7 animate-pulse rounded bg-surface-muted" />
    </div>
    <div v-else-if="!total()" class="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 py-6 text-center">
      <CheckCircle2 :size="22" class="text-emerald-500" aria-hidden="true" />
      <p class="text-sm font-medium text-fg">You're all caught up</p>
      <p class="text-xs text-fg-muted">Approvals and requests for you will show up here.</p>
    </div>
    <ul v-else class="divide-y divide-line/60">
      <li v-for="i in [...items].filter((x) => x.count > 0).sort((a, b) => b.count - a.count)" :key="i.key">
        <RouterLink :to="i.to" class="group flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-muted/50">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted group-hover:text-brand-600 dark:group-hover:text-brand-300">
            <component :is="i.icon" :size="15" aria-hidden="true" />
          </span>
          <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{{ i.label }}</span>
          <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 tabular-nums dark:bg-amber-500/15 dark:text-amber-200">{{ i.count }}</span>
          <ChevronRight :size="15" class="shrink-0 text-fg-subtle transition group-hover:translate-x-0.5" aria-hidden="true" />
        </RouterLink>
      </li>
    </ul>
  </section>
</template>
