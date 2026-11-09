<script setup lang="ts">
import { computed, type Component } from 'vue';

export interface EmployeeFact {
  label: string;
  value: string;
  icon: Component;
  mono?: boolean;
  /** Secondary line under the value, e.g. "in 12 days". */
  hint?: string;
  /** Spans the full row and keeps line breaks (addresses); placed after the other facts. */
  wide?: boolean;
}

/** Icon-tile facts in a hairline grid, for the employee profile's employment and personal sections. */
const props = defineProps<{ items: EmployeeFact[] }>();

const cells = computed(() => props.items.filter((f) => !f.wide));
const wide = computed(() => props.items.filter((f) => f.wide));
// Blank cells close the last row, so the hairline background never shows through as a grey block.
const fillers = computed(() => {
  const n = cells.value.length;
  const two = n % 2;
  const three = (3 - (n % 3)) % 3;
  return Array.from({ length: Math.max(two, three) }, (_, i) => [i < two ? 'max-sm:hidden' : 'hidden', i < three ? '2xl:block' : '2xl:hidden']);
});
</script>

<template>
  <dl class="grid gap-px overflow-hidden rounded-lg bg-line/60 ring-1 ring-line/60 sm:grid-cols-2 2xl:grid-cols-3">
    <div v-for="f in cells" :key="f.label" class="flex min-w-0 items-start gap-3 bg-surface px-3.5 py-3">
      <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><component :is="f.icon" :size="14" /></span>
      <div class="min-w-0 flex-1">
        <dt class="text-2xs font-medium text-fg-muted">{{ f.label }}</dt>
        <dd :class="['mt-0.5 truncate text-sm', f.value === '—' ? 'text-fg-subtle' : 'text-fg', f.mono && 'font-mono']" :title="f.value">{{ f.value }}</dd>
        <dd v-if="f.hint" class="truncate text-2xs text-fg-muted">{{ f.hint }}</dd>
      </div>
    </div>
    <div v-for="(c, i) in fillers" :key="`filler-${i}`" :class="['bg-surface', c]" aria-hidden="true" />
    <div v-for="f in wide" :key="f.label" class="flex min-w-0 items-start gap-3 bg-surface px-3.5 py-3 sm:col-span-2 2xl:col-span-3">
      <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><component :is="f.icon" :size="14" /></span>
      <div class="min-w-0 flex-1">
        <dt class="text-2xs font-medium text-fg-muted">{{ f.label }}</dt>
        <dd :class="['mt-0.5 text-sm whitespace-pre-line', f.value === '—' ? 'text-fg-subtle' : 'text-fg']">{{ f.value }}</dd>
        <dd v-if="f.hint" class="text-2xs text-fg-muted">{{ f.hint }}</dd>
      </div>
    </div>
  </dl>
</template>
