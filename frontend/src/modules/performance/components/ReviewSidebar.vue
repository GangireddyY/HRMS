<script setup lang="ts">
import { computed } from 'vue';
import { CalendarDays, MessageSquarePlus, MessageSquareText, Star, UserCog, UserRound, UsersRound } from '@lucide/vue';
import type { ReviewDetail } from '@/modules/performance/types';
import { RATING_FILL, pct, plural, relativeDay, todayIso } from '@/modules/performance/utils/performance-ops';
import { AppAvatar, AppBadge, AppButton, AppCard } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/** Beside the review: the people, the rating scale and weighting, key dates and 360 feedback. */
const props = defineProps<{ review: ReviewDetail }>();
const emit = defineEmits<{ reassign: []; 'request-feedback': [] }>();
const r = computed(() => props.review);
const labels = computed(() => r.value.cycle.ratingLabels ?? []);
const today = todayIso();

const keyDates = computed(() => {
  const c = r.value?.cycle;
  if (!c) return [];
  return [
    { label: 'Review period starts', date: c.periodStart, tone: 'bg-brand-500', deadline: false },
    { label: 'Goals due', date: c.goalsDue, tone: 'bg-warning', deadline: true },
    { label: 'Self-review due', date: c.selfReviewDue, tone: 'bg-info', deadline: true },
    { label: 'Manager review due', date: c.managerReviewDue, tone: 'bg-special', deadline: true },
    { label: 'Review period ends', date: c.periodEnd, tone: 'bg-fg-subtle', deadline: false },
  ].filter((k): k is { label: string; date: string; tone: string; deadline: boolean } => !!k.date);
});
const feedbackGiven = computed(() => (r.value?.feedback ?? []).filter((f) => f.status === 'SUBMITTED').length);
</script>

<template>
<aside class="space-y-4">
  <AppCard title="People" :icon="UsersRound">
    <ul class="space-y-3">
      <li class="flex items-center gap-3">
        <AppAvatar :name="r.employee.name" size="md" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-fg">{{ r.employee.name }}</p>
          <p class="truncate text-xs text-fg-muted">Employee · <span class="font-mono">{{ r.employee.employeeCode }}</span></p>
        </div>
      </li>
      <li class="flex items-center gap-3">
        <AppAvatar v-if="r.reviewer" :name="r.reviewer.name" size="md" />
        <span v-else class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning-fg" aria-hidden="true"><UserCog :size="16" /></span>
        <div class="min-w-0 flex-1">
          <p :class="['truncate text-sm font-medium', r.reviewer ? 'text-fg' : 'text-warning-fg']">{{ r.reviewer?.name ?? 'Not assigned' }}</p>
          <p class="truncate text-xs text-fg-muted">Reviewer<template v-if="r.reviewer"> · <span class="font-mono">{{ r.reviewer.employeeCode }}</span></template></p>
        </div>
        <AppButton v-if="r.permissions.reassign" size="xs" variant="ghost" @click="emit('reassign')">{{ r.reviewer ? 'Change' : 'Assign' }}</AppButton>
      </li>
    </ul>
  </AppCard>

  <AppCard title="Rating scale" :icon="Star" description="Used for goals and competencies">
    <ol class="space-y-1.5">
      <li v-for="n in [5, 4, 3, 2, 1]" :key="n" :class="['flex items-center gap-2.5 rounded-md px-2 py-1 text-sm', r.manager?.rating === n && 'bg-accent-soft/60 ring-1 ring-brand-500/20 ring-inset']">
        <span :class="['flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white tabular-nums', RATING_FILL[n]]" aria-hidden="true">{{ n }}</span>
        <span class="min-w-0 flex-1 truncate text-fg">{{ labels[n - 1] }}</span>
        <span v-if="r.manager?.rating === n" class="text-2xs font-medium text-accent-fg">Final</span>
      </li>
    </ol>
    <div class="mt-4 border-t border-line/70 pt-3">
      <p class="mb-1.5 flex justify-between text-2xs text-fg-muted"><span>Goals {{ r.cycle.goalsWeight }}%</span><span v-if="r.cycle.competencies.length && r.cycle.goalsWeight < 100">Competencies {{ 100 - r.cycle.goalsWeight }}%</span></p>
      <div class="flex h-1.5 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`Score weighting: goals ${r.cycle.goalsWeight}%, competencies ${100 - r.cycle.goalsWeight}%`">
        <span class="h-full bg-brand-500" :style="{ width: `${r.cycle.goalsWeight}%` }" />
        <span class="h-full bg-special" :style="{ width: `${r.cycle.competencies.length ? 100 - r.cycle.goalsWeight : 0}%` }" />
      </div>
    </div>
  </AppCard>

  <AppCard v-if="keyDates.length" title="Key dates" :icon="CalendarDays">
    <ol class="relative space-y-4 border-s border-line ps-5">
      <li v-for="k in keyDates" :key="k.label" class="relative">
        <span :class="['absolute -start-[25.5px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-surface', k.tone]" aria-hidden="true" />
        <p class="text-sm font-medium text-fg">{{ k.label }}</p>
        <p class="text-xs" :class="k.date < today ? 'text-fg-subtle' : 'text-fg-muted'">{{ formatDate(k.date) }} · {{ relativeDay(k.date) }}</p>
      </li>
    </ol>
  </AppCard>

  <AppCard title="360 feedback" :icon="MessageSquareText" :description="r.viewer.isSubject && !r.cycle.resultsReleased ? `${r.feedbackRequested} requested · shared anonymously with your results` : r.feedback.length ? `${feedbackGiven} of ${plural(r.feedback.length, 'request')} answered` : undefined" :padded="false">
    <template v-if="r.permissions.requestFeedback" #actions><AppButton size="sm" variant="secondary" :icon="MessageSquarePlus" @click="emit('request-feedback')">Request</AppButton></template>
    <div v-if="r.feedback.length && !(r.viewer.isSubject && !r.cycle.resultsReleased)" class="border-b border-line/70 px-4 py-2.5">
      <div class="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`${feedbackGiven} of ${r.feedback.length} answered`">
        <div class="h-full rounded-full bg-success" :style="{ width: `${pct(feedbackGiven, r.feedback.length)}%` }" />
      </div>
    </div>
    <p v-if="!r.feedback.length" class="p-4 text-sm text-fg-muted">{{
        r.viewer.isSubject
          ? r.feedbackRequested
            ? 'Feedback from colleagues is shared with you, without their names, when HR releases the results.'
            : 'Ask colleagues you work with for feedback.'
          : r.permissions.requestFeedback
            ? 'Ask colleagues who work with them for feedback. Their names are not shown to the employee.'
            : 'No feedback requested for this review.'
      }}</p>
    <ul v-else class="divide-y divide-line/60">
      <li v-for="f in r.feedback" :key="f.id" class="px-4 py-3 text-sm">
        <div class="flex items-center gap-2.5">
          <AppAvatar v-if="f.giver" :name="f.giver.name" size="sm" />
          <span v-else class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-fg-subtle" aria-hidden="true"><UserRound :size="14" /></span>
          <span class="min-w-0 flex-1 truncate font-medium text-fg">{{ f.giver?.name ?? 'A colleague' }}</span>
          <AppBadge size="sm" dot :tone="f.status === 'SUBMITTED' ? 'success' : f.status === 'DECLINED' ? 'neutral' : 'warning'">{{ f.status === 'SUBMITTED' ? (f.rating ? `Rated ${f.rating}` : 'Given') : f.status === 'DECLINED' ? 'Declined' : 'Requested' }}</AppBadge>
        </div>
        <div v-if="f.status === 'SUBMITTED'" class="mt-2 space-y-2 ps-9.5">
          <div>
            <p class="text-2xs font-semibold tracking-wide text-success-fg uppercase">Strengths</p>
            <p class="text-fg">{{ f.strengths }}</p>
          </div>
          <div>
            <p class="text-2xs font-semibold tracking-wide text-warning-fg uppercase">To improve</p>
            <p class="text-fg">{{ f.improvements }}</p>
          </div>
        </div>
      </li>
    </ul>
  </AppCard>
</aside>
</template>
