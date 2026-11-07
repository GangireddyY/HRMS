<script setup lang="ts">
import type { Component } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

export interface QuickAction {
  key: string;
  label: string;
  description?: string;
  icon: Component;
  to?: RouteLocationRaw;
  onClick?: () => void;
}

/** Shortcut tiles for the most common tasks. */
defineProps<{ actions: QuickAction[]; columns?: 2 | 3 | 4 }>();
</script>

<template>
  <ul :class="['grid gap-2', { 2: 'grid-cols-2', 3: 'grid-cols-2 sm:grid-cols-3', 4: 'grid-cols-2 lg:grid-cols-4' }[columns ?? 4]]">
    <li v-for="a in actions" :key="a.key">
      <component
        :is="a.to ? 'RouterLink' : 'button'"
        :to="a.to"
        :type="a.to ? undefined : 'button'"
        class="group flex h-full w-full items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-left transition hover:border-brand-500/40 hover:bg-brand-50/40 dark:hover:bg-brand-500/5"
        @click="a.onClick?.()"
      >
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white dark:bg-brand-500/12 dark:text-brand-300">
          <component :is="a.icon" :size="16" aria-hidden="true" />
        </span>
        <span class="min-w-0">
          <span class="block truncate text-[13px] font-medium text-fg">{{ a.label }}</span>
          <span v-if="a.description" class="block truncate text-xs text-fg-muted">{{ a.description }}</span>
        </span>
      </component>
    </li>
  </ul>
</template>
