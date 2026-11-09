<script setup lang="ts">
import { computed } from 'vue';
import { AlertCircle, ArrowRight, CalendarClock, CheckCircle2, ListChecks, Repeat, UserRound } from '@lucide/vue';
import RatingChip from '@/modules/performance/components/RatingChip.vue';
import StageTrack from '@/modules/performance/components/StageTrack.vue';
import type { ReviewRow } from '@/modules/performance/types';
import { STAGE_LABELS, STAGE_ORDER, stageTone } from '@/modules/performance/utils/performance-format';
import { RATING_FILL, plural, relativeDay, todayIso } from '@/modules/performance/utils/performance-ops';
import { AppAvatar, AppBadge } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/**
 * A review in the grid: who is reviewed and by whom, where it is in the workflow with its deadline, and the final rating.
 * `showCycle` adds the cycle (lists across cycles); `mine` flags the step waiting on the viewer as reviewer.
 */
const props = withDefaults(defineProps<{ review: ReviewRow; labels?: string[]; showCycle?: boolean; showReviewer?: boolean; mine?: boolean }>(), { labels: undefined, showReviewer: true });

const r = computed(() => props.review);
const today = todayIso();
const overdue = computed(() => !!r.value.due && r.value.due < today);
const finished = computed(() => r.value.stage === 'COMPLETED' || r.value.stage === 'ACKNOWLEDGED');
const step = computed(() => STAGE_ORDER.indexOf(r.value.stage) + 1);
const subtitle = computed(() => [r.value.employee.designation, r.value.employee.department].filter(Boolean).join(' · ') || r.value.employee.employeeCode);
const yourTurn = computed(() => (!props.mine ? null : r.value.stage === 'GOAL_APPROVAL' ? 'Approve goals' : r.value.stage === 'MANAGER_REVIEW' ? 'Write the review' : null));
const due = computed(() => {
  const d = r.value.due;
  if (d) return { icon: overdue.value ? AlertCircle : CalendarClock, text: overdue.value ? `Overdue · ${relativeDay(d)}` : `Due ${formatDate(d)} · ${relativeDay(d)}`, tone: overdue.value ? 'font-medium text-danger-fg' : 'text-fg-muted' };
  if (finished.value) return { icon: CheckCircle2, text: 'Done', tone: 'text-success-fg' };
  return { icon: CalendarClock, text: 'No deadline', tone: 'text-fg-subtle' };
});
const facts = computed(() => [props.showCycle ? 'cycle' : 'reviewer', props.showCycle && props.showReviewer ? 'reviewer' : 'goals'] as const);
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <AppAvatar :name="r.employee.name" size="md" />
      <div class="min-w-0 flex-1">
        <h3 class="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <span class="truncate">{{ r.employee.name }}</span>
          <AlertCircle v-if="overdue" :size="14" class="shrink-0 text-danger-fg" aria-hidden="true" />
        </h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted">{{ subtitle }}</p>
      </div>
      <span class="shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5 text-2xs text-fg-subtle tabular-nums">Step {{ step }}/{{ STAGE_ORDER.length }}</span>
    </div>

    <div class="rounded-lg bg-surface-muted/50 px-3 py-2.5">
      <div class="flex items-center justify-between gap-2">
        <AppBadge class="min-w-0" :tone="stageTone[r.stage]" size="sm" dot><span class="truncate">{{ STAGE_LABELS[r.stage] }}</span></AppBadge>
        <StageTrack class="shrink-0" :stage="r.stage" :overdue="overdue" />
      </div>
      <p :class="['mt-2 flex items-center gap-1.5 text-xs', due.tone]">
        <component :is="due.icon" :size="13" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ due.text }}</span>
      </p>
      <p v-if="yourTurn" class="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-accent-fg">
        <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />Your turn: {{ yourTurn.toLowerCase() }}
      </p>
    </div>

    <dl class="grid grid-cols-2 gap-2">
      <div v-for="f in facts" :key="f" class="min-w-0 rounded-lg bg-surface-muted/50 px-3 py-2">
        <template v-if="f === 'cycle'">
          <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><Repeat :size="11" aria-hidden="true" />Cycle</dt>
          <dd class="mt-0.5 truncate text-xs font-medium text-fg" :title="r.cycle.name">{{ r.cycle.name }}</dd>
        </template>
        <template v-else-if="f === 'reviewer'">
          <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><UserRound :size="11" aria-hidden="true" />Reviewer</dt>
          <dd v-if="r.reviewer" class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg"><AppAvatar :name="r.reviewer.name" size="xs" /><span class="truncate">{{ r.reviewer.name }}</span></dd>
          <dd v-else class="mt-0.5 flex items-center gap-1 text-xs font-medium text-warning-fg"><AlertCircle :size="12" aria-hidden="true" />Not assigned</dd>
        </template>
        <template v-else>
          <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><ListChecks :size="11" aria-hidden="true" />Goals</dt>
          <dd :class="['mt-0.5 text-xs font-medium tabular-nums', r.goals ? 'text-fg' : 'text-fg-subtle']">{{ r.goals ? plural(r.goals, 'goal') : 'None set yet' }}</dd>
        </template>
      </div>
    </dl>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <span class="shrink-0 text-2xs text-fg-subtle">Final rating</span>
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <template v-if="r.finalRating">
          <RatingChip v-if="labels" :rating="r.finalRating" :labels="labels" />
          <span v-else class="inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-1.5 py-0.5 text-xs ring-1 ring-line ring-inset">
            <span :class="['h-2 w-2 rounded-full', RATING_FILL[r.finalRating]]" aria-hidden="true" />
            <span class="font-semibold text-fg tabular-nums">{{ r.finalRating }}</span><span class="text-2xs text-fg-subtle">/5</span>
          </span>
          <span v-if="r.calibrated" class="truncate text-2xs text-fg-muted">calibrated</span>
        </template>
        <span v-else class="text-xs text-fg-subtle">Not rated yet</span>
      </div>
      <ArrowRight :size="15" class="shrink-0 text-fg-subtle transition group-hover/card:translate-x-0.5 group-hover/card:text-accent-fg" aria-hidden="true" />
    </div>
  </div>
</template>
