<script setup lang="ts">
import { computed, ref } from 'vue';
import { CalendarClock, History, InfinityIcon, RefreshCw, Scale, SlidersHorizontal, TriangleAlert } from '@lucide/vue';
import type { PaginationMeta } from '@contracts';
import { leaveApi } from '@/modules/leave/api/leave.api';
import AdjustBalanceModal from '@/modules/leave/components/AdjustBalanceModal.vue';
import EncashmentApprovals from '@/modules/leave/components/EncashmentApprovals.vue';
import LeaveBalanceGridCard from '@/modules/leave/components/LeaveBalanceGridCard.vue';
import LeaveLedgerModal from '@/modules/leave/components/LeaveLedgerModal.vue';
import type { BalanceOverview } from '@/modules/leave/types';
import { formatDays } from '@/modules/leave/utils/leave-format';
import { structureApi } from '@/modules/people/api/people.api';
import { AppAvatar, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/**
 * Leave balances of everyone in scope: a summary per leave type of the people listed, then one row per employee with
 * what is available per type (credited so far minus taken and pending), balance history and HR adjustments.
 */
type Row = BalanceOverview['items'][number];
type Cell = Row['balances'][number];

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
  return [current, current - 1, current - 2].map((y) => ({ value: y, label: `${y}${y === current ? ' · current year' : ''}` }));
});
const departmentOptions = computed(() => (departments.data.value ?? []).map((d) => ({ value: d.id, label: d.name })));
const types = computed(() => overview.value?.types ?? []);
const columns = computed<TableColumn<Row>[]>(() => [
  { key: 'employee', label: 'Employee' },
  ...types.value.map((t) => ({ key: `type-${t.id}`, label: t.code, align: 'right' as const })),
  { key: 'actions', label: '', align: 'right' },
]);
const cell = (row: Row, typeId: string) => row.balances.find((b) => b.leaveTypeId === typeId);
const round = (n: number) => Math.round(n * 100) / 100;
/** Share of the days credited so far (balance plus taken) that is still available. */
const share = (b: Cell) => {
  const credited = (b.balance ?? 0) + b.taken;
  return credited > 0 && b.available !== null ? Math.max(0, Math.min(100, (b.available / credited) * 100)) : 0;
};
const tint = (color: string, amount: number) => `color-mix(in srgb, ${color} ${amount}%, transparent)`;

/** Per leave type, across the people listed: what is available, taken and waiting, and who is overdrawn. */
const summary = computed(() =>
  types.value.map((t) => {
    const cells = table.rows.value.map((r) => cell(r, t.id)).filter((c): c is Cell => !!c);
    const limited = cells.filter((c) => c.available !== null);
    const available = limited.reduce((s, c) => s + (c.available ?? 0), 0);
    return {
      ...t,
      available: round(available),
      average: limited.length ? Math.round((available / limited.length) * 10) / 10 : null,
      taken: round(cells.reduce((s, c) => s + c.taken, 0)),
      pending: round(cells.reduce((s, c) => s + c.pending, 0)),
      overdrawn: limited.filter((c) => (c.available ?? 0) < 0).length,
    };
  }),
);
const scopeNote = computed(() => {
  const total = table.meta.value?.total ?? 0;
  const shown = table.rows.value.length;
  return total > shown ? `Across the ${shown} people on this page` : `Across ${shown} ${shown === 1 ? 'person' : 'people'}`;
});
const pendingPeople = computed(() => table.rows.value.filter((r) => r.balances.some((b) => b.pending > 0)).length);

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
  <div class="space-y-4">
    <AppPageHeader title="Leave balances" description="Days available per person and leave type, after leave taken and pending requests.">
      <template #actions>
        <AppButton variant="secondary" :icon="CalendarClock" to="/hr/leave/requests">Leave requests</AppButton>
        <AppButton v-if="canAllocate" variant="secondary" :icon="RefreshCw" :loading="running" @click="runAccruals">Bring accruals up to date</AppButton>
      </template>
    </AppPageHeader>

    <section v-if="summary.length" aria-labelledby="balance-summary-title">
      <div class="mb-2 flex flex-wrap items-end justify-between gap-2">
        <h2 id="balance-summary-title" class="text-sm font-semibold text-fg">By leave type <span class="font-normal text-fg-muted">· {{ scopeNote }}</span></h2>
        <p v-if="pendingPeople" class="inline-flex items-center gap-1.5 text-xs font-medium text-warning-fg">
          <span class="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />{{ pendingPeople }} {{ pendingPeople === 1 ? 'person has' : 'people have' }} leave waiting for approval
        </p>
      </div>
      <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <li v-for="t in summary" :key="t.id" class="card relative overflow-hidden p-4 pt-5">
          <span class="absolute inset-x-0 top-0 h-1" :style="{ backgroundColor: t.color }" aria-hidden="true" />
          <div class="flex items-center gap-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-2xs font-semibold" :style="{ backgroundColor: tint(t.color, 14), color: t.color }" aria-hidden="true">{{ t.code }}</span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-fg">{{ t.name }}</p>
              <p class="text-2xs text-fg-muted">{{ t.unlimited ? 'No limit' : t.average === null ? 'No balances yet' : `${t.available} days available in total` }}</p>
            </div>
          </div>
          <dl class="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt class="text-fg-subtle">Avg available</dt>
              <dd class="mt-0.5 text-base leading-6 font-semibold text-fg tabular-nums">
                <InfinityIcon v-if="t.unlimited" :size="16" class="inline" aria-label="No limit" /><template v-else>{{ t.average ?? '—' }}</template>
              </dd>
            </div>
            <div>
              <dt class="text-fg-subtle">Days taken</dt>
              <dd class="mt-0.5 text-base leading-6 font-semibold text-fg tabular-nums">{{ t.taken }}</dd>
            </div>
            <div>
              <dt class="text-fg-subtle">Pending</dt>
              <dd :class="['mt-0.5 text-base leading-6 font-semibold tabular-nums', t.pending ? 'text-warning-fg' : 'text-fg']">{{ t.pending }}</dd>
            </div>
          </dl>
          <p v-if="t.overdrawn" class="mt-2 inline-flex items-center gap-1 text-2xs font-medium text-danger-fg">
            <TriangleAlert :size="12" aria-hidden="true" />{{ t.overdrawn }} {{ t.overdrawn === 1 ? 'person is' : 'people are' }} below zero
          </p>
        </li>
      </ul>
    </section>

    <EncashmentApprovals v-if="canAllocate" @changed="table.load()" />

    <AppCard title="Balances by person" :icon="Scale" :description="table.meta.value ? `${table.meta.value.total} ${table.meta.value.total === 1 ? 'person' : 'people'} · available days, with pending in amber` : undefined" :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_220px_220px]">
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
        :empty-description="overview && !overview.types.length ? 'Set up leave types first, then balances are credited automatically.' : 'People in your scope appear here with their balances.'"
        @page="table.setPage"
        @retry="table.load"
        :filtered="table.isFiltered.value"
        @clear="table.clearFilters()"
      >
        <template #empty>
          <AppButton v-if="overview && !overview.types.length && auth.can('leave.configure')" variant="secondary" to="/hr/leave/types">Set up leave types</AppButton>
        </template>
        <template #cell-employee="{ row }">
          <div class="flex items-center gap-3">
            <AppAvatar :name="row.employee.name" size="sm" />
            <div class="min-w-0">
              <RouterLink :to="`/hr/employees/${row.employee.id}`" class="block truncate font-medium text-fg hover:text-accent-fg">{{ row.employee.name }}</RouterLink>
              <p class="truncate text-xs text-fg-muted">{{ [row.employee.employeeCode, row.employee.department].filter(Boolean).join(' · ') }}</p>
            </div>
          </div>
        </template>
        <template v-for="t in types" :key="t.id" #[`cell-type-${t.id}`]="{ row }">
          <template v-for="b in [cell(row, t.id)]" :key="t.id">
            <span v-if="!b" class="text-fg-subtle">—</span>
            <span v-else-if="b.available === null" class="inline-flex flex-col items-end" :title="`${t.name}: no limit, ${formatDays(b.taken)} taken`">
              <span class="text-sm text-fg-muted tabular-nums">{{ b.taken }} <span class="text-xs">taken</span></span>
              <span class="text-2xs text-fg-subtle">no limit</span>
            </span>
            <span
              v-else
              class="inline-flex min-w-16 flex-col items-end gap-1"
              :title="`${t.name}: ${formatDays(b.available)} available, ${formatDays(b.taken)} taken${b.pending ? `, ${formatDays(b.pending)} pending` : ''}`"
            >
              <span class="tabular-nums">
                <span :class="['font-semibold', b.available < 0 ? 'text-danger-fg' : 'text-fg']">{{ b.available }}</span>
                <span v-if="b.pending" class="ms-1 text-xs font-medium text-warning-fg">+{{ b.pending }}</span>
              </span>
              <span class="flex h-1 w-14 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                <span class="h-full rounded-full" :style="{ width: `${share(b)}%`, backgroundColor: b.available < 0 ? 'var(--status-danger)' : t.color }" />
              </span>
            </span>
          </template>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-1">
            <AppButton size="sm" variant="ghost" :icon="History" :aria-label="`Balance history for ${row.employee.name}`" title="Balance history" @click="ledgerFor = row.employee" />
            <AppButton v-if="canAllocate" size="sm" variant="ghost" :icon="SlidersHorizontal" :aria-label="`Adjust balance for ${row.employee.name}`" title="Adjust balance" @click="adjustFor = row.employee" />
          </div>
        </template>
        <template #card="{ row }">
          <LeaveBalanceGridCard :row="row" :types="types" :year="overview?.year ?? new Date().getFullYear()" :can-allocate="canAllocate" @history="ledgerFor = row.employee" @adjust="adjustFor = row.employee" />
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
