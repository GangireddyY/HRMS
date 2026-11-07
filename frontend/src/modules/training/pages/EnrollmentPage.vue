<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Award, CheckCircle2, ExternalLink, Play, Printer, Star } from '@lucide/vue';
import { trainingApi } from '@/modules/training/api/training.api';
import type { Assessment, EnrollmentDetail } from '@/modules/training/types';
import { CERTIFICATION_LABELS, DELIVERY_LABELS, ENROLLMENT_STATUS_LABELS, certificationTone, enrollmentTone, hours, sessionWhen } from '@/modules/training/utils/training-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppErrorState, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime } from '@/shared/utils/format';

/** One enrolment: what's left to complete, session, assessment, certificate and feedback. */
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
</script>

<template>
  <div>
    <AppSkeleton v-if="enrollment.loading.value && !e" :lines="8" />
    <AppErrorState v-else-if="enrollment.error.value" :error="enrollment.error.value" title="This enrolment isn't available" @retry="enrollment.run" />
    <template v-else-if="e">
      <AppPageHeader class="print:hidden" :title="e.course.title" :description="`${inHr ? `${e.employee.name} · ` : ''}${DELIVERY_LABELS[e.course.delivery]}${e.course.durationHours ? ` · ${hours(e.course.durationHours)}` : ''}`" :back="inHr ? '/hr/training/team' : '/me/training'" :back-label="inHr ? 'Team training' : 'My learning'">
        <template #badges>
          <AppBadge :tone="enrollmentTone[e.status]" dot>{{ ENROLLMENT_STATUS_LABELS[e.status] }}</AppBadge>
          <AppBadge v-if="e.overdue" tone="danger">Overdue</AppBadge>
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

        <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div class="space-y-4">
            <AppCard v-if="e.course.contentUrl || e.permissions.markDone" title="Course content">
              <a v-if="e.course.contentUrl" :href="e.course.contentUrl" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"><ExternalLink :size="14" aria-hidden="true" />Open the course</a>
              <div v-if="e.permissions.markDone" class="mt-4 border-t border-line/70 pt-4">
                <AppButton :icon="CheckCircle2" :loading="busy === 'done'" @click="act('done', () => trainingApi.markDone(id), 'Course completed')">I've finished this course</AppButton>
              </div>
            </AppCard>

            <AppCard v-if="e.course.delivery !== 'SELF_PACED'" title="Session">
              <template v-if="e.session">
                <p class="font-medium text-fg">{{ sessionWhen(e.session) }}</p>
                <p class="text-sm text-fg-muted">{{ [e.session.location, e.session.trainer ? `Trainer: ${e.session.trainer}` : null].filter(Boolean).join(' · ') }}</p>
                <p class="mt-1 text-xs" :class="e.attended ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg-subtle'">{{ e.attended ? 'Attendance recorded' : 'Attendance not recorded yet' }}</p>
              </template>
              <p v-else class="text-sm text-fg-muted">No session chosen yet.</p>
              <div v-if="e.permissions.changeSession && sessionOptions.length" class="mt-4 flex flex-wrap items-end gap-2 border-t border-line/70 pt-4">
                <AppSelect v-model="sessionId" class="min-w-64 flex-1" :label="e.session ? 'Switch to another session' : 'Choose a session'" :options="sessionOptions" placeholder="Choose" />
                <AppButton :disabled="!sessionId" :loading="busy === 'session'" @click="act('session', () => trainingApi.changeSession(id, sessionId!), 'Session updated').then(() => (sessionId = null))">Save</AppButton>
              </div>
            </AppCard>

            <AppCard v-if="e.course.hasAssessment" title="Assessment" :description="`Pass mark ${e.course.passMark}% · ${e.attempts} of ${e.course.maxAttempts} attempts used${e.bestScore !== null ? ` · best ${e.bestScore}%` : ''}`">
              <template v-if="quiz && !result">
                <ol class="space-y-5">
                  <li v-for="(q, qi) in quiz.questions" :key="q.id">
                    <fieldset>
                      <legend class="mb-2 text-sm font-medium text-fg">{{ qi + 1 }}. {{ q.prompt }}</legend>
                      <div class="space-y-1.5">
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
                <ul v-if="e.attemptHistory.length" class="mb-4 space-y-1 text-sm">
                  <li v-for="(a, i) in e.attemptHistory" :key="a.id" class="flex justify-between gap-3"><span class="text-fg-muted">Attempt {{ i + 1 }} · {{ formatDateTime(a.createdAt) }}</span><span :class="a.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg'">{{ a.score }}%</span></li>
                </ul>
                <AppButton v-if="e.permissions.attempt" :loading="busy === 'quiz'" @click="openQuiz">{{ e.attempts ? 'Try again' : 'Take the assessment' }}</AppButton>
                <p v-else-if="e.passed" class="text-sm text-emerald-600 dark:text-emerald-400">Assessment passed.</p>
              </template>
            </AppCard>
          </div>

          <div class="space-y-4">
            <AppCard v-if="e.status === 'COMPLETED'" title="Certificate">
              <p class="flex items-center gap-2 font-medium text-fg"><Award :size="18" class="text-brand-500" aria-hidden="true" />{{ e.certificateNumber }}</p>
              <p class="mt-1 text-sm text-fg-muted">Completed {{ formatDate(e.completedOn!) }}{{ e.expiresOn ? ` · valid until ${formatDate(e.expiresOn)}` : '' }}</p>
              <AppBadge v-if="e.certification" class="mt-2" :tone="certificationTone[e.certification]" size="sm">{{ CERTIFICATION_LABELS[e.certification] }}</AppBadge>
            </AppCard>
            <AppCard v-if="e.status === 'COMPLETED'" title="Your feedback">
              <p v-if="e.feedback" class="text-sm"><span class="text-amber-500">{{ '★'.repeat(e.feedback.rating) }}</span><span class="text-fg-subtle">{{ '★'.repeat(5 - e.feedback.rating) }}</span> <span class="block text-fg-muted">{{ e.feedback.comment }}</span></p>
              <AppButton v-else-if="e.permissions.feedback" size="sm" variant="secondary" :icon="Star" @click="rating = 0; comment = ''; feedbackOpen = true">Rate this course</AppButton>
              <p v-else class="text-sm text-fg-muted">No feedback.</p>
            </AppCard>
            <AppCard title="Details">
              <dl class="space-y-2 text-sm">
                <div class="flex justify-between gap-3"><dt class="text-fg-muted">Learner</dt><dd>{{ e.employee.name }}</dd></div>
                <div class="flex justify-between gap-3"><dt class="text-fg-muted">How</dt><dd>{{ e.source === 'ASSIGNED' ? 'Assigned' : 'Self-enrolled' }}</dd></div>
                <div v-if="e.dueDate" class="flex justify-between gap-3"><dt class="text-fg-muted">Due</dt><dd :class="e.overdue && 'text-red-600 dark:text-red-400'">{{ formatDate(e.dueDate) }}</dd></div>
                <div class="flex justify-between gap-3"><dt class="text-fg-muted">Enrolled</dt><dd>{{ formatDate(e.createdAt) }}</dd></div>
              </dl>
            </AppCard>
          </div>
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
            <button v-for="n in 5" :key="n" type="button" role="radio" :aria-checked="rating === n" :aria-label="`${n} of 5`" class="text-3xl" :class="n <= rating ? 'text-amber-500' : 'text-fg-subtle/40 hover:text-amber-300'" @click="rating = n">★</button>
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
