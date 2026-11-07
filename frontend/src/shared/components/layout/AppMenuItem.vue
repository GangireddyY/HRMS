<script setup lang="ts">
import type { Component } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

defineProps<{ icon?: Component; to?: RouteLocationRaw; danger?: boolean; disabled?: boolean }>();
defineEmits<{ select: [] }>();
const cls = 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm font-medium transition-colors disabled:opacity-50';
</script>

<template>
  <RouterLink v-if="to" :to="to" role="menuitem" :class="[cls, 'text-fg hover:bg-surface-muted']">
    <component :is="icon" v-if="icon" :size="16" class="text-fg-subtle" aria-hidden="true" />
    <slot />
  </RouterLink>
  <button
    v-else
    type="button"
    role="menuitem"
    :disabled="disabled"
    :class="[cls, danger ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10' : 'text-fg hover:bg-surface-muted']"
    @click="$emit('select')"
  >
    <component :is="icon" v-if="icon" :size="16" :class="danger ? '' : 'text-fg-subtle'" aria-hidden="true" />
    <slot />
  </button>
</template>
