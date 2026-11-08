<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { Plus } from '@lucide/vue';
import { PIP_STATUSES, type PipStatus } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import PipFormModal from '@/modules/performance/components/PipFormModal.vue';
import type { PipDetail, PipRow } from '@/modules/performance/types';
import { PIP_STATUS_LABELS, pipTone } from '@/modules/performance/utils/performance-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSelect, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const router = useRouter();
const feedback = useFeedbackStore();
const table = useTable((q) => performanceApi.pips({ ...q, view: 'managed' }), { filters: { status: 'ACTIVE' as PipStatus | undefined } });
const statusOptions = PIP_STATUSES.map((s) => ({ value: s, label: PIP_STATUS_LABELS[s] }));
const formOpen = ref(false);
async function onSaved(p: PipDetail) {
  formOpen.value = false;
  feedback.success('Improvement plan opened', `${p.employee.name} has been notified.`);
  await router.push(`/hr/performance/pips/${p.id}`);
}
const columns: TableColumn<PipRow>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'period', label: 'Plan' },
  { key: 'status', label: 'Status' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Improvement plans" description="Structured support for people not meeting expectations: objectives, regular check-ins and a recorded outcome.">
      <template #actions><AppButton :icon="Plus" @click="formOpen = true">New plan</AppButton></template>
    </AppPageHeader>
    <AppCard :padded="false">
      <div class="flex items-center justify-end gap-2 border-b border-line/70 px-4 py-2">
        <AppSelect size="sm" v-model="table.filters.status" class="w-56" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </div>
      <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Improvement plans" empty-title="No improvement plans" @page="table.setPage" @retry="table.load" @row-click="(row) => router.push(`/hr/performance/pips/${row.id}`)" :filtered="table.isFiltered.value" @clear="table.clearFilters()">
        <template #empty><AppButton :icon="Plus" @click="formOpen = true">New plan</AppButton></template>
        <template #cell-employee="{ row }">
          <div class="flex items-center gap-3">
            <AppAvatar :name="row.employee.name" size="sm" />
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
              <p class="truncate text-xs text-fg-muted">{{ row.employee.department ?? row.employee.employeeCode }}</p>
            </div>
          </div>
        </template>
        <template #cell-period="{ row }">
          <p class="text-fg">{{ formatDate(row.startDate) }} – {{ formatDate(row.endDate) }}</p>
          <p class="text-xs text-fg-muted">{{ row.objectivesCount }} objective{{ row.objectivesCount === 1 ? '' : 's' }} · owner {{ row.owner?.name ?? '—' }}</p>
        </template>
        <template #cell-status="{ row }">
          <AppBadge :tone="pipTone[row.status]" dot>{{ PIP_STATUS_LABELS[row.status] }}</AppBadge>
          <p v-if="row.overdue" class="mt-0.5 text-xs text-danger-fg">Past its end date</p>
          <p v-else-if="!row.acknowledged && row.status === 'ACTIVE'" class="mt-0.5 text-xs text-fg-muted">Not acknowledged yet</p>
        </template>
      </AppDataTable>
    </AppCard>
    <PipFormModal :open="formOpen" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
