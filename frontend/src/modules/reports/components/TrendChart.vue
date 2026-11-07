<script setup lang="ts">
import { computed, type Component } from 'vue';
import { BarChart3 } from '@lucide/vue';
import { formatValue, type ValueFormat } from '@/modules/reports/utils/report-definitions';
import { AppCard, AppEmptyState } from '@/shared/components';

/** Monthly bars; each bar is labelled with its value for screen readers. */
const props = withDefaults(defineProps<{ title: string; description?: string; icon?: Component; points: { label: string; value: number }[]; format: ValueFormat }>(), {
  icon: () => BarChart3,
});
const max = computed(() => Math.max(1, ...props.points.map((p) => p.value)));
</script>

<template>
  <AppCard :title="title" :description="description" :icon="icon" fill>
    <AppEmptyState v-if="!points.length" class="flex-1" compact :icon="BarChart3" title="No data in this period" />
    <ol v-else class="flex h-44 flex-1 items-end gap-2" :aria-label="title">
      <li v-for="p in points" :key="p.label" class="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" :aria-label="`${p.label}: ${formatValue(p.value, format)}`">
        <span class="hidden text-2xs text-fg-muted tabular-nums sm:block">{{ formatValue(p.value, format === 'money' ? 'number' : format) }}</span>
        <span class="w-full rounded-t-md bg-brand-500/80" :style="{ height: `${Math.max(2, (p.value / max) * 100)}%` }" />
        <span class="w-full truncate text-center text-2xs text-fg-muted">{{ p.label }}</span>
      </li>
    </ol>
  </AppCard>
</template>
