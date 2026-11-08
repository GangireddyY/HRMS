<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Archive, CalendarPlus, ClipboardCheck, ExternalLink, ListChecks, Pencil, Rocket, Trash2, UserPlus, XCircle } from '@lucide/vue';
import { trainingApi } from '@/modules/training/api/training.api';
import AssignModal from '@/modules/training/components/AssignModal.vue';
import CourseSkillsCard from '@/modules/training/components/CourseSkillsCard.vue';
import AttendanceModal from '@/modules/training/components/AttendanceModal.vue';
import CourseFormModal from '@/modules/training/components/CourseFormModal.vue';
import QuestionsModal from '@/modules/training/components/QuestionsModal.vue';
import SessionFormModal from '@/modules/training/components/SessionFormModal.vue';
import type { CourseDetail, RosterRow, Session } from '@/modules/training/types';
import { CATEGORY_LABELS, COURSE_STATUS_LABELS, DELIVERY_LABELS, ENROLLMENT_STATUS_LABELS, courseTone, enrollmentTone, hours, isSessionBasedDelivery, sessionWhen } from '@/modules/training/utils/training-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppErrorState, AppModal, AppPageHeader, AppSelect, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Course page: details and sessions for everyone; enrolment for learners; sessions, assessment, roster and assignment for HR. */
const route = useRoute();
const router = useRouter();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const inHr = computed(() => route.path.startsWith('/hr'));
const course = useAsync(() => trainingApi.course(id.value));
const c = computed(() => course.data.value);
const roster = useAsync(() => trainingApi.roster(id.value), { immediate: false });
watch(
  c,
  (v) => {
    if (v?.permissions.manage && inHr.value && !roster.data.value) void roster.run();
  },
  { immediate: true },
);
watch(id, () => {
  roster.data.value = null;
  void course.run();
});
const sessionBased = computed(() => !!c.value && isSessionBasedDelivery(c.value.delivery));
const upcoming = computed(() => (c.value?.sessions ?? []).filter((s) => s.status === 'SCHEDULED' && new Date(s.startsAt) > new Date()));

const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<CourseDetail>, success: string) {
  busy.value = key;
  try {
    course.data.value = await fn();
    feedback.success(success);
  } catch (e) {
    feedback.error('Could not complete the action', e);
  } finally {
    busy.value = null;
  }
}
async function remove() {
  if (!(await feedback.confirm({ title: `Delete ${c.value!.code}?`, message: 'The draft course is deleted.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await trainingApi.removeCourse(id.value);
    feedback.success('Course deleted');
    await router.replace('/hr/training/courses');
  } catch (e) {
    feedback.error('Could not delete the course', e);
  }
}
async function archive() {
  if (!(await feedback.confirm({ title: `Archive ${c.value!.code}?`, message: 'It leaves the catalog; people already enrolled can still finish it.', confirmLabel: 'Archive' }))) return;
  await act('archive', () => trainingApi.archive(id.value), 'Course archived');
}
async function cancelSession(s: Session) {
  if (!(await feedback.confirm({ title: 'Cancel this session?', message: `${sessionWhen(s)}. Enrolled people are notified and asked to pick another session.`, confirmLabel: 'Cancel session', danger: true }))) return;
  await act(`cancel-${s.id}`, () => trainingApi.cancelSession(s.id), 'Session cancelled');
  void roster.run();
}

const editOpen = ref(false);
const questionsOpen = ref(false);
const sessionOpen = ref(false);
const editingSession = ref<Session | null>(null);
const attendanceFor = ref<Session | null>(null);
const assignOpen = ref(false);
function onSaved(next: CourseDetail, message: string) {
  editOpen.value = false;
  questionsOpen.value = false;
  sessionOpen.value = false;
  course.data.value = next;
  feedback.success(message);
}
async function onAssigned(r: { assigned: number; skipped: { name: string; reason: string }[] }) {
  assignOpen.value = false;
  feedback.success(`Assigned to ${r.assigned} ${r.assigned === 1 ? 'person' : 'people'}`, r.skipped.length ? `${r.skipped.length} skipped: ${r.skipped.slice(0, 3).map((s) => `${s.name || 'someone'} (${s.reason.toLowerCase()})`).join(', ')}${r.skipped.length > 3 ? '…' : ''}` : undefined);
  await Promise.all([roster.run(), course.run()]);
}
async function onAttendance() {
  attendanceFor.value = null;
  await Promise.all([roster.run(), course.run()]);
}

// Learner enrolment
const enrollOpen = ref(false);
const sessionId = ref<string | null>(null);
const sessionOptions = computed(() => upcoming.value.map((s) => ({ value: s.id, label: sessionWhen(s), description: [s.location, s.capacity === null ? null : `${s.seatsLeft} seats left`].filter(Boolean).join(' · '), disabled: s.seatsLeft === 0 })));
async function enroll() {
  busy.value = 'enroll';
  try {
    const e = await trainingApi.enroll(id.value, sessionBased.value ? sessionId.value : null);
    enrollOpen.value = false;
    feedback.success('Enrolled', sessionBased.value ? 'See you at the session.' : 'You can start right away.');
    await router.push(`/me/training/enrollments/${e.id}`);
  } catch (e) {
    feedback.error('Could not enrol', e);
  } finally {
    busy.value = null;
  }
}
const rosterRows = computed<RosterRow[]>(() => roster.data.value ?? []);
</script>

<template>
  <div>
    <AppSkeleton v-if="course.loading.value && !c" :lines="8" />
    <AppErrorState v-else-if="course.error.value" :error="course.error.value" title="This course isn't available" @retry="course.run" />
    <template v-else-if="c">
      <AppPageHeader :title="c.title" :description="`${c.code} · ${CATEGORY_LABELS[c.category]} · ${DELIVERY_LABELS[c.delivery]}${c.durationHours ? ` · ${hours(c.durationHours)}` : ''}${c.provider ? ` · ${c.provider}` : ''}`" :back="inHr ? '/hr/training/courses' : '/me/training/catalog'" :back-label="inHr ? 'Courses' : 'Catalog'">
        <template #badges>
          <AppBadge v-if="c.permissions.manage" :tone="courseTone[c.status]" dot>{{ COURSE_STATUS_LABELS[c.status] }}</AppBadge>
          <AppBadge v-if="c.mandatory" tone="warning">Mandatory</AppBadge>
        </template>
        <template #actions>
          <template v-if="inHr && c.permissions.manage">
            <AppButton v-if="c.status === 'DRAFT'" variant="ghost" :icon="Trash2" aria-label="Delete course" @click="remove" />
            <AppButton v-if="c.status === 'PUBLISHED'" variant="ghost" :icon="Archive" :loading="busy === 'archive'" @click="archive">Archive</AppButton>
            <AppButton v-if="c.status !== 'ARCHIVED'" variant="secondary" :icon="Pencil" @click="editOpen = true">Edit</AppButton>
            <AppButton v-if="c.status === 'DRAFT'" :icon="Rocket" :loading="busy === 'publish'" @click="act('publish', () => trainingApi.publish(id), 'Course published')">Publish</AppButton>
          </template>
          <AppButton v-if="inHr && c.permissions.assign" :icon="UserPlus" @click="assignOpen = true">Assign</AppButton>
          <template v-if="!inHr">
            <AppButton v-if="c.myEnrollment && ['ENROLLED', 'IN_PROGRESS', 'COMPLETED'].includes(c.myEnrollment.status)" :to="`/me/training/enrollments/${c.myEnrollment.id}`">Open my enrolment</AppButton>
            <AppButton v-else-if="c.permissions.enroll" :disabled="sessionBased && !upcoming.length" @click="sessionId = null; enrollOpen = true">Enrol</AppButton>
          </template>
        </template>
      </AppPageHeader>

      <AppAlert v-if="!inHr && !c.selfEnrollment && !c.myEnrollment" tone="info" class="mb-4">This course is assigned by your manager or HR.</AppAlert>
      <AppAlert v-if="inHr && c.status === 'DRAFT' && c.hasAssessment && !c.questionCount" tone="warning" class="mb-4" title="Add the assessment questions">The course can be published once it has questions.</AppAlert>

      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div class="space-y-4">
          <AppCard title="About this course">
            <p v-if="c.description" class="text-sm whitespace-pre-line text-fg">{{ c.description }}</p>
            <p v-else class="text-sm text-fg-muted">No description.</p>
            <a v-if="c.contentUrl" :href="c.contentUrl" target="_blank" rel="noopener noreferrer" class="mt-3 inline-flex items-center gap-2 text-sm font-medium text-accent-fg hover:underline"><ExternalLink :size="14" aria-hidden="true" />{{ c.delivery === 'SELF_PACED' ? 'Course content' : 'Pre-reading' }}</a>
          </AppCard>

          <AppCard v-if="sessionBased" title="Sessions">
            <template v-if="inHr && c.permissions.manage && c.status !== 'ARCHIVED'" #actions><AppButton size="sm" variant="secondary" :icon="CalendarPlus" @click="editingSession = null; sessionOpen = true">Schedule</AppButton></template>
            <p v-if="!c.sessions.length" class="text-sm text-fg-muted">No upcoming sessions.</p>
            <ul v-else class="divide-y divide-line/70">
              <li v-for="s in c.sessions" :key="s.id" class="flex flex-wrap items-center gap-3 py-3">
                <div class="min-w-0 flex-1">
                  <p class="font-medium text-fg">{{ sessionWhen(s) }}</p>
                  <p class="text-xs text-fg-muted">{{ [s.location, s.trainer ? `Trainer: ${s.trainer}` : null].filter(Boolean).join(' · ') || '—' }}</p>
                  <p class="text-xs text-fg-subtle">{{ s.enrolled ?? 0 }} enrolled{{ s.capacity !== null ? ` of ${s.capacity}` : '' }}</p>
                </div>
                <AppBadge v-if="s.status !== 'SCHEDULED'" size="sm" :tone="s.status === 'COMPLETED' ? 'success' : 'neutral'">{{ s.status === 'COMPLETED' ? 'Held' : 'Cancelled' }}</AppBadge>
                <template v-if="inHr && c.permissions.manage && s.status !== 'CANCELLED'">
                  <AppButton v-if="new Date(s.startsAt) <= new Date()" size="sm" variant="secondary" :icon="ClipboardCheck" @click="attendanceFor = s">Attendance</AppButton>
                  <template v-if="s.status === 'SCHEDULED'">
                    <AppButton size="sm" variant="ghost" :icon="Pencil" aria-label="Reschedule" @click="editingSession = s; sessionOpen = true" />
                    <AppButton size="sm" variant="ghost" :icon="XCircle" aria-label="Cancel session" :loading="busy === `cancel-${s.id}`" @click="cancelSession(s)" />
                  </template>
                </template>
              </li>
            </ul>
          </AppCard>

          <AppCard v-if="inHr && c.permissions.manage" title="Roster" :padded="false">
            <AppSkeleton v-if="roster.loading.value && !roster.data.value" class="p-4" :lines="3" />
            <p v-else-if="!rosterRows.length" class="p-4 text-sm text-fg-muted">Nobody has enrolled yet.</p>
            <ul v-else class="divide-y divide-line">
              <li v-for="r in rosterRows" :key="r.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
                <div class="min-w-0 flex-1">
                  <RouterLink :to="`/hr/training/enrollments/${r.id}`" class="font-medium text-fg hover:underline">{{ r.employee.name }}</RouterLink>
                  <p class="text-xs text-fg-muted">{{ r.employee.department ?? r.employee.employeeCode }} · {{ r.source === 'ASSIGNED' ? 'assigned' : 'self-enrolled' }}{{ r.dueDate ? ` · due ${formatDate(r.dueDate)}` : '' }}{{ r.bestScore !== null ? ` · best score ${r.bestScore}%` : '' }}</p>
                </div>
                <span v-if="r.feedbackRating" class="text-xs text-warning-fg">{{ '★'.repeat(r.feedbackRating) }}</span>
                <AppBadge :tone="enrollmentTone[r.status]" size="sm">{{ ENROLLMENT_STATUS_LABELS[r.status] }}</AppBadge>
              </li>
            </ul>
          </AppCard>
        </div>

        <div class="space-y-4">
          <AppCard title="Completion">
            <ul class="space-y-2 text-sm text-fg">
              <li v-if="sessionBased">Attend a session</li>
              <li v-if="c.hasAssessment">Pass the assessment ({{ c.passMark }}%, {{ c.maxAttempts }} attempt{{ c.maxAttempts === 1 ? '' : 's' }})</li>
              <li v-if="!sessionBased && !c.hasAssessment">Go through the content and mark it done</li>
              <li class="text-fg-muted">{{ c.validityMonths ? `Certificate valid for ${c.validityMonths} months` : 'Certificate does not expire' }}</li>
            </ul>
            <AppButton v-if="inHr && c.permissions.manage && c.hasAssessment && c.status !== 'ARCHIVED'" class="mt-4" size="sm" variant="secondary" :icon="ListChecks" @click="questionsOpen = true">Assessment questions ({{ c.questionCount ?? 0 }})</AppButton>
          </AppCard>
          <CourseSkillsCard :course-id="c.id" :editable="inHr && c.permissions.manage && c.status !== 'ARCHIVED'" />
          <AppCard v-if="c.feedback.count" title="Learner feedback">
            <p class="text-2xl font-semibold text-fg">{{ c.feedback.average }} <span class="text-sm font-normal text-fg-muted">/ 5 from {{ c.feedback.count }} learner{{ c.feedback.count === 1 ? '' : 's' }}</span></p>
          </AppCard>
        </div>
      </div>

      <CourseFormModal :open="editOpen" :course="c" @close="editOpen = false" @saved="(n) => onSaved(n, 'Course updated')" />
      <QuestionsModal v-if="c.permissions.manage" :open="questionsOpen" :course="c" @close="questionsOpen = false" @saved="(n) => onSaved(n, 'Assessment saved')" />
      <SessionFormModal :open="sessionOpen" :course-id="c.id" :session="editingSession" :virtual="c.delivery === 'VIRTUAL'" @close="sessionOpen = false" @saved="(n) => onSaved(n, editingSession ? 'Session rescheduled' : 'Session scheduled')" />
      <AttendanceModal :open="!!attendanceFor" :course-id="c.id" :session="attendanceFor" @close="attendanceFor = null" @saved="onAttendance" />
      <AssignModal v-if="c.permissions.assign" :open="assignOpen" :course="c" @close="assignOpen = false" @done="onAssigned" />
      <AppModal :open="enrollOpen" :title="`Enrol in ${c.title}`" size="sm" @close="enrollOpen = false">
        <AppSelect v-if="sessionBased" v-model="sessionId" label="Session" :options="sessionOptions" placeholder="Choose a session" :clearable="false" />
        <p v-else class="text-sm text-fg-muted">You can start straight away and take it at your own pace.</p>
        <template #footer>
          <AppButton variant="secondary" @click="enrollOpen = false">Cancel</AppButton>
          <AppButton :loading="busy === 'enroll'" :disabled="sessionBased && !sessionId" @click="enroll">Enrol</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
