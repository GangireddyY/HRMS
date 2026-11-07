<script setup lang="ts">
import type { Component } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { CheckCircle2, ChevronRight, Inbox } from '@lucide/vue';
import AppEmptyState from '@/shared/components/feedback/AppEmptyState.vue';
import AppCard from '@/shared/components/layout/AppCard.vue';

export interface QueueItem {
  key: string;
  label: string;
  count: number;
  to: RouteLocationRaw;
  icon: Component;
}

/** Work waiting for the user, by kind, busiest first; only kinds with something waiting are shown. */
const props = withDefaults(defineProps<{ items: QueueItem[]; loading?: boolean; title?: string; description?: string }>(), {
  title: 'Waiting for you',
  description: 'Approvals and requests for you',
});
const total = () => props.items.reduce((n, i) => n + i.count, 0);
</script>

<template>
  <AppCard :title="title" :description="description" :icon="Inbox" :padded="false" fill>
    <template v-if="!loading && total()" #actions>
      <span class="rounded-full bg-brand-600 px-2 py-0.5 text-2xs font-semibold text-white tabular-nums dark:bg-brand-500">{{ total() }}</span>
    </template>
    <div v-if="loading" class="space-y-3 p-4">
      <div v-for="i in 4" :key="i" class="skeleton h-7 rounded" />
    </div>
    <AppEmptyState v-else-if="!total()" class="flex-1" compact :icon="CheckCircle2" title="You're all caught up" description="Approvals and requests for you show up here." />
    <ul v-else class="divide-y divide-line/60">
      <li v-for="i in [...items].filter((x) => x.count > 0).sort((a, b) => b.count - a.count)" :key="i.key">
        <RouterLink :to="i.to" class="group flex items-center gap-3 px-4 py-3 transition hover:bg-surface-muted/50">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted group-hover:text-brand-600 dark:group-hover:text-brand-300">
            <component :is="i.icon" :size="16" aria-hidden="true" />
          </span>
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-fg">{{ i.label }}</span>
          <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 tabular-nums dark:bg-amber-500/15 dark:text-amber-200">{{ i.count }}</span>
          <ChevronRight :size="16" class="shrink-0 text-fg-subtle transition group-hover:translate-x-0.5" aria-hidden="true" />
        </RouterLink>
      </li>
    </ul>
  </AppCard>
</template>
