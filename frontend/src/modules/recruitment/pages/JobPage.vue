<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CalendarClock, ChevronDown, FileText, Pencil, Star, UserPlus } from '@lucide/vue';
import type { ApplicationStage, JobStatus } from '@contracts';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import CandidateFormModal from '@/modules/recruitment/components/CandidateFormModal.vue';
import JobFormModal from '@/modules/recruitment/components/JobFormModal.vue';
import type { ApplicationCard, Candidate, JobDetail } from '@/modules/recruitment/types';
import { JOB_STATUS_LABELS, STAGE_LABELS, experience, jobTone, stageAccent } from '@/modules/recruitment/utils/recruitment-format';
import { AppAvatar, AppBadge, AppButton, AppDropdown, AppEmptyState, AppErrorState, AppMenuItem, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('recruitment.manage'));
const id = computed(() => String(route.params.id));
const job = useAsync(() => recruitmentApi.job(id.value));
const apps = useAsync(() => recruitmentApi.applications({ jobId: id.value, pageSize: 100 }));
watch(id, () => {
  void job.run();
  void apps.run();
});

const ACTIVE: ApplicationStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
const CLOSED: ApplicationStage[] = ['HIRED', 'REJECTED', 'WITHDRAWN'];
const byStage = computed(() => {
  const m = new Map<ApplicationStage, ApplicationCard[]>();
  for (const a of apps.data.value?.items ?? []) m.set(a.stage, [...(m.get(a.stage) ?? []), a]);
  return m;
});
const showClosed = ref(false);

const STATUS_ACTIONS: Record<JobStatus, { to: JobStatus; label: string }[]> = {
  DRAFT: [{ to: 'OPEN', label: 'Open for applications' }, { to: 'CLOSED', label: 'Close' }],
  OPEN: [{ to: 'ON_HOLD', label: 'Put on hold' }, { to: 'CLOSED', label: 'Close' }],
  ON_HOLD: [{ to: 'OPEN', label: 'Reopen' }, { to: 'CLOSED', label: 'Close' }],
  CLOSED: [{ to: 'OPEN', label: 'Reopen' }],
};
async function setStatus(to: JobStatus) {
  try {
    job.data.value = await recruitmentApi.setJobStatus(id.value, to);
    feedback.success(`Job ${JOB_STATUS_LABELS[to].toLowerCase()}`);
  } catch (e) {
    feedback.error('Could not change the job status', e);
  }
}

const editOpen = ref(false);
function onEdited(j: JobDetail) {
  editOpen.value = false;
  job.data.value = j;
  feedback.success('Job updated');
}

const addOpen = ref(false);
async function onCandidateAdded(c: Candidate) {
  addOpen.value = false;
  feedback.success(`${c.name} added`);
  await apps.run();
}
async function addExisting(candidateId: string) {
  addOpen.value = false;
  try {
    await recruitmentApi.addToJob(id.value, candidateId);
    feedback.success('Candidate added to this job');
    await apps.run();
  } catch (e) {
    feedback.error('Could not add the candidate', e);
  }
}
</script>

<template>
  <div>
    <AppSkeleton v-if="job.loading.value && !job.data.value" :lines="6" />
    <AppErrorState v-else-if="job.error.value" :error="job.error.value" title="Could not load the job" @retry="job.run" />
    <template v-else-if="job.data.value">
      <AppPageHeader
        :title="job.data.value.title"
        :description="[job.data.value.requisition.department?.name, job.data.value.requisition.location?.name, EMPLOYMENT_TYPE_LABELS[job.data.value.requisition.employmentType], experience(job.data.value.experienceMin, job.data.value.experienceMax)].filter(Boolean).join(' · ')"
        back="/hr/recruitment/jobs"
        back-label="Jobs"
      >
        <template #badges>
          <AppBadge :tone="jobTone[job.data.value.status]" dot>{{ JOB_STATUS_LABELS[job.data.value.status] }}</AppBadge>
          <AppBadge v-if="job.data.value.isPublic" tone="info">On careers page</AppBadge>
          <AppBadge>{{ job.data.value.requisition.code }} · {{ job.data.value.requisition.hiredCount }}/{{ job.data.value.requisition.openings }} hired</AppBadge>
        </template>
        <template v-if="canManage" #actions>
          <AppButton variant="secondary" :icon="Pencil" @click="editOpen = true">Edit posting</AppButton>
          <AppDropdown label="Job status" width="w-56">
            <template #trigger="{ toggle }"><AppButton variant="secondary" :icon-right="ChevronDown" @click="toggle">Status</AppButton></template>
            <template #default="{ close }">
              <AppMenuItem v-for="a in STATUS_ACTIONS[job.data.value.status]" :key="a.to" @select="close(); setStatus(a.to)">{{ a.label }}</AppMenuItem>
            </template>
          </AppDropdown>
          <AppButton :icon="UserPlus" :disabled="job.data.value.status !== 'OPEN'" @click="addOpen = true">Add candidate</AppButton>
        </template>
      </AppPageHeader>

      <AppErrorState v-if="apps.error.value" :error="apps.error.value" @retry="apps.run" />
      <AppEmptyState v-else-if="apps.data.value && !apps.data.value.items.length" class="card" title="No candidates yet" :description="job.data.value.status === 'OPEN' ? 'Add candidates, or share the careers page.' : 'Open the job to start adding candidates.'" />
      <div v-else class="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
        <section v-for="s in [...ACTIVE, ...(showClosed ? CLOSED : [])]" :key="s" class="flex min-h-[60vh] min-w-64 flex-1 basis-0 flex-col rounded-md border border-line bg-surface-muted/40 p-2.5">
          <h2 class="mb-3 flex items-center justify-between px-1 text-sm font-semibold text-fg">
            <span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full" :class="stageAccent[s]" aria-hidden="true" />{{ STAGE_LABELS[s] }}</span>
            <span class="text-xs font-normal text-fg-muted tabular-nums">{{ byStage.get(s)?.length ?? 0 }}</span>
          </h2>
          <ul class="space-y-2">
            <li v-for="a in byStage.get(s) ?? []" :key="a.id">
              <button type="button" class="w-full rounded-md border border-line bg-surface p-3 text-left transition hover:border-brand-400" @click="router.push(`/hr/recruitment/applications/${a.id}`)">
                <span class="flex items-center gap-2.5">
                  <AppAvatar :name="a.candidate.name" size="sm" />
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-medium text-fg">{{ a.candidate.name }}</span>
                    <span class="block truncate text-xs text-fg-muted">{{ [a.candidate.currentTitle, a.candidate.currentCompany].filter(Boolean).join(' at ') || a.candidate.email }}</span>
                  </span>
                </span>
                <span class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
                  <span v-if="a.candidate.experienceYears !== null">{{ a.candidate.experienceYears }} yrs</span>
                  <span v-if="a.averageRating !== null" class="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400"><Star :size="12" aria-hidden="true" />{{ a.averageRating }}</span>
                  <span v-if="a.nextInterviewAt" class="inline-flex items-center gap-1"><CalendarClock :size="12" aria-hidden="true" />{{ formatDateTime(a.nextInterviewAt) }}</span>
                  <span v-if="a.candidate.hasResume" class="inline-flex items-center gap-0.5"><FileText :size="12" aria-hidden="true" />CV</span>
                  <span>{{ timeAgo(a.stageChangedAt) }}</span>
                </span>
              </button>
            </li>
          </ul>
        </section>
        <button type="button" class="w-32 shrink-0 self-start rounded-md border border-dashed border-line-strong p-3 text-xs text-fg-muted hover:border-brand-400 hover:text-fg" @click="showClosed = !showClosed">
          {{ showClosed ? 'Hide' : 'Show' }} hired, rejected and withdrawn ({{ CLOSED.reduce((n, s) => n + (byStage.get(s)?.length ?? 0), 0) }})
        </button>
      </div>

      <JobFormModal :open="editOpen" :job="job.data.value" @close="editOpen = false" @saved="onEdited" />
      <CandidateFormModal :open="addOpen" :candidate="null" :job-id="job.data.value.id" @close="addOpen = false" @saved="onCandidateAdded" @existing="addExisting" />
    </template>
  </div>
</template>
