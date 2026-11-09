<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { FileText, MapPin, Plus, UserPlus } from '@lucide/vue';
import { CANDIDATE_SOURCES, type CandidateSource } from '@contracts';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import CandidateFormModal from '@/modules/recruitment/components/CandidateFormModal.vue';
import CandidateGridCard from '@/modules/recruitment/components/CandidateGridCard.vue';
import type { Candidate } from '@/modules/recruitment/types';
import { SOURCE_LABELS, STAGE_LABELS, stageTone } from '@/modules/recruitment/utils/recruitment-format';
import { SOURCE_ICON } from '@/modules/recruitment/utils/recruitment-ui';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** The talent pool: everyone who applied or was sourced, where they came from and where they are in each pipeline. */
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('recruitment.manage'));
const table = useTable((q) => recruitmentApi.candidates(q), { filters: { source: undefined as CandidateSource | undefined } });
const sourceOptions = CANDIDATE_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }));
const formOpen = ref(false);
async function onSaved(c: Candidate) {
  formOpen.value = false;
  feedback.success(`${c.name} added`);
  await router.push(`/hr/recruitment/candidates/${c.id}`);
}

// Source figures across every candidate; each one filters the list.
const summary = useAsync(() => fetchAllPages((page, pageSize) => recruitmentApi.candidates({ page, pageSize })));
const ACTIVE = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
const inPipeline = (c: Candidate) => c.applications.some((a) => ACTIVE.includes(a.stage));
const strip = computed<StripItem[]>(() => {
  const all = summary.data.value ?? [];
  const total = all.length;
  const week = all.filter((c) => Date.now() - new Date(c.createdAt).getTime() < 7 * 86_400_000).length;
  const sources = CANDIDATE_SOURCES.map((s) => ({ s, list: all.filter((c) => c.source === s) })).filter((x) => x.list.length);
  return [
    { key: 'ALL', label: 'All candidates', value: total, tone: 'brand', hint: `${all.filter(inPipeline).length} in an active pipeline · ${week} new this week` },
    ...sources.map(({ s, list }) => ({ key: s, label: SOURCE_LABELS[s], value: list.length, hint: `${list.filter(inPipeline).length} active · ${list.filter((c) => c.applications.some((a) => a.stage === 'HIRED')).length} hired` })),
  ];
});
const selectSource = (k: string | null) => (table.filters.source = !k || k === 'ALL' ? undefined : (k as CandidateSource));

const columns: TableColumn<Candidate>[] = [
  { key: 'name', label: 'Candidate' },
  { key: 'current', label: 'Current role' },
  { key: 'applications', label: 'Applications' },
  { key: 'source', label: 'Source' },
  { key: 'createdAt', label: 'Added' },
];
const STAGE_RANK = ['WITHDRAWN', 'REJECTED', 'APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];
/** Furthest-along applications first, so the most relevant stage shows when only a few fit. */
const ranked = (c: Candidate) => [...c.applications].sort((a, b) => STAGE_RANK.indexOf(b.stage) - STAGE_RANK.indexOf(a.stage));
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Candidates" description="Everyone who applied or was sourced. Each person appears once (by email) and can apply to several jobs.">
      <template v-if="canManage" #actions><AppButton :icon="Plus" @click="formOpen = true">Add candidate</AppButton></template>
    </AppPageHeader>

    <AppStatStrip
      v-if="summary.loading.value || (summary.data.value && summary.data.value.length > 0)"
      :items="strip"
      :loading="summary.loading.value && !summary.data.value"
      selectable
      :selected="table.filters.source ?? 'ALL'"
      label="Candidates by source"
      @select="selectSource"
    />

    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_220px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search name, email, phone, company or title" aria-label="Search candidates" />
        <AppSelect v-model="table.filters.source" :options="sourceOptions" placeholder="All sources" aria-label="Filter by source" />
      </div>
      <AppDataTable
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        clickable
        caption="Candidates"
        empty-title="No candidates yet"
        :empty-description="canManage ? 'Add people you have sourced, or open a job on the careers page so candidates can apply.' : 'Candidates appear here as people apply or recruiters add them.'"
        @page="table.setPage"
        @retry="table.load"
        @row-click="(row) => router.push(`/hr/recruitment/candidates/${row.id}`)"
        :filtered="table.isFiltered.value"
        @clear="table.clearFilters()"
      >
        <template #empty><AppButton v-if="canManage" :icon="UserPlus" @click="formOpen = true">Add candidate</AppButton></template>
        <template #cell-name="{ row }">
          <div class="flex items-center gap-3">
            <AppAvatar :name="row.name" size="md" />
            <div class="min-w-0">
              <p class="flex items-center gap-1.5 truncate font-medium text-fg">
                {{ row.name }}
                <FileText v-if="row.resume" :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
                <span v-if="row.resume" class="sr-only">(has resume)</span>
              </p>
              <p class="truncate text-xs text-fg-muted">{{ row.email }}</p>
            </div>
          </div>
        </template>
        <template #cell-current="{ row }">
          <p class="truncate text-sm text-fg">{{ [row.currentTitle, row.currentCompany].filter(Boolean).join(' at ') || '—' }}</p>
          <p class="flex items-center gap-1 truncate text-xs text-fg-muted">
            <span v-if="row.experienceYears !== null" class="tabular-nums">{{ row.experienceYears }} yrs</span>
            <template v-if="row.location"><span v-if="row.experienceYears !== null" aria-hidden="true">·</span><MapPin :size="11" class="shrink-0" aria-hidden="true" />{{ row.location }}</template>
          </p>
        </template>
        <template #cell-applications="{ row }">
          <div class="flex flex-wrap gap-1">
            <AppBadge v-for="a in ranked(row).slice(0, 2)" :key="a.id" :tone="stageTone[a.stage]" size="sm" dot :title="`${a.job.title}: ${STAGE_LABELS[a.stage]}`">{{ a.job.title }} · {{ STAGE_LABELS[a.stage] }}</AppBadge>
            <AppBadge v-if="row.applications.length > 2" size="sm">+{{ row.applications.length - 2 }}</AppBadge>
            <span v-if="!row.applications.length" class="text-xs text-fg-subtle">Not in a pipeline</span>
          </div>
        </template>
        <template #cell-source="{ row }">
          <span class="inline-flex items-center gap-1.5 text-fg-muted"><component :is="SOURCE_ICON[row.source]" :size="14" aria-hidden="true" />{{ SOURCE_LABELS[row.source] }}</span>
          <p v-if="row.referredBy" class="text-2xs text-fg-subtle">by {{ row.referredBy.name }}</p>
        </template>
        <template #cell-createdAt="{ row }"><span class="text-fg-muted" :title="formatDate(row.createdAt)">{{ timeAgo(row.createdAt) }}</span></template>
        <template #card="{ row }"><CandidateGridCard :candidate="row" /></template>
      </AppDataTable>
    </AppCard>
    <CandidateFormModal :open="formOpen" :candidate="null" @close="formOpen = false" @saved="onSaved" @existing="(cid) => { formOpen = false; router.push(`/hr/recruitment/candidates/${cid}`); }" />
  </div>
</template>
