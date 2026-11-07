<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Plus } from '@lucide/vue';
import { EXIT_STATUSES, type ExitStatus } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { exitApi } from '@/modules/exit/api/exit.api';
import InitiateExitModal from '@/modules/exit/components/InitiateExitModal.vue';
import type { ExitDetail, ExitSummary } from '@/modules/exit/types';
import { SETTLEMENT_LABELS, STATUS_LABELS, TYPE_LABELS, inr, settlementTone, statusTone } from '@/modules/exit/utils/exit-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, AppTabs, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canApprove = auth.can('exit.approve') || auth.can('exit.manage');
const tabs = [...(canApprove ? [{ key: 'approve', label: 'Waiting for me' }] : []), { key: 'all', label: 'All exits' }];
const table = useTable((q) => exitApi.list(q), { filters: { view: (canApprove ? 'approve' : 'all') as 'all' | 'approve', status: undefined as ExitStatus | 'OPEN' | undefined } });
const view = computed({ get: () => table.filters.view, set: (v: string) => (table.filters.view = v as 'all' | 'approve') });
const statusOptions = [{ value: 'OPEN', label: 'Open' }, ...EXIT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))];
const recording = ref(false);
async function onRecorded(e: ExitDetail) {
  recording.value = false;
  feedback.success('Exit recorded', 'Clearance has started.');
  await router.push(`/hr/exits/${e.id}`);
}
const columns: TableColumn<ExitSummary>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'type', label: 'Exit' },
  { key: 'dates', label: 'Last working day' },
  { key: 'clearance', label: 'Clearance' },
  { key: 'settlement', label: 'Settlement' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Exits" description="Resignations, notice periods, clearance and full & final settlements.">
      <template v-if="auth.can('exit.manage')" #actions>
        <AppButton :icon="Plus" @click="recording = true">Record exit</AppButton>
      </template>
    </AppPageHeader>
    <AppTabs v-model="view" :tabs="tabs">
      <AppCard :padded="false">
        <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_220px]">
          <AppSearchInput v-model="table.search.value" placeholder="Search by name or code" aria-label="Search exits" />
          <AppSelect v-if="view === 'all'" v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          clickable
          caption="Exits"
          :empty-title="view === 'approve' ? 'No resignations waiting' : 'No exits'"
          @page="table.setPage"
          @retry="table.load"
          @row-click="(e: ExitSummary) => router.push(`/hr/exits/${e.id}`)"
        >
          <template #cell-employee="{ row }">
            <p class="font-medium text-fg">{{ row.employee?.name }}</p>
            <p class="text-xs text-fg-muted">{{ row.employee?.employeeCode }}{{ row.employee?.department ? ` · ${row.employee.department}` : '' }}</p>
          </template>
          <template #cell-type="{ row }">
            <p class="text-fg">{{ TYPE_LABELS[row.type] }}</p>
            <AppBadge :tone="statusTone[row.status]" size="sm" dot>{{ STATUS_LABELS[row.status] }}</AppBadge>
          </template>
          <template #cell-dates="{ row }">
            <p class="text-fg">{{ row.lastWorkingDay ? formatDate(row.lastWorkingDay) : row.requestedLastDay ? `${formatDate(row.requestedLastDay)} (asked)` : '—' }}</p>
            <p class="text-xs text-fg-muted">
              notice ends {{ formatDate(row.noticeEndsOn) }}<template v-if="row.shortfallDays && !row.noticeWaived"> · {{ row.shortfallDays }} days short</template>
            </p>
          </template>
          <template #cell-clearance="{ row }">
            <span v-if="row.clearance.total" class="text-xs text-fg-muted tabular-nums">{{ row.clearance.done }}/{{ row.clearance.total }}</span>
            <span v-else class="text-xs text-fg-muted">—</span>
          </template>
          <template #cell-settlement="{ row }">
            <template v-if="row.settlement">
              <AppBadge :tone="settlementTone[row.settlement.status]" size="sm">{{ SETTLEMENT_LABELS[row.settlement.status] }}</AppBadge>
              <p class="text-xs" :class="row.settlement.overdue ? 'text-red-600 dark:text-red-400' : 'text-fg-muted'">{{ inr(row.settlement.netPayable) }}{{ row.settlement.overdue ? ' · overdue' : '' }}</p>
            </template>
            <span v-else class="text-xs text-fg-muted">—</span>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>
    <InitiateExitModal :open="recording" @close="recording = false" @saved="onRecorded" />
  </div>
</template>
