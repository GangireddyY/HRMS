<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { BriefcaseBusiness, CalendarClock, Globe, MapPin, Plus, Rss, X } from '@lucide/vue';
import type { ApplicationStage, JobStatus } from '@contracts';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import JobFormModal from '@/modules/recruitment/components/JobFormModal.vue';
import JobGridCard from '@/modules/recruitment/components/JobGridCard.vue';
import type { Job, JobDetail } from '@/modules/recruitment/types';
import { JOB_STATUS_LABELS, STAGE_LABELS, jobTone, stageAccent } from '@/modules/recruitment/utils/recruitment-format';
import { daysUntil, dueText, dueTone } from '@/modules/recruitment/utils/recruitment-ui';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** The job board: every opening with its hiring pipeline at a glance; the status figures filter the list. */
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('recruitment.manage'));
const table = useTable((q) => recruitmentApi.jobs(q), { filters: { status: 'OPEN' as JobStatus | undefined } });
const careersPath = computed(() => (auth.organization?.slug ? `/careers/${auth.organization.slug}` : null));
/** XML feed of the public jobs (Indeed format) that job boards and aggregators import. */
const feedUrl = computed(() => (auth.organization?.slug ? `${window.location.origin}/api/v1/careers/${auth.organization.slug}/jobs.xml` : null));
async function copyFeed() {
  try {
    await navigator.clipboard.writeText(feedUrl.value!);
    feedback.success('Job-board feed link copied', 'Give it to Indeed, Jooble, Adzuna or another board that imports XML feeds; public open jobs update on their own.');
  } catch {
    feedback.info('Job-board feed link', feedUrl.value!);
  }
}

const formOpen = ref(false);
async function onCreated(job: JobDetail) {
  formOpen.value = false;
  feedback.success('Job created');
  await router.push(`/hr/recruitment/jobs/${job.id}`);
}

const ACTIVE: ApplicationStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
const active = (j: Job) => ACTIVE.reduce((n, s) => n + (j.pipeline[s] ?? 0), 0);

// Figures across every job, whatever the current filter.
const summary = useAsync(() => fetchAllPages((page, pageSize) => recruitmentApi.jobs({ page, pageSize })));
const jobs = computed(() => summary.data.value ?? []);
const strip = computed<StripItem[]>(() => {
  const of = (s: JobStatus) => jobs.value.filter((j) => j.status === s);
  const open = of('OPEN');
  const openings = open.reduce((n, j) => n + Math.max(0, j.requisition.openings - j.requisition.hiredCount), 0);
  return [
    { key: 'OPEN', label: 'Open', value: open.length, tone: 'success', hint: `${openings} seat${openings === 1 ? '' : 's'} to fill · ${open.reduce((n, j) => n + active(j), 0)} in pipeline` },
    { key: 'ON_HOLD', label: 'On hold', value: of('ON_HOLD').length, tone: 'warning', hint: 'Paused, not taking applications' },
    { key: 'DRAFT', label: 'Drafts', value: of('DRAFT').length, tone: 'neutral', hint: 'Not yet open for applications' },
    { key: 'CLOSED', label: 'Closed', value: of('CLOSED').length, tone: '#94a3b8', hint: `${jobs.value.reduce((n, j) => n + (j.pipeline.HIRED ?? 0), 0)} hired across all jobs` },
  ];
});

const columns: TableColumn<Job>[] = [
  { key: 'title', label: 'Job' },
  { key: 'manager', label: 'Hiring manager' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'openings', label: 'Hired', align: 'right' },
  { key: 'dates', label: 'Timeline' },
  { key: 'status', label: 'Status' },
];
function closesText(date: string): string {
  const n = daysUntil(date);
  return n < 0 ? `Closing date passed ${dueText(date, false).toLowerCase()}` : `Closes ${dueText(date).toLowerCase()}`;
}
const place = (j: Job) => [j.requisition.department?.name, j.requisition.location?.name].filter(Boolean).join(' · ');
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Jobs" description="Openings created from approved requisitions, and their hiring pipelines.">
      <template #actions>
        <AppButton v-if="careersPath" variant="ghost" :icon="Globe" :to="careersPath">Careers page</AppButton>
        <AppButton v-if="feedUrl" variant="ghost" :icon="Rss" title="Copy the XML feed link for job boards" @click="copyFeed">Job-board feed</AppButton>
        <AppButton v-if="canManage" :icon="Plus" @click="formOpen = true">Open a job</AppButton>
      </template>
    </AppPageHeader>

    <AppStatStrip
      :items="strip"
      :loading="summary.loading.value && !summary.data.value"
      selectable
      :selected="table.filters.status ?? null"
      label="Jobs by status"
      @select="(k) => (table.filters.status = (k as JobStatus | null) ?? undefined)"
    />

    <AppCard :padded="false">
      <div class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
        <AppSearchInput v-model="table.search.value" class="min-w-60 flex-1" placeholder="Search jobs" aria-label="Search jobs" />
        <span class="inline-flex items-center gap-1.5 text-xs text-fg-muted">
          Showing
          <AppBadge v-if="table.filters.status" :tone="jobTone[table.filters.status]" dot>{{ JOB_STATUS_LABELS[table.filters.status] }} jobs</AppBadge>
          <AppBadge v-else>All jobs</AppBadge>
          <AppButton v-if="table.filters.status" size="xs" variant="ghost" :icon="X" aria-label="Show jobs in every status" @click="table.filters.status = undefined" />
        </span>
      </div>
      <AppDataTable
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        clickable
        caption="Jobs"
        :empty-title="table.filters.status ? `No ${JOB_STATUS_LABELS[table.filters.status].toLowerCase()} jobs` : 'No jobs yet'"
        :empty-description="canManage ? 'Open a job from an approved requisition to start receiving applications.' : 'Jobs appear here once recruiters open them from approved requisitions.'"
        @page="table.setPage"
        @retry="table.load"
        @row-click="(row) => router.push(`/hr/recruitment/jobs/${row.id}`)"
        :filtered="table.isFiltered.value && !!table.search.value"
        @clear="table.clearFilters()"
      >
        <template #empty><AppButton v-if="canManage" :icon="Plus" @click="formOpen = true">Open a job</AppButton></template>
        <template #cell-title="{ row }">
          <div class="flex items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true">
              <BriefcaseBusiness :size="17" />
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-2 font-medium text-fg">
                <span class="truncate">{{ row.title }}</span>
                <AppBadge v-if="row.isPublic" size="sm" tone="info"><Globe :size="10" aria-hidden="true" />Public</AppBadge>
              </p>
              <p class="flex items-center gap-1 truncate text-xs text-fg-muted">
                <span class="font-mono">{{ row.requisition.code }}</span>
                <template v-if="place(row)"> · <MapPin :size="11" class="shrink-0" aria-hidden="true" />{{ place(row) }}</template>
              </p>
            </div>
          </div>
        </template>
        <template #cell-manager="{ row }">
          <div v-if="row.requisition.hiringManager" class="flex items-center gap-2">
            <AppAvatar :name="row.requisition.hiringManager.name" size="xs" />
            <span class="truncate text-sm text-fg">{{ row.requisition.hiringManager.name }}</span>
          </div>
          <span v-else class="text-xs text-fg-subtle">Not set</span>
        </template>
        <template #cell-pipeline="{ row }">
          <ol class="flex items-stretch gap-1" :aria-label="`Pipeline: ${ACTIVE.map((s) => `${STAGE_LABELS[s]} ${row.pipeline[s] ?? 0}`).join(', ')}`">
            <li v-for="s in ACTIVE" :key="s" :class="['relative flex w-[4.5rem] flex-col items-center overflow-hidden rounded-md pt-1 pb-1.5', row.pipeline[s] ? 'bg-surface-muted' : 'bg-surface-muted/40']" :title="`${STAGE_LABELS[s]}: ${row.pipeline[s] ?? 0}`">
              <span :class="['text-sm leading-5 font-semibold tabular-nums', row.pipeline[s] ? 'text-fg' : 'text-fg-subtle']">{{ row.pipeline[s] ?? 0 }}</span>
              <span class="text-2xs leading-3 text-fg-muted">{{ STAGE_LABELS[s] }}</span>
              <span :class="['absolute inset-x-0 bottom-0 h-0.5', row.pipeline[s] ? stageAccent[s] : 'bg-transparent']" aria-hidden="true" />
            </li>
          </ol>
        </template>
        <template #cell-openings="{ row }">
          <div class="ms-auto w-20">
            <p class="text-sm text-fg tabular-nums"><span class="font-semibold">{{ row.requisition.hiredCount }}</span><span class="text-fg-muted">/{{ row.requisition.openings }}</span></p>
            <div class="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
              <div class="h-full rounded-full bg-success" :style="{ width: `${(row.requisition.hiredCount / Math.max(1, row.requisition.openings)) * 100}%` }" />
            </div>
          </div>
        </template>
        <template #cell-dates="{ row }">
          <p class="text-sm text-fg">{{ row.openedAt ? `Opened ${timeAgo(row.openedAt)}` : `Created ${timeAgo(row.createdAt)}` }}</p>
          <p v-if="row.status === 'CLOSED' && row.closedAt" class="text-2xs text-fg-subtle">Closed {{ formatDate(row.closedAt) }}</p>
          <p v-else-if="row.closesOn" :class="['inline-flex items-center gap-1 text-2xs font-medium', dueTone(row.closesOn)]">
            <CalendarClock :size="11" aria-hidden="true" />{{ closesText(row.closesOn) }}
          </p>
          <p v-else class="text-2xs text-fg-subtle">No closing date</p>
        </template>
        <template #cell-status="{ row }"><AppBadge :tone="jobTone[row.status]" dot>{{ JOB_STATUS_LABELS[row.status] }}</AppBadge></template>
        <template #card="{ row }"><JobGridCard :job="row" /></template>
      </AppDataTable>
    </AppCard>
    <JobFormModal :open="formOpen" :job="null" @close="formOpen = false" @saved="onCreated" />
  </div>
</template>
