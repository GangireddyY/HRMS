<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';
import AppAvatar from '@/shared/components/data/AppAvatar.vue';
import AppBadge from '@/shared/components/data/AppBadge.vue';

export interface PersonRow {
  id: string;
  name: string;
  avatarUrl?: string | null;
  meta?: string | null;
  badge?: string | null;
  badgeTone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet';
  to?: RouteLocationRaw;
}

/** A compact list of people with a line of context and an optional status badge. */
withDefaults(defineProps<{ people: PersonRow[]; empty?: string; loading?: boolean }>(), { empty: 'Nobody to show' });
</script>

<template>
  <div v-if="loading" class="space-y-3">
    <div v-for="i in 3" :key="i" class="flex items-center gap-3">
      <div class="h-7 w-7 animate-pulse rounded-full bg-surface-muted" />
      <div class="h-3.5 flex-1 animate-pulse rounded bg-surface-muted" />
    </div>
  </div>
  <p v-else-if="!people.length" class="py-2 text-[13px] text-fg-muted">{{ empty }}</p>
  <ul v-else class="-my-1.5 divide-y divide-line/60">
    <li v-for="p in people" :key="p.id">
      <component :is="p.to ? 'RouterLink' : 'div'" :to="p.to" :class="['flex items-center gap-2.5 py-1.5', p.to && 'rounded-sm transition hover:bg-surface-muted/50']">
        <AppAvatar :name="p.name" :src="p.avatarUrl" size="sm" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] font-medium text-fg">{{ p.name }}</span>
          <span v-if="p.meta" class="block truncate text-xs text-fg-muted">{{ p.meta }}</span>
        </span>
        <AppBadge v-if="p.badge" :tone="p.badgeTone ?? 'neutral'" size="sm">{{ p.badge }}</AppBadge>
      </component>
    </li>
  </ul>
</template>
