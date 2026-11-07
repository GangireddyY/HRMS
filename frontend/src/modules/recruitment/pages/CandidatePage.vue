<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { BriefcaseBusiness, Download, FileUp, Pencil, Trash2 } from '@lucide/vue';
import { RESUME_MAX_BYTES } from '@contracts';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import CandidateFormModal from '@/modules/recruitment/components/CandidateFormModal.vue';
import type { Candidate } from '@/modules/recruitment/types';
import { SOURCE_LABELS, STAGE_LABELS, money, stageTone } from '@/modules/recruitment/utils/recruitment-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppErrorState, AppModal, AppPageHeader, AppSelect, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

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
</script>

<template>
  <div>
    <AppSkeleton v-if="candidate.loading.value && !c" :lines="6" />
    <AppErrorState v-else-if="candidate.error.value" :error="candidate.error.value" @retry="candidate.run" />
    <template v-else-if="c">
      <AppPageHeader :title="c.name" :description="[c.currentTitle, c.currentCompany].filter(Boolean).join(' at ') || c.email" back="/hr/recruitment/candidates" back-label="Candidates">
        <template #leading><AppAvatar :name="c.name" size="xl" /></template>
        <template #badges><AppBadge>{{ SOURCE_LABELS[c.source] }}</AppBadge></template>
        <template v-if="canManage" #actions>
          <AppButton variant="ghost" :icon="Trash2" aria-label="Delete candidate" @click="remove" />
          <AppButton variant="secondary" :icon="Pencil" @click="editOpen = true">Edit</AppButton>
          <AppButton :icon="BriefcaseBusiness" @click="openAdd">Add to a job</AppButton>
        </template>
      </AppPageHeader>
      <div class="grid items-start gap-4 lg:grid-cols-3">
        <AppCard class="lg:col-span-2" title="Applications" :padded="false">
          <p v-if="!c.applications.length" class="p-4 text-sm text-fg-muted">Not in any job's pipeline.</p>
          <ul v-else class="divide-y divide-line">
            <li v-for="a in c.applications" :key="a.id">
              <RouterLink :to="`/hr/recruitment/applications/${a.id}`" class="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-muted/50">
                <span class="font-medium text-fg">{{ a.job.title }}</span>
                <span class="flex items-center gap-2 text-xs text-fg-muted">{{ a.stageChangedAt ? timeAgo(a.stageChangedAt) : '' }}<AppBadge :tone="stageTone[a.stage]" dot>{{ STAGE_LABELS[a.stage] }}</AppBadge></span>
              </RouterLink>
            </li>
          </ul>
        </AppCard>
        <AppCard title="Details">
          <dl class="space-y-3 text-sm">
            <div><dt class="text-xs text-fg-muted">Email</dt><dd class="break-all text-fg">{{ c.email }}</dd></div>
            <div><dt class="text-xs text-fg-muted">Phone</dt><dd class="text-fg">{{ c.phone ?? '—' }}</dd></div>
            <div class="grid grid-cols-2 gap-3">
              <div><dt class="text-xs text-fg-muted">Experience</dt><dd class="text-fg">{{ c.experienceYears !== null ? `${c.experienceYears} years` : '—' }}</dd></div>
              <div><dt class="text-xs text-fg-muted">Notice</dt><dd class="text-fg">{{ c.noticePeriodDays !== null ? `${c.noticePeriodDays} days` : '—' }}</dd></div>
              <div><dt class="text-xs text-fg-muted">Current CTC</dt><dd class="text-fg">{{ money(c.currentCtc) }}</dd></div>
              <div><dt class="text-xs text-fg-muted">Expected CTC</dt><dd class="text-fg">{{ money(c.expectedCtc) }}</dd></div>
            </div>
            <div><dt class="text-xs text-fg-muted">Location</dt><dd class="text-fg">{{ c.location ?? '—' }}</dd></div>
            <div v-if="c.skills.length">
              <dt class="text-xs text-fg-muted">Skills</dt>
              <dd class="mt-1 flex flex-wrap gap-2"><AppBadge v-for="s in c.skills" :key="s" size="sm">{{ s }}</AppBadge></dd>
            </div>
            <div v-if="c.referredBy"><dt class="text-xs text-fg-muted">Referred by</dt><dd class="text-fg">{{ c.referredBy.name }}</dd></div>
            <div v-if="c.consentAt"><dt class="text-xs text-fg-muted">Consent</dt><dd class="text-fg">Given {{ formatDate(c.consentAt) }} (careers page)</dd></div>
            <div v-if="c.notes"><dt class="text-xs text-fg-muted">Notes</dt><dd class="whitespace-pre-line text-fg-muted">{{ c.notes }}</dd></div>
          </dl>
          <div class="mt-4 flex flex-wrap gap-2 border-t border-line/70 pt-4">
            <AppButton v-if="c.resume" size="sm" variant="secondary" :icon="Download" @click="recruitmentApi.downloadResume(c.id, c.resume.fileName)">{{ c.resume.fileName }}</AppButton>
            <AppButton v-if="canManage" size="sm" variant="ghost" :icon="FileUp" @click="fileInput?.click()">{{ c.resume ? 'Replace resume' : 'Upload resume' }}</AppButton>
            <input ref="fileInput" type="file" class="sr-only" accept=".pdf,.docx" aria-label="Resume file" @change="onResume" />
          </div>
        </AppCard>
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
