<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { FileBarChart } from '@lucide/vue';
import { GRIEVANCE_CATEGORIES, GRIEVANCE_STATUSES, type GrievanceCategory, type GrievanceStatus } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { grievanceApi } from '@/modules/grievance/api/grievance.api';
import type { CaseRow, GrievanceView } from '@/modules/grievance/types';
import { CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS, priorityTone, statusTone } from '@/modules/grievance/utils/grievance-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, AppStatCard, AppSwitch, AppTabs, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { formatDate } from '@/shared/utils/format';

const router = useRouter();
const auth = useAuthStore();
const tabs = computed(() =>
  [
    { key: 'assigned', label: 'Assigned to me', show: auth.can('grievance.view') || auth.can('grievance.manage') || auth.can('grievance.posh.access') },
    { key: 'all', label: 'All grievances', show: auth.can('grievance.manage') },
    { key: 'posh', label: 'POSH complaints', show: auth.can('grievance.posh.access') },
  ].filter((t) => t.show),
);
const stats = useAsync(() => grievanceApi.stats());
const table = useTable((q) => grievanceApi.list(q), {
  filters: {
    view: (auth.can('grievance.manage') ? 'all' : auth.can('grievance.posh.access') && !auth.can('grievance.view') ? 'posh' : 'assigned') as GrievanceView,
    status: 'OPEN' as GrievanceStatus | 'OPEN' | undefined,
    category: undefined as GrievanceCategory | undefined,
    overdue: undefined as boolean | undefined,
  },
});
const view = computed({ get: () => table.filters.view, set: (v: string) => (table.filters.view = v as GrievanceView) });
watch(view, (v) => {
  if (v === 'posh') table.filters.category = undefined;
});
const current = computed(() => stats.data.value?.[table.filters.view]);
const overdueOnly = computed({ get: () => !!table.filters.overdue, set: (v: boolean) => (table.filters.overdue = v || undefined) });
const statusOptions = [{ value: 'OPEN', label: 'Open' }, ...GRIEVANCE_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))];
const categoryOptions = GRIEVANCE_CATEGORIES.filter((c) => c !== 'POSH').map((c) => ({ value: c, label: CATEGORY_LABELS[c] }));
const columns: TableColumn<CaseRow>[] = [
  { key: 'case', label: 'Case' },
  { key: 'complainant', label: 'Raised by' },
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Handled by' },
  { key: 'due', label: 'Due' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Grievances" description="Confidential employee concerns. Only the people handling a case can read it.">
      <template v-if="auth.can('grievance.posh.access')" #actions>
        <AppButton variant="secondary" :icon="FileBarChart" to="/hr/grievances/posh-report">POSH annual report</AppButton>
      </template>
    </AppPageHeader>
    <AppTabs v-model="view" :tabs="tabs">
      <div class="mb-4 grid gap-4 sm:grid-cols-3">
        <AppStatCard label="Open" :value="current?.open" :loading="stats.loading.value" />
        <AppStatCard label="Overdue" :value="current?.overdue" tone="danger" :loading="stats.loading.value" />
        <AppStatCard v-if="table.filters.view !== 'assigned'" label="Unassigned" :value="current?.unassigned" tone="warning" :loading="stats.loading.value" />
      </div>
      <AppCard :padded="false">
        <div class="grid gap-3 border-b border-line p-4 sm:grid-cols-[1fr_180px_220px_auto] sm:items-center">
          <AppSearchInput v-model="table.search.value" placeholder="Search by reference or subject" aria-label="Search cases" />
          <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
          <AppSelect v-if="table.filters.view !== 'posh'" v-model="table.filters.category" :options="categoryOptions" placeholder="All categories" aria-label="Filter by category" />
          <span v-else />
          <AppSwitch v-model="overdueOnly" label="Overdue" />
        </div>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          clickable
          caption="Grievance cases"
          empty-title="No cases"
          @page="table.setPage"
          @retry="table.load"
          @row-click="(r: CaseRow) => router.push(`/hr/grievances/${r.id}`)"
        >
          <template #cell-case="{ row }">
            <p class="font-medium text-fg">{{ row.subject }}</p>
            <p class="text-xs text-fg-muted">{{ row.reference }} · {{ CATEGORY_LABELS[row.category] }}</p>
          </template>
          <template #cell-complainant="{ row }">
            <p class="text-fg">{{ row.complainant?.name }}</p>
            <p class="text-xs text-fg-muted">{{ row.complainant?.department ?? '—' }}</p>
          </template>
          <template #cell-status="{ row }">
            <div class="flex flex-wrap gap-1.5">
              <AppBadge :tone="statusTone[row.status]" dot>{{ STATUS_LABELS[row.status] }}</AppBadge>
              <AppBadge v-if="row.priority && row.priority !== 'MEDIUM'" :tone="priorityTone[row.priority]" size="sm">{{ PRIORITY_LABELS[row.priority] }}</AppBadge>
            </div>
          </template>
          <template #cell-assignee="{ row }"><span :class="row.assignee ? 'text-fg' : 'text-fg-muted'">{{ row.assignee?.name ?? 'Unassigned' }}</span></template>
          <template #cell-due="{ row }">
            <span :class="row.overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-fg-muted'">{{ row.resolvedOn ? `Resolved ${formatDate(row.resolvedOn)}` : formatDate(row.dueOn) }}{{ row.overdue ? ' · overdue' : '' }}</span>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>
  </div>
</template>
