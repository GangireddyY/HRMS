<script setup lang="ts">
/** Label / value rows for side panels and summaries. Empty values show a dash. */
export interface Fact {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
  strong?: boolean;
}

defineProps<{ items: Fact[] }>();
</script>

<template>
  <dl class="divide-y divide-line/70 text-[13px]">
    <div v-for="f in items" :key="f.label" class="flex items-baseline justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
      <dt class="shrink-0 text-fg-muted">{{ f.label }}</dt>
      <dd :class="['min-w-0 truncate text-right text-fg', f.mono && 'font-mono text-xs', f.strong && 'font-semibold']" :title="f.value == null ? undefined : String(f.value)">
        {{ f.value == null || f.value === '' ? '—' : f.value }}
      </dd>
    </div>
  </dl>
</template>
