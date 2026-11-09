<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowDownRight, ArrowUpRight, CalendarClock, History, Lock, Settings2, Trash2, UserX, Users, Wallet } from '@lucide/vue';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import PaySplitBar, { type PaySegment } from '@/modules/payroll/components/PaySplitBar.vue';
import SalaryBreakdownTable from '@/modules/payroll/components/SalaryBreakdownTable.vue';
import SalaryFormModal from '@/modules/payroll/components/SalaryFormModal.vue';
import SalaryGridCard from '@/modules/payroll/components/SalaryGridCard.vue';
import type { EmployeeSalary, SalaryHistory, SalaryRow } from '@/modules/payroll/types';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { change } from '@/modules/payroll/utils/run-compare';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppSearchInput, AppSkeleton, AppStatStrip, AppTabs, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Everyone's CTC: payroll cost at a glance, who has no salary yet (left out of payroll), upcoming revisions and each employee's history. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canRevise = computed(() => auth.can('employee.salary.revise'));
const canSetup = computed(() => auth.can('payroll.configure') || auth.can('payroll.view'));
const view = ref('all');
const table = useTable((q) => payrollApi.salaries({ ...q, missing: view.value === 'missing' || undefined }));
watch(view, () => void table.load());

/** Everyone in scope, for the totals; the cost figures are only shown when the rows cover everyone (see fetchAllPages' ceiling). */
const summary = useAsync(() => Promise.all([fetchAllPages((page, pageSize) => payrollApi.salaries({ page, pageSize })), payrollApi.salaries({ page: 1, pageSize: 1 })]));
const everyone = computed(() => summary.data.value?.[0] ?? []);
const total = computed(() => summary.data.value?.[1].meta.total ?? 0);
const complete = computed(() => !!summary.data.value && everyone.value.length >= total.value);
const missing = computed(() => everyone.value.filter((r) => !r.current && !r.upcoming));
const upcoming = computed(() => everyone.value.filter((r) => r.upcoming).sort((a, b) => a.upcoming!.effectiveFrom.localeCompare(b.upcoming!.effectiveFrom)));
const tabs = computed(() => [
  { key: 'all', label: 'All employees', icon: Users, count: summary.data.value ? total.value : null },
  { key: 'missing', label: 'Without salary', icon: UserX, count: summary.data.value && complete.value ? missing.value.length : null },
]);
const strip = computed<StripItem[]>(() => {
  const paid = everyone.value.filter((r) => r.current);
  const ctc = paid.reduce((n, r) => n + r.current!.annualCtc, 0);
  const gross = paid.reduce((n, r) => n + r.current!.monthlyGross, 0);
  const items: StripItem[] = [{ key: 'people', label: 'Employees', value: total.value, tone: 'brand', hint: complete.value ? `${paid.length} with a salary` : undefined }];
  if (complete.value)
    items.push(
      { key: 'ctc', label: 'Annual payroll cost', value: rupees(ctc), tone: 'violet', hint: `${rupees(Math.round(ctc / 12))} a month (CTC)` },
      { key: 'gross', label: 'Monthly gross', value: rupees(gross), tone: 'info', hint: 'Before deductions' },
      { key: 'avg', label: 'Average CTC', value: paid.length ? rupees(Math.round(ctc / paid.length)) : '—', tone: 'success', hint: 'A year, per employee' },
      { key: 'missing', label: 'Without salary', value: missing.value.length, tone: missing.value.length ? 'warning' : 'neutral', hint: missing.value.length ? 'Left out of payroll' : 'Everyone is set up' },
      { key: 'upcoming', label: 'Revisions scheduled', value: upcoming.value.length, tone: 'orange', hint: upcoming.value.length ? `Next ${formatDate(upcoming.value[0]!.upcoming!.effectiveFrom)}` : 'None ahead' },
    );
  return items;
});

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
  await Promise.all([table.load(), summary.run()]);
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
    await Promise.all([table.load(), summary.run(), openHistory(historyFor.value!)]);
  } catch (e) {
    feedback.error('Could not delete the salary', e);
  }
}
const COMPONENT_COLORS = ['bg-brand-500', 'bg-sky-500', 'bg-teal-500', 'bg-indigo-400', 'bg-emerald-400', 'bg-cyan-400'];
const segments = (s: EmployeeSalary): PaySegment[] => [
  ...s.components.map((c, i) => ({ key: c.componentId, label: c.name, amount: c.monthly, color: COMPONENT_COLORS[i % COMPONENT_COLORS.length]! })),
  ...(s.employerPf ? [{ key: 'pf', label: 'Employer PF', amount: s.employerPf, color: 'bg-violet-400' }] : []),
  ...(s.employerEsi ? [{ key: 'esi', label: 'Employer ESI', amount: s.employerEsi, color: 'bg-fuchsia-400' }] : []),
];
/** Change against the salary before it (the list is newest first). */
const revision = (i: number) => {
  const list = history.value?.salaries ?? [];
  return list[i + 1] ? change(list[i]!.annualCtc, list[i + 1]!.annualCtc) : null;
};
const isUpcoming = (s: EmployeeSalary) => s.effectiveFrom > new Date().toISOString().slice(0, 10);
const currentIndex = computed(() => history.value?.salaries.findIndex((s) => !isUpcoming(s)) ?? -1);

const columns: TableColumn<SalaryRow>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'structure', label: 'Structure' },
  { key: 'ctc', label: 'Annual CTC', align: 'right' },
  { key: 'gross', label: 'Monthly gross', align: 'right' },
  { key: 'since', label: 'Effective' },
  { key: 'actions', label: '', align: 'right' },
];
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Salaries" description="Each employee's CTC and its breakdown. Revisions start from an effective date and keep the history.">
      <template v-if="canSetup" #actions><AppButton variant="secondary" :icon="Settings2" to="/hr/payroll/setup">Salary structures</AppButton></template>
    </AppPageHeader>

    <AppStatStrip :items="strip" :loading="summary.loading.value && !summary.data.value" label="Payroll cost" />

    <!-- Needs attention -->
    <section v-if="complete && missing.length && view === 'all'" class="card flex flex-wrap items-center gap-4 border-s-4 border-s-warning px-4 py-3" aria-labelledby="missing-title">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning-fg" aria-hidden="true"><UserX :size="17" /></span>
      <div class="min-w-0 flex-1">
        <h2 id="missing-title" class="text-sm font-semibold text-fg">{{ missing.length }} employee{{ missing.length === 1 ? ' has' : 's have' }} no salary</h2>
        <p class="text-xs text-fg-muted">They're left out of payroll runs until a salary is set.</p>
      </div>
      <div class="flex -space-x-2" aria-hidden="true">
        <AppAvatar v-for="m in missing.slice(0, 5)" :key="m.employee.id" :name="m.employee.name" size="sm" class="ring-2 ring-surface" />
      </div>
      <AppButton size="sm" variant="secondary" @click="view = 'missing'">Show who</AppButton>
    </section>

    <AppTabs v-model="view" :tabs="tabs">
      <AppCard :padded="false">
        <div class="border-b border-line/70 p-3">
          <AppSearchInput v-model="table.search.value" placeholder="Search by name or employee code" aria-label="Search employees" />
        </div>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :row-key="(r) => r.employee.id"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          caption="Salaries"
          :empty-title="view === 'missing' ? 'Everyone has a salary' : 'No employees'"
          :empty-description="view === 'missing' ? 'Every employee will be included in the next payroll run.' : undefined"
          :filtered="table.isFiltered.value"
          @page="table.setPage"
          @retry="table.load"
          @clear="table.clearFilters()"
        >
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee.name" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ row.employee.employeeCode }}{{ row.employee.designation ? ` · ${row.employee.designation}` : '' }}{{ row.employee.department ? ` · ${row.employee.department}` : '' }}</p>
              </div>
            </div>
          </template>
          <template #cell-structure="{ row }">
            <span v-if="row.current" class="text-fg-muted">{{ row.current.structure.name ?? '—' }}<span v-if="!row.current.pfApplicable" class="ms-1.5 text-2xs text-fg-subtle">no PF</span></span>
            <span v-else class="text-fg-subtle">—</span>
          </template>
          <template #cell-ctc="{ row }">
            <template v-if="row.current">
              <p class="font-semibold text-fg tabular-nums">{{ rupees(row.current.annualCtc) }}</p>
              <p class="text-2xs text-fg-subtle tabular-nums">{{ rupees(row.current.monthlyCtc) }} a month</p>
            </template>
            <AppBadge v-else-if="!row.upcoming" tone="warning" size="sm" dot>No salary</AppBadge>
            <span v-else class="text-fg-subtle">—</span>
            <p v-if="row.upcoming" class="mt-0.5 inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-px text-2xs font-medium text-accent-fg tabular-nums">
              <CalendarClock :size="11" aria-hidden="true" />{{ rupees(row.upcoming.annualCtc) }} from {{ formatDate(row.upcoming.effectiveFrom) }}
              <template v-if="row.current">
                <component :is="row.upcoming.annualCtc >= row.current.annualCtc ? ArrowUpRight : ArrowDownRight" :size="11" aria-hidden="true" />{{ change(row.upcoming.annualCtc, row.current.annualCtc).pct }}%
              </template>
            </p>
          </template>
          <template #cell-gross="{ row }"><span class="text-fg-muted tabular-nums">{{ row.current ? rupees(row.current.monthlyGross) : '—' }}</span></template>
          <template #cell-since="{ row }">
            <template v-if="row.current">
              <p class="text-fg">{{ formatDate(row.current.effectiveFrom) }}</p>
              <p class="text-2xs text-fg-subtle">{{ row.current.reason ?? timeAgo(row.current.effectiveFrom) }}</p>
            </template>
            <span v-else class="text-fg-subtle">—</span>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex justify-end gap-1">
              <AppButton size="sm" variant="ghost" :icon="History" :aria-label="`Salary history of ${row.employee.name}`" title="Salary history" @click="openHistory(row)" />
              <AppButton v-if="canRevise" size="sm" :variant="row.current || row.upcoming ? 'secondary' : 'primary'" :icon="Wallet" @click="openForm(row)">{{ row.current || row.upcoming ? 'Revise' : 'Set salary' }}</AppButton>
            </div>
          </template>
          <template #card="{ row }">
            <SalaryGridCard :row="row" :segments="row.current ? segments(row.current) : []" :can-revise="canRevise" @history="openHistory(row)" @revise="openForm(row)" />
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>

    <SalaryFormModal :open="formOpen" :employee="target?.employee ?? null" :current="target?.current ?? null" :locked-through="lockedThrough" @close="formOpen = false" @saved="onSaved" />

    <AppModal :open="!!historyFor" :title="historyFor ? `Salary history · ${historyFor.employee.name}` : ''" :description="historyFor ? [historyFor.employee.employeeCode, historyFor.employee.designation, `joined ${formatDate(historyFor.employee.dateOfJoining)}`].filter(Boolean).join(' · ') : undefined" size="lg" @close="historyFor = null">
      <AppSkeleton v-if="loadingHistory" :lines="5" />
      <div v-else-if="history && !history.salaries.length" class="flex items-center gap-3 rounded-lg bg-surface-muted/60 px-4 py-4">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-fg-subtle ring-1 ring-line ring-inset" aria-hidden="true"><Wallet :size="16" /></span>
        <p class="text-sm text-fg-muted">No salary has been set yet.</p>
      </div>
      <template v-else-if="history">
        <p v-if="history.lockedThrough" class="mb-4 flex items-center gap-2 text-xs text-fg-muted">
          <Lock :size="13" aria-hidden="true" />Paid through {{ formatDate(history.lockedThrough) }}: salaries that payroll has used can't be deleted.
        </p>
        <ol class="space-y-4">
          <li v-for="(s, i) in history.salaries" :key="s.id" class="relative ps-8">
            <span v-if="i < history.salaries.length - 1" class="absolute start-3 top-7 -bottom-4 w-px bg-line" aria-hidden="true" />
            <span :class="['absolute start-0 top-1 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-surface', i === 0 ? 'bg-brand-600 text-white' : 'bg-surface-muted text-fg-muted']" aria-hidden="true"><Wallet :size="12" /></span>
            <div class="rounded-xl p-4 ring-1 ring-line ring-inset">
              <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="flex flex-wrap items-center gap-2 font-semibold text-fg">
                    <span class="tabular-nums">{{ rupees(s.annualCtc) }} a year</span>
                    <AppBadge v-if="isUpcoming(s)" tone="info" size="sm">Upcoming</AppBadge>
                    <AppBadge v-else-if="i === currentIndex" tone="brand" size="sm">Current</AppBadge>
                    <span v-if="revision(i) && revision(i)!.direction !== 'same'" :class="['inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-2xs font-semibold tabular-nums', revision(i)!.direction === 'up' ? 'bg-success-soft text-success-fg' : 'bg-danger-soft text-danger-fg']">
                      <component :is="revision(i)!.direction === 'up' ? ArrowUpRight : ArrowDownRight" :size="11" aria-hidden="true" />{{ revision(i)!.pct }}%
                    </span>
                  </p>
                  <p class="text-xs text-fg-muted">From {{ formatDate(s.effectiveFrom) }} · {{ s.structure.name }}{{ s.pfApplicable ? '' : ' · no PF' }}{{ s.reason ? ` · ${s.reason}` : '' }}{{ s.createdBy ? ` · by ${s.createdBy}` : '' }}</p>
                </div>
                <AppButton v-if="canRevise && !s.locked" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete salary from ${s.effectiveFrom}`" @click="removeSalary(s.id, s.effectiveFrom)" />
              </div>
              <PaySplitBar class="mb-3" :segments="segments(s)" :label="`Monthly cost to company from ${formatDate(s.effectiveFrom)}`" />
              <SalaryBreakdownTable :components="s.components" :monthly-gross="s.monthlyGross" :employer-pf="s.employerPf" :employer-esi="s.employerEsi" :monthly-ctc="s.monthlyCtc" />
            </div>
          </li>
        </ol>
      </template>
    </AppModal>
  </div>
</template>
