<script setup lang="ts">
import { RATING_FILL } from '@/modules/performance/utils/performance-ops';

/** A 1–5 rating as a compact chip: colour dot, figure and the cycle's label; a dash when not rated. */
defineProps<{ rating: number | null | undefined; labels: string[]; prefix?: string }>();
</script>

<template>
  <span v-if="rating" class="inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-muted/70 px-2 py-0.5 text-xs ring-1 ring-line ring-inset">
    <span :class="['h-2 w-2 shrink-0 rounded-full', RATING_FILL[rating]]" aria-hidden="true" />
    <span v-if="prefix" class="text-fg-muted">{{ prefix }}</span>
    <span class="font-semibold text-fg tabular-nums">{{ rating }}</span>
    <span v-if="labels[rating - 1]" class="truncate text-fg-muted">{{ labels[rating - 1] }}</span>
  </span>
  <span v-else class="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-fg-subtle">{{ prefix ? `${prefix}: not rated` : 'Not rated' }}</span>
</template>
