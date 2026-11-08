<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRight, CalendarPlus, CheckCircle2, Download, Eye, FileUp, Mail, Phone, Send, Undo2, UserCheck, XCircle } from '@lucide/vue';
import { PIPELINE_STAGES, RESUME_MAX_BYTES, type ApplicationStage } from '@contracts';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import OfferFormModal from '@/modules/recruitment/components/OfferFormModal.vue';
import ScheduleInterviewModal from '@/modules/recruitment/components/ScheduleInterviewModal.vue';
import type { ApplicationDetail } from '@/modules/recruitment/types';
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
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppCheckbox, AppErrorState, AppInput, AppModal, AppPageHeader, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime } from '@/shared/utils/format';

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
</script>

<template>
  <div>
    <AppSkeleton v-if="app.loading.value && !a" :lines="8" />
    <AppErrorState v-else-if="app.error.value" :error="app.error.value" title="Could not load the application" @retry="app.run" />
    <template v-else-if="a">
      <AppPageHeader :title="a.candidate.name" :description="`${a.job.title} · applied ${formatDate(a.createdAt)} via ${SOURCE_LABELS[a.source].toLowerCase()}`" :back="`/hr/recruitment/jobs/${a.job.id}`" back-label="Pipeline">
        <template #leading><AppAvatar :name="a.candidate.name" size="xl" /></template>
        <template #badges><AppBadge :tone="stageTone[a.stage]" dot>{{ STAGE_LABELS[a.stage] }}</AppBadge></template>
        <template v-if="canManage && active" #actions>
          <AppButton variant="ghost" :icon="XCircle" :disabled="offerOpen" @click="rejecting = 'REJECTED'; note = ''">Reject</AppButton>
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

      <AppAlert v-if="a.stage === 'REJECTED' && a.rejectionReason" tone="warning" class="mb-4" title="Rejected">{{ a.rejectionReason }}</AppAlert>

      <div class="grid items-start gap-4 lg:grid-cols-3">
        <div class="space-y-4 lg:col-span-2">
          <AppCard title="Interviews">
            <template v-if="canManage && active" #actions><AppButton size="sm" variant="secondary" :icon="CalendarPlus" @click="scheduleOpen = true">Schedule</AppButton></template>
            <p v-if="!a.interviews.length" class="text-sm text-fg-muted">No interviews yet.</p>
            <ul v-else class="space-y-4">
              <li v-for="i in a.interviews" :key="i.id" class="rounded-xl p-4 ring-1 ring-line">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p class="font-medium text-fg">{{ i.roundName }}</p>
                    <p class="text-xs text-fg-muted">{{ formatDateTime(i.scheduledAt) }} · {{ i.durationMinutes }} min · {{ MODE_LABELS[i.mode] }}{{ i.location ? ` · ${i.location}` : '' }}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <AppBadge :tone="i.status === 'COMPLETED' ? 'success' : i.status === 'CANCELLED' ? 'neutral' : 'info'" size="sm">{{ i.status === 'SCHEDULED' ? 'Scheduled' : i.status === 'COMPLETED' ? 'Completed' : 'Cancelled' }}</AppBadge>
                    <AppButton v-if="canManage && i.status === 'SCHEDULED'" size="xs" variant="ghost" @click="act(`int-${i.id}`, () => recruitmentApi.cancelInterview(i.id), 'Interview cancelled')">Cancel</AppButton>
                  </div>
                </div>
                <ul class="mt-3 space-y-3">
                  <li v-for="(p, n) in i.panel" :key="n" class="text-sm">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-medium text-fg">{{ p.employee?.name }}</span>
                      <span v-if="p.employee?.designation" class="text-xs text-fg-muted">{{ p.employee.designation }}</span>
                      <template v-if="p.submittedAt">
                        <AppBadge v-if="p.recommendation" :tone="recommendationTone[p.recommendation]" size="sm">{{ RECOMMENDATION_LABELS[p.recommendation] }}</AppBadge>
                        <span class="text-xs text-warning-fg">{{ '★'.repeat(p.rating ?? 0) }}<span class="text-fg-subtle">{{ '★'.repeat(5 - (p.rating ?? 0)) }}</span></span>
                      </template>
                      <span v-else class="text-xs text-fg-subtle">Feedback pending</span>
                    </div>
                    <p v-if="p.feedback" class="mt-1 whitespace-pre-line text-fg-muted">{{ p.feedback }}</p>
                  </li>
                </ul>
              </li>
            </ul>
          </AppCard>

          <AppCard title="Timeline">
            <ol class="relative space-y-4 border-s border-line ps-6">
              <li v-for="e in [...a.events].reverse()" :key="e.id" class="relative">
                <span class="absolute top-1 -start-[29px] h-3 w-3 rounded-full border-2 border-surface bg-brand-500" aria-hidden="true" />
                <p class="text-sm text-fg">{{ e.fromStage ? `${STAGE_LABELS[e.fromStage]} → ` : '' }}<span class="font-medium">{{ STAGE_LABELS[e.toStage] }}</span></p>
                <p v-if="e.note" class="text-sm text-fg-muted">{{ e.note }}</p>
                <p class="text-xs text-fg-subtle">{{ e.createdBy ?? 'Careers page' }} · {{ formatDateTime(e.createdAt) }}</p>
              </li>
            </ol>
          </AppCard>
        </div>

        <div class="space-y-4">
          <AppCard title="Candidate">
            <dl class="space-y-3 text-sm">
              <div class="flex items-center gap-2 text-fg"><Mail :size="14" class="text-fg-subtle" aria-hidden="true" /><a :href="`mailto:${a.candidate.email}`" class="break-all hover:underline">{{ a.candidate.email }}</a></div>
              <div v-if="a.candidate.phone" class="flex items-center gap-2 text-fg"><Phone :size="14" class="text-fg-subtle" aria-hidden="true" />{{ a.candidate.phone }}</div>
              <div><dt class="text-xs text-fg-muted">Current role</dt><dd class="text-fg">{{ [a.candidate.currentTitle, a.candidate.currentCompany].filter(Boolean).join(' at ') || '—' }}</dd></div>
              <div class="grid grid-cols-2 gap-3">
                <div><dt class="text-xs text-fg-muted">Experience</dt><dd class="text-fg">{{ a.candidate.experienceYears !== null ? `${a.candidate.experienceYears} years` : '—' }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Notice period</dt><dd class="text-fg">{{ a.candidate.noticePeriodDays !== null ? `${a.candidate.noticePeriodDays} days` : '—' }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Current CTC</dt><dd class="text-fg">{{ money(a.candidate.currentCtc) }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Expected CTC</dt><dd class="text-fg">{{ money(a.candidate.expectedCtc) }}</dd></div>
              </div>
              <div v-if="a.candidate.linkedinUrl"><a :href="a.candidate.linkedinUrl" target="_blank" rel="noopener noreferrer nofollow" class="text-accent-fg hover:underline">LinkedIn profile</a></div>
              <div v-if="a.candidate.notes"><dt class="text-xs text-fg-muted">Notes</dt><dd class="whitespace-pre-line text-fg-muted">{{ a.candidate.notes }}</dd></div>
            </dl>
            <div class="mt-4 flex flex-wrap gap-2 border-t border-line/70 pt-4">
              <template v-if="a.candidate.resume">
                <AppButton size="sm" variant="secondary" :icon="Eye" @click="viewResume">View resume</AppButton>
                <AppButton size="sm" variant="ghost" :icon="Download" @click="recruitmentApi.downloadResume(a.candidate.id, a.candidate.resume.fileName)">Download</AppButton>
              </template>
              <AppButton v-if="canManage" size="sm" variant="ghost" :icon="FileUp" :loading="busy === 'resume'" @click="fileInput?.click()">{{ a.candidate.resume ? 'Replace' : 'Upload resume' }}</AppButton>
              <input ref="fileInput" type="file" class="sr-only" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" aria-label="Resume file" @change="onResume" />
            </div>
          </AppCard>

          <AppCard v-if="canOffer && (a.stage === 'OFFER' || a.offer)" title="Offer">
            <template v-if="!a.offer || a.offer.status === 'WITHDRAWN' || a.offer.status === 'DECLINED'">
              <p v-if="a.offer" class="mb-3 text-sm text-fg-muted">Previous offer {{ OFFER_STATUS_LABELS[a.offer.status].toLowerCase() }}{{ a.offer.declineReason ? `: “${a.offer.declineReason}”` : '' }}.</p>
              <AppButton v-if="a.stage === 'OFFER'" :icon="Send" @click="offerFormOpen = true">Draft offer</AppButton>
            </template>
            <template v-else>
              <AppBadge :tone="offerTone[a.offer.status]" dot>{{ OFFER_STATUS_LABELS[a.offer.status] }}</AppBadge>
              <dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><dt class="text-xs text-fg-muted">Annual CTC</dt><dd class="font-medium text-fg">{{ money(a.offer.annualCtc) }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Joining</dt><dd class="text-fg">{{ formatDate(a.offer.joiningDate) }}</dd></div>
                <div v-if="a.offer.expiresOn"><dt class="text-xs text-fg-muted">Valid until</dt><dd class="text-fg">{{ formatDate(a.offer.expiresOn) }}</dd></div>
              </dl>
              <div class="mt-4 flex flex-wrap gap-2">
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
        </div>
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
