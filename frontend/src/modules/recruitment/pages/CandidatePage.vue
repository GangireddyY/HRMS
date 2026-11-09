<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { BriefcaseBusiness, CalendarDays, Check, ChevronRight, Download, ExternalLink, FileText, FileUp, Mail, MapPin, Pencil, Phone, ShieldCheck, StickyNote, Tags, Trash2, UserRound, Wallet } from '@lucide/vue';
import { RESUME_MAX_BYTES, type ApplicationStage } from '@contracts';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import CandidateFormModal from '@/modules/recruitment/components/CandidateFormModal.vue';
import type { Candidate } from '@/modules/recruitment/types';
import { JOB_STATUS_LABELS, SOURCE_LABELS, STAGE_LABELS, jobTone, money, stageTone } from '@/modules/recruitment/utils/recruitment-format';
import { SOURCE_ICON, STAGE_ICON, stageAge, stageSoft } from '@/modules/recruitment/utils/recruitment-ui';
import { AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppModal, AppPageHeader, AppSelect, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** A candidate's profile: contact, background, resume, and every job they are in with how far they got. */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('recruitment.manage'));
const id = computed(() => String(route.params.id));
const candidate = useAsync(() => recruitmentApi.candidate(id.value));
watch(id, () => void candidate.run());
const c = computed(() => candidate.data.value);

const editOpen = ref(false);
function onSaved(next: Candidate) {
  editOpen.value = false;
  candidate.data.value = next;
  feedback.success('Candidate updated');
}

const fileInput = ref<HTMLInputElement | null>(null);
async function onResume(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > RESUME_MAX_BYTES) return feedback.error('This file is too large', 'Resumes must be 5 MB or smaller.');
  try {
    candidate.data.value = await recruitmentApi.uploadResume(id.value, file);
    feedback.success('Resume uploaded');
  } catch (err) {
    feedback.error('Could not upload the resume', err);
  }
}

const addOpen = ref(false);
const openJobs = useAsync(() => recruitmentApi.jobs({ status: 'OPEN', pageSize: 100 }), { immediate: false });
const jobId = ref<string | null>(null);
const jobOptions = computed(() => (openJobs.data.value?.items ?? []).filter((j) => !c.value?.applications.some((a) => a.job.id === j.id)).map((j) => ({ value: j.id, label: j.title, description: j.requisition.department?.name })));
function openAdd() {
  jobId.value = null;
  addOpen.value = true;
  void openJobs.run();
}
async function addToJob() {
  try {
    const app = await recruitmentApi.addToJob(jobId.value!, id.value);
    addOpen.value = false;
    feedback.success('Added to the job');
    await router.push(`/hr/recruitment/applications/${app.id}`);
  } catch (e) {
    feedback.error('Could not add to the job', e);
  }
}

async function remove() {
  if (!(await feedback.confirm({ title: `Delete ${c.value!.name}?`, message: 'Their applications, interviews, feedback and resume are deleted permanently (for example after a data-deletion request).', confirmLabel: 'Delete candidate', danger: true, requireText: c.value!.email }))) return;
  try {
    await recruitmentApi.removeCandidate(id.value);
    feedback.success('Candidate deleted');
    await router.replace('/hr/recruitment/candidates');
  } catch (e) {
    feedback.error('Could not delete the candidate', e);
  }
}

// ---- Presentation -------------------------------------------------------------------------------------------------
const STEPS: ApplicationStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];
/** How many pipeline steps an application has reached; closed-out applications show as stopped. */
const reached = (stage: ApplicationStage) => (STEPS.includes(stage) ? STEPS.indexOf(stage) : -1);
const ACTIVE: ApplicationStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
const activeCount = computed(() => c.value?.applications.filter((a) => ACTIVE.includes(a.stage)).length ?? 0);
const lastActivity = computed(() => {
  const dates = (c.value?.applications ?? []).map((a) => a.stageChangedAt).filter((d): d is string => !!d);
  return dates.length ? dates.sort().at(-1)! : null;
});
const fileSize = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isUrl = (s: string | null) => !!s && /^https?:\/\//i.test(s);
const background = computed(() => [
  { label: 'Experience', value: c.value?.experienceYears !== null && c.value?.experienceYears !== undefined ? `${c.value.experienceYears} years` : '—' },
  { label: 'Notice period', value: c.value?.noticePeriodDays !== null && c.value?.noticePeriodDays !== undefined ? `${c.value.noticePeriodDays} days` : '—' },
  { label: 'Current CTC', value: money(c.value?.currentCtc) },
  { label: 'Expected CTC', value: money(c.value?.expectedCtc) },
]);
</script>

<template>
  <div class="space-y-4">
    <AppSkeleton v-if="candidate.loading.value && !c" :lines="6" />
    <AppErrorState v-else-if="candidate.error.value" :error="candidate.error.value" @retry="candidate.run" />
    <template v-else-if="c">
      <AppPageHeader :title="c.name" :description="[c.currentTitle, c.currentCompany].filter(Boolean).join(' at ') || 'No current role on file'" back="/hr/recruitment/candidates" back-label="Candidates">
        <template #leading><AppAvatar :name="c.name" size="xl" /></template>
        <template #badges>
          <AppBadge><component :is="SOURCE_ICON[c.source]" :size="11" aria-hidden="true" />{{ SOURCE_LABELS[c.source] }}</AppBadge>
          <AppBadge v-if="activeCount" tone="brand" dot>In {{ activeCount }} active pipeline{{ activeCount === 1 ? '' : 's' }}</AppBadge>
        </template>
        <template v-if="canManage" #actions>
          <AppButton variant="ghost" :icon="Trash2" aria-label="Delete candidate" title="Delete candidate" @click="remove" />
          <AppButton variant="secondary" :icon="Pencil" @click="editOpen = true">Edit</AppButton>
          <AppButton :icon="BriefcaseBusiness" @click="openAdd">Add to a job</AppButton>
        </template>
      </AppPageHeader>

      <!-- Contact strip -->
      <section class="card flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm" aria-label="Contact">
        <a :href="`mailto:${c.email}`" class="inline-flex min-w-0 items-center gap-1.5 text-fg hover:text-accent-fg hover:underline"><Mail :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" /><span class="truncate">{{ c.email }}</span></a>
        <a v-if="c.phone" :href="`tel:${c.phone}`" class="inline-flex items-center gap-1.5 text-fg hover:text-accent-fg hover:underline"><Phone :size="14" class="text-fg-subtle" aria-hidden="true" />{{ c.phone }}</a>
        <span v-if="c.location" class="inline-flex items-center gap-1.5 text-fg-muted"><MapPin :size="14" class="text-fg-subtle" aria-hidden="true" />{{ c.location }}</span>
        <a v-if="isUrl(c.linkedinUrl)" :href="c.linkedinUrl!" target="_blank" rel="noopener noreferrer nofollow" class="inline-flex items-center gap-1.5 text-accent-fg hover:underline"><ExternalLink :size="14" aria-hidden="true" />LinkedIn profile</a>
        <span class="ms-auto inline-flex items-center gap-1.5 text-xs text-fg-muted"><CalendarDays :size="13" aria-hidden="true" />Added {{ formatDate(c.createdAt) }} · {{ timeAgo(c.createdAt) }}</span>
      </section>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div class="space-y-4">
          <!-- Applications -->
          <AppCard title="Applications" :icon="BriefcaseBusiness" :description="c.applications.length ? `${c.applications.length} job${c.applications.length === 1 ? '' : 's'} · ${activeCount} active` : undefined" :padded="false">
            <AppEmptyState v-if="!c.applications.length" compact :icon="BriefcaseBusiness" title="Not in any job's pipeline" :description="canManage ? 'Add them to an open job to start screening.' : undefined">
              <AppButton v-if="canManage" size="sm" :icon="BriefcaseBusiness" @click="openAdd">Add to a job</AppButton>
            </AppEmptyState>
            <ul v-else class="divide-y divide-line/70">
              <li v-for="a in c.applications" :key="a.id">
                <RouterLink :to="`/hr/recruitment/applications/${a.id}`" class="group flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 transition hover:bg-surface-muted/50">
                  <span :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', stageSoft[a.stage]]" aria-hidden="true"><component :is="STAGE_ICON[a.stage]" :size="17" /></span>
                  <div class="min-w-0 flex-1">
                    <p class="flex flex-wrap items-center gap-2">
                      <span class="truncate font-medium text-fg group-hover:text-accent-fg">{{ a.job.title }}</span>
                      <AppBadge v-if="a.job.status && a.job.status !== 'OPEN'" :tone="jobTone[a.job.status]" size="sm">Job {{ JOB_STATUS_LABELS[a.job.status].toLowerCase() }}</AppBadge>
                    </p>
                    <p class="text-xs text-fg-muted">
                      {{ STAGE_LABELS[a.stage] }}<template v-if="a.stageChangedAt"> · {{ ACTIVE.includes(a.stage) ? `in stage ${stageAge(a.stageChangedAt).days === 0 ? 'since today' : `for ${stageAge(a.stageChangedAt).days} days`}` : timeAgo(a.stageChangedAt) }}</template>
                    </p>
                  </div>
                  <!-- Pipeline progress: filled up to the stage reached. -->
                  <ol class="flex items-center gap-1" :aria-label="`Progress: ${STAGE_LABELS[a.stage]}`">
                    <li
                      v-for="(s, i) in STEPS"
                      :key="s"
                      :title="STAGE_LABELS[s]"
                      :class="[
                        'h-1.5 w-7 rounded-full',
                        reached(a.stage) < 0 ? 'bg-line' : i <= reached(a.stage) ? (a.stage === 'HIRED' ? 'bg-success' : 'bg-brand-500') : 'bg-line',
                      ]"
                    />
                  </ol>
                  <AppBadge :tone="stageTone[a.stage]" dot class="w-24 justify-center">{{ STAGE_LABELS[a.stage] }}</AppBadge>
                  <ChevronRight :size="16" class="text-fg-subtle transition group-hover:translate-x-0.5" aria-hidden="true" />
                </RouterLink>
              </li>
            </ul>
          </AppCard>

          <!-- Resume -->
          <AppCard title="Resume" :icon="FileText">
            <div v-if="c.resume" class="flex flex-wrap items-center gap-3 rounded-lg bg-surface-muted/60 p-3 ring-1 ring-line/60 ring-inset">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger-fg" aria-hidden="true"><FileText :size="18" /></span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-fg">{{ c.resume.fileName }}</p>
                <p class="text-xs text-fg-muted">{{ fileSize(c.resume.size) }} · uploaded {{ timeAgo(c.resume.uploadedAt) }}</p>
              </div>
              <AppButton size="sm" variant="secondary" :icon="Download" @click="recruitmentApi.downloadResume(c.id, c.resume.fileName)">Download</AppButton>
              <AppButton v-if="canManage" size="sm" variant="ghost" :icon="FileUp" @click="fileInput?.click()">Replace</AppButton>
            </div>
            <div v-else class="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-line-strong p-4">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-fg-muted" aria-hidden="true"><FileUp :size="18" /></span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-fg">No resume yet</p>
                <p class="text-xs text-fg-muted">PDF or Word, up to 5 MB. Interviewers can open it from their interview list.</p>
              </div>
              <AppButton v-if="canManage" size="sm" variant="secondary" :icon="FileUp" @click="fileInput?.click()">Upload resume</AppButton>
            </div>
            <input ref="fileInput" type="file" class="sr-only" accept=".pdf,.docx" aria-label="Resume file" @change="onResume" />
          </AppCard>

          <AppCard v-if="c.skills.length || c.notes" title="Skills & notes" :icon="Tags">
            <div v-if="c.skills.length" class="flex flex-wrap gap-1.5">
              <AppBadge v-for="s in c.skills" :key="s" tone="brand">{{ s }}</AppBadge>
            </div>
            <div v-if="c.notes" :class="['flex gap-2.5 rounded-lg bg-warning-soft/40 p-3 text-sm', c.skills.length && 'mt-4']">
              <StickyNote :size="15" class="mt-0.5 shrink-0 text-warning-fg" aria-hidden="true" />
              <p class="whitespace-pre-line text-fg">{{ c.notes }}</p>
            </div>
          </AppCard>
        </div>

        <aside class="space-y-4">
          <AppCard title="Background" :icon="Wallet">
            <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line/60 ring-1 ring-line/60">
              <div v-for="f in background" :key="f.label" class="bg-surface px-3 py-2.5">
                <dt class="text-2xs font-medium text-fg-muted">{{ f.label }}</dt>
                <dd class="mt-0.5 text-sm font-medium text-fg tabular-nums">{{ f.value }}</dd>
              </div>
            </dl>
          </AppCard>

          <AppCard title="Source" :icon="UserRound">
            <ul class="space-y-3 text-sm">
              <li class="flex items-start gap-3">
                <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-fg" aria-hidden="true"><component :is="SOURCE_ICON[c.source]" :size="14" /></span>
                <div><p class="font-medium text-fg">{{ SOURCE_LABELS[c.source] }}</p><p class="text-xs text-fg-muted">How they reached us</p></div>
              </li>
              <li v-if="c.referredBy" class="flex items-center gap-3">
                <AppAvatar :name="c.referredBy.name" size="sm" />
                <div><p class="font-medium text-fg">{{ c.referredBy.name }}</p><p class="text-xs text-fg-muted">Referred by</p></div>
              </li>
              <li class="flex items-start gap-3">
                <span :class="['mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', c.consentAt ? 'bg-success-soft text-success-fg' : 'bg-surface-muted text-fg-muted']" aria-hidden="true">
                  <component :is="c.consentAt ? Check : ShieldCheck" :size="14" />
                </span>
                <div>
                  <p class="font-medium text-fg">{{ c.consentAt ? 'Consent given' : 'No consent recorded' }}</p>
                  <p class="text-xs text-fg-muted">{{ c.consentAt ? `${formatDate(c.consentAt)} (careers page)` : 'Added by the hiring team' }}</p>
                </div>
              </li>
            </ul>
          </AppCard>

          <AppCard title="Key dates" :icon="CalendarDays">
            <ol class="relative space-y-4 border-s border-line ps-5">
              <li class="relative">
                <span class="absolute -start-[27px] top-1 h-3 w-3 rounded-full bg-brand-500 ring-4 ring-surface" aria-hidden="true" />
                <p class="text-sm font-medium text-fg">Added to the talent pool</p>
                <p class="text-xs text-fg-muted">{{ formatDate(c.createdAt) }} · {{ timeAgo(c.createdAt) }}</p>
              </li>
              <li v-if="lastActivity" class="relative">
                <span class="absolute -start-[27px] top-1 h-3 w-3 rounded-full bg-special ring-4 ring-surface" aria-hidden="true" />
                <p class="text-sm font-medium text-fg">Last pipeline movement</p>
                <p class="text-xs text-fg-muted">{{ formatDate(lastActivity) }} · {{ timeAgo(lastActivity) }}</p>
              </li>
              <li v-if="c.resume" class="relative">
                <span class="absolute -start-[27px] top-1 h-3 w-3 rounded-full bg-fg-subtle ring-4 ring-surface" aria-hidden="true" />
                <p class="text-sm font-medium text-fg">Resume uploaded</p>
                <p class="text-xs text-fg-muted">{{ formatDate(c.resume.uploadedAt) }}</p>
              </li>
            </ol>
          </AppCard>
        </aside>
      </div>

      <CandidateFormModal :open="editOpen" :candidate="c" @close="editOpen = false" @saved="onSaved" />
      <AppModal :open="addOpen" :title="`Add ${c.name} to a job`" size="sm" @close="addOpen = false">
        <AppSelect v-model="jobId" label="Open job" :options="jobOptions" placeholder="Choose a job" :clearable="false" />
        <template #footer>
          <AppButton variant="secondary" @click="addOpen = false">Cancel</AppButton>
          <AppButton :disabled="!jobId" @click="addToJob">Add</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
