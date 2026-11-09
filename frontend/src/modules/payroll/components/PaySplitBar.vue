<script setup lang="ts">
import { computed } from 'vue';
import { rupees } from '@/modules/payroll/utils/payroll-format';

export interface PaySegment {
  key: string;
  label: string;
  amount: number;
  /** Background class of the segment and its legend dot, e.g. 'bg-brand-500'. */
  color: string;
}

/** A sum split into proportional segments (CTC into components, gross into net and deductions), with an optional legend. */
const props = withDefaults(defineProps<{ segments: PaySegment[]; label: string; legend?: boolean; size?: 'sm' | 'md' | 'lg' }>(), { legend: false, size: 'md' });
const total = computed(() => props.segments.reduce((n, s) => n + Math.max(0, s.amount), 0));
const parts = computed(() => props.segments.filter((s) => s.amount > 0).map((s) => ({ ...s, pct: total.value ? (s.amount / total.value) * 100 : 0 })));
const pctLabel = (p: number) => (p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`);
const summary = computed(() => `${props.label}: ${parts.value.map((s) => `${s.label} ${rupees(s.amount)} (${pctLabel(s.pct)})`).join(', ')}`);
</script>

<template>
  <div>
    <div :class="['flex w-full gap-0.5 overflow-hidden rounded-full bg-surface-muted', { sm: 'h-1.5', md: 'h-2.5', lg: 'h-3.5' }[size]]" role="img" :aria-label="summary">
      <span v-for="s in parts" :key="s.key" :class="['h-full first:rounded-s-full last:rounded-e-full', s.color]" :style="{ width: `${s.pct}%`, minWidth: '4px' }" :title="`${s.label} · ${rupees(s.amount)} · ${pctLabel(s.pct)}`" />
    </div>
    <ul v-if="legend" class="mt-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2" aria-hidden="true">
      <li v-for="s in parts" :key="s.key" class="flex min-w-0 items-center gap-2">
        <span :class="['h-2.5 w-2.5 shrink-0 rounded-sm', s.color]" />
        <span class="min-w-0 flex-1 truncate text-fg-muted">{{ s.label }}</span>
        <span class="font-medium text-fg tabular-nums">{{ rupees(s.amount) }}</span>
        <span class="w-9 text-end text-fg-subtle tabular-nums">{{ pctLabel(s.pct) }}</span>
      </li>
    </ul>
  </div>
</template>
