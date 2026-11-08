<script setup lang="ts">
import type { Component } from 'vue';

/**
 * The standard card: header (icon tile, title, description, actions), body and optional footer.
 * `fill`: the card takes the height of its grid row and the body becomes a column, so cards in a row line up and
 * an empty state can centre itself.
 */
withDefaults(defineProps<{ title?: string; description?: string; padded?: boolean; icon?: Component; fill?: boolean }>(), { padded: true });
</script>

<template>
  <section :class="['card flex flex-col overflow-hidden', fill && 'h-full']">
    <header v-if="title || $slots.actions" class="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-line/70 px-4 py-2 max-sm:flex-wrap">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <span v-if="icon" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs">
          <component :is="icon" :size="16" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <h2 v-if="title" class="text-sm font-semibold text-fg">{{ title }}</h2>
          <p v-if="description" class="text-xs text-fg-muted">{{ description }}</p>
        </div>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2"><slot name="actions" /></div>
    </header>
    <div :class="[padded && 'p-4', fill && 'flex flex-1 flex-col']"><slot /></div>
    <footer v-if="$slots.footer" class="shrink-0 border-t border-line/70 bg-surface-muted/50 px-4 py-3"><slot name="footer" /></footer>
  </section>
</template>
