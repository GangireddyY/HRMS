<script setup lang="ts">
import { computed } from 'vue';
import { CalendarClock, CalendarDays, ChevronRight, CircleCheck, CircleX, IdCard } from '@lucide/vue';
import type { CaseSummary } from '@/modules/onboarding/types';
import { STAGE_LABELS, caseStage, daysFromToday, joinRelative, stageTone } from '@/modules/onboarding/utils/onboarding-format';
import { AppAvatar, AppBadge } from '@/shared/components';
import { formatDate, timeAgo } from '@/shared/utils/format';
import { profileCover } from '@/shared/utils/profile-cover';

/** A joiner's onboarding in the grid, as a profile card: where they are in the journey, checklist progress and what needs attention. */
const props = defineProps<{ onboarding: CaseSummary }>();

const c = computed(() => props.onboarding);
const open = computed(() => c.value.status === 'IN_PROGRESS');
const stage = computed(() => caseStage(c.value));
const role = computed(() => [c.value.employee.designation?.name, c.value.employee.department?.name].filter(Boolean).join(' · ') || 'No role on file');
const pct = computed(() => (c.value.progress.total ? Math.round((c.value.progress.done / c.value.progress.total) * 100) : 0));
const when = computed(() => {
  if (c.value.completedAt) return { icon: CircleCheck, text: `Completed ${formatDate(c.value.completedAt)}`, tone: 'text-success-fg' };
  if (c.value.cancelledAt) return { icon: CircleX, text: `Cancelled ${formatDate(c.value.cancelledAt)}`, tone: 'text-fg-muted' };
  return { icon: CalendarClock, text: joinRelative(c.value.joiningDate), tone: daysFromToday(c.value.joiningDate) > 0 ? 'text-info-fg' : 'text-fg-muted' };
});
const flags = computed(() => open.value && (c.value.progress.overdue > 0 || c.value.progress.awaitingVerification > 0 || !c.value.progress.requiredOpen));
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="relative -mx-4 -mt-4 h-14 border-b border-line/50" :style="profileCover(c.employee.id)">
      <span :class="['absolute end-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-2xs font-medium shadow-xs backdrop-blur-sm', when.tone]">
        <component :is="when.icon" :size="11" aria-hidden="true" />{{ when.text }}
      </span>
    </div>
    <div class="relative z-10 -mt-7 flex items-end justify-between gap-2">
      <span class="rounded-full bg-surface p-0.5"><AppAvatar :name="c.employee.name" size="lg" /></span>
      <AppBadge class="mb-1" :tone="stageTone[stage]" size="sm" dot>{{ STAGE_LABELS[stage] }}</AppBadge>
    </div>

    <h3 class="mt-2 truncate text-sm font-semibold text-fg">{{ c.employee.name }}</h3>
    <p class="truncate text-xs text-fg-muted" :title="role">{{ role }}</p>

    <ul class="mt-3 flex flex-wrap gap-1.5 text-xs" aria-label="Joining details">
      <li class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-fg-muted">
        <CalendarDays :size="12" aria-hidden="true" />{{ daysFromToday(c.joiningDate) > 0 ? 'Joins' : 'Joined' }} {{ formatDate(c.joiningDate) }}
      </li>
      <li class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 font-mono text-fg-muted"><IdCard :size="12" aria-hidden="true" />{{ c.employee.employeeCode }}</li>
    </ul>

    <div class="mt-4">
      <div class="mb-1.5 flex items-baseline justify-between text-xs">
        <span class="font-medium text-fg-muted">Checklist</span>
        <span class="text-fg-subtle tabular-nums"><span class="font-semibold text-fg">{{ pct }}%</span> · {{ c.progress.done }}/{{ c.progress.total }} tasks</span>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100" :aria-label="`${c.employee.name}: checklist progress`">
        <div :class="['h-full rounded-full transition-all', pct === 100 || stage === 'ready' ? 'bg-success' : 'bg-brand-500']" :style="{ width: `${pct}%` }" />
      </div>
      <div v-if="flags" class="mt-2.5 flex flex-wrap gap-1.5">
        <AppBadge v-if="c.progress.overdue" tone="danger" size="sm" dot>{{ c.progress.overdue }} overdue</AppBadge>
        <AppBadge v-if="c.progress.awaitingVerification" tone="warning" size="sm" dot>{{ c.progress.awaitingVerification }} to verify</AppBadge>
        <AppBadge v-if="!c.progress.requiredOpen" tone="success" size="sm" dot>Ready to complete</AppBadge>
      </div>
      <p v-else-if="open" class="mt-2.5 inline-flex items-center gap-1 text-2xs text-fg-subtle"><CircleCheck :size="11" aria-hidden="true" />On track, nothing overdue</p>
    </div>

    <div class="mt-auto pt-3">
      <div class="flex items-center gap-2 border-t border-line/60 pt-3 text-2xs text-fg-subtle">
        <span :title="formatDate(c.createdAt)">Started {{ timeAgo(c.createdAt) }}</span>
        <span class="ms-auto inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-accent-fg opacity-0 transition group-hover/card:opacity-100 group-focus-visible/card:opacity-100">
          Open checklist <ChevronRight :size="13" aria-hidden="true" />
        </span>
      </div>
    </div>
  </div>
</template>
