<script setup lang="ts">
import { computed } from 'vue';
import type { ReportTable } from '@contracts';
import { formatValue } from '@/modules/reports/utils/report-definitions';
import { SERIES_COLORS, type ChartSpec } from '@/modules/reports/utils/report-visuals';

/**
 * A breakdown as a chart: parts of a whole get a donut with a legend (up to six parts), anything else ranked bars.
 * Colours come from theme variables; the table view carries the same figures for screen readers.
 */
const props = defineProps<{ table: ReportTable; spec: ChartSpec }>();

const items = computed(() => {
  const s = props.spec;
  const rows = [...props.table.rows].sort((a, b) => Number(b[s.bar.key] ?? 0) - Number(a[s.bar.key] ?? 0));
  const max = Math.max(1, ...rows.map((r) => Number(r[s.bar.key] ?? 0)));
  return rows.map((r, i) => ({
    label: String(r[s.label] ?? '—'),
    value: Number(r[s.bar.key] ?? 0),
    bar: formatValue(Number(r[s.bar.key] ?? 0), s.bar.format as never),
    aside: s.aside ? formatValue(r[s.aside.key] ?? null, s.aside.format as never) : null,
    pct: (Number(r[s.bar.key] ?? 0) / max) * 100,
    color: SERIES_COLORS[i % SERIES_COLORS.length]!,
  }));
});
const total = computed(() => items.value.reduce((n, i) => n + i.value, 0));
const donut = computed(() => props.spec.whole && items.value.length <= 6 && total.value > 0);

/** Donut arcs on r=15.915 so the circumference is 100 and dash lengths are percentages. */
const arcs = computed(() => {
  let offset = 0;
  return items.value.map((i) => {
    const share = (i.value / total.value) * 100;
    const arc = { color: i.color, dash: `${Math.max(0, share - 0.6)} ${100 - Math.max(0, share - 0.6)}`, offset: 25 - offset };
    offset += share;
    return arc;
  });
});
const totalLabel = computed(() => formatValue(total.value, props.spec.bar.format as never));
</script>

<template>
  <div v-if="donut" class="flex flex-wrap items-center gap-6 p-4">
    <div class="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 42 42" class="h-full w-full" aria-hidden="true">
        <circle cx="21" cy="21" r="15.915" fill="none" class="stroke-surface-muted" stroke-width="5" />
        <circle v-for="(a, i) in arcs" :key="i" cx="21" cy="21" r="15.915" fill="none" :stroke="a.color" stroke-width="5" :stroke-dasharray="a.dash" :stroke-dashoffset="a.offset" />
      </svg>
      <div class="absolute inset-0 grid place-items-center text-center">
        <div>
          <p class="text-xl leading-none font-semibold text-fg tabular-nums">{{ totalLabel }}</p>
          <p class="mt-1 text-2xs text-fg-muted">{{ spec.bar.label.toLowerCase() }}</p>
        </div>
      </div>
    </div>
    <ul class="min-w-48 flex-1 space-y-2.5 text-sm">
      <li v-for="i in items" :key="i.label" class="flex items-center gap-2.5">
        <span class="h-2.5 w-2.5 shrink-0 rounded-sm" :style="{ background: i.color }" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-fg">{{ i.label }}</span>
        <span class="text-fg-muted tabular-nums">{{ i.bar }}</span>
        <span v-if="i.aside" class="w-14 text-end font-semibold text-fg tabular-nums">{{ i.aside }}</span>
      </li>
    </ul>
  </div>
  <ul v-else class="space-y-3 p-4">
    <li v-for="i in items" :key="i.label">
      <div class="flex items-baseline gap-2 text-sm">
        <span class="min-w-0 flex-1 truncate text-fg">{{ i.label }}</span>
        <span v-if="i.aside" class="text-xs text-fg-muted tabular-nums">{{ i.aside }} {{ spec.aside!.label.toLowerCase() }}</span>
        <span class="w-16 text-end font-semibold text-fg tabular-nums">{{ i.bar }}</span>
      </div>
      <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <div class="h-full rounded-full bg-brand-500 transition-all" :style="{ width: `${Math.max(i.value ? 2 : 0, i.pct)}%` }" />
      </div>
    </li>
  </ul>
</template>
