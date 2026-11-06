<script setup lang="ts">
import type { CaseEvent } from '@/modules/grievance/types';
import { EVENT_LABELS, STATUS_LABELS } from '@/modules/grievance/utils/grievance-format';
import { AppBadge, AppCard } from '@/shared/components';
import { formatDateTime } from '@/shared/utils/format';

defineProps<{ events: CaseEvent[] }>();
</script>

<template>
  <AppCard title="Timeline">
    <ol class="relative space-y-4 border-l border-line pl-5">
      <li v-for="e in events" :key="e.id" class="relative">
        <span class="absolute top-1.5 -left-[1.6rem] h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-surface" aria-hidden="true" />
        <p class="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
          {{ EVENT_LABELS[e.type] ?? e.type }}
          <AppBadge v-if="e.internal" size="sm" tone="warning">Internal</AppBadge>
        </p>
        <p v-if="e.detail || e.toStatus" class="text-sm text-fg-muted">{{ e.detail ?? `Status: ${STATUS_LABELS[e.toStatus!]}` }}</p>
        <p class="text-xs text-fg-subtle">{{ formatDateTime(e.createdAt) }}<template v-if="e.actor"> · {{ e.actor }}</template></p>
      </li>
    </ol>
  </AppCard>
</template>
