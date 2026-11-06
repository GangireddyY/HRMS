<script setup lang="ts">
import type { Component } from 'vue';
import { Inbox } from '@lucide/vue';

withDefaults(defineProps<{ title: string; description?: string; icon?: Component; compact?: boolean }>(), { icon: () => Inbox });
</script>

<template>
  <div :class="['flex flex-col items-center justify-center px-6 text-center', compact ? 'py-8' : 'py-14']">
    <div class="relative mb-4">
      <div class="absolute inset-0 -m-3 rounded-full bg-brand-500/8 blur-md" aria-hidden="true" />
      <div class="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-fg-muted shadow-card">
        <component :is="icon" :size="20" aria-hidden="true" />
      </div>
    </div>
    <p class="text-sm font-semibold text-fg">{{ title }}</p>
    <p v-if="description" class="mt-1 max-w-sm text-sm text-fg-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-5"><slot /></div>
  </div>
</template>
