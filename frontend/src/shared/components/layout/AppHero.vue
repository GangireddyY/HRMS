<script setup lang="ts">
import { Sparkles } from '@lucide/vue';

/**
 * Dashboard header: a greeting or title, a one-line summary of what matters right now (`summary`, e.g. built from
 * live counts) and primary actions. Sits on a soft gradient wash.
 */
defineProps<{ eyebrow?: string; title: string; summary?: string | null; loading?: boolean }>();
</script>

<template>
  <section class="ai-ring bg-ai-wash relative overflow-hidden rounded-lg px-5 py-5 shadow-card sm:px-6">
    <div class="bg-dots pointer-events-none absolute inset-y-0 end-0 w-1/2 opacity-70 [mask-image:linear-gradient(to_left,#000,transparent)]" aria-hidden="true" />
    <div class="relative flex flex-wrap items-center justify-between gap-4">
      <div class="flex min-w-0 items-center gap-4">
        <slot name="leading" />
        <div class="min-w-0">
          <p v-if="eyebrow" class="text-xs font-medium tracking-wide text-fg-muted uppercase">{{ eyebrow }}</p>
          <h1 class="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{{ title }}</h1>
          <p v-if="loading" class="skeleton mt-2 h-4 w-72 max-w-full rounded" />
          <p v-else-if="summary" class="mt-1 flex items-start gap-2 text-sm text-fg-muted">
            <Sparkles :size="14" class="mt-0.5 shrink-0 text-brand-500" aria-hidden="true" />
            <span>{{ summary }}</span>
          </p>
          <slot name="meta" />
        </div>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2 max-sm:w-full"><slot name="actions" /></div>
    </div>
  </section>
</template>
