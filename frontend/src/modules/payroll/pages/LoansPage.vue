<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Plus } from '@lucide/vue';
import { LOAN_STATUSES, LOAN_TYPES, type LoanStatus, type LoanType } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { loansApi } from '@/modules/payroll/api/payroll.api';
import LoanRequestModal from '@/modules/payroll/components/LoanRequestModal.vue';
import type { Loan, LoanDetail } from '@/modules/payroll/types';
import { LOAN_STATUS_LABELS, LOAN_TYPE_LABELS, loanTone, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, AppTabs, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canApprove = auth.can('payroll.loan.approve');
const tabs = [...(canApprove ? [{ key: 'approve', label: 'Waiting for me' }] : []), { key: 'all', label: 'All loans' }];
const table = useTable((q) => loansApi.list(q), { filters: { view: (canApprove ? 'approve' : 'all') as 'approve' | 'all', status: 'OPEN' as LoanStatus | 'OPEN' | undefined, type: undefined as LoanType | undefined } });
const view = computed({ get: () => table.filters.view, set: (v: string) => (table.filters.view = v as 'approve' | 'all') });
const statusOptions = [{ value: 'OPEN', label: 'Open' }, ...LOAN_STATUSES.map((s) => ({ value: s, label: LOAN_STATUS_LABELS[s] }))];
const typeOptions = LOAN_TYPES.map((t) => ({ value: t, label: LOAN_TYPE_LABELS[t] }));
const raising = ref(false);
async function onRaised(l: LoanDetail) {
  raising.value = false;
  feedback.success('Request raised', `${l.reference} needs approval by someone else.`);
  await router.push(`/hr/payroll/loans/${l.id}`);
}
const columns: TableColumn<Loan>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'loan', label: 'Loan' },
  { key: 'amount', label: 'Amount', align: 'right' },
  { key: 'outstanding', label: 'Still owed', align: 'right' },
  { key: 'status', label: 'Status' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Loans & advances" description="Requests to approve, money to pay out and what is still being repaid through payroll.">
      <template v-if="auth.can('payroll.loan.manage')" #actions><AppButton :icon="Plus" @click="raising = true">Raise for an employee</AppButton></template>
    </AppPageHeader>
    <AppTabs v-model="view" :tabs="tabs">
      <AppCard :padded="false">
        <div v-if="view === 'all'" class="grid gap-3 border-b border-line p-4 sm:grid-cols-[1fr_200px_200px]">
          <AppSearchInput v-model="table.search.value" placeholder="Search by name or code" aria-label="Search loans" />
          <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="Any status" aria-label="Filter by status" />
          <AppSelect v-model="table.filters.type" :options="typeOptions" placeholder="Loans and advances" aria-label="Filter by type" />
        </div>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          clickable
          caption="Loans and advances"
          :empty-title="view === 'approve' ? 'Nothing waiting for you' : 'No loans or advances'"
          @page="table.setPage"
          @retry="table.load"
          @row-click="(l: Loan) => router.push(`/hr/payroll/loans/${l.id}`)"
        >
          <template #cell-employee="{ row }">
            <p class="font-medium text-fg">{{ row.employee?.name }}</p>
            <p class="text-xs text-fg-muted">{{ row.employee?.employeeCode }}{{ row.employee?.department ? ` · ${row.employee.department}` : '' }}</p>
          </template>
          <template #cell-loan="{ row }">
            <p class="text-fg">{{ LOAN_TYPE_LABELS[row.type] }} · {{ row.reference }}</p>
            <p class="max-w-72 truncate text-xs text-fg-muted">{{ row.purpose }}</p>
          </template>
          <template #cell-amount="{ row }">
            <p class="font-medium tabular-nums">{{ rupees(row.principal) }}</p>
            <p class="text-xs text-fg-muted tabular-nums">{{ row.emi ? `${rupees(row.emi)} × ${row.tenureMonths}` : `${row.tenureMonths} months` }}</p>
          </template>
          <template #cell-outstanding="{ row }">
            <span class="tabular-nums">{{ row.status === 'ACTIVE' || row.status === 'CLOSED' ? rupees(row.outstanding) : '—' }}</span>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :tone="loanTone[row.status]" size="sm" dot>{{ LOAN_STATUS_LABELS[row.status] }}</AppBadge>
            <p v-if="row.start && (row.status === 'APPROVED' || row.status === 'ACTIVE')" class="text-xs text-fg-muted">from {{ row.start.label }}</p>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>
    <LoanRequestModal :open="raising" on-behalf @close="raising = false" @saved="onRaised" />
  </div>
</template>
