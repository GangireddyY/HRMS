<script setup lang="ts">
import { computed } from 'vue';
import { AlertCircle, CalendarRange, Eye, EyeOff, ListChecks } from '@lucide/vue';
import type { PipRow } from '@/modules/performance/types';
import { PIP_STATUS_LABELS } from '@/modules/performance/utils/performance-format';
import { daysBetween, pct, plural, relativeDay, todayIso } from '@/modules/performance/utils/performance-ops';
import { AppAvatar } from '@/shared/components';
import { formatDate, timeAgo } from '@/shared/utils/format';
import { profileCover } from '@/shared/utils/profile-cover';

/** An improvement plan in the grid, as a profile card: whose plan, how far through its period, objectives, acknowledgement and owner. */
const props = defineProps<{ pip: PipRow }>();

const p = computed(() => props.pip);
const today = todayIso();
const active = computed(() => p.value.status === 'ACTIVE');
const length = computed(() => daysBetween(p.value.startDate, p.value.endDate) + 1);
const elapsed = computed(() => (active.value ? Math.min(100, Math.max(0, pct(daysBetween(p.value.startDate, today), Math.max(1, length.value - 1)))) : 100));
const timing = computed(() => {
  const x = p.value;
  if (!active.value) return { text: `${PIP_STATUS_LABELS[x.status]} · ${plural(length.value, 'day')} plan`, tone: 'text-fg-muted' };
  if (x.overdue) return { text: `Ended ${relativeDay(x.endDate)}: record the outcome`, tone: 'font-medium text-danger-fg' };
  if (x.startDate > today) return { text: `Starts ${relativeDay(x.startDate)}`, tone: 'text-fg-muted' };
  return { text: `Day ${daysBetween(x.startDate, today) + 1} of ${length.value} · ends ${relativeDay(x.endDate)}`, tone: 'text-fg-muted' };
});
const STATUS_STYLE = {
  ACTIVE: { dot: 'bg-warning', text: 'text-warning-fg', bar: 'bg-warning' },
  SUCCESSFUL: { dot: 'bg-success', text: 'text-success-fg', bar: 'bg-success' },
  UNSUCCESSFUL: { dot: 'bg-danger', text: 'text-danger-fg', bar: 'bg-danger/70' },
  CANCELLED: { dot: 'bg-fg-subtle', text: 'text-fg-muted', bar: 'bg-fg-subtle/60' },
} as const;
const style = computed(() => STATUS_STYLE[p.value.status]);
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="relative -mx-4 -mt-4 h-14 border-b border-line/50" :style="profileCover(p.employee.id)">
      <span :class="['absolute end-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-2 py-0.5 text-2xs font-medium shadow-xs backdrop-blur-sm', style.text]">
        <span :class="['h-1.5 w-1.5 rounded-full', style.dot]" aria-hidden="true" />{{ PIP_STATUS_LABELS[p.status] }}
      </span>
    </div>
    <div class="relative z-10 -mt-7 flex items-end justify-between gap-2">
      <span class="rounded-full bg-surface p-0.5"><AppAvatar :name="p.employee.name" size="lg" /></span>
      <span v-if="p.overdue" class="mb-1 inline-flex items-center gap-1 rounded-md bg-danger-soft px-1.5 py-0.5 text-2xs font-medium text-danger-fg">
        <AlertCircle :size="11" aria-hidden="true" />Past its end date
      </span>
    </div>

    <h3 class="mt-2 truncate text-sm font-semibold text-fg">{{ p.employee.name }}</h3>
    <p class="truncate text-xs text-fg-muted">{{ p.employee.department ?? p.employee.employeeCode }}</p>

    <div class="mt-3 rounded-lg bg-surface-muted/50 px-3 py-2.5">
      <div class="flex items-center justify-between gap-2 text-xs">
        <span class="flex min-w-0 items-center gap-1.5 font-medium text-fg tabular-nums">
          <CalendarRange :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" /><span class="truncate">{{ formatDate(p.startDate) }} – {{ formatDate(p.endDate) }}</span>
        </span>
        <span v-if="active" class="shrink-0 text-2xs text-fg-subtle tabular-nums">{{ elapsed }}%</span>
      </div>
      <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface ring-1 ring-line/70 ring-inset" role="img" :aria-label="active ? `${elapsed}% of the plan period has passed` : `Plan closed: ${PIP_STATUS_LABELS[p.status]}`">
        <div :class="['h-full rounded-full', p.overdue ? 'bg-danger' : style.bar]" :style="{ width: `${elapsed}%` }" />
      </div>
      <p :class="['mt-1.5 truncate text-2xs', timing.tone]">{{ timing.text }}</p>
    </div>

    <ul class="mt-3 flex flex-wrap gap-1.5 text-xs" aria-label="Plan details">
      <li class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-fg-muted"><ListChecks :size="12" aria-hidden="true" />{{ plural(p.objectivesCount, 'objective') }}</li>
      <li v-if="p.acknowledged" class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-fg-muted"><Eye :size="12" aria-hidden="true" />Acknowledged</li>
      <li v-else-if="active" class="inline-flex items-center gap-1 rounded-md bg-warning-soft px-2 py-1 text-warning-fg"><EyeOff :size="12" aria-hidden="true" />Not acknowledged yet</li>
    </ul>

    <div class="mt-auto pt-3">
      <div class="flex items-center gap-2 border-t border-line/60 pt-3">
        <template v-if="p.owner">
          <AppAvatar :name="p.owner.name" size="sm" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs font-medium text-fg">{{ p.owner.name }}</p>
            <p class="text-2xs text-fg-subtle">Plan owner</p>
          </div>
        </template>
        <p v-else class="flex-1 text-xs text-fg-subtle">No owner</p>
        <span class="shrink-0 text-2xs text-fg-subtle" :title="formatDate(p.createdAt)">Opened {{ timeAgo(p.createdAt) }}</span>
      </div>
    </div>
  </div>
</template>
