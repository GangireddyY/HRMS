<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Check, MessageSquarePlus, Pencil, Plus, Scale, Send, Trash2, TrendingUp, Undo2, UserCog } from '@lucide/vue';
import { performanceApi } from '@/modules/performance/api/performance.api';
import ColleaguePicker from '@/modules/performance/components/ColleaguePicker.vue';
import GoalFormModal from '@/modules/performance/components/GoalFormModal.vue';
import RatingInput from '@/modules/performance/components/RatingInput.vue';
import type { CompetencyRating, Goal, ReviewDetail } from '@/modules/performance/types';
import { STAGE_LABELS, STAGE_ORDER, ratingText, stageTone } from '@/modules/performance/utils/performance-format';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppErrorState, AppInput, AppModal, AppPageHeader, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const inHr = computed(() => route.path.startsWith('/hr'));
const review = useAsync(() => performanceApi.review(id.value));
watch(id, () => void review.run());
const r = computed(() => review.data.value);
const labels = computed(() => r.value?.cycle.ratingLabels ?? []);
const stageIndex = computed(() => (r.value ? STAGE_ORDER.indexOf(r.value.stage) : 0));
const totalWeight = computed(() => (r.value?.goals ?? []).reduce((n, g) => n + g.weight, 0));

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
        </template>
        <template #actions>
          <AppButton v-if="r.permissions.reassign" variant="secondary" :icon="UserCog" @click="newReviewer = null; reassignOpen = true">{{ r.reviewer ? 'Change reviewer' : 'Assign reviewer' }}</AppButton>
          <AppButton v-if="r.permissions.calibrate" variant="secondary" :icon="Scale" @click="calibration.rating = r.manager?.rating ?? null; calibration.note = ''; calibrateOpen = true">Calibrate</AppButton>
          <AppButton v-if="r.permissions.acknowledge" :icon="Check" @click="ackComment = ''; ackOpen = true">Acknowledge</AppButton>
          <AppButton v-if="inHr && !r.viewer.isSubject && (r.viewer.isReviewer || r.viewer.isHr) && (r.stage === 'COMPLETED' || r.stage === 'ACKNOWLEDGED')" variant="secondary" :icon="TrendingUp" :to="`/hr/performance/cycles/${r.cycle.id}/hikes`">Salary increase</AppButton>
        </template>
      </AppPageHeader>

      <ol class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Review stages">
        <li v-for="(s, i) in STAGE_ORDER" :key="s" class="rounded-xl px-3 py-2 text-xs ring-1" :class="i < stageIndex ? 'bg-emerald-500/8 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300' : i === stageIndex ? 'bg-brand-500/10 font-semibold text-fg ring-brand-500/40' : 'text-fg-subtle ring-line'" :aria-current="i === stageIndex ? 'step' : undefined">
          {{ i + 1 }}. {{ STAGE_LABELS[s] }}
        </li>
      </ol>

      <div class="mb-4 space-y-3">
        <AppAlert v-if="r.stage === 'GOAL_SETTING' && r.goalsReturnNote" tone="warning" title="Goals sent back">{{ r.goalsReturnNote }}</AppAlert>
        <AppAlert v-if="r.viewer.isSubject && !r.reviewer" tone="warning" title="No reviewer yet">Your HR team needs to assign a reviewer before you can submit goals.</AppAlert>
        <AppAlert v-if="r.viewer.isSubject && r.stage === 'COMPLETED' && !r.cycle.resultsReleased" tone="info" title="Review completed">Your manager has submitted the review. You'll see the results once HR releases them.</AppAlert>
        <AppAlert v-if="r.viewer.isReviewer && r.stage === 'GOAL_APPROVAL'" tone="info" title="Goals waiting for your approval">Approve them, edit them, or send them back with a note.</AppAlert>
      </div>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div class="space-y-4">
          <!-- Goals -->
          <AppCard title="Goals" :description="`${r.goals.length} goal${r.goals.length === 1 ? '' : 's'} · weights add up to ${totalWeight}%${r.cycle.goalsDue ? ` · due ${formatDate(r.cycle.goalsDue)}` : ''}`">
            <template #actions>
              <AppButton v-if="r.permissions.editGoals" size="sm" variant="secondary" :icon="Plus" @click="openGoal(null)">Add goal</AppButton>
            </template>
            <p v-if="!r.goals.length" class="text-sm text-fg-muted">{{ r.permissions.editGoals ? 'Add the goals for this period. Weights must add up to 100%.' : 'No goals yet.' }}</p>
            <ul v-else class="space-y-3">
              <li v-for="g in r.goals" :key="g.id" class="rounded-xl p-4 ring-1 ring-line">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <p class="font-medium text-fg">{{ g.title }} <span class="ms-1 text-xs font-normal text-fg-muted">{{ g.weight }}%</span></p>
                    <p v-if="g.measure" class="text-sm text-fg-muted">Measure: {{ g.measure }}</p>
                    <p v-if="g.description" class="mt-1 text-sm whitespace-pre-line text-fg-muted">{{ g.description }}</p>
                    <p v-if="g.dueDate" class="text-xs text-fg-subtle">Due {{ formatDate(g.dueDate) }}</p>
                  </div>
                  <div class="flex gap-1">
                    <AppButton v-if="r.permissions.updateProgress" size="sm" variant="ghost" :icon="TrendingUp" @click="openProgress(g)">Progress</AppButton>
                    <template v-if="r.permissions.editGoals">
                      <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${g.title}`" @click="openGoal(g)" />
                      <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove ${g.title}`" :loading="busy === `goal-${g.id}`" @click="removeGoal(g)" />
                    </template>
                  </div>
                </div>
                <div v-if="r.goalsApprovedAt" class="mt-3">
                  <div class="mb-1 flex justify-between text-xs text-fg-muted"><span>{{ g.progressNote ?? 'Progress' }}</span><span class="tabular-nums">{{ g.progress }}%</span></div>
                  <div class="h-1.5 rounded-full bg-surface-muted"><div class="h-1.5 rounded-full bg-brand-500" :style="{ width: `${g.progress}%` }" /></div>
                </div>
                <dl v-if="(g.selfRating && !r.permissions.selfAssess) || g.managerRating" class="mt-3 grid gap-2 border-t border-line/70 pt-3 text-sm sm:grid-cols-2">
                  <div v-if="g.selfRating && !r.permissions.selfAssess"><dt class="text-xs text-fg-muted">Self rating</dt><dd class="text-fg">{{ ratingText(g.selfRating, labels) }}</dd><dd v-if="g.selfComment" class="text-fg-muted">{{ g.selfComment }}</dd></div>
                  <div v-if="g.managerRating && !r.permissions.managerAssess"><dt class="text-xs text-fg-muted">Manager rating</dt><dd class="text-fg">{{ ratingText(g.managerRating, labels) }}</dd><dd v-if="g.managerComment" class="text-fg-muted">{{ g.managerComment }}</dd></div>
                </dl>
              </li>
            </ul>
            <div v-if="r.permissions.submitGoals || r.permissions.approveGoals" class="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line/70 pt-4">
              <span v-if="totalWeight !== 100 && r.goals.length" class="me-auto text-xs text-amber-700 dark:text-amber-300">Weights add up to {{ totalWeight }}% (must be 100%).</span>
              <AppButton v-if="r.permissions.returnGoals" variant="secondary" :icon="Undo2" @click="returnNote = ''; returnOpen = true">Send back</AppButton>
              <AppButton v-if="r.permissions.approveGoals" :icon="Check" :loading="busy === 'approve'" :disabled="totalWeight !== 100" @click="act('approve', () => performanceApi.approveGoals(id), 'Goals approved')">Approve goals</AppButton>
              <AppButton v-if="r.permissions.submitGoals" :icon="Send" :loading="busy === 'submit-goals'" :disabled="totalWeight !== 100" @click="act('submit-goals', () => performanceApi.submitGoals(id), 'Goals submitted', 'Your reviewer has been notified.')">Submit goals</AppButton>
            </div>
          </AppCard>

          <!-- Self-assessment -->
          <AppCard v-if="r.permissions.selfAssess" title="Self-assessment" :description="r.cycle.selfReviewDue ? `Due ${formatDate(r.cycle.selfReviewDue)}` : 'Rate yourself on each goal and competency.'">
            <div class="space-y-5">
              <div v-for="g in r.goals" :key="g.id" class="space-y-2">
                <p class="text-sm font-medium text-fg">{{ g.title }}</p>
                <RatingInput v-model="selfForm.goals[g.id]!.rating" :labels="labels" :label="`Self rating for ${g.title}`" />
                <AppTextarea v-model="selfForm.goals[g.id]!.comment" :aria-label="`Comment on ${g.title}`" placeholder="What you achieved" :rows="2" :maxlength="2000" />
              </div>
              <div v-for="k in r.cycle.competencies" :key="k.key" class="space-y-2">
                <p class="text-sm font-medium text-fg">{{ k.name }} <span class="text-xs font-normal text-fg-muted">{{ k.description }}</span></p>
                <RatingInput v-model="selfForm.competencies[k.key]!.rating" :labels="labels" :label="`Self rating for ${k.name}`" />
              </div>
              <AppTextarea v-model="selfForm.comment" label="Overall comments" :rows="3" :maxlength="5000" placeholder="Highlights of the period, challenges, what you'd like to grow in" />
              <div class="flex justify-end gap-2">
                <AppButton variant="secondary" :loading="busy === 'self-save'" @click="saveSelf(false)">Save draft</AppButton>
                <AppButton :icon="Send" :loading="busy === 'self-submit'" :disabled="!complete(selfForm)" @click="saveSelf(true)">Submit self-assessment</AppButton>
              </div>
            </div>
          </AppCard>
          <AppCard v-else-if="r.self.submittedAt" title="Self-assessment" :description="`Submitted ${formatDate(r.self.submittedAt)}`">
            <dl class="space-y-2 text-sm">
              <div v-for="k in r.cycle.competencies" :key="k.key" class="flex justify-between gap-3"><dt class="text-fg-muted">{{ k.name }}</dt><dd>{{ ratingText(r.self.competencies.find((c) => c.key === k.key)?.rating, labels) }}</dd></div>
            </dl>
            <p v-if="r.self.comment" class="mt-3 text-sm whitespace-pre-line text-fg">{{ r.self.comment }}</p>
          </AppCard>

          <!-- Manager review -->
          <AppCard v-if="r.permissions.managerAssess" title="Your review" :description="r.permissions.submitManagerReview ? (r.cycle.managerReviewDue ? `Due ${formatDate(r.cycle.managerReviewDue)}` : 'Rate each goal and competency.') : 'You can draft now and submit after the self-assessment.'">
            <div class="space-y-5">
              <div v-for="g in r.goals" :key="g.id" class="space-y-2">
                <p class="text-sm font-medium text-fg">{{ g.title }} <span class="text-xs font-normal text-fg-muted">{{ g.weight }}% · self {{ g.selfRating ?? '—' }}</span></p>
                <RatingInput v-model="managerForm.goals[g.id]!.rating" :labels="labels" :label="`Manager rating for ${g.title}`" />
                <AppTextarea v-model="managerForm.goals[g.id]!.comment" :aria-label="`Manager comment on ${g.title}`" placeholder="Evidence and feedback" :rows="2" :maxlength="2000" />
              </div>
              <div v-for="k in r.cycle.competencies" :key="k.key" class="space-y-2">
                <p class="text-sm font-medium text-fg">{{ k.name }} <span class="text-xs font-normal text-fg-muted">self {{ r.self.competencies.find((c) => c.key === k.key)?.rating ?? '—' }}</span></p>
                <RatingInput v-model="managerForm.competencies[k.key]!.rating" :labels="labels" :label="`Manager rating for ${k.name}`" />
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <AppTextarea v-model="managerForm.strengths" label="Strengths" :rows="3" :maxlength="5000" />
                <AppTextarea v-model="managerForm.improvements" label="Areas to improve" :rows="3" :maxlength="5000" />
              </div>
              <AppTextarea v-model="managerForm.comment" label="Overall comments" :rows="3" :maxlength="5000" />
              <div v-if="preview" class="rounded-xl bg-surface-muted/50 p-4 text-sm ring-1 ring-line">
                <p class="text-fg-muted">
                  Goals {{ preview.goalScore ?? '—' }}<template v-if="r.cycle.competencies.length"> · competencies {{ preview.competencyScore ?? '—' }}</template> · overall <span class="font-semibold text-fg">{{ preview.overall ?? '—' }}</span>
                  <template v-if="preview.suggested"> → suggested rating {{ ratingText(preview.suggested, labels) }}</template>
                </p>
                <div class="mt-3">
                  <RatingInput v-model="managerForm.finalRating" :labels="labels" label="Final rating" />
                  <p class="mt-1 text-xs text-fg-muted">Leave empty to use the suggested rating.</p>
                </div>
              </div>
              <div class="flex justify-end gap-2">
                <AppButton variant="secondary" :loading="busy === 'mgr-save'" @click="saveManager(false)">Save draft</AppButton>
                <AppButton :icon="Send" :loading="busy === 'mgr-submit'" :disabled="!r.permissions.submitManagerReview || !complete(managerForm)" @click="saveManager(true)">Submit review</AppButton>
              </div>
            </div>
          </AppCard>
          <AppCard v-else-if="r.manager && r.manager.submittedAt" title="Manager review" :description="`${r.reviewer?.name ?? 'Reviewer'} · ${formatDate(r.manager.submittedAt)}`">
            <div class="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p class="text-2xl font-semibold text-fg">{{ ratingText(r.manager.rating, labels) }}</p>
              <p class="text-sm text-fg-muted">Score {{ r.manager.overallScore ?? '—' }}<template v-if="r.manager.calibratedRating"> · calibrated from {{ r.manager.finalRating }}</template></p>
            </div>
            <p v-if="r.manager.calibrationNote" class="mb-3 text-sm text-fg-muted">Calibration: {{ r.manager.calibrationNote }}</p>
            <dl class="space-y-2 text-sm">
              <div v-for="k in r.cycle.competencies" :key="k.key" class="flex justify-between gap-3"><dt class="text-fg-muted">{{ k.name }}</dt><dd>{{ ratingText(r.manager.competencies.find((c) => c.key === k.key)?.rating, labels) }}</dd></div>
            </dl>
            <div class="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div v-if="r.manager.strengths"><p class="text-xs text-fg-muted">Strengths</p><p class="whitespace-pre-line text-fg">{{ r.manager.strengths }}</p></div>
              <div v-if="r.manager.improvements"><p class="text-xs text-fg-muted">Areas to improve</p><p class="whitespace-pre-line text-fg">{{ r.manager.improvements }}</p></div>
            </div>
            <p v-if="r.manager.comment" class="mt-3 text-sm whitespace-pre-line text-fg">{{ r.manager.comment }}</p>
            <div v-if="r.acknowledgedAt" class="mt-4 border-t border-line/70 pt-3 text-sm">
              <p class="text-xs text-fg-muted">Acknowledged {{ formatDate(r.acknowledgedAt) }}</p>
              <p v-if="r.employeeResponse" class="text-fg">“{{ r.employeeResponse }}”</p>
            </div>
          </AppCard>
        </div>

        <div class="space-y-4">
          <AppCard title="People">
            <dl class="space-y-3 text-sm">
              <div><dt class="text-xs text-fg-muted">Employee</dt><dd class="text-fg">{{ r.employee.name }} ({{ r.employee.employeeCode }})</dd></div>
              <div><dt class="text-xs text-fg-muted">Reviewer</dt><dd :class="r.reviewer ? 'text-fg' : 'text-amber-700 dark:text-amber-300'">{{ r.reviewer?.name ?? 'Not assigned' }}</dd></div>
            </dl>
          </AppCard>
          <AppCard title="360 feedback" :description="r.viewer.isSubject && !r.cycle.resultsReleased ? `${r.feedbackRequested} requested · shared anonymously with your results` : undefined">
            <template v-if="r.permissions.requestFeedback" #actions><AppButton size="sm" variant="secondary" :icon="MessageSquarePlus" @click="requestIds = []; requestOpen = true">Request</AppButton></template>
            <p v-if="!r.feedback.length" class="text-sm text-fg-muted">{{ r.permissions.requestFeedback ? 'Ask colleagues you work with for feedback.' : 'No feedback to show.' }}</p>
            <ul v-else class="space-y-3">
              <li v-for="f in r.feedback" :key="f.id" class="rounded-xl p-3 text-sm ring-1 ring-line">
                <p class="flex items-center justify-between gap-2">
                  <span class="font-medium text-fg">{{ f.giver?.name ?? 'A colleague' }}</span>
                  <AppBadge size="sm" :tone="f.status === 'SUBMITTED' ? 'success' : f.status === 'DECLINED' ? 'neutral' : 'warning'">{{ f.status === 'SUBMITTED' ? (f.rating ? `Rated ${f.rating}` : 'Given') : f.status === 'DECLINED' ? 'Declined' : 'Requested' }}</AppBadge>
                </p>
                <template v-if="f.status === 'SUBMITTED'">
                  <p class="mt-2 text-xs text-fg-muted">Strengths</p>
                  <p class="text-fg">{{ f.strengths }}</p>
                  <p class="mt-2 text-xs text-fg-muted">To improve</p>
                  <p class="text-fg">{{ f.improvements }}</p>
                </template>
              </li>
            </ul>
          </AppCard>
        </div>
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
