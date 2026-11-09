<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { AlertTriangle, Award, CalendarClock, Check, CheckCircle2, ExternalLink, ListChecks, MapPin, Play, Printer, Star, UserRound, X } from '@lucide/vue';
import { trainingApi } from '@/modules/training/api/training.api';
import type { Assessment, EnrollmentDetail } from '@/modules/training/types';
import { COURSE_VISUALS, dateTile, daysUntil, overdueBy, relativeDay } from '@/modules/training/utils/course-visuals';
import { CATEGORY_LABELS, CERTIFICATION_LABELS, DELIVERY_LABELS, ENROLLMENT_STATUS_LABELS, certificationTone, enrollmentTone, hours, sessionWhen } from '@/modules/training/utils/training-format';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppErrorState, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime } from '@/shared/utils/format';

/** One enrolment: progress through the course, what's left, session, assessment, certificate and feedback. */
const route = useRoute();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const inHr = computed(() => route.path.startsWith('/hr'));
const enrollment = useAsync(() => trainingApi.enrollment(id.value));
watch(id, () => void enrollment.run());
const e = computed(() => enrollment.data.value);

const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<EnrollmentDetail>, success: string) {
  busy.value = key;
  try {
    enrollment.data.value = await fn();
    feedback.success(success);
  } catch (err) {
    feedback.error('Could not complete the action', err);
  } finally {
    busy.value = null;
  }
}
async function cancel() {
  if (!(await feedback.confirm({ title: 'Cancel this enrolment?', message: `${e.value!.course.title} is removed from ${inHr.value ? 'their' : 'your'} learning.`, confirmLabel: 'Cancel enrolment', danger: true }))) return;
  await act('cancel', () => trainingApi.cancel(id.value), 'Enrolment cancelled');
}
const sessionId = ref<string | null>(null);
const sessionOptions = computed(() => (e.value?.availableSessions ?? []).filter((s) => s.id !== e.value?.session?.id).map((s) => ({ value: s.id, label: sessionWhen(s), description: [s.location, s.capacity === null ? null : `${s.seatsLeft} seats left`].filter(Boolean).join(' · '), disabled: s.seatsLeft === 0 })));

// Assessment
const quiz = ref<Assessment | null>(null);
const answers = reactive<Record<string, number>>({});
const result = ref<{ score: number; passed: boolean; correct: number; total: number } | null>(null);
async function openQuiz() {
  busy.value = 'quiz';
  try {
    quiz.value = await trainingApi.assessment(id.value);
    for (const k of Object.keys(answers)) delete answers[k];
    result.value = null;
  } catch (err) {
    feedback.error('Could not open the assessment', err);
  } finally {
    busy.value = null;
  }
}
const answeredAll = computed(() => !!quiz.value && quiz.value.questions.every((q) => answers[q.id] !== undefined));
async function submitQuiz() {
  busy.value = 'submit';
  try {
    const r = await trainingApi.attempt(id.value, { ...answers });
    result.value = r.result;
    enrollment.data.value = r.enrollment;
  } catch (err) {
    feedback.error('Could not submit your answers', err);
  } finally {
    busy.value = null;
  }
}

const feedbackOpen = ref(false);
const rating = ref(0);
const comment = ref('');
async function sendFeedback() {
  feedbackOpen.value = false;
  await act('feedback', () => trainingApi.feedback(id.value, rating.value, comment.value || null), 'Thanks for your feedback');
}
const print = () => window.print();

// ---- Progress ------------------------------------------------------------------------------------------------------
type StepState = 'done' | 'current' | 'todo' | 'failed';
const steps = computed(() => {
  const v = e.value!;
  const sessionBased = v.course.delivery !== 'SELF_PACED';
  const closedBad = v.status === 'FAILED' || v.status === 'NO_SHOW' || v.status === 'CANCELLED';
  const out: { key: string; label: string; detail: string; state: StepState }[] = [
    { key: 'enrolled', label: 'Enrolled', detail: formatDate(v.createdAt), state: 'done' },
    { key: 'started', label: sessionBased ? 'Session booked' : 'Started', detail: sessionBased ? (v.session ? formatDate(v.session.startsAt) : 'Not booked') : v.startedAt ? formatDate(v.startedAt) : 'Not yet', state: (sessionBased ? !!v.session : !!v.startedAt || v.status !== 'ENROLLED') ? 'done' : 'todo' },
  ];
  if (sessionBased) out.push({ key: 'attended', label: 'Attended', detail: v.attended ? 'Recorded' : v.status === 'NO_SHOW' ? 'Missed' : 'Not yet', state: v.attended ? 'done' : v.status === 'NO_SHOW' ? 'failed' : 'todo' });
  if (v.course.hasAssessment) out.push({ key: 'assessment', label: 'Assessment', detail: v.passed ? `Passed · ${v.bestScore}%` : v.attempts ? `${v.attempts} of ${v.course.maxAttempts} attempts` : `Pass mark ${v.course.passMark}%`, state: v.passed ? 'done' : v.status === 'FAILED' ? 'failed' : 'todo' });
  out.push({ key: 'completed', label: v.status === 'CANCELLED' ? 'Cancelled' : 'Completed', detail: v.completedOn ? formatDate(v.completedOn) : v.status === 'CANCELLED' ? 'Enrolment ended' : v.dueDate ? `Due ${formatDate(v.dueDate)}` : 'Not yet', state: v.status === 'COMPLETED' ? 'done' : v.status === 'CANCELLED' ? 'failed' : 'todo' });
  // The first unfinished step is where the learner is now (unless the enrolment ended).
  const next = out.find((s) => s.state === 'todo');
  if (next && !closedBad) next.state = 'current';
  return out;
});
const doneSteps = computed(() => steps.value.filter((s) => s.state === 'done').length);
const stepClass: Record<StepState, string> = {
  done: 'bg-success text-white',
  current: 'bg-brand-600 text-white ring-4 ring-brand-500/20',
  todo: 'bg-surface-muted text-fg-subtle ring-1 ring-line',
  failed: 'bg-danger text-white',
};
const dueText = computed(() => {
  const v = e.value!;
  if (!v.dueDate) return null;
  if (v.overdue) return { text: overdueBy(v.dueDate), tone: 'text-danger-fg' };
  if (v.status === 'ENROLLED' || v.status === 'IN_PROGRESS') return { text: `Due ${relativeDay(v.dueDate)}`, tone: daysUntil(v.dueDate) <= 7 ? 'text-warning-fg' : 'text-fg-muted' };
  return null;
});
</script>

<template>
  <div>
    <AppSkeleton v-if="enrollment.loading.value && !e" :lines="8" />
    <AppErrorState v-else-if="enrollment.error.value" :error="enrollment.error.value" title="This enrolment isn't available" @retry="enrollment.run" />
    <template v-else-if="e">
      <AppPageHeader class="print:hidden" :title="e.course.title" :description="`${inHr ? `${e.employee.name} · ` : ''}${DELIVERY_LABELS[e.course.delivery]}${e.course.durationHours ? ` · ${hours(e.course.durationHours)}` : ''}`" :back="inHr ? '/hr/training/team' : '/me/training'" :back-label="inHr ? 'Team training' : 'My learning'">
        <template #leading>
          <span :class="['flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1 ring-black/5 max-sm:hidden dark:ring-white/10', COURSE_VISUALS[e.course.category].tile]" :title="CATEGORY_LABELS[e.course.category]" aria-hidden="true">
            <component :is="COURSE_VISUALS[e.course.category].icon" :size="22" />
          </span>
        </template>
        <template #badges>
          <AppBadge :tone="enrollmentTone[e.status]" dot>{{ ENROLLMENT_STATUS_LABELS[e.status] }}</AppBadge>
          <AppBadge v-if="e.overdue" tone="danger">Overdue</AppBadge>
          <AppBadge v-if="e.course.mandatory" tone="violet">Mandatory</AppBadge>
        </template>
        <template #actions>
          <AppButton v-if="e.permissions.cancel" variant="ghost" :loading="busy === 'cancel'" @click="cancel">Cancel enrolment</AppButton>
          <AppButton v-if="e.permissions.start" :icon="Play" :loading="busy === 'start'" @click="act('start', () => trainingApi.start(id), 'Course started')">Start</AppButton>
          <AppButton v-if="e.status === 'COMPLETED'" variant="secondary" :icon="Printer" @click="print">Print certificate</AppButton>
        </template>
      </AppPageHeader>

      <div class="space-y-4 print:hidden">
        <AppAlert v-if="e.requirementsLeft.length" tone="info" title="To complete this course">{{ e.requirementsLeft.join(' · ') }}{{ e.dueDate ? ` — by ${formatDate(e.dueDate)}` : '' }}</AppAlert>
        <AppAlert v-if="e.status === 'FAILED'" tone="warning" title="Assessment not passed">All attempts were used. You can enrol again from the catalog.</AppAlert>
        <AppAlert v-if="e.status === 'NO_SHOW'" tone="warning" title="Session missed">Ask your manager or HR to assign the course again, or enrol in another session.</AppAlert>

        <!-- Progress -->
        <section class="card px-4 py-4 sm:px-5" aria-labelledby="progress-title">
          <div class="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="progress-title" class="text-sm font-semibold text-fg">Progress</h2>
            <p class="text-xs text-fg-muted"><span class="font-semibold text-fg tabular-nums">{{ doneSteps }}</span> of {{ steps.length }} steps<template v-if="dueText"> · <span :class="['font-medium', dueText.tone]">{{ dueText.text }}</span></template></p>
          </div>
          <ol class="grid gap-y-4" :style="{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }">
            <li v-for="(st, i) in steps" :key="st.key" class="relative flex flex-col items-center text-center" :aria-current="st.state === 'current' ? 'step' : undefined">
              <span v-if="i > 0" :class="['absolute top-3.5 right-1/2 h-0.5 w-full -translate-y-1/2', st.state === 'done' || st.state === 'failed' || st.state === 'current' ? 'bg-success/60' : 'bg-line']" aria-hidden="true" />
              <span :class="['relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold', stepClass[st.state]]">
                <Check v-if="st.state === 'done'" :size="14" aria-hidden="true" />
                <X v-else-if="st.state === 'failed'" :size="14" aria-hidden="true" />
                <span v-else class="tabular-nums" aria-hidden="true">{{ i + 1 }}</span>
              </span>
              <span :class="['mt-2 text-xs font-medium', st.state === 'todo' ? 'text-fg-muted' : 'text-fg']">{{ st.label }}<span class="sr-only"> — {{ st.state === 'done' ? 'done' : st.state === 'failed' ? 'not achieved' : st.state === 'current' ? 'current step' : 'to do' }}</span></span>
              <span :class="['text-2xs', st.state === 'failed' ? 'text-danger-fg' : 'text-fg-subtle']">{{ st.detail }}</span>
            </li>
          </ol>
        </section>

        <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div class="min-w-0 space-y-4">
            <AppCard v-if="e.course.contentUrl || e.permissions.markDone" title="Course content" :icon="ExternalLink">
              <a v-if="e.course.contentUrl" :href="e.course.contentUrl" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 rounded-lg p-3 ring-1 ring-line transition hover:bg-surface-muted/50">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg" aria-hidden="true"><ExternalLink :size="16" /></span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium text-fg">Open the course</span>
                  <span class="block truncate text-xs text-fg-muted">{{ e.course.contentUrl }}</span>
                </span>
              </a>
              <div v-if="e.permissions.markDone" :class="e.course.contentUrl && 'mt-4 border-t border-line/70 pt-4'">
                <AppButton :icon="CheckCircle2" :loading="busy === 'done'" @click="act('done', () => trainingApi.markDone(id), 'Course completed')">I've finished this course</AppButton>
              </div>
            </AppCard>

            <AppCard v-if="e.course.delivery !== 'SELF_PACED'" title="Session" :icon="CalendarClock">
              <div v-if="e.session" class="flex items-start gap-4">
                <div class="flex w-12 shrink-0 flex-col items-center rounded-lg bg-accent-soft py-1.5 text-accent-fg">
                  <span class="text-2xs font-semibold uppercase">{{ dateTile(e.session.startsAt).month }}</span>
                  <span class="text-lg leading-5 font-semibold tabular-nums">{{ dateTile(e.session.startsAt).day }}</span>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="font-medium text-fg">{{ sessionWhen(e.session) }}</p>
                  <p class="mt-0.5 flex flex-wrap gap-x-3 text-sm text-fg-muted">
                    <span v-if="e.session.location" class="inline-flex items-center gap-1"><MapPin :size="13" aria-hidden="true" />{{ e.session.location }}</span>
                    <span v-if="e.session.trainer" class="inline-flex items-center gap-1"><UserRound :size="13" aria-hidden="true" />Trainer: {{ e.session.trainer }}</span>
                  </p>
                  <p :class="['mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', e.attended ? 'bg-success-soft text-success-fg' : 'bg-surface-muted text-fg-muted']">
                    <CheckCircle2 v-if="e.attended" :size="12" aria-hidden="true" />{{ e.attended ? 'Attendance recorded' : 'Attendance not recorded yet' }}
                  </p>
                </div>
              </div>
              <p v-else class="text-sm text-fg-muted">No session chosen yet.</p>
              <div v-if="e.permissions.changeSession && sessionOptions.length" class="mt-4 flex flex-wrap items-end gap-2 border-t border-line/70 pt-4">
                <AppSelect v-model="sessionId" class="min-w-64 flex-1" :label="e.session ? 'Switch to another session' : 'Choose a session'" :options="sessionOptions" placeholder="Choose" />
                <AppButton :disabled="!sessionId" :loading="busy === 'session'" @click="act('session', () => trainingApi.changeSession(id, sessionId!), 'Session updated').then(() => (sessionId = null))">Save</AppButton>
              </div>
            </AppCard>

            <AppCard v-if="e.course.hasAssessment" title="Assessment" :icon="ListChecks" :description="`Pass mark ${e.course.passMark}% · ${e.attempts} of ${e.course.maxAttempts} attempts used${e.bestScore !== null ? ` · best ${e.bestScore}%` : ''}`">
              <template v-if="quiz && !result">
                <ol class="space-y-5">
                  <li v-for="(q, qi) in quiz.questions" :key="q.id">
                    <fieldset>
                      <legend class="mb-2 text-sm font-medium text-fg">{{ qi + 1 }}. {{ q.prompt }}</legend>
                      <div class="space-y-2">
                        <label v-for="(o, oi) in q.options" :key="oi" class="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-line has-[:checked]:ring-2 has-[:checked]:ring-brand-500">
                          <input v-model="answers[q.id]" type="radio" :name="q.id" :value="oi" class="accent-brand-600" />
                          {{ o }}
                        </label>
                      </div>
                    </fieldset>
                  </li>
                </ol>
                <div class="mt-4 flex justify-end gap-2">
                  <AppButton variant="secondary" @click="quiz = null">Cancel</AppButton>
                  <AppButton :loading="busy === 'submit'" :disabled="!answeredAll" @click="submitQuiz">Submit answers</AppButton>
                </div>
              </template>
              <template v-else>
                <AppAlert v-if="result" :tone="result.passed ? 'success' : 'warning'" class="mb-4" :title="result.passed ? 'Passed' : 'Not passed'">You scored {{ result.score }}% ({{ result.correct }} of {{ result.total }}).</AppAlert>
                <ul v-if="e.attemptHistory.length" class="mb-4 space-y-2.5">
                  <li v-for="(a, i) in e.attemptHistory" :key="a.id" class="grid grid-cols-[minmax(0,12rem)_1fr_3.5rem] items-center gap-3 text-sm">
                    <span class="truncate text-fg-muted">Attempt {{ i + 1 }} · {{ formatDateTime(a.createdAt) }}</span>
                    <span class="relative h-2 rounded-full bg-surface-muted" role="img" :aria-label="`${a.score}%, pass mark ${e.course.passMark}%`">
                      <span :class="['block h-2 rounded-full', a.passed ? 'bg-success' : 'bg-warning']" :style="{ width: `${a.score}%` }" />
                      <span class="absolute -top-1 h-4 w-0.5 rounded bg-fg/40" :style="{ left: `${e.course.passMark}%` }" aria-hidden="true" />
                    </span>
                    <span :class="['text-end font-medium tabular-nums', a.passed ? 'text-success-fg' : 'text-fg']">{{ a.score }}%</span>
                  </li>
                </ul>
                <p v-if="e.attemptHistory.length" class="-mt-2 mb-4 text-2xs text-fg-subtle">The marker shows the pass mark.</p>
                <AppButton v-if="e.permissions.attempt" :loading="busy === 'quiz'" @click="openQuiz">{{ e.attempts ? 'Try again' : 'Take the assessment' }}</AppButton>
                <p v-else-if="e.passed" class="flex items-center gap-1.5 text-sm text-success-fg"><CheckCircle2 :size="15" aria-hidden="true" />Assessment passed.</p>
                <p v-else-if="!e.attemptHistory.length" class="text-sm text-fg-muted">No attempts yet.</p>
              </template>
            </AppCard>
          </div>

          <aside class="space-y-4">
            <AppCard v-if="inHr" title="Learner" :icon="UserRound">
              <div class="flex items-center gap-3">
                <AppAvatar :name="e.employee.name" size="lg" />
                <div class="min-w-0">
                  <p class="truncate font-medium text-fg">{{ e.employee.name }}</p>
                  <p class="truncate text-xs text-fg-muted">{{ e.employee.department ?? '—' }} · <span class="font-mono">{{ e.employee.employeeCode }}</span></p>
                </div>
              </div>
            </AppCard>
            <section v-if="e.status === 'COMPLETED'" class="card overflow-hidden" aria-labelledby="cert-title">
              <div class="bg-gradient-to-br from-amber-100/80 via-amber-50/40 to-transparent p-4 dark:from-amber-500/15 dark:via-amber-500/5">
                <div class="flex items-start gap-3">
                  <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-100 to-amber-50 text-amber-600 ring-1 ring-amber-500/25 dark:from-amber-500/20 dark:to-amber-500/5 dark:text-amber-300" aria-hidden="true"><Award :size="18" /></span>
                  <div class="min-w-0 flex-1">
                    <h2 id="cert-title" class="text-sm font-semibold text-fg">Certificate</h2>
                    <p class="truncate font-mono text-xs text-fg-muted">{{ e.certificateNumber }}</p>
                  </div>
                  <AppBadge v-if="e.certification" :tone="certificationTone[e.certification]" size="sm" dot>{{ CERTIFICATION_LABELS[e.certification] }}</AppBadge>
                </div>
                <dl class="mt-4 grid grid-cols-2 gap-2 border-t border-dashed border-amber-500/30 pt-3 text-xs">
                  <div>
                    <dt class="text-fg-subtle">Completed</dt>
                    <dd class="mt-0.5 font-medium text-fg">{{ formatDate(e.completedOn!) }}</dd>
                  </div>
                  <div>
                    <dt class="text-fg-subtle">{{ e.expiresOn ? (e.certification === 'EXPIRED' ? 'Expired' : 'Valid until') : 'Validity' }}</dt>
                    <dd :class="['mt-0.5 font-medium', e.certification === 'EXPIRED' ? 'text-danger-fg' : e.certification === 'EXPIRING' ? 'text-warning-fg' : 'text-fg']">{{ e.expiresOn ? formatDate(e.expiresOn) : 'Does not expire' }}</dd>
                  </div>
                </dl>
                <AppButton class="mt-3" block size="sm" variant="secondary" :icon="Printer" @click="print">Print certificate</AppButton>
              </div>
            </section>
            <AppCard v-if="e.status === 'COMPLETED'" :title="inHr ? 'Learner feedback' : 'Your feedback'" :icon="Star">
              <div v-if="e.feedback" class="text-sm">
                <p class="flex gap-0.5" :aria-label="`${e.feedback.rating} out of 5`">
                  <Star v-for="n in 5" :key="n" :size="16" :class="n <= e.feedback.rating ? 'fill-amber-400 text-amber-400' : 'text-fg-subtle/40'" aria-hidden="true" />
                </p>
                <p v-if="e.feedback.comment" class="mt-2 text-fg-muted">“{{ e.feedback.comment }}”</p>
              </div>
              <AppButton v-else-if="e.permissions.feedback" size="sm" variant="secondary" :icon="Star" @click="rating = 0; comment = ''; feedbackOpen = true">Rate this course</AppButton>
              <p v-else class="text-sm text-fg-muted">No feedback.</p>
            </AppCard>
            <AppCard title="Details">
              <dl class="space-y-2.5 text-sm">
                <div class="flex justify-between gap-3"><dt class="text-fg-muted">Learner</dt><dd class="text-end text-fg">{{ e.employee.name }}</dd></div>
                <div class="flex justify-between gap-3"><dt class="text-fg-muted">Course</dt><dd class="text-end font-mono text-xs text-fg">{{ e.course.code }}</dd></div>
                <div class="flex justify-between gap-3"><dt class="text-fg-muted">How</dt><dd class="text-fg">{{ e.source === 'ASSIGNED' ? 'Assigned' : 'Self-enrolled' }}</dd></div>
                <div v-if="e.dueDate" class="flex justify-between gap-3">
                  <dt class="text-fg-muted">Due</dt>
                  <dd :class="['text-end', e.overdue ? 'font-medium text-danger-fg' : 'text-fg']">
                    <span class="inline-flex items-center gap-1"><AlertTriangle v-if="e.overdue" :size="13" aria-hidden="true" />{{ formatDate(e.dueDate) }}</span>
                    <span v-if="dueText" :class="['block text-2xs', dueText.tone]">{{ dueText.text }}</span>
                  </dd>
                </div>
                <div class="flex justify-between gap-3"><dt class="text-fg-muted">Enrolled</dt><dd class="text-fg">{{ formatDate(e.createdAt) }}</dd></div>
                <div v-if="e.startedAt" class="flex justify-between gap-3"><dt class="text-fg-muted">Started</dt><dd class="text-fg">{{ formatDate(e.startedAt) }}</dd></div>
                <div v-if="e.cancelReason" class="flex justify-between gap-3"><dt class="text-fg-muted">Cancel reason</dt><dd class="text-end text-fg">{{ e.cancelReason }}</dd></div>
              </dl>
            </AppCard>
          </aside>
        </div>
      </div>

      <!-- Printable certificate -->
      <section v-if="e.status === 'COMPLETED'" class="hidden print:block">
        <div class="mx-auto mt-16 max-w-3xl border-4 border-double border-neutral-400 p-12 text-center text-neutral-900">
          <p class="text-sm tracking-[0.3em] uppercase">Certificate of completion</p>
          <p class="mt-4 text-lg">This certifies that</p>
          <p class="mt-2 text-4xl font-semibold">{{ e.employee.name }}</p>
          <p class="mt-4 text-lg">has completed</p>
          <p class="mt-2 text-2xl font-semibold">{{ e.course.title }}</p>
          <p class="mt-2 text-sm">{{ e.course.code }}{{ e.course.durationHours ? ` · ${hours(e.course.durationHours)}` : '' }}{{ e.bestScore !== null ? ` · score ${e.bestScore}%` : '' }}</p>
          <p class="mt-10 text-sm">{{ auth.organization?.name }} · completed {{ formatDate(e.completedOn!) }}{{ e.expiresOn ? ` · valid until ${formatDate(e.expiresOn)}` : '' }}</p>
          <p class="mt-2 font-mono text-xs">{{ e.certificateNumber }}</p>
        </div>
      </section>

      <AppModal :open="feedbackOpen" title="Rate this course" size="sm" @close="feedbackOpen = false">
        <div class="space-y-4">
          <div class="flex gap-1" role="radiogroup" aria-label="Rating">
            <button v-for="n in 5" :key="n" type="button" role="radio" :aria-checked="rating === n" :aria-label="`${n} of 5`" class="text-3xl" :class="n <= rating ? 'text-warning' : 'text-fg-subtle/40 hover:text-warning'" @click="rating = n">★</button>
          </div>
          <AppTextarea v-model="comment" label="Comments" :rows="3" :maxlength="2000" placeholder="What worked, what could be better" />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="feedbackOpen = false">Cancel</AppButton>
          <AppButton :disabled="!rating" @click="sendFeedback">Send</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
