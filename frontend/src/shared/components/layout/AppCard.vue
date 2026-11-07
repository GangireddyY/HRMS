<script setup lang="ts">
import type { Component } from 'vue';

withDefaults(defineProps<{ title?: string; description?: string; padded?: boolean; icon?: Component }>(), { padded: true });
</script>

<template>
  <section class="card overflow-hidden">
    <header v-if="title || $slots.actions" class="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-4 py-2.5">
      <div class="flex min-w-0 items-center gap-2.5">
        <span v-if="icon" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted">
          <component :is="icon" :size="15" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <h2 v-if="title" class="text-sm font-semibold text-fg">{{ title }}</h2>
          <p v-if="description" class="text-xs text-fg-muted">{{ description }}</p>
        </div>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-1.5"><slot name="actions" /></div>
    </header>
    <div :class="padded ? 'p-4' : ''"><slot /></div>
    <footer v-if="$slots.footer" class="border-t border-line/70 bg-surface-muted/40 px-4 py-2.5"><slot name="footer" /></footer>
  </section>
</template>
