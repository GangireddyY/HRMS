<script setup lang="ts">
import { Plus } from '@lucide/vue';
import type { RouteLocationRaw } from 'vue-router';

/** Dashed "add another" tile closing a grid of cards, so a short grid doesn't leave a blank gap. */
defineProps<{ title: string; description?: string; to?: RouteLocationRaw }>();
defineEmits<{ click: [] }>();
</script>

<template>
  <component
    :is="to ? 'RouterLink' : 'button'"
    :to="to"
    :type="to ? undefined : 'button'"
    class="group flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-strong p-4 text-center transition hover:border-brand-400 hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-brand-500/5"
    @click="!to && $emit('click')"
  >
    <span class="flex h-8 w-8 items-center justify-center rounded-md bg-surface-muted text-fg-muted transition group-hover:bg-brand-600 group-hover:text-white"><Plus :size="16" aria-hidden="true" /></span>
    <span class="text-sm font-medium text-fg">{{ title }}</span>
    <span v-if="description" class="max-w-xs text-xs text-fg-muted">{{ description }}</span>
  </component>
</template>
