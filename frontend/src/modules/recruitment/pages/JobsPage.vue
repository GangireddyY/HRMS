<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Globe, Plus } from '@lucide/vue';
import type { JobStatus } from '@contracts';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import JobFormModal from '@/modules/recruitment/components/JobFormModal.vue';
import type { Job, JobDetail } from '@/modules/recruitment/types';
import { JOB_STATUS_LABELS, PIPELINE_ORDER, STAGE_LABELS, jobTone, stageAccent } from '@/modules/recruitment/utils/recruitment-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('recruitment.manage'));
const table = useTable((q) => recruitmentApi.jobs(q), { filters: { status: 'OPEN' as JobStatus | undefined } });
const statusOptions = (Object.keys(JOB_STATUS_LABELS) as JobStatus[]).map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] }));
const careersPath = computed(() => (auth.organization?.slug ? `/careers/${auth.organization.slug}` : null));

const formOpen = ref(false);
async function onCreated(job: JobDetail) {
  formOpen.value = false;
  feedback.success('Job created');
  await router.push(`/hr/recruitment/jobs/${job.id}`);
}

const columns: TableColumn<Job>[] = [
  { key: 'title', label: 'Job' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'openings', label: 'Hired', align: 'right' },
  { key: 'status', label: 'Status' },
];
const total = (j: Job) => Object.values(j.pipeline).reduce((n, v) => n + (v ?? 0), 0);
</script>

<template>
  <div>
    <AppPageHeader title="Jobs" description="Openings created from approved requisitions, and their hiring pipelines.">
      <template #actions>
        <AppButton v-if="careersPath" variant="ghost" :icon="Globe" :to="careersPath">Careers page</AppButton>
        <AppButton v-if="canManage" :icon="Plus" @click="formOpen = true">Open a job</AppButton>
      </template>
    </AppPageHeader>
    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_200px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search jobs" aria-label="Search jobs" />
        <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </div>
      <AppDataTable
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        clickable
        caption="Jobs"
        empty-title="No jobs"
        :empty-description="canManage ? 'Open a job from an approved requisition.' : undefined"
        @page="table.setPage"
        @retry="table.load"
        @row-click="(row) => router.push(`/hr/recruitment/jobs/${row.id}`)"
        :filtered="table.isFiltered.value"
        @clear="table.clearFilters()"
      >
        <template #cell-title="{ row }">
          <p class="font-medium text-fg">{{ row.title }} <AppBadge v-if="row.isPublic" size="sm" tone="info" class="ms-1">Public</AppBadge></p>
          <p class="text-xs text-fg-muted">{{ [row.requisition.code, row.requisition.department?.name, row.requisition.location?.name].filter(Boolean).join(' · ') }}</p>
        </template>
        <template #cell-pipeline="{ row }">
          <div class="flex min-w-48 items-center gap-2">
            <div class="flex h-2 flex-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
              <div v-for="s in PIPELINE_ORDER" :key="s" :class="stageAccent[s]" :style="{ width: total(row) ? `${((row.pipeline[s] ?? 0) / total(row)) * 100}%` : '0%' }" />
            </div>
            <span class="text-xs text-fg-muted tabular-nums" :title="PIPELINE_ORDER.map((s) => `${STAGE_LABELS[s]}: ${row.pipeline[s] ?? 0}`).join(', ')">{{ total(row) }}</span>
          </div>
        </template>
        <template #cell-openings="{ row }"><span class="tabular-nums">{{ row.requisition.hiredCount }}/{{ row.requisition.openings }}</span></template>
        <template #cell-status="{ row }"><AppBadge :tone="jobTone[row.status]" dot>{{ JOB_STATUS_LABELS[row.status] }}</AppBadge></template>
      </AppDataTable>
    </AppCard>
    <JobFormModal :open="formOpen" :job="null" @close="formOpen = false" @saved="onCreated" />
  </div>
</template>
