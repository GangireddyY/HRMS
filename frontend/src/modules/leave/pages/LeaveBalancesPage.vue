<script setup lang="ts">
import { computed, ref } from 'vue';
import { History, RefreshCw, SlidersHorizontal } from '@lucide/vue';
import type { PaginationMeta } from '@contracts';
import { leaveApi } from '@/modules/leave/api/leave.api';
import AdjustBalanceModal from '@/modules/leave/components/AdjustBalanceModal.vue';
import LeaveLedgerModal from '@/modules/leave/components/LeaveLedgerModal.vue';
import type { BalanceOverview } from '@/modules/leave/types';
import { structureApi } from '@/modules/people/api/people.api';
import { AppAvatar, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

type Row = BalanceOverview['items'][number];

const auth = useAuthStore();
const feedback = useFeedbackStore();
const canAllocate = computed(() => auth.can('leave.allocate'));
const departments = useAsync(() => structureApi.departments());
const overview = ref<BalanceOverview | null>(null);
const table = useTable<Row, { departmentId?: string; year?: number }>(
  async (q) => {
    const res = await leaveApi.overview(q);
    overview.value = res;
    return { items: res.items, meta: res.meta as PaginationMeta };
  },
  { filters: { departmentId: undefined, year: undefined } },
);
const year = computed<number | null>({
  get: () => table.filters.year ?? overview.value?.year ?? null,
  set: (y) => (table.filters.year = y ?? undefined),
});

const yearOptions = computed(() => {
  const current = overview.value?.currentYear ?? new Date().getFullYear();
  return [current, current - 1, current - 2].map((y) => ({ value: y, label: String(y) }));
});
const departmentOptions = computed(() => (departments.data.value ?? []).map((d) => ({ value: d.id, label: d.name })));
const columns = computed<TableColumn<Row>[]>(() => [
  { key: 'employee', label: 'Employee' },
  ...(overview.value?.types ?? []).map((t) => ({ key: `type-${t.id}`, label: t.code, align: 'right' as const })),
  { key: 'actions', label: '', align: 'right' },
]);
const cell = (row: Row, typeId: string) => row.balances.find((b) => b.leaveTypeId === typeId);

const ledgerFor = ref<Row['employee'] | null>(null);
const adjustFor = ref<Row['employee'] | null>(null);
async function onAdjusted() {
  adjustFor.value = null;
  feedback.success('Balance updated', 'The employee has been notified.');
  await table.load();
}

const running = ref(false);
async function runAccruals() {
  running.value = true;
  try {
    const r = await leaveApi.runAccruals();
    feedback.success('Accruals are up to date', r.entries ? `${r.entries} entries written for ${r.employees} employees.` : 'Nothing was due.');
    await table.load();
  } catch (e) {
    feedback.error('Could not run accruals', e);
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Leave balances" description="Available days per leave type (balance minus pending requests). Accruals and year-end carry-forward are credited automatically.">
      <template #actions>
        <AppButton v-if="canAllocate" variant="secondary" :icon="RefreshCw" :loading="running" @click="runAccruals">Bring accruals up to date</AppButton>
      </template>
    </AppPageHeader>
    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_220px_140px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search name or code" aria-label="Search employees" />
        <AppSelect v-model="table.filters.departmentId" :options="departmentOptions" placeholder="All departments" aria-label="Filter by department" />
        <AppSelect v-model="year" :options="yearOptions" :clearable="false" aria-label="Leave year" />
      </div>
      <AppDataTable
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        :row-key="(r) => r.employee.id"
        caption="Leave balances"
        empty-title="No employees"
        :empty-description="overview && !overview.types.length ? 'Set up leave types first.' : undefined"
        @page="table.setPage"
        @retry="table.load"
      >
        <template #cell-employee="{ row }">
          <div class="flex items-center gap-3">
            <AppAvatar :name="row.employee.name" size="sm" />
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
              <p class="truncate text-xs text-fg-muted">{{ [row.employee.employeeCode, row.employee.department].filter(Boolean).join(' · ') }}</p>
            </div>
          </div>
        </template>
        <template v-for="t in overview?.types ?? []" :key="t.id" #[`cell-type-${t.id}`]="{ row }">
          <template v-for="b in [cell(row, t.id)]" :key="t.id">
            <span v-if="!b" class="text-fg-subtle">—</span>
            <span v-else-if="b.available === null" class="text-fg-muted tabular-nums" :title="`${b.taken} taken`">{{ b.taken }} taken</span>
            <span v-else class="tabular-nums" :class="b.available < 0 ? 'text-red-600 dark:text-red-400' : 'text-fg'" :title="b.pending ? `${b.pending} pending` : undefined">
              {{ b.available }}<span v-if="b.pending" class="ms-1 text-xs text-amber-600 dark:text-amber-400">({{ b.pending }})</span>
            </span>
          </template>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-1">
            <AppButton size="sm" variant="ghost" :icon="History" :aria-label="`Balance history for ${row.employee.name}`" @click="ledgerFor = row.employee" />
            <AppButton v-if="canAllocate" size="sm" variant="ghost" :icon="SlidersHorizontal" :aria-label="`Adjust balance for ${row.employee.name}`" @click="adjustFor = row.employee" />
          </div>
        </template>
      </AppDataTable>
    </AppCard>

    <LeaveLedgerModal
      v-if="overview"
      :open="!!ledgerFor"
      :employee-id="ledgerFor?.id"
      :employee-name="ledgerFor?.name"
      :year="overview.year"
      :types="overview.types"
      @close="ledgerFor = null"
    />
    <AdjustBalanceModal :open="!!adjustFor" :employee="adjustFor" @close="adjustFor = null" @saved="onAdjusted" />
  </div>
</template>
