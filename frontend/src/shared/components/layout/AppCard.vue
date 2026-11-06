<script setup lang="ts">
import type { Component } from 'vue';

withDefaults(defineProps<{ title?: string; description?: string; padded?: boolean; icon?: Component }>(), { padded: true });
</script>

<template>
  <section class="card overflow-hidden">
    <header v-if="title || $slots.actions" class="flex flex-wrap items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
      <div class="flex min-w-0 items-start gap-3">
        <span v-if="icon" class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-fg-muted ring-1 ring-line ring-inset">
          <component :is="icon" :size="16" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <h2 v-if="title" class="text-[15px] font-semibold text-fg">{{ title }}</h2>
          <p v-if="description" class="mt-0.5 text-[13px] text-fg-muted">{{ description }}</p>
        </div>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2"><slot name="actions" /></div>
    </header>
    <div :class="padded ? 'p-5' : ''"><slot /></div>
    <footer v-if="$slots.footer" class="border-t border-line/70 bg-surface-muted/40 px-5 py-3"><slot name="footer" /></footer>
  </section>
</template>
