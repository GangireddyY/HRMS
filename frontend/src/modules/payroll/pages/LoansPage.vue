<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import { useRouter } from 'vue-router';
import { CalendarClock, ChevronRight, Hourglass, Inbox, Landmark, ListChecks, Plus, Wallet } from '@lucide/vue';
import { LOAN_STATUSES, LOAN_TYPES, type LoanStatus, type LoanType } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { useAuthStore } from '@/core/auth/auth.store';
import { loansApi } from '@/modules/payroll/api/payroll.api';
import LoanRequestModal from '@/modules/payroll/components/LoanRequestModal.vue';
import type { Loan, LoanDetail } from '@/modules/payroll/types';
import { nextInstalmentNumber } from '@/modules/payroll/utils/loan-progress';
import { LOAN_STATUS_LABELS, LOAN_TYPE_LABELS, loanTone, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, AppStatStrip, AppTabs, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { timeAgo } from '@/shared/utils/format';

/** Loans and salary advances: requests to decide, money to pay out, what's being repaid through payroll, and every loan. */
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canApprove = auth.can('payroll.loan.approve');
const canManage = auth.can('payroll.loan.manage');
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

/** Every loan in scope for the summary, the queue and the deductions due; independent of the table. */
const all = useAsync(() => fetchAllPages((page, pageSize) => loansApi.list({ view: 'all', page, pageSize })));
const loans = computed(() => all.data.value ?? []);
const mine = useAsync(() => (canApprove ? loansApi.list({ view: 'approve', page: 1, pageSize: 1 }) : Promise.resolve(null)));
const tabs = computed(() => [...(canApprove ? [{ key: 'approve', label: 'Waiting for me', icon: Inbox, count: mine.data.value?.meta.total ?? null }] : []), { key: 'all', label: 'All loans', icon: ListChecks }]);
const sum = (list: Loan[], pick: (l: Loan) => number) => list.reduce((n, l) => n + pick(l), 0);
const by = (s: LoanStatus) => loans.value.filter((l) => l.status === s);
const strip = computed<StripItem[]>(() => [
  { key: 'REQUESTED', label: 'Waiting for approval', value: by('REQUESTED').length, tone: 'warning', hint: by('REQUESTED').length ? `${rupees(sum(by('REQUESTED'), (l) => l.principal))} requested` : 'No requests' },
  { key: 'APPROVED', label: 'Approved · to pay out', value: by('APPROVED').length, tone: 'info', hint: by('APPROVED').length ? `${rupees(sum(by('APPROVED'), (l) => l.principal))} to transfer` : 'Nothing to pay out' },
  { key: 'ACTIVE', label: 'Repaying', value: by('ACTIVE').length, tone: 'brand', hint: by('ACTIVE').length ? `${rupees(sum(by('ACTIVE'), (l) => l.outstanding))} still owed` : 'Nothing outstanding' },
  { key: 'CLOSED', label: 'Repaid', value: by('CLOSED').length, tone: 'success', hint: by('CLOSED').length ? `${rupees(sum(by('CLOSED'), (l) => l.principal))} recovered` : 'None closed yet' },
]);
const stripSelected = computed(() => (table.filters.view === 'all' && typeof table.filters.status === 'string' && table.filters.status !== 'OPEN' ? table.filters.status : null));
function selectStatus(key: string | null) {
  table.filters.view = 'all';
  table.filters.status = (key as LoanStatus | null) ?? 'OPEN';
}
const requests = computed(() => by('REQUESTED').sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
const deductions = computed(() => by('ACTIVE').filter((l) => l.nextInstalment).sort((a, b) => b.nextInstalment!.amount - a.nextInstalment!.amount));
const nextTotal = computed(() => sum(deductions.value, (l) => l.nextInstalment!.amount));

const TYPE_ICON: Record<LoanType, Component> = { ADVANCE: Wallet, LOAN: Landmark };
const TYPE_TILE: Record<LoanType, string> = {
  ADVANCE: 'bg-sky-50 text-sky-600 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300',
  LOAN: 'bg-violet-50 text-violet-600 ring-violet-600/15 dark:bg-violet-500/15 dark:text-violet-300',
};
const progress = (l: Loan) => (l.principal ? Math.min(100, Math.round((l.repaid / l.principal) * 100)) : 0);
/** Payroll month of the next instalment, counted from the first deduction month. */
const nextMonth = (l: Loan) => (l.start ? new Date(l.start.year, l.start.month - 1 + l.instalmentsPaid, 1).toLocaleDateString(appLocale(), { month: 'short', year: 'numeric' }) : null);
const columns: TableColumn<Loan>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'loan', label: 'Loan' },
  { key: 'amount', label: 'Amount', align: 'right' },
  { key: 'outstanding', label: 'Repayment' },
  { key: 'status', label: 'Status' },
];
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Loans & advances" description="Requests to approve, money to pay out and what is still being repaid through payroll.">
      <template v-if="canManage" #actions><AppButton :icon="Plus" @click="raising = true">Raise for an employee</AppButton></template>
    </AppPageHeader>

    <AppStatStrip :items="strip" :loading="all.loading.value && !all.data.value" selectable :selected="stripSelected" label="Loans by status" @select="selectStatus" />

    <div class="grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <div class="min-w-0">
        <AppTabs v-model="view" :tabs="tabs">
          <AppCard :padded="false">
            <div v-if="view === 'all'" class="grid gap-3 border-b border-line/70 px-3 py-3 sm:grid-cols-[1fr_180px_180px]">
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
              :empty-description="view === 'approve' ? 'Requests that need your decision or a payout appear here.' : 'Requests employees make, or that you raise for them, appear here.'"
              :filtered="table.isFiltered.value"
              @page="table.setPage"
              @retry="table.load"
              @row-click="(l: Loan) => router.push(`/hr/payroll/loans/${l.id}`)"
              @clear="table.clearFilters()"
            >
              <template #empty><AppButton v-if="canManage" :icon="Plus" @click="raising = true">Raise for an employee</AppButton></template>
              <template #cell-employee="{ row }">
                <div class="flex items-center gap-3">
                  <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
                  <div class="min-w-0">
                    <p class="truncate font-medium text-fg">{{ row.employee?.name }}</p>
                    <p class="truncate text-xs text-fg-muted">{{ row.employee?.employeeCode }}{{ row.employee?.department ? ` · ${row.employee.department}` : '' }}</p>
                  </div>
                </div>
              </template>
              <template #cell-loan="{ row }">
                <div class="flex min-w-0 items-center gap-2.5 max-md:justify-end">
                  <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset max-md:hidden', TYPE_TILE[row.type]]" aria-hidden="true"><component :is="TYPE_ICON[row.type]" :size="15" /></span>
                  <div class="min-w-0">
                    <p class="truncate text-fg">{{ LOAN_TYPE_LABELS[row.type] }} <span class="text-fg-muted">· {{ row.reference }}</span></p>
                    <p class="max-w-64 truncate text-xs text-fg-muted">{{ row.purpose }}</p>
                  </div>
                </div>
              </template>
              <template #cell-amount="{ row }">
                <p class="font-semibold tabular-nums">{{ rupees(row.principal) }}</p>
                <p class="text-2xs text-fg-muted tabular-nums">{{ row.emi ? `${rupees(row.emi)} × ${row.tenureMonths}` : `${row.tenureMonths} months` }}{{ row.interestRate ? ` · ${row.interestRate}%` : '' }}</p>
              </template>
              <template #cell-outstanding="{ row }">
                <div v-if="row.status === 'ACTIVE' || row.status === 'CLOSED'" class="w-40 max-md:ms-auto">
                  <div class="flex justify-between text-2xs text-fg-muted tabular-nums">
                    <span>{{ progress(row) }}% repaid</span>
                    <span>{{ row.status === 'CLOSED' ? 'Done' : `${rupees(row.outstanding)} left` }}</span>
                  </div>
                  <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="progress(row)" aria-valuemin="0" aria-valuemax="100" :aria-label="`${row.reference} repaid`">
                    <div :class="['h-full rounded-full', row.status === 'CLOSED' ? 'bg-success' : 'bg-brand-500']" :style="{ width: `${progress(row)}%` }" />
                  </div>
                  <p v-if="row.status === 'ACTIVE' && row.nextInstalment" class="mt-0.5 text-2xs text-fg-subtle tabular-nums">Next {{ rupees(row.nextInstalment.amount) }}{{ nextMonth(row) ? ` · ${nextMonth(row)}` : '' }}</p>
                </div>
                <p v-else-if="row.status === 'APPROVED' && row.start" class="text-xs text-fg-muted">Deductions from {{ row.start.label }}, after payout</p>
                <p v-else-if="row.status === 'REQUESTED'" class="text-xs text-fg-muted">Asked {{ timeAgo(row.createdAt) }}</p>
                <span v-else class="text-fg-subtle">—</span>
              </template>
              <template #cell-status="{ row }">
                <AppBadge :tone="loanTone[row.status]" size="sm" dot>{{ LOAN_STATUS_LABELS[row.status] }}</AppBadge>
              </template>
            </AppDataTable>
          </AppCard>
        </AppTabs>
      </div>

      <aside class="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-1">
        <AppCard title="Waiting for approval" :icon="Hourglass" :padded="false" :description="requests.length ? 'Oldest first' : undefined">
          <ul v-if="requests.length" class="divide-y divide-line/60">
            <li v-for="l in requests.slice(0, 5)" :key="l.id">
              <RouterLink :to="`/hr/payroll/loans/${l.id}`" class="group flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-muted/50 focus-visible:bg-surface-muted/50 focus-visible:outline-none">
                <AppAvatar :name="l.employee?.name ?? '?'" size="sm" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-fg">{{ l.employee?.name }}</p>
                  <p class="truncate text-2xs text-fg-muted">{{ LOAN_TYPE_LABELS[l.type] }} · asked {{ timeAgo(l.createdAt) }}</p>
                </div>
                <span class="text-sm font-semibold text-fg tabular-nums">{{ rupees(l.principal) }}</span>
                <ChevronRight :size="15" class="text-fg-subtle transition group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
          <p v-else class="px-4 py-4 text-xs text-fg-muted">No requests are waiting for a decision.</p>
        </AppCard>

        <AppCard title="Next payroll deductions" :icon="CalendarClock" :padded="false" :description="deductions.length ? `${rupees(nextTotal)} from ${deductions.length} employee${deductions.length === 1 ? '' : 's'}` : undefined">
          <ul v-if="deductions.length" class="divide-y divide-line/60">
            <li v-for="l in deductions.slice(0, 6)" :key="l.id">
              <RouterLink :to="`/hr/payroll/loans/${l.id}`" class="flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-muted/50 focus-visible:bg-surface-muted/50 focus-visible:outline-none">
                <span :class="['flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset', TYPE_TILE[l.type]]" aria-hidden="true"><component :is="TYPE_ICON[l.type]" :size="13" /></span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm text-fg">{{ l.employee?.name }}</p>
                  <p class="truncate text-2xs text-fg-muted">{{ l.reference }} · {{ nextInstalmentNumber(l) }} of {{ l.tenureMonths }}</p>
                </div>
                <span class="text-sm font-medium text-fg tabular-nums">{{ rupees(l.nextInstalment!.amount) }}</span>
              </RouterLink>
            </li>
          </ul>
          <p v-else class="px-4 py-4 text-xs text-fg-muted">Nothing will be deducted from salaries for loans next month.</p>
        </AppCard>
      </aside>
    </div>
    <LoanRequestModal :open="raising" on-behalf @close="raising = false" @saved="onRaised" />
  </div>
</template>
