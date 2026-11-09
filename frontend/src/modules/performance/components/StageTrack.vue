<script setup lang="ts">
import { computed } from 'vue';
import type { ReviewStage } from '@contracts';
import { STAGE_LABELS, STAGE_ORDER } from '@/modules/performance/utils/performance-format';

/** Compact six-segment track of where a review is in its workflow, for list rows. */
const props = defineProps<{ stage: ReviewStage; overdue?: boolean }>();
const at = computed(() => STAGE_ORDER.indexOf(props.stage));
const done = computed(() => props.stage === 'ACKNOWLEDGED');
</script>

<template>
  <div class="flex items-center gap-0.5" role="img" :aria-label="`Step ${at + 1} of ${STAGE_ORDER.length}: ${STAGE_LABELS[stage]}`">
    <span
      v-for="(s, i) in STAGE_ORDER"
      :key="s"
      :class="[
        'h-1.5 w-4 rounded-full',
        i < at || done ? 'bg-success/70' : i === at ? (overdue ? 'bg-danger' : 'bg-brand-500') : 'bg-surface-muted ring-1 ring-line ring-inset',
      ]"
    />
  </div>
</template>
