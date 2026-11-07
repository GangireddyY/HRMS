<script setup lang="ts">
import type { Component } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { Users } from '@lucide/vue';
import AppAvatar from '@/shared/components/data/AppAvatar.vue';
import AppBadge from '@/shared/components/data/AppBadge.vue';
import AppEmptyState from '@/shared/components/feedback/AppEmptyState.vue';

export interface PersonRow {
  id: string;
  name: string;
  avatarUrl?: string | null;
  meta?: string | null;
  badge?: string | null;
  badgeTone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet';
  to?: RouteLocationRaw;
}

/** A compact list of people with a line of context and an optional status badge; the standard empty state when empty. */
withDefaults(defineProps<{ people: PersonRow[]; empty?: string; emptyDescription?: string; emptyIcon?: Component; loading?: boolean }>(), {
  empty: 'Nobody to show',
  emptyIcon: () => Users,
});
</script>

<template>
  <div v-if="loading" class="space-y-3">
    <div v-for="i in 3" :key="i" class="flex items-center gap-3">
      <div class="skeleton h-7 w-7 rounded-full" />
      <div class="skeleton h-3.5 flex-1 rounded" />
    </div>
  </div>
  <AppEmptyState v-else-if="!people.length" class="flex-1" compact :icon="emptyIcon" :title="empty" :description="emptyDescription" />
  <ul v-else class="-my-2 divide-y divide-line/60">
    <li v-for="p in people" :key="p.id">
      <component :is="p.to ? 'RouterLink' : 'div'" :to="p.to" :class="['flex items-center gap-3 py-2', p.to && 'rounded-sm transition hover:bg-surface-muted/50']">
        <AppAvatar :name="p.name" :src="p.avatarUrl" size="sm" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium text-fg">{{ p.name }}</span>
          <span v-if="p.meta" class="block truncate text-xs text-fg-muted">{{ p.meta }}</span>
        </span>
        <AppBadge v-if="p.badge" :tone="p.badgeTone ?? 'neutral'" size="sm">{{ p.badge }}</AppBadge>
      </component>
    </li>
  </ul>
</template>
