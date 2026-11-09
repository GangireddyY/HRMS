<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronRight,
  Flag,
  Hourglass,
  LifeBuoy,
  MessageSquareText,
  Send,
  Target,
  TrendingUp,
  Trophy,
  UsersRound,
} from '@lucide/vue';
import { DEFAULT_RATING_LABELS, type ReviewStage } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { performanceApi } from '@/modules/performance/api/performance.api';
import RatingInput from '@/modules/performance/components/RatingInput.vue';
import type { FeedbackRequest, ReviewRow } from '@/modules/performance/types';
import { PIP_STATUS_LABELS, STAGE_LABELS, STAGE_ORDER, pipTone, stageTone } from '@/modules/performance/utils/performance-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppModal, AppPageHeader, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Self-service performance: the current review and what to do next, goals, feedback colleagues asked for, and any improvement plan. */
const auth = useAuthStore();
const toast = useFeedbackStore();
const reviews = useAsync(() => performanceApi.reviews({ view: 'mine', pageSize: 50 }));
const canGive = computed(() => auth.can('performance.feedback.give'));
const requests = useAsync(() => performanceApi.myFeedback(), { immediate: canGive.value });
const pips = useAsync(() => performanceApi.pips({ view: 'mine', pageSize: 20 }));
const open = computed(() => (requests.data.value ?? []).filter((r) => r.open));
const past = computed(() => (requests.data.value ?? []).filter((r) => !r.open));
const today = new Date().toISOString().slice(0, 10);

// ---- Current review --------------------------------------------------------------------------------------------
const rows = computed(() => reviews.data.value?.items ?? []);
/** The review that needs attention: an active cycle that isn't closed out, else the most recent one. */
const current = computed<ReviewRow | null>(() => rows.value.find((r) => r.cycle.status === 'ACTIVE' && r.stage !== 'ACKNOWLEDGED') ?? rows.value[0] ?? null);
const detail = useAsync(() => performanceApi.review(current.value!.id), { immediate: false });
watch(
  () => current.value?.id,
  (id) => id && void detail.run(),
  { immediate: true },
);
const d = computed(() => (detail.data.value?.id === current.value?.id ? detail.data.value : null));
const labels = computed(() => d.value?.cycle.ratingLabels ?? DEFAULT_RATING_LABELS);
const reviewer = computed(() => d.value?.reviewer ?? current.value?.reviewer ?? null);
const reviewerFirst = computed(() => reviewer.value?.name.split(' ')[0] ?? 'your reviewer');
const firstName = computed(() => auth.user?.firstName ?? d.value?.employee.name.split(' ')[0] ?? '');

const goals = computed(() => d.value?.goals ?? []);
const goalProgress = computed(() => {
  const total = goals.value.reduce((s, g) => s + g.weight, 0);
  return total ? Math.round(goals.value.reduce((s, g) => s + g.progress * g.weight, 0) / total) : 0;
});
const rating = computed(() => d.value?.manager?.rating ?? current.value?.finalRating ?? null);

/** What the employee should do (or is waiting on) at each stage. */
const next = computed(() => {
  const r = current.value;
  if (!r) return null;
  const v = d.value;
  const p = v?.permissions;
  const link = `/me/performance/reviews/${r.id}`;
  const on = (label: string, iso: string | null | undefined) => (iso ? `${label} ${formatDate(iso)}` : null);
  const weight = goals.value.reduce((s, g) => s + g.weight, 0);
  const drafted = goals.value.length ? `${goals.value.length} goal${goals.value.length === 1 ? '' : 's'} drafted · weights total ${weight}%${weight === 100 ? '' : ' (must be 100%)'}` : 'No goals added yet';
  const toRate = `Rate ${goals.value.length} goal${goals.value.length === 1 ? '' : 's'} and ${v?.cycle.competencies.length ?? 0} competencies`;
  switch (r.stage) {
    case 'GOAL_SETTING':
      return v?.goalsReturnNote
        ? { title: 'Your goals were sent back', text: `“${v.goalsReturnNote}” — update them and submit again.`, detail: drafted, cta: 'Update goals', link, you: true }
        : { title: 'Set your goals', text: `Add goals for this period with weights adding up to 100%, then submit them to ${reviewerFirst.value}.`, detail: [drafted, on('due', v?.cycle.goalsDue)].filter(Boolean).join(' · '), cta: 'Set goals', link, you: p?.editGoals ?? true };
    case 'GOAL_APPROVAL':
      return { title: `Goals are with ${reviewerFirst.value}`, text: 'Your reviewer approves them or sends them back with a note.', detail: on('Submitted', v?.goalsSubmittedAt) ?? 'Goals submitted for approval', cta: 'View goals', link, you: false };
    case 'SELF_REVIEW':
      return p?.selfAssess === false
        ? { title: `Waiting for ${reviewerFirst.value}`, text: 'Your self-assessment is in. Your reviewer completes the review next.', detail: on('Self-assessment submitted', v?.self.submittedAt) ?? 'Self-assessment submitted', cta: 'View review', link, you: false }
        : { title: 'Time for your self-review', text: 'Rate yourself on each goal and competency, add a comment, then submit.', detail: [toRate, on('due', v?.cycle.selfReviewDue)].filter(Boolean).join(' · '), cta: 'Start self-review', link, you: true };
    case 'MANAGER_REVIEW':
      return { title: `${reviewerFirst.value} is writing your review`, text: "You'll be notified when it's complete and HR releases the results.", detail: on('Manager review due', v?.cycle.managerReviewDue) ?? on('Self-assessment submitted', v?.self.submittedAt) ?? 'With your reviewer', cta: 'View review', link, you: false };
    case 'COMPLETED':
      return r.cycle.resultsReleased
        ? { title: 'Your results are in', text: 'Read your reviewer’s feedback, then acknowledge the review.', detail: p?.acknowledge ? 'Acknowledge the review to close it' : 'Results released', cta: p?.acknowledge ? 'Read & acknowledge' : 'See results', link, you: !!p?.acknowledge }
        : { title: 'Review complete', text: 'Your reviewer has submitted it. You will see the results once HR releases them.', detail: on('Reviewer submitted', v?.manager?.submittedAt) ?? 'Results not released yet', cta: 'View review', link, you: false };
    default:
      return { title: 'Review closed', text: 'You acknowledged this review. Thanks for taking part.', detail: on('Acknowledged', v?.acknowledgedAt) ?? 'Acknowledged', cta: 'View review', link, you: false };
  }
});

const STEP_LABELS: Record<ReviewStage, string> = {
  GOAL_SETTING: 'Set goals',
  GOAL_APPROVAL: 'Goal approval',
  SELF_REVIEW: 'Self-review',
  MANAGER_REVIEW: 'Manager review',
  COMPLETED: 'Completed',
  ACKNOWLEDGED: 'Acknowledged',
};
const steps = computed(() => {
  const r = current.value;
  if (!r) return [];
  const at = STAGE_ORDER.indexOf(r.stage);
  const c = d.value?.cycle;
  const when: Partial<Record<ReviewStage, { done: string | null | undefined; due: string | null | undefined }>> = {
    GOAL_SETTING: { done: d.value?.goalsSubmittedAt, due: c?.goalsDue },
    GOAL_APPROVAL: { done: d.value?.goalsApprovedAt, due: null },
    SELF_REVIEW: { done: d.value?.self.submittedAt, due: c?.selfReviewDue },
    MANAGER_REVIEW: { done: d.value?.manager?.submittedAt, due: c?.managerReviewDue },
    ACKNOWLEDGED: { done: d.value?.acknowledgedAt, due: null },
  };
  return STAGE_ORDER.map((s, i) => {
    const state = i < at || r.stage === 'ACKNOWLEDGED' ? 'done' : i === at ? 'current' : 'upcoming';
    const w = when[s];
    const date = state === 'done' ? (w?.done ? `Done ${formatDate(w.done)}` : null) : w?.due ? `Due ${formatDate(w.due)}` : null;
    return { key: s, label: STEP_LABELS[s], state, date, late: state !== 'done' && !!w?.due && w.due < today };
  });
});

const keyDates = computed(() => {
  const c = d.value?.cycle;
  if (!c) return [];
  return [
    { label: 'Review period starts', date: c.periodStart, tone: 'bg-brand-500' },
    { label: 'Goals due', date: c.goalsDue, tone: 'bg-sky-500' },
    { label: 'Self-review due', date: c.selfReviewDue, tone: 'bg-info' },
    { label: 'Manager review due', date: c.managerReviewDue, tone: 'bg-violet-500' },
    { label: 'Review period ends', date: c.periodEnd, tone: 'bg-fg-subtle' },
  ].filter((k): k is { label: string; date: string; tone: string } => !!k.date);
});

// ---- Dates -----------------------------------------------------------------------------------------------------
const DAY = 86_400_000;
const rtf = new Intl.RelativeTimeFormat(appLocale(), { numeric: 'auto' });
function relativeDay(iso: string): string {
  const n = Math.round((new Date(`${iso.slice(0, 10)}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / DAY);
  if (Math.abs(n) < 14) return rtf.format(n, 'day');
  if (Math.abs(n) < 60) return rtf.format(Math.round(n / 7), 'week');
  return rtf.format(Math.round(n / 30), 'month');
}

const stats = computed(() => [
  { key: 'goals', label: 'Goals this cycle', value: d.value ? goals.value.length : (current.value?.goals ?? 0), hint: goals.value.length ? `Weights total ${goals.value.reduce((s, g) => s + g.weight, 0)}%` : 'Set with your reviewer', icon: Target, tone: 'text-accent-fg bg-accent-soft' },
  { key: 'progress', label: 'Goal progress', value: `${goalProgress.value}%`, hint: 'Weighted by goal importance', icon: TrendingUp, tone: goalProgress.value >= 70 ? 'text-success-fg bg-success-soft' : 'text-info-fg bg-info-soft' },
  ...(canGive.value
    ? [{ key: 'asks', label: 'Feedback asked of you', value: open.value.length, hint: open.value.length ? 'Colleagues are waiting' : 'All caught up', icon: MessageSquareText, tone: open.value.length ? 'text-warning-fg bg-warning-soft' : 'text-fg-muted bg-surface-muted' }]
    : []),
  { key: 'requested', label: 'Feedback you requested', value: d.value?.feedbackRequested ?? 0, hint: 'From colleagues, for this review', icon: UsersRound, tone: 'text-violet-700 bg-violet-500/10 dark:text-violet-300' },
]);
const CIRC = 2 * Math.PI * 42;

// ---- Feedback --------------------------------------------------------------------------------------------------
const giving = ref<FeedbackRequest | null>(null);
const form = reactive({ rating: null as number | null, strengths: '', improvements: '' });
const busy = ref(false);
function openGive(r: FeedbackRequest) {
  giving.value = r;
  Object.assign(form, { rating: null, strengths: '', improvements: '' });
}
async function give() {
  busy.value = true;
  try {
    await performanceApi.giveFeedback(giving.value!.id, { ...form });
    toast.success('Feedback sent', `Thanks — ${giving.value!.subject.name} will see it anonymously.`);
    giving.value = null;
    await requests.run();
  } catch (e) {
    toast.error('Could not send the feedback', e);
  } finally {
    busy.value = false;
  }
}
async function decline(r: FeedbackRequest) {
  if (!(await toast.confirm({ title: `Decline feedback on ${r.subject.name}?`, message: 'For example if you have not worked together enough.', confirmLabel: 'Decline' }))) return;
  try {
    await performanceApi.declineFeedback(r.id);
    toast.success('Request declined');
    await requests.run();
  } catch (e) {
    toast.error('Could not decline the request', e);
  }
}
const pastLabel = (f: FeedbackRequest) => (f.status === 'SUBMITTED' ? 'Given' : f.status === 'DECLINED' ? 'Declined' : 'Closed');
const pastTone = (f: FeedbackRequest) => (f.status === 'SUBMITTED' ? 'success' : 'neutral');
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Performance" description="Your review and goals, feedback colleagues asked you for, and any improvement plan." />

    <AppSkeleton v-if="reviews.loading.value && !reviews.data.value" :lines="6" />
    <AppErrorState v-else-if="reviews.error.value" :error="reviews.error.value" title="Could not load your reviews" @retry="reviews.run" />
    <div v-else-if="!current" class="card">
      <AppEmptyState :icon="Target" title="No reviews yet" description="When HR starts a review cycle you'll set your goals here, and see each step of your review." />
    </div>
    <template v-else>
      <!-- Current review -->
      <section class="card overflow-hidden" aria-labelledby="review-title">
        <div class="relative flex flex-wrap items-center gap-6 hero-banner px-6 py-6 text-white">
          <div class="relative min-w-0 flex-1 basis-72">
            <p class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
              <Target :size="13" aria-hidden="true" />{{ current.cycle.name }} · {{ STAGE_LABELS[current.stage] }}
            </p>
            <h2 id="review-title" class="mt-3 text-2xl font-semibold tracking-tight">{{ next?.you ? `${next.title}${firstName ? `, ${firstName}` : ''}` : next?.title }}</h2>
            <p class="mt-1 max-w-2xl text-sm text-white/85">{{ next?.text }}</p>
            <ul class="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-white/80">
              <li v-if="d" class="inline-flex items-center gap-1.5"><CalendarDays :size="13" aria-hidden="true" />{{ formatDate(d.cycle.periodStart) }} – {{ formatDate(d.cycle.periodEnd) }}</li>
              <li class="inline-flex items-center gap-1.5"><UsersRound :size="13" aria-hidden="true" />Reviewer: <span class="font-medium text-white">{{ reviewer?.name ?? 'not assigned yet' }}</span></li>
              <li v-if="current.due" class="inline-flex items-center gap-1.5"><CalendarClock :size="13" aria-hidden="true" />Due {{ formatDate(current.due) }} · {{ relativeDay(current.due) }}</li>
            </ul>
          </div>
          <div class="relative flex items-center gap-4">
            <div class="relative h-28 w-28">
              <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" class="stroke-white/20" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke-width="9"
                  stroke-linecap="round"
                  class="stroke-white transition-[stroke-dashoffset] duration-700"
                  :stroke-dasharray="CIRC"
                  :stroke-dashoffset="CIRC * (1 - (rating ? rating / 5 : goalProgress / 100))"
                />
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center">
                <template v-if="rating">
                  <span class="text-2xl font-semibold tabular-nums">{{ rating }}<span class="text-sm font-normal text-white/70">/5</span></span>
                  <span class="text-2xs text-white/80">rating</span>
                </template>
                <template v-else>
                  <span class="text-2xl font-semibold tabular-nums">{{ goalProgress }}%</span>
                  <span class="text-2xs text-white/80">goal progress</span>
                </template>
              </div>
            </div>
            <p v-if="rating" class="max-w-36 text-sm text-white/85"><Trophy :size="16" class="mb-1 block" aria-hidden="true" />{{ labels[rating - 1] }}</p>
            <p v-else class="text-sm text-white/85">
              <span class="block text-2xl font-semibold text-white tabular-nums">{{ d ? goals.length : current.goals }}</span>goal{{ (d ? goals.length : current.goals) === 1 ? '' : 's' }} this cycle
            </p>
          </div>
        </div>

        <!-- Stages -->
        <nav class="scrollbar-none overflow-x-auto border-b border-line/70 px-3 py-3" aria-label="Review stages">
          <ol class="flex min-w-[46rem] items-center gap-1">
            <template v-for="(s, i) in steps" :key="s.key">
              <li class="flex shrink-0 items-center gap-2 rounded-lg px-2 py-1 whitespace-nowrap" :class="s.state === 'current' && 'bg-accent-soft/60 ring-1 ring-brand-500/25 ring-inset'" :aria-current="s.state === 'current' ? 'step' : undefined">
                <span
                  :class="[
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    s.state === 'done' ? 'bg-success text-white' : s.state === 'current' ? 'bg-brand-600 text-white' : 'bg-surface-muted text-fg-muted ring-1 ring-line ring-inset',
                  ]"
                  aria-hidden="true"
                >
                  <Check v-if="s.state === 'done'" :size="14" :stroke-width="3" />
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <span>
                  <span class="block text-sm font-medium" :class="s.state === 'upcoming' ? 'text-fg-muted' : 'text-fg'">{{ s.label }}<span class="sr-only"> ({{ s.state === 'done' ? 'done' : s.state === 'current' ? 'current step' : 'to come' }})</span></span>
                  <span v-if="s.date" class="block text-2xs" :class="s.late ? 'font-medium text-danger-fg' : 'text-fg-muted'">{{ s.date }}</span>
                </span>
              </li>
              <li v-if="i < steps.length - 1" :class="['h-px min-w-3 flex-1', s.state === 'done' ? 'bg-success/60' : 'bg-line']" aria-hidden="true" />
            </template>
          </ol>
        </nav>

        <div class="grid grid-cols-2 gap-px bg-line/70" :class="stats.length === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3'">
          <div v-for="s in stats" :key="s.key" class="flex items-center gap-3 bg-surface px-4 py-3.5 max-xl:odd:last:col-span-2 sm:px-5">
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
            <p class="truncate text-sm font-medium text-fg">{{ next.detail }}</p>
          </div>
          <AppButton size="sm" :variant="next.you ? 'primary' : 'secondary'" :icon-right="ArrowRight" :to="next.link">{{ next.cta }}</AppButton>
        </div>
      </section>
    </template>

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div class="min-w-0 space-y-4">
        <!-- Goals -->
        <AppCard v-if="current" title="Your goals" :icon="Target" :description="current.cycle.name" :padded="false">
          <template #actions>
            <AppButton size="sm" variant="ghost" :icon-right="ChevronRight" :to="`/me/performance/reviews/${current.id}`">Open review</AppButton>
          </template>
          <AppSkeleton v-if="detail.loading.value && !d" class="p-4" :lines="3" />
          <AppErrorState v-else-if="detail.error.value" :error="detail.error.value" title="Could not load your goals" @retry="detail.run" />
          <AppEmptyState v-else-if="!goals.length" compact :icon="Target" title="No goals yet" :description="d?.permissions.editGoals ? 'Add the goals for this period. Weights must add up to 100%.' : 'Goals you agree with your reviewer appear here.'">
            <AppButton v-if="d?.permissions.editGoals" size="sm" :icon-right="ArrowRight" :to="`/me/performance/reviews/${current.id}`">Set goals</AppButton>
          </AppEmptyState>
          <ol v-else class="divide-y divide-line/70">
            <li v-for="(g, i) in goals" :key="g.id" class="flex flex-wrap items-center gap-4 px-4 py-3.5">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-xs font-semibold text-fg-muted tabular-nums" aria-hidden="true">{{ i + 1 }}</span>
              <div class="min-w-0 flex-1 basis-56">
                <p class="text-sm font-medium text-fg">{{ g.title }}</p>
                <p class="truncate text-xs text-fg-muted">
                  <template v-if="g.measure">{{ g.measure }}</template><template v-else>No measure set</template>
                  <template v-if="g.dueDate"> · <span :class="g.dueDate < today && g.progress < 100 ? 'font-medium text-danger-fg' : ''">due {{ formatDate(g.dueDate) }}</span></template>
                </p>
                <p v-if="g.progressNote" class="mt-1 line-clamp-1 text-xs text-fg-subtle">“{{ g.progressNote }}”</p>
              </div>
              <span class="rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-semibold text-fg-muted tabular-nums" :title="`Weight ${g.weight}%`">{{ g.weight }}%<span class="sr-only"> weight</span></span>
              <div class="w-36 shrink-0">
                <div class="mb-1 flex justify-between text-2xs text-fg-muted"><span>Progress</span><span class="font-semibold text-fg tabular-nums">{{ g.progress }}%</span></div>
                <div class="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="g.progress" aria-valuemin="0" aria-valuemax="100" :aria-label="`Progress on ${g.title}`">
                  <div :class="['h-full rounded-full transition-[width] duration-500', g.progress >= 100 ? 'bg-success' : 'bg-brand-500']" :style="{ width: `${g.progress}%` }" />
                </div>
              </div>
            </li>
          </ol>
          <p v-if="d?.permissions.updateProgress && goals.length" class="border-t border-line/70 bg-surface-muted/40 px-4 py-2.5 text-xs text-fg-muted">Keep progress current so your self-review and your reviewer's assessment start from the same picture.</p>
        </AppCard>

        <!-- Feedback asked of you -->
        <section v-if="canGive" class="card" aria-labelledby="asks-title">
          <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-2.5">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><MessageSquareText :size="16" /></span>
            <div class="min-w-0 flex-1">
              <h2 id="asks-title" class="text-sm font-semibold text-fg">Feedback asked of you</h2>
              <p class="text-xs text-fg-muted">Colleagues' reviews. They see your feedback without your name.</p>
            </div>
            <AppBadge v-if="open.length" tone="warning" dot>{{ open.length }} waiting</AppBadge>
          </header>
          <AppSkeleton v-if="requests.loading.value && !requests.data.value" class="p-4" :lines="2" />
          <AppErrorState v-else-if="requests.error.value" :error="requests.error.value" @retry="requests.run" />
          <AppEmptyState v-else-if="!requests.data.value?.length" :icon="MessageSquareText" title="No feedback requests" description="Colleagues can ask you for feedback during a review cycle. Requests show up here." compact />
          <template v-else>
            <ul v-if="open.length" class="divide-y divide-line/70">
              <li v-for="f in open" :key="f.id" class="relative flex flex-wrap items-center gap-3 px-4 py-3.5">
                <span class="absolute inset-y-0 start-0 w-1 bg-warning" aria-hidden="true" />
                <AppAvatar :name="f.subject.name" size="md" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-fg">{{ f.subject.name }}</p>
                  <p class="truncate text-xs text-fg-muted">{{ f.cycle.name }} · asked {{ relativeDay(f.createdAt) }}</p>
                </div>
                <AppButton size="sm" variant="ghost" @click="decline(f)">Decline</AppButton>
                <AppButton size="sm" :icon="Send" @click="openGive(f)">Give feedback</AppButton>
              </li>
            </ul>
            <template v-if="past.length">
              <h3 class="border-y border-line/60 bg-surface-muted/50 px-4 py-1.5 text-2xs font-semibold tracking-wide text-fg-muted uppercase" :class="!open.length && 'border-t-0'">Earlier</h3>
              <ul class="divide-y divide-line/70">
                <li v-for="f in past" :key="f.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
                  <AppAvatar :name="f.subject.name" size="sm" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm text-fg">{{ f.subject.name }}</p>
                    <p class="truncate text-xs text-fg-muted">{{ f.cycle.name }} · {{ f.submittedAt ? `sent ${formatDate(f.submittedAt)}` : `asked ${formatDate(f.createdAt)}` }}</p>
                  </div>
                  <AppBadge size="sm" :tone="pastTone(f)" dot>{{ pastLabel(f) }}</AppBadge>
                </li>
              </ul>
            </template>
          </template>
        </section>

        <!-- Improvement plans -->
        <AppCard v-if="pips.data.value?.items.length" title="Improvement plans" :icon="LifeBuoy" description="Agreed objectives and check-ins with your manager." :padded="false">
          <ul class="divide-y divide-line/70">
            <li v-for="p in pips.data.value.items" :key="p.id">
              <RouterLink :to="`/me/performance/pips/${p.id}`" class="flex flex-wrap items-center gap-3 px-4 py-3.5 transition hover:bg-surface-muted/50">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning-fg" aria-hidden="true"><LifeBuoy :size="16" /></span>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-fg">{{ formatDate(p.startDate) }} – {{ formatDate(p.endDate) }}</p>
                  <p class="text-xs text-fg-muted">{{ p.objectivesCount }} objective{{ p.objectivesCount === 1 ? '' : 's' }} · with {{ p.owner?.name ?? 'your manager' }}<template v-if="p.status === 'ACTIVE'"> · ends {{ relativeDay(p.endDate) }}</template></p>
                </div>
                <AppBadge v-if="!p.acknowledged" size="sm" tone="warning">Not acknowledged yet</AppBadge>
                <AppBadge :tone="pipTone[p.status]" dot>{{ PIP_STATUS_LABELS[p.status] }}</AppBadge>
                <ChevronRight :size="16" class="text-fg-subtle" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
        </AppCard>
      </div>

      <aside v-if="current" class="space-y-4">
        <AppCard title="Your reviewer">
          <div v-if="reviewer" class="flex items-center gap-3">
            <AppAvatar :name="reviewer.name" size="md" />
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-fg">{{ reviewer.name }}</p>
              <p class="text-xs text-fg-muted">Reviewer · <span class="font-mono">{{ reviewer.employeeCode }}</span></p>
            </div>
          </div>
          <p v-else class="text-sm text-fg-muted">HR will assign a reviewer for this cycle.</p>
          <p v-if="reviewer" class="mt-3 rounded-md bg-surface-muted/70 px-3 py-2 text-xs text-fg-muted">Approves your goals and writes your review. Check in with {{ reviewerFirst }} on progress during the cycle.</p>
        </AppCard>

        <AppCard v-if="keyDates.length" title="Key dates">
          <ol class="relative space-y-4 border-s border-line ps-5">
            <li v-for="k in keyDates" :key="k.label" class="relative">
              <span :class="['absolute -start-[25.5px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-surface', k.tone]" aria-hidden="true" />
              <p class="text-sm font-medium text-fg">{{ k.label }}</p>
              <p class="text-xs" :class="k.date < today ? 'text-fg-subtle' : 'text-fg-muted'">{{ formatDate(k.date) }} · {{ relativeDay(k.date) }}</p>
            </li>
          </ol>
        </AppCard>

        <AppCard title="All reviews" :padded="false">
          <ul class="divide-y divide-line/70">
            <li v-for="r in rows" :key="r.id">
              <RouterLink :to="`/me/performance/reviews/${r.id}`" class="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-muted/50" :aria-current="r.id === current.id ? 'true' : undefined">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-fg">{{ r.cycle.name }}</p>
                  <p class="truncate text-xs text-fg-muted">
                    {{ r.goals }} goal{{ r.goals === 1 ? '' : 's' }}<template v-if="r.finalRating"> · rated {{ r.finalRating }}</template><template v-if="r.due"> · <span :class="r.due < today && 'text-danger-fg'">due {{ formatDate(r.due) }}</span></template>
                  </p>
                  <AppBadge class="mt-1.5" size="sm" :tone="stageTone[r.stage]" dot>{{ STAGE_LABELS[r.stage] }}</AppBadge>
                </div>
                <ChevronRight :size="16" class="shrink-0 text-fg-subtle" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
        </AppCard>
      </aside>
    </div>

    <AppModal :open="!!giving" :title="giving ? `Feedback for ${giving.subject.name}` : ''" description="Be specific and kind. The employee sees it without your name; their reviewer and HR see who wrote it." @close="giving = null">
      <div v-if="giving" class="space-y-5">
        <div class="flex items-center gap-3 rounded-lg bg-surface-muted/60 p-3">
          <AppAvatar :name="giving.subject.name" size="lg" />
          <div class="min-w-0">
            <p class="truncate font-semibold text-fg">{{ giving.subject.name }}</p>
            <p class="truncate text-xs text-fg-muted">{{ giving.cycle.name }} · asked {{ formatDate(giving.createdAt) }}</p>
          </div>
        </div>
        <div>
          <p class="label">Overall (optional)</p>
          <RatingInput v-model="form.rating" :labels="DEFAULT_RATING_LABELS" label="Overall rating" />
        </div>
        <AppTextarea v-model="form.strengths" label="What they do well" required :rows="3" :maxlength="2000" placeholder="A specific example of something they did well, and its impact." help="At least 10 characters." />
        <AppTextarea v-model="form.improvements" label="What they could do better" required :rows="3" :maxlength="2000" placeholder="One or two things that would make them even more effective." help="At least 10 characters." />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="giving = null">Cancel</AppButton>
        <AppButton :icon="Send" :loading="busy" :disabled="form.strengths.trim().length < 10 || form.improvements.trim().length < 10" @click="give">Send feedback</AppButton>
      </template>
    </AppModal>
  </div>
</template>
