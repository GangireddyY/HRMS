<script setup lang="ts">
import { computed } from 'vue';
import { ArrowDown, Check, Flag, Hourglass, Star, Target, TrendingUp, UserRound } from '@lucide/vue';
import type { ReviewStage } from '@contracts';
import type { ReviewDetail } from '@/modules/performance/types';
import { STAGE_ORDER } from '@/modules/performance/utils/performance-format';
import { RATING_TEXT, todayIso } from '@/modules/performance/utils/performance-ops';
import { AppButton } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/** The review's stages with dates, its key figures, and what this viewer should do next (or who it waits on). */
const props = defineProps<{ review: ReviewDetail }>();
const emit = defineEmits<{ go: [section: string] }>();
const r = computed(() => props.review);
const labels = computed(() => r.value.cycle.ratingLabels ?? []);
const totalWeight = computed(() => r.value.goals.reduce((n, g) => n + g.weight, 0));
const today = todayIso();

const first = (name: string | undefined) => name?.split(' ')[0] ?? '';
const STEP_LABELS: Record<ReviewStage, string> = { GOAL_SETTING: 'Set goals', GOAL_APPROVAL: 'Goal approval', SELF_REVIEW: 'Self-review', MANAGER_REVIEW: 'Manager review', COMPLETED: 'Completed', ACKNOWLEDGED: 'Acknowledged' };
const steps = computed(() => {
  const d = r.value;
  if (!d) return [];
  const at = STAGE_ORDER.indexOf(d.stage);
  const c = d.cycle;
  const when: Partial<Record<ReviewStage, { done: string | null | undefined; due: string | null | undefined }>> = {
    GOAL_SETTING: { done: d.goalsSubmittedAt, due: c.goalsDue },
    GOAL_APPROVAL: { done: d.goalsApprovedAt, due: c.goalsDue },
    SELF_REVIEW: { done: d.self.submittedAt, due: c.selfReviewDue },
    MANAGER_REVIEW: { done: d.manager?.submittedAt, due: c.managerReviewDue },
    ACKNOWLEDGED: { done: d.acknowledgedAt, due: null },
  };
  return STAGE_ORDER.map((s, i) => {
    const state = i < at || d.stage === 'ACKNOWLEDGED' ? 'done' : i === at ? 'current' : 'upcoming';
    const w = when[s];
    const date = state === 'done' ? (w?.done ? `Done ${formatDate(w.done)}` : null) : w?.due && c.status === 'ACTIVE' ? `Due ${formatDate(w.due)}` : null;
    return { key: s, label: STEP_LABELS[s], state, date, late: state !== 'done' && c.status === 'ACTIVE' && !!w?.due && w.due < today };
  });
});

const goalProgress = computed(() => (totalWeight.value ? Math.round((r.value?.goals ?? []).reduce((s, g) => s + g.progress * g.weight, 0) / totalWeight.value) : 0));
const stats = computed(() => {
  const d = r.value!;
  const selfDone = !!d.self.submittedAt;
  const beforeSelf = STAGE_ORDER.indexOf(d.stage) < STAGE_ORDER.indexOf('SELF_REVIEW');
  const rating = d.manager?.rating ?? null;
  return [
    { key: 'goals', label: 'Goals', value: d.goals.length, hint: d.goals.length ? `Weights total ${totalWeight.value}%` : 'None added yet', icon: Target, tone: 'text-accent-fg bg-accent-soft' },
    { key: 'progress', label: 'Goal progress', value: `${goalProgress.value}%`, hint: d.goalsApprovedAt ? 'Weighted by goal importance' : 'Tracked once goals are approved', icon: TrendingUp, tone: goalProgress.value >= 70 ? 'text-success-fg bg-success-soft' : 'text-info-fg bg-info-soft' },
    { key: 'self', label: 'Self-assessment', value: selfDone ? 'Submitted' : beforeSelf ? 'Not started' : 'In progress', hint: selfDone ? formatDate(d.self.submittedAt) : d.cycle.selfReviewDue ? `Due ${formatDate(d.cycle.selfReviewDue)}` : 'No deadline set', icon: UserRound, tone: selfDone ? 'text-success-fg bg-success-soft' : 'text-fg-muted bg-surface-muted' },
    {
      key: 'rating',
      label: 'Overall rating',
      value: rating ? `${rating} / 5` : '—',
      hint: rating ? `${labels.value[rating - 1] ?? ''}${d.manager?.calibratedRating ? ' · calibrated' : ''}` : d.manager?.submittedAt ? 'Not visible yet' : 'After the manager review',
      icon: Star,
      tone: rating ? `${RATING_TEXT[rating]} bg-surface-muted` : 'text-fg-muted bg-surface-muted',
    },
  ];
});

/** What this viewer should do next (or who it is waiting on), for the bar under the stepper. */
const next = computed(() => {
  const d = r.value;
  if (!d) return null;
  const p = d.permissions;
  const emp = first(d.employee.name);
  const rev = d.reviewer ? first(d.reviewer.name) : 'the reviewer';
  const subject = d.viewer.isSubject;
  switch (d.stage) {
    case 'GOAL_SETTING':
      if (p.editGoals && subject) return { you: true, title: d.goalsReturnNote ? 'Update your goals and submit them again' : `Set your goals and submit them to ${rev}`, cta: 'Go to goals', target: 'goals' };
      return { you: !!p.editGoals, title: `${emp} is setting goals`, detail: d.cycle.goalsDue ? `Due ${formatDate(d.cycle.goalsDue)}` : undefined, cta: 'View goals', target: 'goals' };
    case 'GOAL_APPROVAL':
      if (p.approveGoals) return { you: true, title: `Approve ${emp}'s goals`, detail: 'Approve them, edit them, or send them back with a note.', cta: 'Review goals', target: 'goals' };
      return { you: false, title: `Goals are with ${rev} for approval`, detail: d.goalsSubmittedAt ? `Submitted ${formatDate(d.goalsSubmittedAt)}` : undefined, cta: 'View goals', target: 'goals' };
    case 'SELF_REVIEW':
      if (p.selfAssess) return { you: true, title: 'Rate yourself on each goal and competency', detail: d.cycle.selfReviewDue ? `Due ${formatDate(d.cycle.selfReviewDue)}` : 'Save a draft any time, then submit.', cta: 'Start self-review', target: 'self' };
      return { you: false, title: `${emp} is completing the self-assessment`, detail: p.managerAssess ? 'You can draft your review now and submit it once the self-assessment is in.' : undefined, cta: p.managerAssess ? 'Draft your review' : undefined, target: 'manager' };
    case 'MANAGER_REVIEW':
      if (p.submitManagerReview || p.managerAssess) return { you: true, title: `Write your review of ${emp}`, detail: d.cycle.managerReviewDue ? `Due ${formatDate(d.cycle.managerReviewDue)}` : 'Rate each goal and competency.', cta: 'Write review', target: 'manager' };
      return { you: false, title: subject ? `${rev} is writing your review` : `With ${rev} for the manager review`, detail: subject ? "You'll be notified when it's complete and HR releases the results." : undefined, target: 'manager' };
    case 'COMPLETED':
      if (p.acknowledge) return { you: true, title: 'Read your review, then acknowledge it', detail: 'Add a comment if you would like to respond.', cta: 'Read review', target: 'manager' };
      if (subject && !d.cycle.resultsReleased) return { you: false, title: 'Review completed', detail: "Your manager has submitted the review. You'll see the results once HR releases them." };
      if (p.calibrate) return { you: true, title: 'Calibrate the rating if needed', detail: 'Align ratings across teams before HR releases the results.', cta: 'See the review', target: 'manager' };
      return { you: false, title: d.cycle.resultsReleased ? `Waiting for ${emp} to acknowledge` : 'Review completed', detail: d.cycle.resultsReleased ? 'Results are released.' : 'The employee sees it once HR releases the results.', cta: 'See the review', target: 'manager' };
    default:
      return { you: false, title: 'Review closed', detail: d.acknowledgedAt ? `Acknowledged ${formatDate(d.acknowledgedAt)}` : undefined, cta: 'See the review', target: 'manager' };
  }
});
</script>

<template>
  <section class="card mb-4 overflow-hidden" aria-label="Review progress">
    <nav class="scrollbar-none overflow-x-auto border-b border-line/70 px-3 py-3" aria-label="Review stages">
      <ol class="flex min-w-[52rem] items-center gap-1">
        <template v-for="(s, i) in steps" :key="s.key">
          <li class="flex shrink-0 items-center gap-2 rounded-lg px-2 py-1 whitespace-nowrap" :class="s.state === 'current' && 'bg-accent-soft/60 ring-1 ring-brand-500/25 ring-inset'" :aria-current="s.state === 'current' ? 'step' : undefined">
            <span
              :class="[
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                s.state === 'done' ? 'bg-success text-white' : s.state === 'current' ? (s.late ? 'bg-danger text-white' : 'bg-brand-600 text-white') : 'bg-surface-muted text-fg-muted ring-1 ring-line ring-inset',
              ]"
              aria-hidden="true"
            >
              <Check v-if="s.state === 'done'" :size="14" :stroke-width="3" />
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span>
              <span class="block text-sm font-medium" :class="s.state === 'upcoming' ? 'text-fg-muted' : 'text-fg'">{{ s.label }}<span class="sr-only"> ({{ s.state === 'done' ? 'done' : s.state === 'current' ? 'current step' : 'to come' }})</span></span>
              <span v-if="s.date" class="block text-2xs" :class="s.late ? 'font-medium text-danger-fg' : 'text-fg-muted'">{{ s.date }}<template v-if="s.late"> · overdue</template></span>
            </span>
          </li>
          <li v-if="i < steps.length - 1" :class="['h-px min-w-3 flex-1', s.state === 'done' ? 'bg-success/60' : 'bg-line']" aria-hidden="true" />
        </template>
      </ol>
    </nav>

    <div class="grid grid-cols-2 gap-px bg-line/70 xl:grid-cols-4">
      <div v-for="s in stats" :key="s.key" class="flex items-center gap-3 bg-surface px-4 py-3.5 sm:px-5">
        <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg max-sm:hidden', s.tone]" aria-hidden="true"><component :is="s.icon" :size="17" /></span>
        <div class="min-w-0">
          <p class="text-xl leading-6 font-semibold text-fg tabular-nums">{{ s.value }}</p>
          <p class="truncate text-xs font-medium text-fg-muted">{{ s.label }}</p>
          <p class="truncate text-2xs text-fg-subtle">{{ s.hint }}</p>
        </div>
      </div>
    </div>

    <div v-if="next" :class="['flex flex-wrap items-center gap-3 border-t border-line/70 px-5 py-3', next.you ? 'bg-accent-soft/40' : 'bg-surface-muted/50']">
      <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-full', next.you ? 'bg-brand-600 text-white' : 'bg-surface text-fg-muted ring-1 ring-line']" aria-hidden="true">
        <component :is="next.you ? Flag : Hourglass" :size="15" />
      </span>
      <div class="min-w-0 flex-1">
        <p :class="['text-2xs font-semibold tracking-wide uppercase', next.you ? 'text-accent-fg' : 'text-fg-muted']">{{ next.you ? 'Your next step' : 'Waiting on others' }}</p>
        <p class="text-sm font-medium text-fg">{{ next.title }}</p>
        <p v-if="next.detail" class="text-xs text-fg-muted">{{ next.detail }}</p>
      </div>
      <AppButton v-if="next.cta && next.target" size="sm" :variant="next.you ? 'primary' : 'secondary'" :icon-right="ArrowDown" @click="emit('go', next.target)">{{ next.cta }}</AppButton>
    </div>
  </section>
</template>
