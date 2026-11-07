<script setup lang="ts">
export interface StripItem {
  key: string;
  label: string;
  value: string | number | null | undefined;
  /** Dot colour: a tone or any CSS colour. */
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'orange' | 'cyan' | 'neutral' | string;
  hint?: string;
}

/**
 * A row of metrics in one surface, divided by hairlines — the summary bar above a list. With `selectable` each metric
 * is a toggle (e.g. filter the list to that status); `selected` is the active key.
 */
const props = defineProps<{ items: StripItem[]; selectable?: boolean; selected?: string | null; loading?: boolean; label?: string }>();
const emit = defineEmits<{ select: [key: string | null] }>();

const TONES: Record<string, string> = {
  brand: 'var(--brand-500)',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#0ea5e9',
  violet: '#8b5cf6',
  orange: '#f97316',
  cyan: '#06b6d4',
  neutral: '#a1a1aa',
};
const dot = (t?: string) => (t ? (TONES[t] ?? t) : undefined);
const toggle = (key: string) => emit('select', props.selected === key ? null : key);
</script>

<template>
  <div class="card overflow-hidden" role="group" :aria-label="label ?? 'Summary'">
    <ul class="grid grid-cols-2 sm:grid-flow-col sm:auto-cols-fr sm:grid-cols-none">
      <li v-for="(it, i) in items" :key="it.key" :class="['min-w-0 border-line/70', i > 0 && 'sm:border-s', i % 2 === 1 && 'max-sm:border-s', i > 1 && 'max-sm:border-t']">
        <component
          :is="selectable ? 'button' : 'div'"
          :type="selectable ? 'button' : undefined"
          :aria-pressed="selectable ? selected === it.key : undefined"
          :class="[
            'relative flex h-full w-full flex-col gap-1 px-4 py-3 text-start transition-colors',
            selectable && 'cursor-pointer hover:bg-surface-muted/60 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none focus-visible:ring-inset',
            selected === it.key && 'bg-brand-50/70 dark:bg-brand-500/10',
          ]"
          @click="selectable && toggle(it.key)"
        >
          <span class="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
            <span v-if="it.tone" class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: dot(it.tone) }" aria-hidden="true" />
            <span class="truncate">{{ it.label }}</span>
          </span>
          <span v-if="loading" class="skeleton h-7 w-12 rounded-md" aria-hidden="true" />
          <span v-else class="text-2xl leading-8 font-semibold tracking-tight text-fg tabular-nums">{{ it.value ?? '—' }}</span>
          <span v-if="it.hint" class="truncate text-2xs text-fg-subtle">{{ it.hint }}</span>
          <span v-if="selected === it.key" class="absolute inset-x-0 bottom-0 h-0.5 bg-brand-600 dark:bg-brand-400" aria-hidden="true" />
        </component>
      </li>
    </ul>
  </div>
</template>
