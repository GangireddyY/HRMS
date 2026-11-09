<script setup lang="ts">
import { computed } from 'vue';
import type { ExitSummary } from '@/modules/exit/types';
import { STATUS_LABELS, exitSteps, statusTone } from '@/modules/exit/utils/exit-format';
import { AppBadge } from '@/shared/components';

/** Compact view of where an exit is in the workflow: status pill plus one segment per step. */
const props = defineProps<{ exit: ExitSummary }>();
const closed = computed(() => props.exit.status === 'WITHDRAWN' || props.exit.status === 'CANCELLED');
const steps = computed(() => exitSteps(props.exit));
const done = computed(() => steps.value.filter((s) => s.done).length);
const current = computed(() => steps.value.find((s) => s.state === 'current'));
</script>

<template>
  <div class="min-w-36">
    <AppBadge :tone="statusTone[exit.status]" size="sm" dot>{{ STATUS_LABELS[exit.status] }}</AppBadge>
    <div v-if="!closed" class="mt-1.5 flex items-center gap-2">
      <span class="flex gap-0.5" aria-hidden="true">
        <span
          v-for="s in steps"
          :key="s.key"
          :class="['h-1.5 w-4 rounded-full', s.state === 'done' ? 'bg-success' : s.state === 'current' ? 'bg-brand-500' : 'bg-surface-muted ring-1 ring-line ring-inset']"
        />
      </span>
      <span class="truncate text-2xs text-fg-muted">
        <span class="sr-only">{{ done }} of {{ steps.length }} steps done. </span>{{ current ? `Next: ${current.label.toLowerCase()}` : 'All steps done' }}
      </span>
    </div>
  </div>
</template>
