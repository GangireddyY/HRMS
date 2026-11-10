<script setup lang="ts">
import { computed } from 'vue';
import { Check, Eye, Hourglass, X } from '@lucide/vue';
import type { Timesheet } from '@/modules/attendance/types';
import { dateRange } from '@/modules/attendance/utils/attendance-format';
import { dateTile, waiting } from '@/modules/attendance/utils/attendance-ops';
import { TIMESHEET_LABELS, hoursLabel, timesheetTone } from '@/modules/attendance/utils/timesheet-format';
import { AppAvatar, AppBadge, AppButton } from '@/shared/components';

/** A timesheet in the review grid: the week, hours per day as small bars, the main projects and the reviewer actions. */
const props = defineProps<{ timesheet: Timesheet; selectable?: boolean }>();
const emit = defineEmits<{ open: []; approve: []; reject: [] }>();

const t = computed(() => props.timesheet);
const tile = computed(() => dateTile(t.value.weekStart));
const peak = computed(() => Math.max(480, ...t.value.dayTotals));
const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const wait = computed(() => (t.value.submittedAt ? waiting(t.value.submittedAt) : null));
const WAIT_TONE = { neutral: 'text-fg-subtle', warning: 'text-warning-fg', danger: 'font-medium text-danger-fg' };
const projects = computed(() => {
  const by = new Map<string, number>();
  for (const e of t.value.entries) by.set(e.project, (by.get(e.project) ?? 0) + e.minutes);
  return [...by.entries()].sort((a, b) => b[1] - a[1]);
});
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div :class="['flex items-start gap-3', selectable && 'ps-7']">
      <span class="flex w-11 shrink-0 flex-col items-center rounded-xl bg-accent-soft py-1 text-accent-fg" aria-hidden="true">
        <span class="text-2xs leading-3 font-semibold uppercase">{{ tile.month }}</span>
        <span class="text-lg leading-6 font-semibold tabular-nums">{{ tile.day }}</span>
      </span>
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm leading-snug font-semibold text-fg">{{ dateRange(t.weekStart, t.weekEnd) }}</h3>
        <p class="mt-0.5 text-xs text-fg-muted tabular-nums">{{ hoursLabel(t.totalMinutes) }} logged · {{ t.entries.length }} activit{{ t.entries.length === 1 ? 'y' : 'ies' }}</p>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-1">
        <AppBadge :tone="timesheetTone[t.status]" size="sm" dot>{{ TIMESHEET_LABELS[t.status] }}</AppBadge>
        <span v-if="t.status === 'SUBMITTED' && wait" :class="['inline-flex items-center gap-1 text-2xs', WAIT_TONE[wait.tone]]"><Hourglass :size="10" aria-hidden="true" />Sent {{ wait.label }}</span>
        <span v-else-if="t.reviewedBy" class="max-w-32 truncate text-2xs text-fg-subtle">by {{ t.reviewedBy }}</span>
      </div>
    </div>

    <div class="grid grid-cols-7 items-end gap-1.5" :aria-label="`Hours per day: ${t.dayTotals.map(hoursLabel).join(', ')}`" role="img">
      <div v-for="(m, i) in t.dayTotals" :key="i" class="flex flex-col items-center gap-1">
        <div class="flex h-12 w-full items-end overflow-hidden rounded-md bg-surface-muted">
          <div :class="['w-full rounded-md transition-[height]', i >= 5 ? 'bg-brand-300 dark:bg-brand-700' : 'bg-brand-500 dark:bg-brand-400']" :style="{ height: `${Math.round((m / peak) * 100)}%` }" />
        </div>
        <span class="text-2xs text-fg-subtle">{{ LETTERS[i] }}</span>
      </div>
    </div>

    <ul class="space-y-1 text-xs">
      <li v-for="[name, minutes] in projects.slice(0, 2)" :key="name" class="flex items-center gap-2">
        <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-fg">{{ name }}</span>
        <span class="shrink-0 text-fg-muted tabular-nums">{{ hoursLabel(minutes) }}</span>
      </li>
      <li v-if="projects.length > 2" class="ps-3.5 text-fg-subtle">+ {{ projects.length - 2 }} more</li>
    </ul>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <AppAvatar :name="t.employee?.name ?? '?'" size="sm" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs font-medium text-fg">{{ t.employee?.name ?? 'Unknown employee' }}</p>
        <p class="truncate text-2xs text-fg-subtle">{{ [t.employee?.employeeCode, t.employee?.department].filter(Boolean).join(' · ') }}</p>
      </div>
      <template v-if="t.permissions.review">
        <AppButton size="xs" variant="secondary" :icon="X" :aria-label="`Send back ${t.employee?.name}'s timesheet`" @click.stop="emit('reject')" />
        <AppButton size="xs" :icon="Check" @click.stop="emit('approve')">Approve</AppButton>
      </template>
      <AppButton v-else size="xs" variant="secondary" :icon="Eye" @click.stop="emit('open')">View</AppButton>
    </div>
  </div>
</template>
