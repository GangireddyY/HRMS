<script setup lang="ts">
import { computed, type Component } from 'vue';
import { ArrowDownRight, ArrowUpRight } from '@lucide/vue';
import { KPI_TILE, type KpiTone } from '@/modules/reports/utils/report-visuals';
import { AppSparkline } from '@/shared/components';

/** A headline figure: icon, value, what it means, and — when the report has a monthly series — its trend and change. */
const props = defineProps<{ label: string; value: string; icon: Component; tone: KpiTone; hint?: string; spark?: number[] | null; changeLabel?: (diff: number) => string }>();

const change = computed(() => {
  const s = props.spark;
  if (!s || s.length < 2) return null;
  const diff = s.at(-1)! - s[0]!;
  if (!diff) return { text: 'No change', up: null as boolean | null, months: s.length - 1 };
  return { text: props.changeLabel ? props.changeLabel(Math.abs(diff)) : Math.abs(diff).toLocaleString(), up: diff > 0, months: s.length - 1 };
});
</script>

<template>
  <div class="card flex h-full flex-col p-4">
    <div class="flex items-start gap-3">
      <span :class="['grid h-9 w-9 shrink-0 place-items-center rounded-lg', KPI_TILE[tone]]" aria-hidden="true"><component :is="icon" :size="17" /></span>
      <p class="min-w-0 flex-1 pt-0.5 text-xs leading-snug font-medium text-fg-muted">{{ label }}</p>
    </div>
    <p class="mt-3 text-2xl leading-none font-semibold tracking-tight text-fg tabular-nums">{{ value }}</p>
    <div class="mt-auto pt-3">
      <div v-if="spark" class="mb-2"><AppSparkline :values="spark" :tone="tone" :height="28" /></div>
      <p v-if="change" class="flex items-center gap-1 text-2xs text-fg-muted">
        <span v-if="change.up !== null" :class="['inline-flex items-center font-semibold tabular-nums', change.up ? 'text-success-fg' : 'text-danger-fg']">
          <component :is="change.up ? ArrowUpRight : ArrowDownRight" :size="12" aria-hidden="true" />{{ change.up ? '+' : '−' }}{{ change.text }}
        </span>
        <span v-else class="font-medium">{{ change.text }}</span>
        <span>over {{ change.months }} month{{ change.months === 1 ? '' : 's' }}</span>
      </p>
      <p v-else-if="hint" class="text-2xs leading-snug text-fg-subtle">{{ hint }}</p>
    </div>
  </div>
</template>
