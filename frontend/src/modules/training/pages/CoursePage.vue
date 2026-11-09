<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  AlertTriangle,
  Archive,
  Award,
  BookOpenCheck,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Filter,
  ListChecks,
  MapPin,
  MessageSquareText,
  Pencil,
  Rocket,
  Star,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  XCircle,
} from '@lucide/vue';
import type { EnrollmentStatus } from '@contracts';
import { trainingApi } from '@/modules/training/api/training.api';
import AssignModal from '@/modules/training/components/AssignModal.vue';
import CourseSkillsCard from '@/modules/training/components/CourseSkillsCard.vue';
import AttendanceModal from '@/modules/training/components/AttendanceModal.vue';
import CourseFormModal from '@/modules/training/components/CourseFormModal.vue';
import QuestionsModal from '@/modules/training/components/QuestionsModal.vue';
import SessionFormModal from '@/modules/training/components/SessionFormModal.vue';
import type { CourseDetail, RosterRow, Session } from '@/modules/training/types';
import { COURSE_VISUALS, DELIVERY_ICON, dateTile, daysUntil, overdueBy, pct, relativeDay, todayIso } from '@/modules/training/utils/course-visuals';
import { CATEGORY_LABELS, COURSE_STATUS_LABELS, DELIVERY_LABELS, ENROLLMENT_STATUS_LABELS, courseTone, enrollmentTone, hours, isSessionBasedDelivery, sessionWhen } from '@/modules/training/utils/training-format';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppStatStrip, type StripItem } from '@/shared/components';
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
  rosterFilter.value = null;
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
const showRoster = computed(() => inHr.value && !!c.value?.permissions.manage);

// ---- Roster summary and filter -----------------------------------------------------------------------------------
const OPEN: EnrollmentStatus[] = ['ENROLLED', 'IN_PROGRESS'];
const isOverdue = (r: RosterRow) => OPEN.includes(r.status) && !!r.dueDate && r.dueDate < todayIso();
type RosterFilter = 'ENROLLED' | 'IN_PROGRESS' | 'COMPLETED' | 'overdue' | 'other';
const rosterFilter = ref<RosterFilter | null>(null);
const counted = computed(() => rosterRows.value.filter((r) => r.status !== 'CANCELLED'));
const count = (s: EnrollmentStatus) => counted.value.filter((r) => r.status === s).length;
const overdueCount = computed(() => rosterRows.value.filter(isOverdue).length);
const otherCount = computed(() => count('FAILED') + count('NO_SHOW'));
const completionRate = computed(() => pct(count('COMPLETED'), counted.value.length));
const rosterStrip = computed<StripItem[]>(() => [
  { key: 'ENROLLED', label: 'Not started', value: count('ENROLLED'), tone: 'neutral' },
  { key: 'IN_PROGRESS', label: 'In progress', value: count('IN_PROGRESS'), tone: 'info' },
  { key: 'COMPLETED', label: 'Completed', value: count('COMPLETED'), tone: 'success', hint: counted.value.length ? `${completionRate.value}% of ${counted.value.length} learners` : undefined },
  { key: 'overdue', label: 'Overdue', value: overdueCount.value, tone: overdueCount.value ? 'danger' : 'neutral', hint: overdueCount.value ? 'Past their due date' : 'Nobody is late' },
  { key: 'other', label: 'Not passed / missed', value: otherCount.value, tone: otherCount.value ? 'warning' : 'neutral' },
]);
const shownRoster = computed(() => {
  const f = rosterFilter.value;
  const rows = !f ? rosterRows.value : f === 'overdue' ? rosterRows.value.filter(isOverdue) : f === 'other' ? rosterRows.value.filter((r) => r.status === 'FAILED' || r.status === 'NO_SHOW') : rosterRows.value.filter((r) => r.status === f);
  // Overdue first, then by due date, so the people to chase are on top.
  return [...rows].sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
});
const filterLabel = computed(() => rosterStrip.value.find((s) => s.key === rosterFilter.value)?.label ?? '');

/** Each step counts everyone who got at least that far. */
const funnel = computed(() => {
  const rows = counted.value;
  const started = rows.filter((r) => r.status !== 'ENROLLED' || r.attended).length;
  const steps = [
    { label: 'Enrolled', value: rows.length },
    { label: sessionBased.value ? 'Started or attended' : 'Started', value: started },
    ...(sessionBased.value ? [{ label: 'Attended a session', value: rows.filter((r) => r.attended).length }] : []),
    ...(c.value?.hasAssessment ? [{ label: 'Took the assessment', value: rows.filter((r) => r.attempts > 0).length }] : []),
    { label: 'Completed', value: count('COMPLETED') },
  ];
  return steps.map((s) => ({ ...s, share: pct(s.value, rows.length) }));
});

// ---- Header and sessions -------------------------------------------------------------------------------------------
const facts = computed(() => {
  const v = c.value!;
  return [
    { icon: DELIVERY_ICON[v.delivery], text: DELIVERY_LABELS[v.delivery] },
    v.durationHours ? { icon: CalendarClock, text: hours(v.durationHours)! } : null,
    v.provider ? { icon: UserRound, text: v.provider } : null,
    { icon: Users, text: v.selfEnrollment ? 'Open for self-enrolment' : 'Assigned only' },
    v.hasAssessment ? { icon: ListChecks, text: `Assessment · ${v.questionCount ?? 0} question${v.questionCount === 1 ? '' : 's'}` } : null,
    { icon: Award, text: v.validityMonths ? `Certificate valid ${v.validityMonths} months` : 'Certificate does not expire' },
  ].filter((f): f is { icon: typeof Award; text: string } => !!f);
});
const isPast = (s: Session) => new Date(s.startsAt) <= new Date();
const sortedSessions = computed(() => [...(c.value?.sessions ?? [])].sort((a, b) => Number(isPast(a)) - Number(isPast(b)) || (isPast(a) ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt))));
const seatShare = (s: Session) => (s.capacity ? Math.min(100, pct(s.enrolled ?? 0, s.capacity)) : 0);
const requirements = computed(() => {
  const v = c.value!;
  return [
    sessionBased.value ? { icon: CalendarClock, text: 'Attend a session' } : null,
    v.hasAssessment ? { icon: ListChecks, text: `Pass the assessment (${v.passMark}%, ${v.maxAttempts} attempt${v.maxAttempts === 1 ? '' : 's'})` } : null,
    !sessionBased.value && !v.hasAssessment ? { icon: BookOpenCheck, text: 'Go through the content and mark it done' } : null,
  ].filter((r): r is { icon: typeof Award; text: string } => !!r);
});
</script>

<template>
  <div>
    <AppSkeleton v-if="course.loading.value && !c" :lines="8" />
    <AppErrorState v-else-if="course.error.value" :error="course.error.value" title="This course isn't available" @retry="course.run" />
    <template v-else-if="c">
      <AppPageHeader :title="c.title" :description="`${c.code} · ${CATEGORY_LABELS[c.category]} · ${DELIVERY_LABELS[c.delivery]}${c.durationHours ? ` · ${hours(c.durationHours)}` : ''}${c.provider ? ` · ${c.provider}` : ''}`" :back="inHr ? '/hr/training/courses' : '/me/training/catalog'" :back-label="inHr ? 'Courses' : 'Catalog'">
        <template #leading>
          <span :class="['flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1 ring-black/5 max-sm:hidden dark:ring-white/10', COURSE_VISUALS[c.category].tile]" aria-hidden="true">
            <component :is="COURSE_VISUALS[c.category].icon" :size="22" />
          </span>
        </template>
        <template #badges>
          <AppBadge v-if="c.permissions.manage" :tone="courseTone[c.status]" dot>{{ COURSE_STATUS_LABELS[c.status] }}</AppBadge>
          <AppBadge v-if="c.mandatory" tone="violet">Mandatory</AppBadge>
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

      <div class="space-y-4">
        <AppAlert v-if="!inHr && !c.selfEnrollment && !c.myEnrollment" tone="info">This course is assigned by your manager or HR.</AppAlert>
        <AppAlert v-if="inHr && c.status === 'DRAFT' && c.hasAssessment && !c.questionCount" tone="warning" title="Add the assessment questions">The course can be published once it has questions.</AppAlert>
        <AppAlert v-if="inHr && c.permissions.manage && c.status === 'PUBLISHED' && sessionBased && !upcoming.length" tone="warning" title="No upcoming session">Learners can't enrol until a session is scheduled.</AppAlert>

        <AppStatStrip v-if="showRoster && (rosterRows.length || roster.loading.value)" :items="rosterStrip" :loading="roster.loading.value && !roster.data.value" selectable :selected="rosterFilter" label="Learner progress — select to filter the roster" @select="(k) => (rosterFilter = k as RosterFilter | null)" />

        <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div class="min-w-0 space-y-4">
            <AppCard title="About this course">
              <p v-if="c.description" class="text-sm whitespace-pre-line text-fg">{{ c.description }}</p>
              <p v-else class="text-sm text-fg-muted">No description.</p>
              <ul class="mt-4 flex flex-wrap gap-2" aria-label="Course facts">
                <li v-for="f in facts" :key="f.text" class="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs text-fg-muted">
                  <component :is="f.icon" :size="12" aria-hidden="true" />{{ f.text }}
                </li>
              </ul>
              <a v-if="c.contentUrl" :href="c.contentUrl" target="_blank" rel="noopener noreferrer" class="mt-4 flex items-center gap-3 rounded-lg p-3 ring-1 ring-line transition hover:bg-surface-muted/50">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg" aria-hidden="true"><ExternalLink :size="16" /></span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium text-fg">{{ c.delivery === 'SELF_PACED' ? 'Course content' : 'Pre-reading' }}</span>
                  <span class="block truncate text-xs text-fg-muted">{{ c.contentUrl }}</span>
                </span>
              </a>
            </AppCard>

            <AppCard v-if="sessionBased" title="Sessions" :icon="CalendarClock" :description="c.sessions.length ? `${upcoming.length} upcoming · ${c.sessions.length} in total` : undefined" :padded="false">
              <template v-if="inHr && c.permissions.manage && c.status !== 'ARCHIVED'" #actions><AppButton size="sm" variant="secondary" :icon="CalendarPlus" @click="editingSession = null; sessionOpen = true">Schedule</AppButton></template>
              <AppEmptyState v-if="!c.sessions.length" compact :icon="CalendarClock" title="No sessions yet" :description="inHr && c.permissions.manage ? 'Schedule a session so people can enrol and attend.' : 'No upcoming sessions.'">
                <AppButton v-if="inHr && c.permissions.manage && c.status !== 'ARCHIVED'" size="sm" variant="secondary" :icon="CalendarPlus" @click="editingSession = null; sessionOpen = true">Schedule a session</AppButton>
              </AppEmptyState>
              <ul v-else class="divide-y divide-line/70">
                <li v-for="s in sortedSessions" :key="s.id" :class="['flex flex-wrap items-center gap-4 px-4 py-3.5', s.status === 'CANCELLED' && 'opacity-60']">
                  <div :class="['flex w-12 shrink-0 flex-col items-center rounded-lg py-1.5', s.status === 'SCHEDULED' && !isPast(s) ? 'bg-accent-soft text-accent-fg' : 'bg-surface-muted text-fg-muted']">
                    <span class="text-2xs font-semibold uppercase">{{ dateTile(s.startsAt).month }}</span>
                    <span class="text-lg leading-5 font-semibold tabular-nums">{{ dateTile(s.startsAt).day }}</span>
                  </div>
                  <div class="min-w-0 flex-1 basis-52">
                    <p :class="['text-sm font-medium text-fg', s.status === 'CANCELLED' && 'line-through']">{{ sessionWhen(s) }}</p>
                    <p class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-muted">
                      <span v-if="s.location" class="inline-flex items-center gap-1"><MapPin :size="12" aria-hidden="true" />{{ s.location }}</span>
                      <span v-if="s.trainer" class="inline-flex items-center gap-1"><UserRound :size="12" aria-hidden="true" />Trainer: {{ s.trainer }}</span>
                      <span v-if="!s.location && !s.trainer">—</span>
                    </p>
                  </div>
                  <div class="w-36 shrink-0">
                    <p class="flex justify-between text-xs text-fg-muted"><span><span class="font-semibold text-fg tabular-nums">{{ s.enrolled ?? 0 }}</span> enrolled</span><span v-if="s.capacity !== null" class="tabular-nums">of {{ s.capacity }}</span></p>
                    <div v-if="s.capacity" class="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`${s.enrolled ?? 0} of ${s.capacity} seats taken`">
                      <div :class="['h-full rounded-full', seatShare(s) >= 100 ? 'bg-warning' : 'bg-brand-500']" :style="{ width: `${seatShare(s)}%` }" />
                    </div>
                    <p v-else class="text-2xs text-fg-subtle">No seat limit</p>
                  </div>
                  <AppBadge v-if="s.status !== 'SCHEDULED'" size="sm" :tone="s.status === 'COMPLETED' ? 'success' : 'neutral'" dot>{{ s.status === 'COMPLETED' ? 'Held' : 'Cancelled' }}</AppBadge>
                  <span v-else class="text-xs font-medium text-fg-muted">{{ isPast(s) ? 'Took place' : relativeDay(s.startsAt) }}</span>
                  <div v-if="inHr && c.permissions.manage && s.status !== 'CANCELLED'" class="flex items-center gap-1">
                    <AppButton v-if="isPast(s)" size="sm" variant="secondary" :icon="ClipboardCheck" @click="attendanceFor = s">Attendance</AppButton>
                    <template v-if="s.status === 'SCHEDULED'">
                      <AppButton size="sm" variant="ghost" :icon="Pencil" aria-label="Reschedule" @click="editingSession = s; sessionOpen = true" />
                      <AppButton size="sm" variant="ghost" :icon="XCircle" aria-label="Cancel session" :loading="busy === `cancel-${s.id}`" @click="cancelSession(s)" />
                    </template>
                  </div>
                </li>
              </ul>
            </AppCard>

            <AppCard v-if="showRoster" title="Roster" :icon="Users" :description="rosterFilter ? `${shownRoster.length} of ${rosterRows.length} · ${filterLabel}` : `${rosterRows.length} learner${rosterRows.length === 1 ? '' : 's'} · overdue first`" :padded="false">
              <template v-if="rosterFilter" #actions><AppButton size="sm" variant="ghost" :icon="Filter" @click="rosterFilter = null">Show everyone</AppButton></template>
              <AppSkeleton v-if="roster.loading.value && !roster.data.value" class="p-4" :lines="3" />
              <AppEmptyState v-else-if="!rosterRows.length" compact :icon="Users" title="Nobody has enrolled yet" :description="c.permissions.assign ? 'Assign the course to people or departments, with a due date if it’s required.' : 'Learners appear here once they enrol.'">
                <AppButton v-if="c.permissions.assign" size="sm" variant="secondary" :icon="UserPlus" @click="assignOpen = true">Assign</AppButton>
              </AppEmptyState>
              <AppEmptyState v-else-if="!shownRoster.length" compact :icon="CheckCircle2" :title="`No one: ${filterLabel.toLowerCase()}`" description="Switch back to see the whole roster.">
                <AppButton size="sm" variant="secondary" @click="rosterFilter = null">Show everyone</AppButton>
              </AppEmptyState>
              <ul v-else class="divide-y divide-line/70">
                <li v-for="r in shownRoster" :key="r.id">
                  <RouterLink :to="`/hr/training/enrollments/${r.id}`" :class="['relative flex flex-wrap items-center gap-3 px-4 py-3 transition hover:bg-surface-muted/50', isOverdue(r) && 'bg-danger-soft/20']">
                    <span v-if="isOverdue(r)" class="absolute inset-y-0 start-0 w-1 bg-danger" aria-hidden="true" />
                    <AppAvatar :name="r.employee.name" size="sm" />
                    <div class="min-w-0 flex-1 basis-48">
                      <p class="truncate text-sm font-medium text-fg">{{ r.employee.name }}</p>
                      <p class="truncate text-xs text-fg-muted">{{ r.employee.department ?? r.employee.employeeCode }} · {{ r.source === 'ASSIGNED' ? 'assigned' : 'self-enrolled' }}<template v-if="r.session"> · session {{ formatDate(r.session.startsAt) }}</template><template v-if="r.bestScore !== null"> · best score {{ r.bestScore }}%</template></p>
                    </div>
                    <span v-if="isOverdue(r)" class="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger-fg"><AlertTriangle :size="12" aria-hidden="true" />{{ overdueBy(r.dueDate!) }}</span>
                    <span v-else-if="r.dueDate && OPEN.includes(r.status)" :class="['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', daysUntil(r.dueDate) <= 7 ? 'bg-warning-soft text-warning-fg' : 'bg-surface-muted text-fg-muted']"><CalendarClock :size="12" aria-hidden="true" />Due {{ relativeDay(r.dueDate) }}</span>
                    <span v-else-if="r.completedOn" class="text-xs text-fg-subtle">Completed {{ formatDate(r.completedOn) }}</span>
                    <span v-if="r.feedbackRating" class="inline-flex items-center gap-0.5 text-xs text-fg-muted" :aria-label="`Rated ${r.feedbackRating} of 5`"><Star :size="12" class="fill-amber-400 text-amber-400" aria-hidden="true" />{{ r.feedbackRating }}</span>
                    <AppBadge :tone="enrollmentTone[r.status]" size="sm" dot>{{ ENROLLMENT_STATUS_LABELS[r.status] }}</AppBadge>
                  </RouterLink>
                </li>
              </ul>
            </AppCard>
          </div>

          <aside class="space-y-4">
            <AppCard v-if="showRoster && counted.length" title="Completion funnel" :description="`${completionRate}% of learners have completed`">
              <ol class="space-y-3">
                <li v-for="(f, i) in funnel" :key="f.label">
                  <div class="mb-1 flex items-baseline justify-between gap-2 text-xs">
                    <span class="font-medium text-fg">{{ f.label }}</span>
                    <span class="text-fg-muted tabular-nums"><span class="font-semibold text-fg">{{ f.value }}</span> · {{ f.share }}%</span>
                  </div>
                  <div class="h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                    <div :class="['h-full rounded-full transition-[width] duration-500', i === funnel.length - 1 ? 'bg-success' : 'bg-brand-500']" :style="{ width: `${f.share}%`, opacity: 1 - i * 0.12 }" />
                  </div>
                </li>
              </ol>
            </AppCard>

            <AppCard title="Completion" :icon="CheckCircle2">
              <ul class="space-y-2.5 text-sm text-fg">
                <li v-for="r in requirements" :key="r.text" class="flex items-start gap-2.5">
                  <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-fg" aria-hidden="true"><component :is="r.icon" :size="12" /></span>{{ r.text }}
                </li>
                <li class="flex items-start gap-2.5 text-fg-muted">
                  <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/12 text-amber-600 dark:text-amber-300" aria-hidden="true"><Award :size="12" /></span>{{ c.validityMonths ? `Certificate valid for ${c.validityMonths} months` : 'Certificate does not expire' }}
                </li>
              </ul>
              <AppButton v-if="inHr && c.permissions.manage && c.hasAssessment && c.status !== 'ARCHIVED'" class="mt-4" size="sm" variant="secondary" :icon="ListChecks" @click="questionsOpen = true">Assessment questions ({{ c.questionCount ?? 0 }})</AppButton>
            </AppCard>
            <CourseSkillsCard :course-id="c.id" :editable="inHr && c.permissions.manage && c.status !== 'ARCHIVED'" />
            <AppCard v-if="c.feedback.count" title="Learner feedback" :icon="MessageSquareText">
              <div class="flex items-center gap-3">
                <p class="text-3xl font-semibold text-fg tabular-nums">{{ c.feedback.average }}</p>
                <div>
                  <p class="flex gap-0.5" :aria-label="`${c.feedback.average} out of 5`">
                    <Star v-for="n in 5" :key="n" :size="14" :class="n <= Math.round(c.feedback.average ?? 0) ? 'fill-amber-400 text-amber-400' : 'text-fg-subtle/40'" aria-hidden="true" />
                  </p>
                  <p class="mt-0.5 text-xs text-fg-muted">from {{ c.feedback.count }} learner{{ c.feedback.count === 1 ? '' : 's' }}</p>
                </div>
              </div>
            </AppCard>
          </aside>
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
