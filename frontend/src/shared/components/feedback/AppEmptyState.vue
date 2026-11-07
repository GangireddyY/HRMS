<script setup lang="ts">
import type { Component } from 'vue';
import { Inbox } from '@lucide/vue';

withDefaults(defineProps<{ title: string; description?: string; icon?: Component; compact?: boolean }>(), { icon: () => Inbox });
</script>

<template>
  <div :class="['flex flex-col items-center justify-center px-4 text-center', compact ? 'py-6' : 'py-10']">
    <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-line bg-surface-muted text-fg-muted">
      <component :is="icon" :size="18" aria-hidden="true" />
    </div>
    <p class="text-sm font-semibold text-fg">{{ title }}</p>
    <p v-if="description" class="mt-0.5 max-w-sm text-[13px] text-fg-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4"><slot /></div>
  </div>
</template>
