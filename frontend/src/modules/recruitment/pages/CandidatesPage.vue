<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { FileText, Plus } from '@lucide/vue';
import { CANDIDATE_SOURCES, type CandidateSource } from '@contracts';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import CandidateFormModal from '@/modules/recruitment/components/CandidateFormModal.vue';
import type { Candidate } from '@/modules/recruitment/types';
import { SOURCE_LABELS, STAGE_LABELS, stageTone } from '@/modules/recruitment/utils/recruitment-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

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
const columns: TableColumn<Candidate>[] = [
  { key: 'name', label: 'Candidate' },
  { key: 'current', label: 'Current role' },
  { key: 'applications', label: 'Applications' },
  { key: 'source', label: 'Source' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Candidates" description="Everyone who applied or was sourced. Each person appears once (by email) and can apply to several jobs.">
      <template v-if="canManage" #actions><AppButton :icon="Plus" @click="formOpen = true">Add candidate</AppButton></template>
    </AppPageHeader>
    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line p-4 sm:grid-cols-[1fr_220px]">
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
        empty-title="No candidates"
        @page="table.setPage"
        @retry="table.load"
        @row-click="(row) => router.push(`/hr/recruitment/candidates/${row.id}`)"
      >
        <template #cell-name="{ row }">
          <div class="flex items-center gap-3">
            <AppAvatar :name="row.name" size="sm" />
            <div class="min-w-0">
              <p class="flex items-center gap-1.5 truncate font-medium text-fg">{{ row.name }}<FileText v-if="row.resume" :size="13" class="text-fg-subtle" aria-label="Has resume" /></p>
              <p class="truncate text-xs text-fg-muted">{{ row.email }} · {{ timeAgo(row.createdAt) }}</p>
            </div>
          </div>
        </template>
        <template #cell-current="{ row }"><span class="text-fg-muted">{{ [row.currentTitle, row.currentCompany].filter(Boolean).join(' at ') || '—' }}</span></template>
        <template #cell-applications="{ row }">
          <div class="flex flex-wrap gap-1">
            <AppBadge v-for="a in row.applications.slice(0, 3)" :key="a.id" :tone="stageTone[a.stage]" size="sm" :title="a.job.title">{{ a.job.title }} · {{ STAGE_LABELS[a.stage] }}</AppBadge>
            <span v-if="!row.applications.length" class="text-xs text-fg-subtle">None</span>
          </div>
        </template>
        <template #cell-source="{ row }"><span class="text-fg-muted">{{ SOURCE_LABELS[row.source] }}</span></template>
      </AppDataTable>
    </AppCard>
    <CandidateFormModal :open="formOpen" :candidate="null" @close="formOpen = false" @saved="onSaved" @existing="(cid) => { formOpen = false; router.push(`/hr/recruitment/candidates/${cid}`); }" />
  </div>
</template>
