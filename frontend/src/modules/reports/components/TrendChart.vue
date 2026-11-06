<script setup lang="ts">
import { computed } from 'vue';
import { formatValue, type ValueFormat } from '@/modules/reports/utils/report-definitions';
import { AppCard } from '@/shared/components';

/** Monthly bars; each bar is labelled with its value for screen readers. */
const props = defineProps<{ title: string; points: { label: string; value: number }[]; format: ValueFormat }>();
const max = computed(() => Math.max(1, ...props.points.map((p) => p.value)));
</script>

<template>
  <AppCard :title="title">
    <p v-if="!points.length" class="text-sm text-fg-muted">No data in this period.</p>
    <ol v-else class="flex h-44 items-end gap-1.5 sm:gap-2" :aria-label="title">
      <li v-for="p in points" :key="p.label" class="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" :aria-label="`${p.label}: ${formatValue(p.value, format)}`">
        <span class="hidden text-[10px] text-fg-muted tabular-nums sm:block">{{ formatValue(p.value, format === 'money' ? 'number' : format) }}</span>
        <span class="w-full rounded-t-md bg-brand-500/80" :style="{ height: `${Math.max(2, (p.value / max) * 100)}%` }" />
        <span class="w-full truncate text-center text-[10px] text-fg-muted">{{ p.label }}</span>
      </li>
    </ol>
  </AppCard>
</template>
