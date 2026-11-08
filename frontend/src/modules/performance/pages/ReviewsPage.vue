<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { REVIEW_STAGES, type ReviewStage } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import type { ReviewRow } from '@/modules/performance/types';
import { STAGE_LABELS, stageTone } from '@/modules/performance/utils/performance-format';
import { AppAvatar, AppBadge, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, AppTabs, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { formatDate } from '@/shared/utils/format';

/** Reviews you conduct as reviewer, and all reviews within your `performance.view` scope. */
const router = useRouter();
const auth = useAuthStore();
const canSeeAll = computed(() => auth.can('performance.view', 'TEAM') || auth.can('performance.configure'));
const tabs = computed(() => [{ key: 'team', label: 'I review' }, ...(canSeeAll.value ? [{ key: 'all', label: 'All reviews' }] : [])]);
const view = ref<'team' | 'all'>('team');
const table = useTable((q) => performanceApi.reviews({ ...q, view: view.value }), { filters: { stage: undefined as ReviewStage | undefined } });
watch(view, () => void table.load());
const stageOptions = REVIEW_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }));
const today = new Date().toISOString().slice(0, 10);
const columns: TableColumn<ReviewRow>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'cycle', label: 'Cycle' },
  { key: 'stage', label: 'Stage' },
  { key: 'rating', label: 'Rating', align: 'right' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Reviews" description="Approve goals, write reviews for your team and follow progress." />
    <AppTabs v-model="view" :tabs="tabs">
      <AppCard :padded="false">
        <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_240px]">
          <AppSearchInput v-model="table.search.value" placeholder="Search employees" aria-label="Search reviews" />
          <AppSelect v-model="table.filters.stage" :options="stageOptions" placeholder="All stages" aria-label="Filter by stage" />
        </div>
        <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Reviews" :empty-title="view === 'team' ? 'Nobody to review' : 'No reviews'" @page="table.setPage" @retry="table.load" @row-click="(row) => router.push(`/hr/performance/reviews/${row.id}`)" :filtered="table.isFiltered.value" @clear="table.clearFilters()">
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee.name" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ [row.employee.designation, row.employee.department].filter(Boolean).join(' · ') || row.employee.employeeCode }}</p>
              </div>
            </div>
          </template>
          <template #cell-cycle="{ row }">
            <p class="text-fg">{{ row.cycle.name }}</p>
            <p v-if="view === 'all'" class="text-xs text-fg-muted">Reviewer: {{ row.reviewer?.name ?? 'not assigned' }}</p>
          </template>
          <template #cell-stage="{ row }">
            <AppBadge :tone="stageTone[row.stage]" dot>{{ STAGE_LABELS[row.stage] }}</AppBadge>
            <p v-if="row.due" class="mt-0.5 text-xs" :class="row.due < today ? 'text-danger-fg' : 'text-fg-muted'">{{ row.due < today ? 'Overdue since' : 'Due' }} {{ formatDate(row.due) }}</p>
          </template>
          <template #cell-rating="{ row }"><span class="tabular-nums">{{ row.finalRating ?? '—' }}</span></template>
        </AppDataTable>
      </AppCard>
    </AppTabs>
  </div>
</template>
