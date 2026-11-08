<script setup lang="ts">
import type { Component } from 'vue';
import { Inbox } from '@lucide/vue';

withDefaults(defineProps<{ title: string; description?: string; icon?: Component; compact?: boolean }>(), { icon: () => Inbox });
</script>

<template>
  <div role="status" :class="['flex flex-col items-center justify-center px-4 text-center', compact ? 'py-6' : 'py-12']">
    <div :class="['relative flex items-center justify-center', compact ? 'mb-3 h-16 w-16' : 'mb-4 h-24 w-24']">
      <div class="empty-rings absolute inset-0 -m-6" aria-hidden="true" />
      <div
        :class="[
          'relative flex items-center justify-center rounded-full border border-line bg-surface text-accent-fg shadow-card',
          compact ? 'h-10 w-10' : 'h-12 w-12',
        ]"
      >
        <component :is="icon" :size="compact ? 18 : 22" aria-hidden="true" />
      </div>
    </div>
    <p :class="['font-semibold text-fg', compact ? 'text-sm' : 'text-base']">{{ title }}</p>
    <p v-if="description" class="mt-1 max-w-sm text-sm text-fg-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-5"><slot /></div>
  </div>
</template>
