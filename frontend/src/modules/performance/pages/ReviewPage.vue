<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  ArrowDown,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardList,
  Flag,
  Gauge,
  Hourglass,
  MessageSquarePlus,
  MessageSquareText,
  Pencil,
  PenLine,
  Plus,
  Quote,
  Scale,
  Send,
  Star,
  Target,
  Trash2,
  TrendingUp,
  Undo2,
  UserCog,
  UserRound,
  UsersRound,
} from '@lucide/vue';
import type { ReviewStage } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import ColleaguePicker from '@/modules/performance/components/ColleaguePicker.vue';
import GoalFormModal from '@/modules/performance/components/GoalFormModal.vue';
import RatingChip from '@/modules/performance/components/RatingChip.vue';
import RatingInput from '@/modules/performance/components/RatingInput.vue';
import type { CompetencyRating, Goal, ReviewDetail } from '@/modules/performance/types';
import { STAGE_LABELS, STAGE_ORDER, ratingText, stageTone } from '@/modules/performance/utils/performance-format';
import { RATING_FILL, RATING_TEXT, pct, plural, relativeDay, todayIso } from '@/modules/performance/utils/performance-ops';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppErrorState, AppInput, AppModal, AppPageHeader, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/**
 * One performance review, for the employee (own review, from /me), the reviewer and HR: workflow stepper, goals,
 * self-assessment, manager review with live scoring, 360 feedback, calibration and acknowledgement.
 */
const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const inHr = computed(() => route.path.startsWith('/hr'));
const review = useAsync(() => performanceApi.review(id.value));
watch(id, () => void review.run());
const r = computed(() => review.data.value);
const labels = computed(() => r.value?.cycle.ratingLabels ?? []);
const totalWeight = computed(() => (r.value?.goals ?? []).reduce((n, g) => n + g.weight, 0));
const today = todayIso();

const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<ReviewDetail>, success: string, description?: string) {
  busy.value = key;
  try {
    review.data.value = await fn();
    feedback.success(success, description);
    return true;
  } catch (e) {
    feedback.error('Could not complete the action', e);
    return false;
  } finally {
    busy.value = null;
  }
}

// Goals
const goalOpen = ref(false);
const editingGoal = ref<Goal | null>(null);
function openGoal(g: Goal | null) {
  editingGoal.value = g;
  goalOpen.value = true;
}
function onGoalSaved(next: ReviewDetail) {
  goalOpen.value = false;
  review.data.value = next;
  feedback.success('Goal saved');
}
async function removeGoal(g: Goal) {
  if (!(await feedback.confirm({ title: `Remove "${g.title}"?`, message: 'The goal is deleted from this review.', confirmLabel: 'Remove', danger: true }))) return;
  await act(`goal-${g.id}`, () => performanceApi.removeGoal(id.value, g.id), 'Goal removed');
}
const returnOpen = ref(false);
const returnNote = ref('');
const progressFor = ref<Goal | null>(null);
const progress = reactive({ value: 0 as number | string, note: '' });
function openProgress(g: Goal) {
  progressFor.value = g;
  Object.assign(progress, { value: g.progress, note: g.progressNote ?? '' });
}
async function saveProgress() {
  const g = progressFor.value!;
  progressFor.value = null;
  await act('progress', () => performanceApi.progress(id.value, g.id, Math.min(100, Math.max(0, Number(progress.value) || 0)), progress.note || null), 'Progress updated');
}

// Assessments (self and manager share the same shape)
interface FormState {
  goals: Record<string, { rating: number | null; comment: string }>;
  competencies: Record<string, { rating: number | null; comment: string }>;
  comment: string;
  strengths: string;
  improvements: string;
  finalRating: number | null;
}
const blank = (): FormState => ({ goals: {}, competencies: {}, comment: '', strengths: '', improvements: '', finalRating: null });
const selfForm = reactive<FormState>(blank());
const managerForm = reactive<FormState>(blank());
function fill(form: FormState, d: ReviewDetail, who: 'self' | 'manager') {
  const comps: CompetencyRating[] = who === 'self' ? d.self.competencies : (d.manager?.competencies ?? []);
  Object.assign(form, blank(), {
    goals: Object.fromEntries(d.goals.map((g) => [g.id, { rating: who === 'self' ? g.selfRating : g.managerRating, comment: (who === 'self' ? g.selfComment : g.managerComment) ?? '' }])),
    competencies: Object.fromEntries(d.cycle.competencies.map((k) => [k.key, { rating: comps.find((c) => c.key === k.key)?.rating ?? null, comment: comps.find((c) => c.key === k.key)?.comment ?? '' }])),
    comment: (who === 'self' ? d.self.comment : d.manager?.comment) ?? '',
    strengths: d.manager?.strengths ?? '',
    improvements: d.manager?.improvements ?? '',
    finalRating: d.manager?.finalRating ?? null,
  });
}
watch(
  r,
  (d) => {
    if (!d) return;
    fill(selfForm, d, 'self');
    fill(managerForm, d, 'manager');
  },
  { immediate: true },
);
const payload = (form: FormState, submit: boolean) => ({
  goals: Object.entries(form.goals).map(([goalId, v]) => ({ goalId, rating: v.rating, comment: v.comment || null })),
  competencies: Object.entries(form.competencies).map(([key, v]) => ({ key, rating: v.rating, comment: v.comment || null })),
  comment: form.comment || null,
  submit,
});
const complete = (form: FormState) => Object.values(form.goals).every((g) => g.rating) && Object.values(form.competencies).every((c) => c.rating);
/** Ratings given / ratings needed, for the progress line above a form's buttons. */
const rated = (form: FormState) => {
  const all = [...Object.values(form.goals), ...Object.values(form.competencies)];
  return { done: all.filter((x) => x.rating).length, total: all.length };
};
async function saveSelf(submit: boolean) {
  if (submit && !(await feedback.confirm({ title: 'Submit your self-assessment?', message: 'Your reviewer is notified. You can still update goal progress, but not your ratings.', confirmLabel: 'Submit' }))) return;
  await act(submit ? 'self-submit' : 'self-save', () => performanceApi.selfAssessment(id.value, payload(selfForm, submit)), submit ? 'Self-assessment submitted' : 'Draft saved');
}

/** Live preview of the scores the server computes on submission. */
const preview = computed(() => {
  const d = r.value;
  if (!d) return null;
  const goals = d.goals.map((g) => ({ weight: g.weight, rating: managerForm.goals[g.id]?.rating ?? null }));
  const gs = goals.length && goals.every((g) => g.rating) ? goals.reduce((n, g) => n + g.weight * g.rating!, 0) / goals.reduce((n, g) => n + g.weight, 0) : null;
  const comps = Object.values(managerForm.competencies).map((c) => c.rating);
  const cs = comps.length && comps.every((x) => x) ? comps.reduce((n: number, x) => n + x!, 0) / comps.length : null;
  const hasComps = d.cycle.competencies.length > 0;
  const w = d.cycle.goalsWeight;
  const overall = !hasComps || w === 100 ? gs : w === 0 ? cs : gs !== null && cs !== null ? (gs * w + cs * (100 - w)) / 100 : null;
  const round = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
  return { goalScore: round(gs), competencyScore: round(cs), overall: round(overall), suggested: overall === null ? null : Math.min(5, Math.max(1, Math.floor(overall + 0.5))) };
});
async function saveManager(submit: boolean) {
  if (submit && !(await feedback.confirm({ title: `Submit your review of ${r.value!.employee.name}?`, message: 'The review is completed and scored. The employee sees it once HR releases the results.', confirmLabel: 'Submit review' }))) return;
  await act(submit ? 'mgr-submit' : 'mgr-save', () => performanceApi.managerReview(id.value, { ...payload(managerForm, submit), strengths: managerForm.strengths || null, improvements: managerForm.improvements || null, finalRating: managerForm.finalRating }), submit ? 'Review submitted' : 'Draft saved');
}

// Feedback, calibration, reviewer, acknowledgement
const requestOpen = ref(false);
const requestIds = ref<string[]>([]);
async function requestFeedback() {
  requestOpen.value = false;
  if (await act('request', () => performanceApi.requestFeedback(id.value, requestIds.value), 'Feedback requested', 'Your colleagues have been notified.')) requestIds.value = [];
}
const calibrateOpen = ref(false);
const calibration = reactive({ rating: null as number | null, note: '' });
async function calibrate() {
  calibrateOpen.value = false;
  await act('calibrate', () => performanceApi.calibrate(id.value, calibration.rating!, calibration.note), 'Rating calibrated');
}
const reassignOpen = ref(false);
const newReviewer = ref<string | null>(null);
async function reassign() {
  reassignOpen.value = false;
  await act('reassign', () => performanceApi.reassign(id.value, newReviewer.value!), 'Reviewer assigned');
}
const ackOpen = ref(false);
const ackComment = ref('');
async function acknowledge() {
  ackOpen.value = false;
  await act('ack', () => performanceApi.acknowledge(id.value, ackComment.value || null), 'Review acknowledged');
}

// ---- Workflow summary ------------------------------------------------------------------------------------------
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

function scrollTo(section: string) {
  document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
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
const selfComp = (key: string) => r.value?.self.competencies.find((c) => c.key === key)?.rating ?? null;
const mgrComp = (key: string) => r.value?.manager?.competencies.find((c) => c.key === key) ?? null;
const feedbackGiven = computed(() => (r.value?.feedback ?? []).filter((f) => f.status === 'SUBMITTED').length);
</script>

<template>
  <div>
    <AppSkeleton v-if="review.loading.value && !r" :lines="10" />
    <AppErrorState v-else-if="review.error.value" :error="review.error.value" title="This review isn't available" @retry="review.run" />
    <template v-else-if="r">
      <AppPageHeader
        :title="r.viewer.isSubject ? `My review · ${r.cycle.name}` : r.employee.name"
        :description="r.viewer.isSubject ? `${formatDate(r.cycle.periodStart)} – ${formatDate(r.cycle.periodEnd)}` : `${r.cycle.name}${r.employee.designation ? ` · ${r.employee.designation}` : ''}${r.employee.department ? ` · ${r.employee.department}` : ''}`"
        :back="inHr ? '/hr/performance/reviews' : '/me/performance'"
        :back-label="inHr ? 'Reviews' : 'Performance'"
      >
        <template v-if="!r.viewer.isSubject" #leading><AppAvatar :name="r.employee.name" size="xl" /></template>
        <template #badges>
          <AppBadge :tone="stageTone[r.stage]" dot>{{ STAGE_LABELS[r.stage] }}</AppBadge>
          <AppBadge v-if="r.cycle.status === 'CLOSED'">Cycle closed</AppBadge>
          <AppBadge v-if="r.manager?.calibratedRating" tone="violet">Calibrated</AppBadge>
        </template>
        <template #actions>
          <AppButton v-if="r.permissions.reassign" variant="secondary" :icon="UserCog" @click="newReviewer = null; reassignOpen = true">{{ r.reviewer ? 'Change reviewer' : 'Assign reviewer' }}</AppButton>
          <AppButton v-if="r.permissions.calibrate" variant="secondary" :icon="Scale" @click="calibration.rating = r.manager?.rating ?? null; calibration.note = ''; calibrateOpen = true">Calibrate</AppButton>
          <AppButton v-if="inHr && !r.viewer.isSubject && (r.viewer.isReviewer || r.viewer.isHr) && (r.stage === 'COMPLETED' || r.stage === 'ACKNOWLEDGED')" variant="secondary" :icon="TrendingUp" :to="`/hr/performance/cycles/${r.cycle.id}/hikes`">Salary increase</AppButton>
          <AppButton v-if="r.permissions.acknowledge" :icon="Check" @click="ackComment = ''; ackOpen = true">Acknowledge</AppButton>
        </template>
      </AppPageHeader>

      <!-- Workflow -->
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
          <AppButton v-if="next.cta && next.target" size="sm" :variant="next.you ? 'primary' : 'secondary'" :icon-right="ArrowDown" @click="scrollTo(next.target)">{{ next.cta }}</AppButton>
        </div>
      </section>

      <div v-if="(r.stage === 'GOAL_SETTING' && r.goalsReturnNote) || (r.viewer.isSubject && !r.reviewer)" class="mb-4 space-y-3">
        <AppAlert v-if="r.stage === 'GOAL_SETTING' && r.goalsReturnNote" tone="warning" title="Goals sent back">{{ r.goalsReturnNote }}</AppAlert>
        <AppAlert v-if="r.viewer.isSubject && !r.reviewer" tone="warning" title="No reviewer yet">Your HR team needs to assign a reviewer before you can submit goals.</AppAlert>
      </div>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div class="min-w-0 space-y-4">
          <!-- Goals -->
          <section id="goals" class="card scroll-mt-4 overflow-hidden" aria-labelledby="goals-title">
            <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-2.5">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><Target :size="16" /></span>
              <div class="min-w-0 flex-1">
                <h2 id="goals-title" class="flex items-center gap-2 text-sm font-semibold text-fg">Goals <AppBadge size="sm">{{ r.goals.length }}</AppBadge></h2>
                <p class="text-xs text-fg-muted">
                  {{ r.goalsApprovedAt ? `Approved ${formatDate(r.goalsApprovedAt)}` : r.goalsSubmittedAt ? `Submitted ${formatDate(r.goalsSubmittedAt)}` : 'Not submitted yet' }}<template v-if="r.cycle.goalsDue"> · due {{ formatDate(r.cycle.goalsDue) }}</template>
                </p>
              </div>
              <AppButton v-if="r.permissions.editGoals" size="sm" variant="secondary" :icon="Plus" @click="openGoal(null)">Add goal</AppButton>
            </header>
            <div v-if="!r.goals.length" class="flex flex-col items-center px-6 py-10 text-center">
              <span class="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent-fg" aria-hidden="true"><Target :size="20" /></span>
              <p class="text-sm font-medium text-fg">No goals yet</p>
              <p class="mt-1 max-w-sm text-sm text-fg-muted">{{ r.permissions.editGoals ? 'Add the goals for this period. Weights must add up to 100%.' : r.viewer.isSubject ? 'Your goals appear here once added.' : `${first(r.employee.name)} hasn't added goals yet.` }}</p>
              <AppButton v-if="r.permissions.editGoals" class="mt-4" size="sm" :icon="Plus" @click="openGoal(null)">Add the first goal</AppButton>
            </div>
            <ol v-else class="divide-y divide-line/70">
              <li v-for="(g, i) in r.goals" :key="g.id" class="flex gap-3 px-4 py-4">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-xs font-semibold text-fg-muted tabular-nums" aria-hidden="true">{{ i + 1 }}</span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-start gap-2">
                    <div class="min-w-0 flex-1 basis-56">
                      <p class="font-medium text-fg">{{ g.title }}</p>
                      <p class="mt-0.5 text-xs text-fg-muted">
                        <template v-if="g.measure">Measure: {{ g.measure }}</template><template v-else>No measure set</template>
                        <template v-if="g.dueDate"> · <span :class="g.dueDate < today && g.progress < 100 ? 'font-medium text-danger-fg' : ''">due {{ formatDate(g.dueDate) }}</span></template>
                      </p>
                    </div>
                    <span class="rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-semibold text-fg-muted tabular-nums ring-1 ring-line ring-inset" :title="`Weight ${g.weight}%`">{{ g.weight }}%<span class="sr-only"> weight</span></span>
                    <div class="flex gap-0.5">
                      <AppButton v-if="r.permissions.updateProgress" size="sm" variant="ghost" :icon="TrendingUp" @click="openProgress(g)">Progress</AppButton>
                      <template v-if="r.permissions.editGoals">
                        <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${g.title}`" @click="openGoal(g)" />
                        <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove ${g.title}`" :loading="busy === `goal-${g.id}`" @click="removeGoal(g)" />
                      </template>
                    </div>
                  </div>
                  <p v-if="g.description" class="mt-1.5 text-sm whitespace-pre-line text-fg-muted">{{ g.description }}</p>
                  <div v-if="r.goalsApprovedAt" class="mt-3 max-w-md">
                    <div class="mb-1 flex justify-between gap-3 text-2xs text-fg-muted"><span class="truncate">{{ g.progressNote ?? 'Progress' }}</span><span class="font-semibold text-fg tabular-nums">{{ g.progress }}%</span></div>
                    <div class="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="g.progress" aria-valuemin="0" aria-valuemax="100" :aria-label="`Progress on ${g.title}`">
                      <div :class="['h-full rounded-full transition-[width] duration-500', g.progress >= 100 ? 'bg-success' : 'bg-brand-500']" :style="{ width: `${g.progress}%` }" />
                    </div>
                  </div>
                  <div v-if="(g.selfRating && !r.permissions.selfAssess) || (g.managerRating && !r.permissions.managerAssess)" class="mt-3 grid gap-2 sm:grid-cols-2">
                    <div v-if="g.selfRating && !r.permissions.selfAssess" class="rounded-lg bg-surface-muted/50 p-2.5">
                      <RatingChip :rating="g.selfRating" :labels="labels" prefix="Self" />
                      <p v-if="g.selfComment" class="mt-1.5 text-xs whitespace-pre-line text-fg-muted">{{ g.selfComment }}</p>
                    </div>
                    <div v-if="g.managerRating && !r.permissions.managerAssess" class="rounded-lg bg-surface-muted/50 p-2.5">
                      <RatingChip :rating="g.managerRating" :labels="labels" prefix="Manager" />
                      <p v-if="g.managerComment" class="mt-1.5 text-xs whitespace-pre-line text-fg-muted">{{ g.managerComment }}</p>
                    </div>
                  </div>
                </div>
              </li>
            </ol>
            <footer v-if="r.goals.length || r.permissions.submitGoals || r.permissions.approveGoals" class="flex flex-wrap items-center gap-3 border-t border-line/70 bg-surface-muted/40 px-4 py-3">
              <div v-if="r.goals.length" class="me-auto flex min-w-48 items-center gap-3">
                <div class="h-1.5 w-28 overflow-hidden rounded-full bg-surface" role="img" :aria-label="`Weights add up to ${totalWeight}%`">
                  <div :class="['h-full rounded-full', totalWeight === 100 ? 'bg-success' : 'bg-warning']" :style="{ width: `${Math.min(100, totalWeight)}%` }" />
                </div>
                <span :class="['text-xs tabular-nums', totalWeight === 100 ? 'text-fg-muted' : 'font-medium text-warning-fg']">Weights {{ totalWeight }}%{{ totalWeight === 100 ? '' : ' (must be 100%)' }}</span>
              </div>
              <template v-if="r.permissions.submitGoals || r.permissions.approveGoals">
                <AppButton v-if="r.permissions.returnGoals" variant="secondary" :icon="Undo2" @click="returnNote = ''; returnOpen = true">Send back</AppButton>
                <AppButton v-if="r.permissions.approveGoals" :icon="Check" :loading="busy === 'approve'" :disabled="totalWeight !== 100" @click="act('approve', () => performanceApi.approveGoals(id), 'Goals approved')">Approve goals</AppButton>
                <AppButton v-if="r.permissions.submitGoals" :icon="Send" :loading="busy === 'submit-goals'" :disabled="totalWeight !== 100" @click="act('submit-goals', () => performanceApi.submitGoals(id), 'Goals submitted', 'Your reviewer has been notified.')">Submit goals</AppButton>
              </template>
            </footer>
          </section>

          <!-- Self-assessment -->
          <section v-if="r.permissions.selfAssess" id="self" class="card scroll-mt-4 overflow-hidden" aria-labelledby="self-title">
            <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-2.5">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><UserRound :size="16" /></span>
              <div class="min-w-0 flex-1">
                <h2 id="self-title" class="text-sm font-semibold text-fg">Self-assessment</h2>
                <p class="text-xs text-fg-muted">{{ r.cycle.selfReviewDue ? `Due ${formatDate(r.cycle.selfReviewDue)} · ${relativeDay(r.cycle.selfReviewDue)}` : 'Rate yourself on each goal and competency.' }}</p>
              </div>
              <AppBadge :tone="complete(selfForm) ? 'success' : 'neutral'" dot>{{ rated(selfForm).done }} of {{ rated(selfForm).total }} rated</AppBadge>
            </header>
            <div class="space-y-5 p-4">
              <div v-if="r.goals.length" class="space-y-3">
                <h3 class="text-2xs font-semibold tracking-wide text-fg-muted uppercase">Goals</h3>
                <div v-for="(g, i) in r.goals" :key="g.id" class="space-y-2.5 rounded-lg p-3.5 ring-1 ring-line">
                  <p class="flex items-start gap-2 text-sm font-medium text-fg">
                    <CheckCircle2 v-if="selfForm.goals[g.id]?.rating" :size="16" class="mt-0.5 shrink-0 text-success-fg" aria-hidden="true" />
                    <span v-else class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-2xs text-fg-subtle ring-1 ring-line" aria-hidden="true">{{ i + 1 }}</span>
                    <span class="min-w-0 flex-1">{{ g.title }}</span>
                    <span class="text-xs font-normal text-fg-muted tabular-nums">{{ g.weight }}%</span>
                  </p>
                  <RatingInput v-model="selfForm.goals[g.id]!.rating" :labels="labels" :label="`Self rating for ${g.title}`" />
                  <AppTextarea v-model="selfForm.goals[g.id]!.comment" :aria-label="`Comment on ${g.title}`" placeholder="What you achieved" :rows="2" :maxlength="2000" />
                </div>
              </div>
              <div v-if="r.cycle.competencies.length" class="space-y-3">
                <h3 class="text-2xs font-semibold tracking-wide text-fg-muted uppercase">Competencies</h3>
                <div v-for="k in r.cycle.competencies" :key="k.key" class="space-y-2.5 rounded-lg p-3.5 ring-1 ring-line">
                  <div class="flex items-start gap-2">
                    <CheckCircle2 v-if="selfForm.competencies[k.key]?.rating" :size="16" class="mt-0.5 shrink-0 text-success-fg" aria-hidden="true" />
                    <span v-else class="mt-0.5 h-4 w-4 shrink-0 rounded-full ring-1 ring-line" aria-hidden="true" />
                    <div class="min-w-0">
                      <p class="text-sm font-medium text-fg">{{ k.name }}</p>
                      <p v-if="k.description" class="text-xs text-fg-muted">{{ k.description }}</p>
                    </div>
                  </div>
                  <RatingInput v-model="selfForm.competencies[k.key]!.rating" :labels="labels" :label="`Self rating for ${k.name}`" />
                </div>
              </div>
              <AppTextarea v-model="selfForm.comment" label="Overall comments" :rows="3" :maxlength="5000" placeholder="Highlights of the period, challenges, what you'd like to grow in" />
            </div>
            <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-line/70 bg-surface-muted/40 px-4 py-3">
              <p class="me-auto text-xs text-fg-muted">{{ complete(selfForm) ? 'Everything is rated. Submit when you are ready.' : 'Rate every goal and competency to submit.' }}</p>
              <AppButton variant="secondary" :loading="busy === 'self-save'" @click="saveSelf(false)">Save draft</AppButton>
              <AppButton :icon="Send" :loading="busy === 'self-submit'" :disabled="!complete(selfForm)" @click="saveSelf(true)">Submit self-assessment</AppButton>
            </footer>
          </section>
          <AppCard v-else-if="r.self.submittedAt" id="self" class="scroll-mt-4" title="Self-assessment" :icon="UserRound" :description="`Submitted ${formatDate(r.self.submittedAt)}`">
            <ul v-if="r.cycle.competencies.length" class="divide-y divide-line/60">
              <li v-for="k in r.cycle.competencies" :key="k.key" class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 first:pt-0">
                <span class="text-sm text-fg">{{ k.name }}</span>
                <RatingChip :rating="selfComp(k.key)" :labels="labels" />
              </li>
            </ul>
            <figure v-if="r.self.comment" class="mt-4 flex gap-2.5 rounded-lg bg-surface-muted/60 p-3">
              <Quote :size="15" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />
              <blockquote class="text-sm whitespace-pre-line text-fg">{{ r.self.comment }}</blockquote>
            </figure>
          </AppCard>

          <!-- Manager review -->
          <section v-if="r.permissions.managerAssess" id="manager" class="card scroll-mt-4 overflow-hidden" aria-labelledby="mgr-title">
            <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-2.5">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><PenLine :size="16" /></span>
              <div class="min-w-0 flex-1">
                <h2 id="mgr-title" class="text-sm font-semibold text-fg">Your review</h2>
                <p class="text-xs text-fg-muted">{{ r.permissions.submitManagerReview ? (r.cycle.managerReviewDue ? `Due ${formatDate(r.cycle.managerReviewDue)}` : 'Rate each goal and competency.') : 'You can draft now and submit after the self-assessment.' }}</p>
              </div>
              <AppBadge :tone="complete(managerForm) ? 'success' : 'neutral'" dot>{{ rated(managerForm).done }} of {{ rated(managerForm).total }} rated</AppBadge>
            </header>
            <div class="space-y-5 p-4">
              <div v-if="r.goals.length" class="space-y-3">
                <h3 class="text-2xs font-semibold tracking-wide text-fg-muted uppercase">Goals · {{ r.cycle.goalsWeight }}% of the score</h3>
                <div v-for="(g, i) in r.goals" :key="g.id" class="space-y-2.5 rounded-lg p-3.5 ring-1 ring-line">
                  <div class="flex flex-wrap items-start gap-2">
                    <CheckCircle2 v-if="managerForm.goals[g.id]?.rating" :size="16" class="mt-0.5 shrink-0 text-success-fg" aria-hidden="true" />
                    <span v-else class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-2xs text-fg-subtle ring-1 ring-line" aria-hidden="true">{{ i + 1 }}</span>
                    <p class="min-w-0 flex-1 text-sm font-medium text-fg">{{ g.title }} <span class="text-xs font-normal text-fg-muted tabular-nums">· {{ g.weight }}% · progress {{ g.progress }}%</span></p>
                    <RatingChip :rating="g.selfRating" :labels="labels" prefix="Self" />
                  </div>
                  <p v-if="g.selfComment" class="ms-6 border-s-2 border-line ps-2.5 text-xs whitespace-pre-line text-fg-muted">{{ g.selfComment }}</p>
                  <RatingInput v-model="managerForm.goals[g.id]!.rating" :labels="labels" :label="`Manager rating for ${g.title}`" />
                  <AppTextarea v-model="managerForm.goals[g.id]!.comment" :aria-label="`Manager comment on ${g.title}`" placeholder="Evidence and feedback" :rows="2" :maxlength="2000" />
                </div>
              </div>
              <div v-if="r.cycle.competencies.length" class="space-y-3">
                <h3 class="text-2xs font-semibold tracking-wide text-fg-muted uppercase">Competencies · {{ 100 - r.cycle.goalsWeight }}% of the score</h3>
                <div v-for="k in r.cycle.competencies" :key="k.key" class="space-y-2.5 rounded-lg p-3.5 ring-1 ring-line">
                  <div class="flex flex-wrap items-start gap-2">
                    <CheckCircle2 v-if="managerForm.competencies[k.key]?.rating" :size="16" class="mt-0.5 shrink-0 text-success-fg" aria-hidden="true" />
                    <span v-else class="mt-0.5 h-4 w-4 shrink-0 rounded-full ring-1 ring-line" aria-hidden="true" />
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-medium text-fg">{{ k.name }}</p>
                      <p v-if="k.description" class="text-xs text-fg-muted">{{ k.description }}</p>
                    </div>
                    <RatingChip :rating="selfComp(k.key)" :labels="labels" prefix="Self" />
                  </div>
                  <RatingInput v-model="managerForm.competencies[k.key]!.rating" :labels="labels" :label="`Manager rating for ${k.name}`" />
                </div>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <AppTextarea v-model="managerForm.strengths" label="Strengths" :rows="3" :maxlength="5000" placeholder="What they did especially well, with examples" />
                <AppTextarea v-model="managerForm.improvements" label="Areas to improve" :rows="3" :maxlength="5000" placeholder="One or two things that would make the biggest difference" />
              </div>
              <AppTextarea v-model="managerForm.comment" label="Overall comments" :rows="3" :maxlength="5000" />
              <div v-if="preview" class="overflow-hidden rounded-xl ring-1 ring-line">
                <div class="flex items-center gap-2 border-b border-line/70 bg-surface-muted/50 px-4 py-2">
                  <Gauge :size="15" class="text-accent-fg" aria-hidden="true" />
                  <p class="text-sm font-semibold text-fg">Score</p>
                  <p class="text-xs text-fg-muted">Worked out as you rate · goals {{ r.cycle.goalsWeight }}%<template v-if="r.cycle.competencies.length && r.cycle.goalsWeight < 100">, competencies {{ 100 - r.cycle.goalsWeight }}%</template></p>
                </div>
                <dl class="grid grid-cols-3 divide-x divide-line/70 rtl:divide-x-reverse">
                  <div class="px-4 py-3"><dt class="text-2xs text-fg-muted">Goals</dt><dd class="text-lg font-semibold text-fg tabular-nums">{{ preview.goalScore ?? '—' }}</dd></div>
                  <div class="px-4 py-3"><dt class="text-2xs text-fg-muted">Competencies</dt><dd class="text-lg font-semibold text-fg tabular-nums">{{ r.cycle.competencies.length ? (preview.competencyScore ?? '—') : 'n/a' }}</dd></div>
                  <div class="bg-accent-soft/40 px-4 py-3"><dt class="text-2xs text-fg-muted">Overall</dt><dd class="text-lg font-semibold text-accent-fg tabular-nums">{{ preview.overall ?? '—' }}</dd></div>
                </dl>
                <div class="space-y-2 border-t border-line/70 px-4 py-3">
                  <p class="text-xs text-fg-muted">Suggested rating: <span class="font-medium text-fg">{{ preview.suggested ? ratingText(preview.suggested, labels) : 'rate everything to see it' }}</span></p>
                  <RatingInput v-model="managerForm.finalRating" :labels="labels" label="Final rating" />
                  <p class="text-xs text-fg-muted">Leave empty to use the suggested rating.</p>
                </div>
              </div>
            </div>
            <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-line/70 bg-surface-muted/40 px-4 py-3">
              <p class="me-auto text-xs text-fg-muted">{{ !r.permissions.submitManagerReview ? 'Submitting opens after the self-assessment.' : complete(managerForm) ? 'Everything is rated. Submit when you are ready.' : 'Rate every goal and competency to submit.' }}</p>
              <AppButton variant="secondary" :loading="busy === 'mgr-save'" @click="saveManager(false)">Save draft</AppButton>
              <AppButton :icon="Send" :loading="busy === 'mgr-submit'" :disabled="!r.permissions.submitManagerReview || !complete(managerForm)" @click="saveManager(true)">Submit review</AppButton>
            </footer>
          </section>
          <section v-else-if="r.manager && r.manager.submittedAt" id="manager" class="card scroll-mt-4 overflow-hidden" aria-labelledby="mgr-done-title">
            <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-2.5">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><ClipboardList :size="16" /></span>
              <div class="min-w-0 flex-1">
                <h2 id="mgr-done-title" class="text-sm font-semibold text-fg">Manager review</h2>
                <p class="text-xs text-fg-muted">{{ r.reviewer?.name ?? 'Reviewer' }} · {{ formatDate(r.manager.submittedAt) }}</p>
              </div>
            </header>
            <div class="flex flex-wrap items-center gap-5 border-b border-line/70 px-4 py-4">
              <div v-if="r.manager.rating" :class="['flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-surface-muted ring-1 ring-line ring-inset', RATING_TEXT[r.manager.rating]]">
                <span class="text-2xl leading-7 font-semibold tabular-nums">{{ r.manager.rating }}</span>
                <span class="text-2xs text-fg-muted">of 5</span>
              </div>
              <div class="min-w-0 flex-1 basis-48">
                <p class="text-lg font-semibold text-fg">{{ r.manager.rating ? labels[r.manager.rating - 1] : 'Not rated' }}</p>
                <p class="text-xs text-fg-muted">
                  Overall score {{ r.manager.overallScore ?? '—' }}<template v-if="r.manager.calibratedRating"> · calibrated from {{ r.manager.finalRating }}</template>
                </p>
                <div class="mt-2 flex gap-1" aria-hidden="true">
                  <span v-for="n in 5" :key="n" :class="['h-1.5 w-8 rounded-full', r.manager.rating && n <= r.manager.rating ? RATING_FILL[r.manager.rating] : 'bg-surface-muted']" />
                </div>
              </div>
              <dl class="flex gap-5 text-center">
                <div><dt class="text-2xs text-fg-muted">Goals</dt><dd class="text-base font-semibold text-fg tabular-nums">{{ r.manager.goalScore ?? '—' }}</dd></div>
                <div v-if="r.cycle.competencies.length"><dt class="text-2xs text-fg-muted">Competencies</dt><dd class="text-base font-semibold text-fg tabular-nums">{{ r.manager.competencyScore ?? '—' }}</dd></div>
              </dl>
            </div>
            <div class="space-y-4 p-4">
              <p v-if="r.manager.calibrationNote" class="flex gap-2 rounded-lg bg-special-soft px-3 py-2 text-sm text-fg"><Scale :size="15" class="mt-0.5 shrink-0 text-special-fg" aria-hidden="true" /><span><span class="font-medium">Calibration:</span> {{ r.manager.calibrationNote }}</span></p>
              <div v-if="r.cycle.competencies.length">
                <h3 class="mb-2 text-2xs font-semibold tracking-wide text-fg-muted uppercase">Competencies</h3>
                <ul class="divide-y divide-line/60 rounded-lg ring-1 ring-line">
                  <li v-for="k in r.cycle.competencies" :key="k.key" class="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5">
                    <div class="min-w-0 flex-1 basis-40">
                      <p class="text-sm font-medium text-fg">{{ k.name }}</p>
                      <p v-if="mgrComp(k.key)?.comment" class="text-xs text-fg-muted">{{ mgrComp(k.key)?.comment }}</p>
                    </div>
                    <span v-if="selfComp(k.key)" class="text-2xs text-fg-subtle tabular-nums">self {{ selfComp(k.key) }}</span>
                    <RatingChip :rating="mgrComp(k.key)?.rating" :labels="labels" />
                  </li>
                </ul>
              </div>
              <div v-if="r.manager.strengths || r.manager.improvements" class="grid gap-3 sm:grid-cols-2">
                <div v-if="r.manager.strengths" class="rounded-lg bg-success-soft/60 p-3">
                  <p class="mb-1 text-2xs font-semibold tracking-wide text-success-fg uppercase">Strengths</p>
                  <p class="text-sm whitespace-pre-line text-fg">{{ r.manager.strengths }}</p>
                </div>
                <div v-if="r.manager.improvements" class="rounded-lg bg-warning-soft/60 p-3">
                  <p class="mb-1 text-2xs font-semibold tracking-wide text-warning-fg uppercase">Areas to improve</p>
                  <p class="text-sm whitespace-pre-line text-fg">{{ r.manager.improvements }}</p>
                </div>
              </div>
              <figure v-if="r.manager.comment" class="flex gap-2.5 rounded-lg bg-surface-muted/60 p-3">
                <Quote :size="15" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                <blockquote class="text-sm whitespace-pre-line text-fg">{{ r.manager.comment }}</blockquote>
              </figure>
            </div>
            <footer v-if="r.acknowledgedAt" class="flex gap-2.5 border-t border-line/70 bg-surface-muted/40 px-4 py-3 text-sm">
              <CheckCircle2 :size="16" class="mt-0.5 shrink-0 text-success-fg" aria-hidden="true" />
              <div>
                <p class="text-xs font-medium text-fg">Acknowledged {{ formatDate(r.acknowledgedAt) }}</p>
                <p v-if="r.employeeResponse" class="text-fg-muted">“{{ r.employeeResponse }}”</p>
              </div>
            </footer>
          </section>
        </div>

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
                <AppButton v-if="r.permissions.reassign" size="xs" variant="ghost" @click="newReviewer = null; reassignOpen = true">{{ r.reviewer ? 'Change' : 'Assign' }}</AppButton>
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
            <template v-if="r.permissions.requestFeedback" #actions><AppButton size="sm" variant="secondary" :icon="MessageSquarePlus" @click="requestIds = []; requestOpen = true">Request</AppButton></template>
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
      </div>

      <GoalFormModal :open="goalOpen" :review-id="r.id" :goal="editingGoal" :remaining-weight="100 - totalWeight + (editingGoal?.weight ?? 0)" :period-start="r.cycle.periodStart" :period-end="r.cycle.periodEnd" @close="goalOpen = false" @saved="onGoalSaved" />

      <AppModal :open="returnOpen" title="Send goals back" size="sm" @close="returnOpen = false">
        <AppTextarea v-model="returnNote" label="What should change?" required :rows="3" :maxlength="1000" />
        <template #footer>
          <AppButton variant="secondary" @click="returnOpen = false">Cancel</AppButton>
          <AppButton :disabled="returnNote.trim().length < 3" @click="returnOpen = false; act('return', () => performanceApi.returnGoals(id, returnNote), 'Goals sent back')">Send back</AppButton>
        </template>
      </AppModal>

      <AppModal :open="!!progressFor" :title="progressFor ? `Progress · ${progressFor.title}` : ''" size="sm" @close="progressFor = null">
        <div class="space-y-4">
          <AppInput v-model="progress.value" label="Progress (%)" type="number" :min="0" :max="100" />
          <AppInput v-model="progress.note" label="Update" :maxlength="1000" placeholder="e.g. Beta live with two customers" />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="progressFor = null">Cancel</AppButton>
          <AppButton :loading="busy === 'progress'" @click="saveProgress">Save</AppButton>
        </template>
      </AppModal>

      <AppModal :open="requestOpen" title="Request feedback" description="Colleagues are notified. Their names aren't shown to the employee." @close="requestOpen = false">
        <ColleaguePicker v-model:values="requestIds" label="Colleagues" multiple :exclude="[r.employee.id, ...r.feedback.map((f) => f.giver?.id ?? '')]" />
        <template #footer>
          <AppButton variant="secondary" @click="requestOpen = false">Cancel</AppButton>
          <AppButton :disabled="!requestIds.length" :loading="busy === 'request'" @click="requestFeedback">Request</AppButton>
        </template>
      </AppModal>

      <AppModal :open="calibrateOpen" title="Calibrate rating" :description="`Manager's rating: ${ratingText(r.manager?.finalRating, labels)}. Calibration aligns ratings across teams before results are released.`" size="sm" @close="calibrateOpen = false">
        <div class="space-y-4">
          <RatingInput v-model="calibration.rating" :labels="labels" label="Calibrated rating" />
          <AppTextarea v-model="calibration.note" label="Reason" required :rows="3" :maxlength="1000" />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="calibrateOpen = false">Cancel</AppButton>
          <AppButton :disabled="!calibration.rating || calibration.note.trim().length < 3" @click="calibrate">Save</AppButton>
        </template>
      </AppModal>

      <AppModal :open="reassignOpen" title="Assign reviewer" size="sm" @close="reassignOpen = false">
        <ColleaguePicker v-model:value="newReviewer" label="Reviewer" :exclude="[r.employee.id]" />
        <template #footer>
          <AppButton variant="secondary" @click="reassignOpen = false">Cancel</AppButton>
          <AppButton :disabled="!newReviewer" @click="reassign">Assign</AppButton>
        </template>
      </AppModal>

      <AppModal :open="ackOpen" title="Acknowledge your review" description="Confirms you have read it. Add a comment if you'd like (for example if you disagree)." size="sm" @close="ackOpen = false">
        <AppTextarea v-model="ackComment" label="Comment" :rows="3" :maxlength="2000" />
        <template #footer>
          <AppButton variant="secondary" @click="ackOpen = false">Cancel</AppButton>
          <AppButton :icon="Check" @click="acknowledge">Acknowledge</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
