<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { History, Trash2, Wallet } from '@lucide/vue';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import SalaryBreakdownTable from '@/modules/payroll/components/SalaryBreakdownTable.vue';
import SalaryFormModal from '@/modules/payroll/components/SalaryFormModal.vue';
import type { SalaryHistory, SalaryRow } from '@/modules/payroll/types';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppSearchInput, AppSkeleton, AppTabs, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const canRevise = computed(() => auth.can('employee.salary.revise'));
const view = ref('all');
const tabs = [
  { key: 'all', label: 'All employees' },
  { key: 'missing', label: 'Without salary' },
];
const table = useTable((q) => payrollApi.salaries({ ...q, missing: view.value === 'missing' || undefined }));
watch(view, () => void table.load());

const formOpen = ref(false);
const target = ref<SalaryRow | null>(null);
const lockedThrough = ref<string | null>(null);
async function openForm(row: SalaryRow) {
  target.value = row;
  lockedThrough.value = (await payrollApi.salaryHistory(row.employee.id).catch(() => null))?.lockedThrough ?? null;
  formOpen.value = true;
}
async function onSaved() {
  formOpen.value = false;
  feedback.success('Salary saved', `${target.value?.employee.name} has been notified.`);
  await table.load();
  if (history.value?.employee?.id === target.value?.employee.id) await openHistory(target.value!);
}

const history = ref<SalaryHistory | null>(null);
const historyFor = ref<SalaryRow | null>(null);
const loadingHistory = ref(false);
async function openHistory(row: SalaryRow) {
  historyFor.value = row;
  history.value = null;
  loadingHistory.value = true;
  try {
    history.value = await payrollApi.salaryHistory(row.employee.id);
  } catch (e) {
    historyFor.value = null;
    feedback.error('Could not load the salary history', e);
  } finally {
    loadingHistory.value = false;
  }
}
async function removeSalary(id: string, effectiveFrom: string) {
  if (!(await feedback.confirm({ title: 'Delete this salary?', message: `The salary effective ${formatDate(effectiveFrom)} is removed; the previous one applies again.`, confirmLabel: 'Delete', danger: true }))) return;
  try {
    await payrollApi.removeSalary(id);
    feedback.success('Salary deleted');
    await Promise.all([table.load(), openHistory(historyFor.value!)]);
  } catch (e) {
    feedback.error('Could not delete the salary', e);
  }
}

const columns: TableColumn<SalaryRow>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'ctc', label: 'Annual CTC', align: 'right' },
  { key: 'gross', label: 'Monthly gross', align: 'right' },
  { key: 'since', label: 'Since' },
  { key: 'actions', label: '', align: 'right' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Salaries" description="Each employee's CTC and its breakdown. Revisions start from an effective date and keep the history." />
    <AppTabs v-model="view" :tabs="tabs">
      <AppCard :padded="false">
        <div class="border-b border-line p-4">
          <AppSearchInput v-model="table.search.value" placeholder="Search by name or employee code" aria-label="Search employees" />
        </div>
        <AppDataTable :columns="columns" :rows="table.rows.value" :row-key="(r) => r.employee.id" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" caption="Salaries" :empty-title="view === 'missing' ? 'Everyone has a salary' : 'No employees'" @page="table.setPage" @retry="table.load">
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee.name" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ row.employee.employeeCode }}{{ row.employee.designation ? ` · ${row.employee.designation}` : '' }}</p>
              </div>
            </div>
          </template>
          <template #cell-ctc="{ row }">
            <span v-if="row.current" class="font-medium tabular-nums">{{ rupees(row.current.annualCtc) }}</span>
            <AppBadge v-else tone="warning" size="sm">No salary</AppBadge>
            <p v-if="row.upcoming" class="text-xs text-fg-muted">{{ rupees(row.upcoming.annualCtc) }} from {{ formatDate(row.upcoming.effectiveFrom) }}</p>
          </template>
          <template #cell-gross="{ row }"><span class="tabular-nums text-fg-muted">{{ row.current ? rupees(row.current.monthlyGross) : '—' }}</span></template>
          <template #cell-since="{ row }"><span class="text-fg-muted">{{ row.current ? formatDate(row.current.effectiveFrom) : '—' }}</span></template>
          <template #cell-actions="{ row }">
            <div class="flex justify-end gap-1">
              <AppButton size="sm" variant="ghost" :icon="History" :aria-label="`Salary history of ${row.employee.name}`" @click="openHistory(row)" />
              <AppButton v-if="canRevise" size="sm" variant="secondary" :icon="Wallet" @click="openForm(row)">{{ row.current || row.upcoming ? 'Revise' : 'Set salary' }}</AppButton>
            </div>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>

    <SalaryFormModal :open="formOpen" :employee="target?.employee ?? null" :current="target?.current ?? null" :locked-through="lockedThrough" @close="formOpen = false" @saved="onSaved" />

    <AppModal :open="!!historyFor" :title="historyFor ? `Salary history · ${historyFor.employee.name}` : ''" size="lg" @close="historyFor = null">
      <AppSkeleton v-if="loadingHistory" :lines="5" />
      <p v-else-if="history && !history.salaries.length" class="text-sm text-fg-muted">No salary has been set yet.</p>
      <ol v-else-if="history" class="space-y-4">
        <li v-for="(s, i) in history.salaries" :key="s.id" class="rounded-xl p-4 ring-1 ring-line">
          <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <p class="font-semibold text-fg">{{ rupees(s.annualCtc) }} a year <AppBadge v-if="i === 0" tone="brand" size="sm" class="ml-1">Latest</AppBadge></p>
              <p class="text-xs text-fg-muted">From {{ formatDate(s.effectiveFrom) }} · {{ s.structure.name }}{{ s.pfApplicable ? '' : ' · no PF' }}{{ s.reason ? ` · ${s.reason}` : '' }}{{ s.createdBy ? ` · by ${s.createdBy}` : '' }}</p>
            </div>
            <AppButton v-if="canRevise && !s.locked" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete salary from ${s.effectiveFrom}`" @click="removeSalary(s.id, s.effectiveFrom)" />
          </div>
          <SalaryBreakdownTable :components="s.components" :monthly-gross="s.monthlyGross" :employer-pf="s.employerPf" :employer-esi="s.employerEsi" :monthly-ctc="s.monthlyCtc" />
        </li>
      </ol>
    </AppModal>
  </div>
</template>
