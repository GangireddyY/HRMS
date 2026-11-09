<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  FileSignature,
  FileText,
  FileUp,
  Hourglass,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Send,
  Star,
  ThumbsDown,
  ThumbsUp,
  Undo2,
  UserCheck,
  UserRound,
  Video,
  X,
  XCircle,
} from '@lucide/vue';
import { PIPELINE_STAGES, RESUME_MAX_BYTES, type ApplicationStage, type InterviewMode } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import OfferFormModal from '@/modules/recruitment/components/OfferFormModal.vue';
import ScheduleInterviewModal from '@/modules/recruitment/components/ScheduleInterviewModal.vue';
import type { ApplicationDetail, InterviewItem } from '@/modules/recruitment/types';
import {
  MODE_LABELS,
  OFFER_STATUS_LABELS,
  RECOMMENDATION_LABELS,
  SOURCE_LABELS,
  STAGE_LABELS,
  money,
  offerTone,
  recommendationTone,
  stageTone,
} from '@/modules/recruitment/utils/recruitment-format';
import { SOURCE_ICON, STAGE_ICON, daysUntil, dueText, stageAge, timeOfDay } from '@/modules/recruitment/utils/recruitment-ui';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppCheckbox, AppEmptyState, AppErrorState, AppInput, AppModal, AppPageHeader, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime, timeAgo } from '@/shared/utils/format';

/** One candidate in one job: where they are in the process, interviews and scorecards, the offer and the history. */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('recruitment.manage'));
const canOffer = computed(() => auth.can('recruitment.offer.manage'));
const canHire = computed(() => canOffer.value && auth.can('employee.create'));
const id = computed(() => String(route.params.id));
const app = useAsync(() => recruitmentApi.application(id.value));
watch(id, () => void app.run());
const a = computed(() => app.data.value);
const active = computed(() => !!a.value && (PIPELINE_STAGES as readonly string[]).includes(a.value.stage));
const offerOpen = computed(() => !!a.value?.offer && ['RELEASED', 'ACCEPTED'].includes(a.value.offer.status));

const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<ApplicationDetail | unknown>, success: string) {
  busy.value = key;
  try {
    const r = await fn();
    if (r && typeof r === 'object' && 'candidate' in r) app.data.value = r as ApplicationDetail;
    else await app.run();
    feedback.success(success);
  } catch (e) {
    feedback.error('Could not complete the action', e);
  } finally {
    busy.value = null;
  }
}

// Stage moves
const nextStage = computed<ApplicationStage | null>(() => {
  const i = (PIPELINE_STAGES as readonly ApplicationStage[]).indexOf(a.value?.stage ?? 'APPLIED');
  return i >= 0 && i < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[i + 1]! : null;
});
const rejecting = ref<'REJECTED' | 'WITHDRAWN' | null>(null);
const note = ref('');
async function closeOut() {
  const stage = rejecting.value!;
  rejecting.value = null;
  await act('close', () => recruitmentApi.move(id.value, stage, note.value || null), stage === 'REJECTED' ? 'Candidate rejected' : 'Marked as withdrawn');
}

// Resume
const fileInput = ref<HTMLInputElement | null>(null);
async function onResume(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > RESUME_MAX_BYTES) return feedback.error('This file is too large', 'Resumes must be 5 MB or smaller.');
  await act('resume', () => recruitmentApi.uploadResume(a.value!.candidate.id, file), 'Resume uploaded');
}
async function viewResume() {
  const tab = window.open('', '_blank');
  try {
    const blob = await recruitmentApi.resumeBlob(a.value!.candidate.id);
    const url = URL.createObjectURL(new Blob([blob], { type: a.value!.candidate.resume!.contentType }));
    if (tab) tab.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    feedback.error('Could not open the resume', e);
  }
}

// Interviews and offers
const scheduleOpen = ref(false);
function onScheduled(d: ApplicationDetail) {
  scheduleOpen.value = false;
  app.data.value = d;
  feedback.success('Interview scheduled', 'The interviewers have been notified.');
}
const offerFormOpen = ref(false);
async function onOfferSaved() {
  offerFormOpen.value = false;
  feedback.success('Offer saved');
  await app.run();
}
const declineOpen = ref(false);
const declineReason = ref('');
const hireOpen = ref(false);
const startOnboarding = ref(true);
const canOnboard = computed(() => auth.hasFeature('onboarding') && auth.can('onboarding.manage'));
const employeeCode = ref('');
async function hire() {
  busy.value = 'hire';
  try {
    const r = await recruitmentApi.hire(a.value!.offer!.id, { startOnboarding: canOnboard.value && startOnboarding.value, employeeCode: employeeCode.value || null });
    hireOpen.value = false;
    feedback.success(`${a.value!.candidate.name} hired as ${r.employeeCode}`, r.onboardingError ?? (r.onboardingCaseId ? 'Onboarding has started.' : undefined));
    await router.push(r.onboardingCaseId ? `/hr/onboarding/${r.onboardingCaseId}` : `/hr/employees/${r.employeeId}`);
  } catch (e) {
    feedback.error('Could not hire the candidate', e);
  } finally {
    busy.value = null;
  }
}

// ---- Stage stepper ------------------------------------------------------------------------------------------------
const STEPS: ApplicationStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];
/** Where a rejected or withdrawn application stopped: the stage it left, from the history. */
const stoppedAt = computed<ApplicationStage | null>(() => {
  if (!a.value || STEPS.includes(a.value.stage)) return null;
  const last = [...a.value.events].reverse().find((e) => e.toStage === a.value!.stage);
  return last?.fromStage && STEPS.includes(last.fromStage) ? last.fromStage : 'APPLIED';
});
/** When each stage was (last) entered. */
const enteredAt = computed(() => {
  const m = new Map<ApplicationStage, string>();
  for (const e of a.value?.events ?? []) m.set(e.toStage, e.createdAt);
  return m;
});
const steps = computed(() => {
  const cur = a.value ? (stoppedAt.value ?? a.value.stage) : 'APPLIED';
  const at = STEPS.indexOf(cur);
  return STEPS.map((s, i) => ({
    stage: s,
    state: stoppedAt.value && i === at ? 'stopped' : i < at || (i === at && s === 'HIRED') ? 'done' : i === at ? 'current' : 'upcoming',
    at: i <= at ? enteredAt.value.get(s) : undefined,
  }));
});
const age = computed(() => (a.value ? stageAge(a.value.stageChangedAt) : null));

// ---- Interviews and scorecards ------------------------------------------------------------------------------------
const MODE_ICON: Record<InterviewMode, Component> = { VIDEO: Video, PHONE: Phone, IN_PERSON: MapPin };
const isLink = (s: string | null) => !!s && /^https?:\/\//i.test(s);
const interviews = computed(() => [...(a.value?.interviews ?? [])].sort((x, y) => y.scheduledAt.localeCompare(x.scheduledAt)));
const scorecards = computed(() => (a.value?.interviews ?? []).filter((i) => i.status !== 'CANCELLED').flatMap((i) => i.panel.filter((p) => p.submittedAt)));
const avgRating = computed(() => {
  const r = scorecards.value.filter((p) => p.rating);
  return r.length ? Math.round((r.reduce((n, p) => n + (p.rating ?? 0), 0) / r.length) * 10) / 10 : null;
});
const votes = computed(() => ({
  hire: scorecards.value.filter((p) => p.recommendation === 'HIRE' || p.recommendation === 'STRONG_HIRE').length,
  noHire: scorecards.value.filter((p) => p.recommendation === 'NO_HIRE' || p.recommendation === 'STRONG_NO_HIRE').length,
}));
const isPast = (i: InterviewItem) => new Date(i.scheduledAt).getTime() <= Date.now();
/** Feedback is expected within a day of the interview. */
const lateFeedback = (i: InterviewItem) => i.status !== 'CANCELLED' && Date.now() - new Date(i.scheduledAt).getTime() > 24 * 3_600_000;
const pendingFeedback = computed(() => (a.value?.interviews ?? []).filter((i) => i.status !== 'CANCELLED' && isPast(i)).reduce((n, i) => n + i.panel.filter((p) => !p.submittedAt).length, 0));
const nextInterview = computed(() => (a.value?.interviews ?? []).filter((i) => i.status === 'SCHEDULED' && !isPast(i)).sort((x, y) => x.scheduledAt.localeCompare(y.scheduledAt))[0] ?? null);
const tile = (iso: string) => {
  const d = new Date(iso);
  return { day: d.getDate(), month: d.toLocaleDateString(appLocale(), { month: 'short' }) };
};
const interviewStatus = (i: InterviewItem) =>
  i.status === 'COMPLETED' ? { label: 'Completed', tone: 'success' as const } : i.status === 'CANCELLED' ? { label: 'Cancelled', tone: 'neutral' as const } : isPast(i) ? { label: 'Awaiting feedback', tone: 'warning' as const } : { label: 'Scheduled', tone: 'info' as const };

// ---- Activity -----------------------------------------------------------------------------------------------------
interface Activity {
  key: string;
  at: string;
  icon: Component;
  tone: string;
  title: string;
  detail?: string | null;
  by?: string | null;
}
const activity = computed<Activity[]>(() => {
  const d = a.value;
  if (!d) return [];
  const list: Activity[] = d.events.map((e) => ({
    key: `e-${e.id}`,
    at: e.createdAt,
    icon: STAGE_ICON[e.toStage],
    tone: e.toStage === 'REJECTED' ? 'bg-danger-soft text-danger-fg' : e.toStage === 'HIRED' ? 'bg-success-soft text-success-fg' : 'bg-accent-soft text-accent-fg',
    title: e.fromStage ? `${STAGE_LABELS[e.fromStage]} → ${STAGE_LABELS[e.toStage]}` : `Applied via ${SOURCE_LABELS[d.source].toLowerCase()}`,
    detail: e.note,
    by: e.createdBy ?? 'Careers page',
  }));
  for (const i of d.interviews) {
    list.push({
      key: `i-${i.id}`,
      at: i.scheduledAt,
      icon: i.status === 'CANCELLED' ? X : MessageSquareText,
      tone: i.status === 'CANCELLED' ? 'bg-surface-muted text-fg-muted' : 'bg-special-soft text-special-fg',
      title: `${i.roundName} ${i.status === 'CANCELLED' ? 'cancelled' : isPast(i) ? 'held' : 'scheduled'}`,
      detail: i.panel.map((p) => p.employee?.name).filter(Boolean).join(', ') || null,
    });
    for (const p of i.panel)
      if (p.submittedAt && p.recommendation)
        list.push({ key: `f-${i.id}-${p.employee?.id}`, at: p.submittedAt, icon: Star, tone: 'bg-warning-soft text-warning-fg', title: `Scorecard: ${RECOMMENDATION_LABELS[p.recommendation]}`, detail: i.roundName, by: p.employee?.name });
  }
  if (d.offer?.releasedAt) list.push({ key: 'o-rel', at: d.offer.releasedAt, icon: Send, tone: 'bg-accent-soft text-accent-fg', title: 'Offer released' });
  if (d.offer?.respondedAt)
    list.push({
      key: 'o-resp',
      at: d.offer.respondedAt,
      icon: d.offer.status === 'ACCEPTED' ? CheckCircle2 : XCircle,
      tone: d.offer.status === 'ACCEPTED' ? 'bg-success-soft text-success-fg' : 'bg-danger-soft text-danger-fg',
      title: `Offer ${OFFER_STATUS_LABELS[d.offer.status].toLowerCase()}`,
      detail: d.offer.declineReason,
    });
  return list.sort((x, y) => y.at.localeCompare(x.at));
});
const showAllActivity = ref(false);

// ---- Side panel ---------------------------------------------------------------------------------------------------
const keyDates = computed(() => {
  const d = a.value;
  if (!d) return [];
  const out: { label: string; value: string; hint?: string; icon: Component; tone: string }[] = [
    { label: 'Applied', value: formatDate(d.createdAt), hint: timeAgo(d.createdAt), icon: CalendarDays, tone: 'bg-surface-muted text-fg-muted' },
    { label: `In ${STAGE_LABELS[d.stage].toLowerCase()} since`, value: formatDate(d.stageChangedAt), hint: timeAgo(d.stageChangedAt), icon: STAGE_ICON[d.stage], tone: 'bg-accent-soft text-accent-fg' },
  ];
  if (nextInterview.value) out.push({ label: 'Next interview', value: `${formatDate(nextInterview.value.scheduledAt)}, ${timeOfDay(nextInterview.value.scheduledAt)}`, hint: nextInterview.value.roundName, icon: CalendarClock, tone: 'bg-special-soft text-special-fg' });
  if (d.offer?.expiresOn && d.offer.status === 'RELEASED') out.push({ label: 'Offer valid until', value: formatDate(d.offer.expiresOn), hint: dueText(d.offer.expiresOn), icon: Hourglass, tone: daysUntil(d.offer.expiresOn) < 0 ? 'bg-danger-soft text-danger-fg' : 'bg-warning-soft text-warning-fg' });
  if (d.offer && ['DRAFT', 'RELEASED', 'ACCEPTED'].includes(d.offer.status)) out.push({ label: 'Joining date', value: formatDate(d.offer.joiningDate), hint: dueText(d.offer.joiningDate, false), icon: UserCheck, tone: 'bg-success-soft text-success-fg' });
  return out;
});
</script>

<template>
  <div class="space-y-4">
    <AppSkeleton v-if="app.loading.value && !a" :lines="8" />
    <AppErrorState v-else-if="app.error.value" :error="app.error.value" title="Could not load the application" @retry="app.run" />
    <template v-else-if="a">
      <AppPageHeader :title="a.candidate.name" :description="`${a.job.title} · applied ${formatDate(a.createdAt)} via ${SOURCE_LABELS[a.source].toLowerCase()}`" :back="`/hr/recruitment/jobs/${a.job.id}`" back-label="Pipeline">
        <template #leading><AppAvatar :name="a.candidate.name" size="xl" /></template>
        <template #badges>
          <AppBadge :tone="stageTone[a.stage]" dot>{{ STAGE_LABELS[a.stage] }}</AppBadge>
          <AppBadge v-if="avgRating !== null" tone="warning"><Star :size="11" class="fill-warning text-warning" aria-hidden="true" />{{ avgRating }} · {{ scorecards.length }} scorecard{{ scorecards.length === 1 ? '' : 's' }}</AppBadge>
        </template>
        <template v-if="canManage && active" #actions>
          <AppButton variant="ghost" :icon="XCircle" :disabled="offerOpen" :title="offerOpen ? 'Withdraw the offer first' : undefined" @click="rejecting = 'REJECTED'; note = ''">Reject</AppButton>
          <AppButton variant="secondary" :icon="CalendarPlus" @click="scheduleOpen = true">Schedule interview</AppButton>
          <AppButton v-if="nextStage" :icon-right="ArrowRight" :loading="busy === 'move'" @click="act('move', () => recruitmentApi.move(id, nextStage!), `Moved to ${STAGE_LABELS[nextStage!].toLowerCase()}`)">Move to {{ STAGE_LABELS[nextStage] }}</AppButton>
        </template>
        <template v-else-if="canManage && (a.stage === 'REJECTED' || a.stage === 'WITHDRAWN')" #actions>
          <AppButton variant="secondary" :icon="Undo2" @click="act('move', () => recruitmentApi.move(id, 'APPLIED', 'Reconsidered'), 'Back in the pipeline')">Reconsider</AppButton>
        </template>
        <template v-else-if="a.hiredEmployeeId" #actions>
          <AppButton variant="secondary" :to="`/hr/employees/${a.hiredEmployeeId}`">Open employee record</AppButton>
        </template>
      </AppPageHeader>

      <!-- Stage stepper -->
      <nav class="card px-4 py-3" aria-label="Hiring stages">
        <ol class="flex flex-wrap items-center gap-y-2">
          <template v-for="(s, i) in steps" :key="s.stage">
            <li class="flex items-center gap-2.5" :aria-current="s.state === 'current' ? 'step' : undefined">
              <span
                :class="[
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  s.state === 'done' && 'bg-success text-white',
                  s.state === 'current' && 'bg-brand-600 text-white ring-4 ring-brand-500/15',
                  s.state === 'stopped' && 'bg-danger text-white ring-4 ring-danger/15',
                  s.state === 'upcoming' && 'bg-surface-muted text-fg-subtle ring-1 ring-line ring-inset',
                ]"
                aria-hidden="true"
              >
                <Check v-if="s.state === 'done'" :size="15" :stroke-width="3" />
                <X v-else-if="s.state === 'stopped'" :size="15" :stroke-width="3" />
                <component :is="STAGE_ICON[s.stage]" v-else :size="14" />
              </span>
              <span class="min-w-0">
                <span :class="['block text-sm', s.state === 'upcoming' ? 'text-fg-muted' : 'font-semibold text-fg']">{{ STAGE_LABELS[s.stage] }}</span>
                <span class="block text-2xs text-fg-muted">
                  <template v-if="s.state === 'stopped'">{{ STAGE_LABELS[a.stage] }} here</template>
                  <template v-else-if="s.state === 'current' && age">{{ age.days === 0 ? 'Since today' : `${age.days} day${age.days === 1 ? '' : 's'} here` }}</template>
                  <template v-else-if="s.at">{{ formatDate(s.at) }}</template>
                  <template v-else>&nbsp;</template>
                </span>
                <span class="sr-only">({{ s.state === 'done' ? 'completed' : s.state === 'current' ? 'current stage' : s.state === 'stopped' ? STAGE_LABELS[a.stage] : 'not reached' }})</span>
              </span>
            </li>
            <li v-if="i < steps.length - 1" :class="['mx-3 hidden h-px min-w-6 flex-1 sm:block', s.state === 'done' ? 'bg-success' : 'bg-line']" aria-hidden="true" />
          </template>
        </ol>
        <p v-if="active && age && age.tone !== 'fresh'" :class="['mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-xs', age.tone === 'stuck' ? 'bg-danger-soft/60 text-danger-fg' : 'bg-warning-soft/60 text-warning-fg']">
          <AlertTriangle :size="14" aria-hidden="true" />{{ a.candidate.name.split(' ')[0] }} has been in {{ STAGE_LABELS[a.stage].toLowerCase() }} for {{ age.days }} days — move them forward or close the application.
        </p>
      </nav>

      <AppAlert v-if="a.stage === 'REJECTED' && a.rejectionReason" tone="warning" title="Rejected">{{ a.rejectionReason }}</AppAlert>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div class="space-y-4">
          <!-- Interviews & scorecards -->
          <AppCard title="Interviews & scorecards" :icon="MessageSquareText" :padded="false">
            <template v-if="canManage && active" #actions><AppButton size="sm" variant="secondary" :icon="CalendarPlus" @click="scheduleOpen = true">Schedule</AppButton></template>
            <AppEmptyState v-if="!a.interviews.length" compact :icon="CalendarClock" :title="active ? 'No interviews yet' : 'No interviews were recorded'" :description="canManage && active ? 'Schedule a round; the panel is notified and can leave a scorecard afterwards.' : undefined">
              <AppButton v-if="canManage && active" size="sm" :icon="CalendarPlus" @click="scheduleOpen = true">Schedule interview</AppButton>
            </AppEmptyState>
            <template v-else>
              <dl class="grid grid-cols-2 gap-px border-b border-line/70 bg-line/60 sm:grid-cols-4">
                <div class="bg-surface px-4 py-2.5">
                  <dt class="text-2xs font-medium text-fg-muted">Average rating</dt>
                  <dd class="mt-0.5 flex items-center gap-1 text-lg font-semibold text-fg tabular-nums">
                    <template v-if="avgRating !== null"><Star :size="15" class="fill-warning text-warning" aria-hidden="true" />{{ avgRating }}<span class="text-xs font-normal text-fg-subtle">/5</span></template>
                    <span v-else class="text-sm font-normal text-fg-subtle">—</span>
                  </dd>
                </div>
                <div class="bg-surface px-4 py-2.5">
                  <dt class="text-2xs font-medium text-fg-muted">Recommend hire</dt>
                  <dd class="mt-0.5 flex items-center gap-1.5 text-lg font-semibold text-success-fg tabular-nums"><ThumbsUp :size="15" aria-hidden="true" />{{ votes.hire }}</dd>
                </div>
                <div class="bg-surface px-4 py-2.5">
                  <dt class="text-2xs font-medium text-fg-muted">Recommend no hire</dt>
                  <dd class="mt-0.5 flex items-center gap-1.5 text-lg font-semibold tabular-nums" :class="votes.noHire ? 'text-danger-fg' : 'text-fg-subtle'"><ThumbsDown :size="15" aria-hidden="true" />{{ votes.noHire }}</dd>
                </div>
                <div class="bg-surface px-4 py-2.5">
                  <dt class="text-2xs font-medium text-fg-muted">Feedback pending</dt>
                  <dd class="mt-0.5 flex items-center gap-1.5 text-lg font-semibold tabular-nums" :class="pendingFeedback ? 'text-warning-fg' : 'text-fg-subtle'"><Hourglass :size="15" aria-hidden="true" />{{ pendingFeedback }}</dd>
                </div>
              </dl>
              <ul class="divide-y divide-line/70">
                <li v-for="i in interviews" :key="i.id" :class="['px-4 py-4', i.status === 'CANCELLED' && 'opacity-70']">
                  <div class="flex flex-wrap items-start gap-3">
                    <div class="flex w-12 shrink-0 flex-col items-center rounded-lg bg-surface-muted py-1" aria-hidden="true">
                      <span class="text-2xs font-semibold text-fg-muted uppercase">{{ tile(i.scheduledAt).month }}</span>
                      <span class="text-lg leading-6 font-semibold text-fg tabular-nums">{{ tile(i.scheduledAt).day }}</span>
                    </div>
                    <div class="min-w-0 flex-1">
                      <p :class="['font-semibold text-fg', i.status === 'CANCELLED' && 'line-through decoration-fg-subtle/60']">{{ i.roundName }}</p>
                      <p class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-muted">
                        <span class="inline-flex items-center gap-1"><CalendarClock :size="12" aria-hidden="true" />{{ formatDateTime(i.scheduledAt) }} · {{ i.durationMinutes }} min</span>
                        <span class="inline-flex items-center gap-1"><component :is="MODE_ICON[i.mode]" :size="12" aria-hidden="true" />{{ MODE_LABELS[i.mode] }}</span>
                        <a v-if="isLink(i.location)" :href="i.location!" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-accent-fg hover:underline"><ExternalLink :size="12" aria-hidden="true" />Meeting link</a>
                        <span v-else-if="i.location">{{ i.location }}</span>
                      </p>
                    </div>
                    <div class="flex items-center gap-2">
                      <AppBadge :tone="interviewStatus(i).tone" size="sm" dot>{{ interviewStatus(i).label }}</AppBadge>
                      <AppButton v-if="canManage && i.status === 'SCHEDULED'" size="xs" variant="ghost" :loading="busy === `int-${i.id}`" @click="act(`int-${i.id}`, () => recruitmentApi.cancelInterview(i.id), 'Interview cancelled')">Cancel</AppButton>
                    </div>
                  </div>
                  <ul class="mt-3 space-y-2 sm:ms-15">
                    <li v-for="(p, n) in i.panel" :key="n" :class="['rounded-lg p-3 ring-1 ring-inset', p.submittedAt ? 'bg-surface ring-line' : 'bg-surface-muted/50 ring-line/60']">
                      <div class="flex flex-wrap items-center gap-2.5">
                        <AppAvatar :name="p.employee?.name ?? '?'" size="sm" />
                        <div class="min-w-0 flex-1">
                          <p class="truncate text-sm font-medium text-fg">{{ p.employee?.name ?? 'Former panelist' }}</p>
                          <p v-if="p.employee?.designation" class="truncate text-2xs text-fg-muted">{{ p.employee.designation }}</p>
                        </div>
                        <template v-if="p.submittedAt">
                          <span class="flex items-center gap-0.5" :aria-label="`${p.rating ?? 0} of 5 stars`">
                            <Star v-for="k in 5" :key="k" :size="13" :class="k <= (p.rating ?? 0) ? 'fill-warning text-warning' : 'text-line-strong'" aria-hidden="true" />
                          </span>
                          <AppBadge v-if="p.recommendation" :tone="recommendationTone[p.recommendation]" size="sm" dot>{{ RECOMMENDATION_LABELS[p.recommendation] }}</AppBadge>
                        </template>
                        <span v-else-if="i.status !== 'CANCELLED' && isPast(i)" :class="['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium', lateFeedback(i) ? 'bg-danger-soft text-danger-fg' : 'bg-warning-soft text-warning-fg']">
                          <Hourglass :size="11" aria-hidden="true" />{{ lateFeedback(i) ? 'Feedback overdue' : 'Feedback pending' }}
                        </span>
                        <span v-else-if="i.status !== 'CANCELLED'" class="text-2xs text-fg-subtle">Interviews {{ timeAgo(i.scheduledAt) }}</span>
                      </div>
                      <p v-if="p.feedback" class="mt-2 border-s-2 border-line-strong ps-3 text-sm whitespace-pre-line text-fg-muted">{{ p.feedback }}</p>
                      <p v-if="p.submittedAt" class="mt-1.5 text-2xs text-fg-subtle">Submitted {{ formatDateTime(p.submittedAt) }}</p>
                    </li>
                  </ul>
                </li>
              </ul>
            </template>
          </AppCard>

          <!-- Activity -->
          <AppCard title="Activity" :icon="CalendarDays">
            <ol class="space-y-4">
              <li v-for="(e, n) in showAllActivity ? activity : activity.slice(0, 8)" :key="e.key" class="relative flex gap-3">
                <span v-if="n < (showAllActivity ? activity.length : Math.min(8, activity.length)) - 1" class="absolute start-[13px] top-7 -bottom-4 w-px bg-line" aria-hidden="true" />
                <span :class="['relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full', e.tone]" aria-hidden="true"><component :is="e.icon" :size="13" /></span>
                <div class="min-w-0 flex-1 pt-0.5">
                  <p class="text-sm font-medium text-fg">{{ e.title }}</p>
                  <p v-if="e.detail" class="text-sm text-fg-muted">{{ e.detail }}</p>
                  <p class="text-2xs text-fg-subtle"><template v-if="e.by">{{ e.by }} · </template>{{ formatDateTime(e.at) }}</p>
                </div>
              </li>
            </ol>
            <AppButton v-if="activity.length > 8" class="mt-3" size="sm" variant="ghost" @click="showAllActivity = !showAllActivity">{{ showAllActivity ? 'Show less' : `Show all ${activity.length} events` }}</AppButton>
          </AppCard>
        </div>

        <aside class="space-y-4">
          <!-- Offer -->
          <AppCard v-if="canOffer && (a.stage === 'OFFER' || a.offer)" title="Offer" :icon="FileSignature">
            <template v-if="!a.offer || a.offer.status === 'WITHDRAWN' || a.offer.status === 'DECLINED'">
              <p v-if="a.offer" class="mb-3 rounded-md bg-surface-muted/70 px-3 py-2 text-sm text-fg-muted">Previous offer {{ OFFER_STATUS_LABELS[a.offer.status].toLowerCase() }}{{ a.offer.declineReason ? `: “${a.offer.declineReason}”` : '' }}.</p>
              <p v-else class="mb-3 text-sm text-fg-muted">Draft the offer — compensation, joining date and validity — then release it to the candidate.</p>
              <AppButton v-if="a.stage === 'OFFER'" :icon="Send" @click="offerFormOpen = true">Draft offer</AppButton>
            </template>
            <template v-else>
              <AppBadge :tone="offerTone[a.offer.status]" dot>{{ OFFER_STATUS_LABELS[a.offer.status] }}</AppBadge>
              <p class="mt-3 text-2xs font-medium text-fg-muted">Annual CTC</p>
              <p class="text-2xl font-semibold tracking-tight text-fg tabular-nums">{{ money(a.offer.annualCtc) }}</p>
              <dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><dt class="text-2xs font-medium text-fg-muted">Joining</dt><dd class="text-fg">{{ formatDate(a.offer.joiningDate) }}</dd></div>
                <div v-if="a.offer.expiresOn"><dt class="text-2xs font-medium text-fg-muted">Valid until</dt><dd class="text-fg">{{ formatDate(a.offer.expiresOn) }}</dd></div>
              </dl>
              <div class="mt-4 flex flex-wrap gap-2 border-t border-line/70 pt-4">
                <template v-if="a.offer.status === 'DRAFT'">
                  <AppButton size="sm" variant="secondary" @click="offerFormOpen = true">Edit</AppButton>
                  <AppButton size="sm" :icon="Send" :loading="busy === 'release'" @click="act('release', () => recruitmentApi.releaseOffer(a!.offer!.id), 'Offer released')">Release</AppButton>
                </template>
                <template v-else-if="a.offer.status === 'RELEASED'">
                  <AppButton size="sm" :icon="CheckCircle2" :loading="busy === 'accept'" @click="act('accept', () => recruitmentApi.respondOffer(a!.offer!.id, 'ACCEPTED'), 'Offer accepted')">Accepted</AppButton>
                  <AppButton size="sm" variant="secondary" @click="declineOpen = true; declineReason = ''">Declined</AppButton>
                </template>
                <AppButton v-if="a.offer.status === 'ACCEPTED' && a.stage !== 'HIRED'" size="sm" :icon="UserCheck" :disabled="!canHire" @click="hireOpen = true">Hire</AppButton>
                <AppButton v-if="a.stage !== 'HIRED'" size="sm" variant="ghost" :loading="busy === 'withdraw'" @click="act('withdraw', () => recruitmentApi.withdrawOffer(a!.offer!.id), 'Offer withdrawn')">Withdraw</AppButton>
              </div>
              <p v-if="a.offer.status === 'ACCEPTED' && !canHire && a.stage !== 'HIRED'" class="mt-2 text-xs text-fg-muted">Hiring creates the employee record; someone with permission to create employees completes it.</p>
            </template>
          </AppCard>

          <!-- Candidate -->
          <AppCard title="Candidate" :icon="UserRound">
            <template #actions><AppButton size="xs" variant="link" :to="`/hr/recruitment/candidates/${a.candidate.id}`">Full profile</AppButton></template>
            <ul class="space-y-2 text-sm">
              <li class="flex items-center gap-2 text-fg"><Mail :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" /><a :href="`mailto:${a.candidate.email}`" class="break-all hover:underline">{{ a.candidate.email }}</a></li>
              <li v-if="a.candidate.phone" class="flex items-center gap-2 text-fg"><Phone :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" /><a :href="`tel:${a.candidate.phone}`" class="hover:underline">{{ a.candidate.phone }}</a></li>
              <li v-if="a.candidate.location" class="flex items-center gap-2 text-fg-muted"><MapPin :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" />{{ a.candidate.location }}</li>
              <li class="flex items-center gap-2 text-fg-muted"><component :is="SOURCE_ICON[a.source]" :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" />{{ SOURCE_LABELS[a.source] }}<template v-if="a.candidate.referredBy"> · {{ a.candidate.referredBy.name }}</template></li>
              <li v-if="a.candidate.linkedinUrl"><a :href="a.candidate.linkedinUrl" target="_blank" rel="noopener noreferrer nofollow" class="inline-flex items-center gap-2 text-accent-fg hover:underline"><ExternalLink :size="14" aria-hidden="true" />LinkedIn profile</a></li>
            </ul>
            <dl class="mt-4 space-y-3 border-t border-line/70 pt-4 text-sm">
              <div><dt class="text-2xs font-medium text-fg-muted">Current role</dt><dd class="text-fg">{{ [a.candidate.currentTitle, a.candidate.currentCompany].filter(Boolean).join(' at ') || '—' }}</dd></div>
              <div class="grid grid-cols-2 gap-3">
                <div><dt class="text-2xs font-medium text-fg-muted">Experience</dt><dd class="text-fg tabular-nums">{{ a.candidate.experienceYears !== null ? `${a.candidate.experienceYears} years` : '—' }}</dd></div>
                <div><dt class="text-2xs font-medium text-fg-muted">Notice period</dt><dd class="text-fg tabular-nums">{{ a.candidate.noticePeriodDays !== null ? `${a.candidate.noticePeriodDays} days` : '—' }}</dd></div>
                <div><dt class="text-2xs font-medium text-fg-muted">Current CTC</dt><dd class="text-fg tabular-nums">{{ money(a.candidate.currentCtc) }}</dd></div>
                <div><dt class="text-2xs font-medium text-fg-muted">Expected CTC</dt><dd class="text-fg tabular-nums">{{ money(a.candidate.expectedCtc) }}</dd></div>
              </div>
              <div v-if="a.candidate.skills.length">
                <dt class="text-2xs font-medium text-fg-muted">Skills</dt>
                <dd class="mt-1 flex flex-wrap gap-1"><AppBadge v-for="s in a.candidate.skills" :key="s" size="sm">{{ s }}</AppBadge></dd>
              </div>
              <div v-if="a.candidate.notes"><dt class="text-2xs font-medium text-fg-muted">Notes</dt><dd class="whitespace-pre-line text-fg-muted">{{ a.candidate.notes }}</dd></div>
            </dl>
            <div class="mt-4 border-t border-line/70 pt-4">
              <div v-if="a.candidate.resume" class="mb-2 flex items-center gap-2 text-sm">
                <FileText :size="15" class="shrink-0 text-danger-fg" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-fg" :title="a.candidate.resume.fileName">{{ a.candidate.resume.fileName }}</span>
              </div>
              <div class="flex flex-wrap gap-2">
                <template v-if="a.candidate.resume">
                  <AppButton size="sm" variant="secondary" :icon="Eye" @click="viewResume">View resume</AppButton>
                  <AppButton size="sm" variant="ghost" :icon="Download" @click="recruitmentApi.downloadResume(a.candidate.id, a.candidate.resume.fileName)">Download</AppButton>
                </template>
                <AppButton v-if="canManage" size="sm" variant="ghost" :icon="FileUp" :loading="busy === 'resume'" @click="fileInput?.click()">{{ a.candidate.resume ? 'Replace' : 'Upload resume' }}</AppButton>
              </div>
              <input ref="fileInput" type="file" class="sr-only" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" aria-label="Resume file" @change="onResume" />
            </div>
          </AppCard>

          <!-- Key dates -->
          <AppCard title="Key dates" :icon="CalendarDays">
            <ul class="space-y-3 text-sm">
              <li v-for="k in keyDates" :key="k.label" class="flex items-start gap-3">
                <span :class="['mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', k.tone]" aria-hidden="true"><component :is="k.icon" :size="14" /></span>
                <div class="min-w-0">
                  <p class="text-2xs font-medium text-fg-muted">{{ k.label }}</p>
                  <p class="font-medium text-fg">{{ k.value }}</p>
                  <p v-if="k.hint" class="text-xs text-fg-muted">{{ k.hint }}</p>
                </div>
              </li>
            </ul>
          </AppCard>
        </aside>
      </div>

      <ScheduleInterviewModal :open="scheduleOpen" :application-id="a.id" @close="scheduleOpen = false" @saved="onScheduled" />
      <OfferFormModal :open="offerFormOpen" :application-id="a.id" :offer="a.offer && a.offer.status === 'DRAFT' ? a.offer : null" @close="offerFormOpen = false" @saved="onOfferSaved" />

      <AppModal :open="!!rejecting" :title="rejecting === 'REJECTED' ? `Reject ${a.candidate.name}?` : 'Candidate withdrew?'" size="sm" @close="rejecting = null">
        <AppTextarea v-model="note" :label="rejecting === 'REJECTED' ? 'Reason' : 'Note'" :required="rejecting === 'REJECTED'" :rows="3" :maxlength="1000" />
        <template #footer>
          <AppButton variant="ghost" @click="rejecting = rejecting === 'REJECTED' ? 'WITHDRAWN' : 'REJECTED'">{{ rejecting === 'REJECTED' ? 'They withdrew instead' : 'Reject instead' }}</AppButton>
          <AppButton variant="danger" :disabled="rejecting === 'REJECTED' && note.trim().length < 3" @click="closeOut">{{ rejecting === 'REJECTED' ? 'Reject' : 'Mark withdrawn' }}</AppButton>
        </template>
      </AppModal>
      <AppModal :open="declineOpen" title="Offer declined" size="sm" @close="declineOpen = false">
        <AppTextarea v-model="declineReason" label="Reason (if shared)" :rows="2" :maxlength="500" />
        <template #footer>
          <AppButton variant="secondary" @click="declineOpen = false">Cancel</AppButton>
          <AppButton variant="danger" @click="declineOpen = false; act('decline', () => recruitmentApi.respondOffer(a!.offer!.id, 'DECLINED', declineReason || null), 'Offer marked as declined')">Record decline</AppButton>
        </template>
      </AppModal>
      <AppModal :open="hireOpen" :title="`Hire ${a.candidate.name}`" description="Creates the employee record from the accepted offer and fills one opening of the requisition." size="sm" @close="hireOpen = false">
        <div class="space-y-4">
          <AppInput v-model="employeeCode" label="Employee code" placeholder="Generated, e.g. EMP-0042" />
          <AppCheckbox v-if="canOnboard" v-model="startOnboarding" label="Start onboarding" description="Uses the default checklist; the new joiner and their manager are notified." />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="hireOpen = false">Cancel</AppButton>
          <AppButton :icon="UserCheck" :loading="busy === 'hire'" @click="hire">Hire</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
