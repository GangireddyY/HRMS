<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { AlertTriangle, Ban, Calculator, Check, ChevronDown, Download, Plus, Send, Trash2, Undo2, Wallet, X } from '@lucide/vue';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import PayslipView from '@/modules/payroll/components/PayslipView.vue';
import type { PayrollRunDetail, PayslipDetail, PayslipSummary } from '@/modules/payroll/types';
import { isBlocking, RUN_STATUS_LABELS, rupees, runTone, warningText } from '@/modules/payroll/utils/payroll-format';
import {
  AppAlert,
  AppAvatar,
  AppBadge,
  AppButton,
  AppCard,
  AppCheckbox,
  AppDataTable,
  AppDropdown,
  AppErrorState,
  AppInput,
  AppMenuItem,
  AppModal,
  AppPageHeader,
  AppSearchInput,
  AppSelect,
  AppSkeleton,
  AppStatCard,
  AppTabs,
  AppTextarea,
  type TableColumn,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime } from '@/shared/utils/format';

const route = useRoute();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const run = useAsync(() => payrollApi.run(id.value));
const r = computed(() => run.data.value);
const filter = ref('all');
const filterTabs = computed(() => [
  { key: 'all', label: `All (${(r.value?.employeeCount ?? 0) + (r.value?.summary.held ?? 0)})` },
  { key: 'warnings', label: 'With warnings' },
  { key: 'held', label: `Held (${r.value?.summary.held ?? 0})` },
]);
const table = useTable((q) => payrollApi.runPayslips(id.value, { ...q, filter: filter.value === 'all' ? undefined : (filter.value as 'warnings' | 'held') }));
watch(filter, () => void table.load());
watch(id, () => {
  void run.run();
  void table.load();
});
async function refresh(next?: PayrollRunDetail) {
  if (next) run.data.value = next;
  else await run.run();
  await table.load();
}

const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<PayrollRunDetail>, success: string, description?: string) {
  busy.value = key;
  try {
    await refresh(await fn());
    feedback.success(success, description);
  } catch (e) {
    feedback.error('Could not complete the action', e);
  } finally {
    busy.value = null;
  }
}
async function cancelRun() {
  if (!(await feedback.confirm({ title: `Cancel payroll for ${r.value!.period}?`, message: 'The run and its payslips are discarded; you can start the month again.', confirmLabel: 'Cancel payroll', danger: true }))) return;
  await act('cancel', () => payrollApi.cancel(id.value), 'Payroll cancelled');
}

const decision = ref<'approve' | 'reject' | null>(null);
const note = ref('');
async function decide() {
  const d = decision.value!;
  decision.value = null;
  await act(d, () => (d === 'approve' ? payrollApi.approve(id.value, note.value || null) : payrollApi.reject(id.value, note.value)), d === 'approve' ? 'Payroll approved' : 'Payroll sent back', d === 'approve' ? 'Payslips are now visible to employees.' : undefined);
}
const payOpen = ref(false);
const paymentReference = ref('');
async function pay() {
  payOpen.value = false;
  await act('pay', () => payrollApi.pay(id.value, paymentReference.value), 'Payroll marked as paid');
}
async function download(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    feedback.error('Could not download the file', e);
  }
}

// Payslip dialog
const slip = ref<PayslipDetail | null>(null);
const slipLoading = ref(false);
const edit = reactive({ lop: '' as number | string, held: false, reason: '' });
const adj = reactive({ kind: 'EARNING' as 'EARNING' | 'DEDUCTION', label: '', amount: '' as number | string, taxable: true });
function syncEdit(p: PayslipDetail) {
  slip.value = p;
  Object.assign(edit, { lop: p.lopOverride ?? '', held: p.excluded, reason: p.excludeReason ?? '' });
}
async function openSlip(row: PayslipSummary) {
  slipLoading.value = true;
  slip.value = null;
  Object.assign(adj, { kind: 'EARNING', label: '', amount: '', taxable: true });
  try {
    syncEdit(await payrollApi.payslip(row.id));
  } catch (e) {
    feedback.error('Could not open the payslip', e);
  } finally {
    slipLoading.value = false;
  }
}
async function slipAct(key: string, fn: () => Promise<PayslipDetail | null>, success: string) {
  busy.value = key;
  try {
    const p = await fn();
    if (p) syncEdit(p);
    await refresh();
    feedback.success(success);
  } catch (e) {
    feedback.error('Could not update the payslip', e);
  } finally {
    busy.value = null;
  }
}
const saveLop = () => slipAct('lop', () => payrollApi.updatePayslip(id.value, slip.value!.id, { lopOverride: edit.lop === '' ? null : Number(edit.lop) }), 'Loss of pay updated');
const saveHold = () => slipAct('hold', () => payrollApi.updatePayslip(id.value, slip.value!.id, { excluded: edit.held, excludeReason: edit.held ? edit.reason : null }), edit.held ? 'Salary held for this run' : 'Hold released');
const addAdjustment = () =>
  slipAct('adj', () => payrollApi.addAdjustment(id.value, { employeeId: slip.value!.employeeId, kind: adj.kind, label: adj.label, amount: Number(adj.amount), taxable: adj.kind === 'EARNING' ? adj.taxable : false }), 'Adjustment added').then(() =>
    Object.assign(adj, { label: '', amount: '' }),
  );
const removeAdjustment = (adjustmentId: string) => slipAct(`adj-${adjustmentId}`, () => payrollApi.removeAdjustment(id.value, adjustmentId), 'Adjustment removed');

const columns: TableColumn<PayslipSummary>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'days', label: 'Days paid', align: 'right' },
  { key: 'gross', label: 'Gross', align: 'right' },
  { key: 'deductions', label: 'Deductions', align: 'right' },
  { key: 'net', label: 'Net pay', align: 'right' },
  { key: 'flags', label: '' },
];
</script>

<template>
  <div>
    <AppSkeleton v-if="run.loading.value && !r" :lines="8" />
    <AppErrorState v-else-if="run.error.value" :error="run.error.value" title="Could not load the payroll run" @retry="run.run" />
    <template v-else-if="r">
      <AppPageHeader :title="`Payroll · ${r.period}`" :description="r.notes ?? undefined" back="/hr/payroll/runs" back-label="Payroll runs">
        <template #badges><AppBadge :tone="runTone[r.status]" dot>{{ RUN_STATUS_LABELS[r.status] }}</AppBadge></template>
        <template #actions>
          <AppDropdown label="Downloads" width="w-60">
            <template #trigger="{ toggle }"><AppButton variant="secondary" :icon="Download" :icon-right="ChevronDown" @click="toggle">Downloads</AppButton></template>
            <template #default="{ close }">
              <AppMenuItem @select="close(); download(() => payrollApi.downloadRegister(r!.id))">Payroll register (CSV)</AppMenuItem>
              <AppMenuItem v-if="r.status === 'APPROVED' || r.status === 'PAID'" @select="close(); download(() => payrollApi.downloadPfEcr(r!.id))">PF return – ECR (TXT)</AppMenuItem>
              <AppMenuItem v-if="(r.status === 'APPROVED' || r.status === 'PAID') && auth.can('payroll.disburse')" @select="close(); download(() => payrollApi.downloadBankFile(r!.id))">Bank transfer file (CSV)</AppMenuItem>
            </template>
          </AppDropdown>
          <AppButton v-if="r.permissions.cancel" variant="ghost" :icon="Ban" :loading="busy === 'cancel'" @click="cancelRun">Cancel</AppButton>
          <template v-if="r.permissions.process">
            <AppButton variant="secondary" :icon="Calculator" :loading="busy === 'calc'" @click="act('calc', () => payrollApi.calculate(id), 'Payroll recalculated')">Recalculate</AppButton>
            <AppButton :icon="Send" :loading="busy === 'submit'" :disabled="!r.calculatedAt" @click="act('submit', () => payrollApi.submit(id), 'Sent for approval', 'Approvers have been notified.')">Submit for approval</AppButton>
          </template>
          <template v-if="r.permissions.approve">
            <AppButton variant="secondary" :icon="X" @click="decision = 'reject'; note = ''">Send back</AppButton>
            <AppButton :icon="Check" @click="decision = 'approve'; note = ''">Approve</AppButton>
          </template>
          <AppButton v-if="r.permissions.pay" :icon="Wallet" @click="payOpen = true; paymentReference = ''">Mark as paid</AppButton>
        </template>
      </AppPageHeader>

      <div class="mb-6 space-y-3">
        <AppAlert v-if="r.status === 'DRAFT' && r.reviewNote" tone="warning" title="Sent back">{{ r.reviewNote }} — {{ r.reviewedBy }}</AppAlert>
        <AppAlert v-if="r.status === 'DRAFT' && !r.calculatedAt" tone="warning" title="Not calculated yet">Use Recalculate to work out the payslips; any problem (for example attendance not closed) is shown then.</AppAlert>
        <AppAlert v-if="r.attendance.lopFromAttendance && !r.attendance.monthClosed" tone="warning" title="Attendance isn't closed for this month">Loss of pay is taken from attendance, so close the month under Attendance → Monthly closing first.</AppAlert>
        <AppAlert v-if="r.summary.blocking" tone="error" title="Problems to fix">{{ r.summary.blocking }} payslip{{ r.summary.blocking === 1 ? ' has' : 's have' }} problems that block submission. Fix them or hold those salaries.</AppAlert>
        <AppAlert v-if="r.status === 'DRAFT' && r.missingSalary.length" tone="info" :title="`${r.missingSalary.length} employee${r.missingSalary.length === 1 ? '' : 's'} without a salary are left out`">
          {{ r.missingSalary.slice(0, 8).map((m) => `${m.name} (${m.employeeCode})`).join(', ') }}{{ r.missingSalary.length > 8 ? '…' : '' }}.
          <RouterLink to="/hr/payroll/salaries" class="font-medium underline">Set salaries</RouterLink>
        </AppAlert>
        <AppAlert v-if="r.status === 'PAID'" tone="success" title="Paid">Payment reference {{ r.paymentReference }} · {{ r.paidBy }} · {{ formatDateTime(r.paidAt!) }}</AppAlert>
      </div>

      <div class="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <AppStatCard label="Employees paid" :value="r.employeeCount" :hint="r.summary.held ? `${r.summary.held} held` : undefined" />
        <AppStatCard label="Gross pay" :value="rupees(r.totalGross)" tone="info" />
        <AppStatCard label="Deductions" :value="rupees(r.totalDeductions)" tone="warning" />
        <AppStatCard label="Net pay" :value="rupees(r.totalNet)" tone="success" />
        <AppStatCard label="Employer contributions" :value="rupees(r.totalEmployerContributions)" />
      </div>

      <div class="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <AppTabs v-model="filter" :tabs="filterTabs">
          <AppCard :padded="false">
            <div class="border-b border-line p-4">
              <AppSearchInput v-model="table.search.value" placeholder="Search by name or employee code" aria-label="Search payslips" />
            </div>
            <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Payslips" empty-title="No payslips" @page="table.setPage" @retry="table.load" @row-click="openSlip">
              <template #cell-employee="{ row }">
                <div class="flex items-center gap-3">
                  <AppAvatar :name="row.employee.name" size="sm" />
                  <div class="min-w-0">
                    <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
                    <p class="truncate text-xs text-fg-muted">{{ row.employee.employeeCode }}{{ row.employee.department ? ` · ${row.employee.department}` : '' }}</p>
                  </div>
                </div>
              </template>
              <template #cell-days="{ row }">
                <span class="tabular-nums">{{ row.payableDays }}/{{ row.daysInMonth }}</span>
                <p v-if="(row.lopOverride ?? row.lopDays) > 0" class="text-xs text-amber-700 dark:text-amber-300">{{ row.lopOverride ?? row.lopDays }} LOP</p>
              </template>
              <template #cell-gross="{ row }"><span class="tabular-nums text-fg-muted">{{ rupees(row.gross) }}</span></template>
              <template #cell-deductions="{ row }"><span class="tabular-nums text-fg-muted">{{ rupees(row.totalDeductions) }}</span></template>
              <template #cell-net="{ row }"><span class="font-medium tabular-nums" :class="row.netPay < 0 && 'text-red-600'">{{ rupees(row.netPay) }}</span></template>
              <template #cell-flags="{ row }">
                <div class="flex justify-end gap-1">
                  <AppBadge v-if="row.excluded" tone="warning" size="sm">Held</AppBadge>
                  <AppBadge v-if="row.warnings.some(isBlocking)" tone="danger" size="sm">Problem</AppBadge>
                  <AppBadge v-else-if="row.warnings.length" size="sm" :title="row.warnings.join('\n')"><AlertTriangle :size="11" aria-hidden="true" />{{ row.warnings.length }}</AppBadge>
                </div>
              </template>
            </AppDataTable>
          </AppCard>
        </AppTabs>

        <div class="grid gap-6 md:grid-cols-2 2xl:grid-cols-1">
          <AppCard title="Totals by component">
            <p v-if="!r.summary.earnings.length" class="text-sm text-fg-muted">Nothing calculated yet.</p>
            <template v-else>
              <p class="mb-1 text-xs font-medium tracking-wide text-fg-muted uppercase">Earnings</p>
              <dl class="mb-3 space-y-1 text-sm">
                <div v-for="l in r.summary.earnings" :key="l.code" class="flex justify-between gap-3"><dt class="truncate text-fg-muted">{{ l.name }}</dt><dd class="tabular-nums">{{ rupees(l.amount) }}</dd></div>
              </dl>
              <p class="mb-1 text-xs font-medium tracking-wide text-fg-muted uppercase">Deductions</p>
              <dl class="mb-3 space-y-1 text-sm">
                <div v-for="l in r.summary.deductions" :key="l.code" class="flex justify-between gap-3"><dt class="truncate text-fg-muted">{{ l.name }}</dt><dd class="tabular-nums">{{ rupees(l.amount) }}</dd></div>
              </dl>
              <template v-if="r.summary.employerContributions.length">
                <p class="mb-1 text-xs font-medium tracking-wide text-fg-muted uppercase">Employer</p>
                <dl class="space-y-1 text-sm">
                  <div v-for="l in r.summary.employerContributions" :key="l.code" class="flex justify-between gap-3"><dt class="truncate text-fg-muted">{{ l.name }}</dt><dd class="tabular-nums">{{ rupees(l.amount) }}</dd></div>
                </dl>
              </template>
            </template>
          </AppCard>
          <AppCard title="History">
            <ol class="space-y-2 text-sm">
              <li v-if="r.calculatedAt"><span class="text-fg">Calculated</span> <span class="text-fg-muted">by {{ r.calculatedBy }} · {{ formatDateTime(r.calculatedAt) }}</span></li>
              <li v-if="r.submittedAt"><span class="text-fg">Submitted</span> <span class="text-fg-muted">by {{ r.submittedBy }} · {{ formatDateTime(r.submittedAt) }}</span></li>
              <li v-if="r.reviewedAt"><span class="text-fg">{{ r.status === 'DRAFT' ? 'Sent back' : 'Approved' }}</span> <span class="text-fg-muted">by {{ r.reviewedBy }} · {{ formatDateTime(r.reviewedAt) }}</span></li>
              <li v-if="r.paidAt"><span class="text-fg">Paid</span> <span class="text-fg-muted">by {{ r.paidBy }} · {{ formatDateTime(r.paidAt) }}</span></li>
            </ol>
          </AppCard>
        </div>
      </div>

      <AppModal :open="!!decision" :title="decision === 'approve' ? `Approve payroll for ${r.period}?` : 'Send back for changes'" :description="decision === 'approve' ? `${r.employeeCount} employees, net pay ${rupees(r.totalNet)}. Payslips are published to employees.` : undefined" size="sm" @close="decision = null">
        <AppTextarea v-model="note" :label="decision === 'approve' ? 'Note (optional)' : 'What needs to change?'" :required="decision === 'reject'" :rows="3" :maxlength="500" />
        <template #footer>
          <AppButton variant="secondary" @click="decision = null">Back</AppButton>
          <AppButton :variant="decision === 'approve' ? 'primary' : 'danger'" :disabled="decision === 'reject' && note.trim().length < 3" @click="decide">{{ decision === 'approve' ? 'Approve' : 'Send back' }}</AppButton>
        </template>
      </AppModal>

      <AppModal :open="payOpen" title="Mark as paid" description="Record how the salaries were paid (e.g. the bank batch or UTR reference). Approved reimbursements in this run are marked paid too." size="sm" @close="payOpen = false">
        <AppInput v-model="paymentReference" label="Payment reference" required :maxlength="100" placeholder="NEFT batch 2026-11-30" />
        <template #footer>
          <AppButton variant="secondary" @click="payOpen = false">Cancel</AppButton>
          <AppButton :icon="Wallet" :disabled="paymentReference.trim().length < 2" @click="pay">Mark as paid</AppButton>
        </template>
      </AppModal>

      <AppModal :open="slipLoading || !!slip" :title="slip ? `${slip.employee.name} · ${slip.period}` : 'Payslip'" size="xl" @close="slip = null; slipLoading = false">
        <AppSkeleton v-if="slipLoading" :lines="10" />
        <div v-else-if="slip" class="grid gap-6 lg:grid-cols-[1fr_280px]">
          <div class="min-w-0">
            <ul v-if="slip.warnings.length" class="mb-4 space-y-1">
              <li v-for="w in slip.warnings" :key="w" class="flex items-start gap-2 text-sm" :class="isBlocking(w) ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-300'">
                <AlertTriangle :size="14" class="mt-0.5 shrink-0" aria-hidden="true" />{{ warningText(w) }}
              </li>
            </ul>
            <PayslipView :payslip="slip" />
          </div>
          <div class="space-y-5">
            <template v-if="r.permissions.process">
              <section class="space-y-2">
                <h3 class="text-sm font-semibold text-fg">Loss of pay</h3>
                <p class="text-xs text-fg-muted">From {{ r.attendance.lopFromAttendance ? 'attendance and unpaid leave' : 'unpaid leave' }}: {{ slip.lopDays }} day{{ slip.lopDays === 1 ? '' : 's' }}.</p>
                <AppInput v-model="edit.lop" label="Override (days)" type="number" :min="0" :max="slip.employedDays" placeholder="Use the calculated days" help="Whole or half days." />
                <div class="flex gap-2">
                  <AppButton size="sm" :loading="busy === 'lop'" @click="saveLop">Save</AppButton>
                  <AppButton v-if="slip.lopOverride !== null" size="sm" variant="ghost" :icon="Undo2" @click="edit.lop = ''; saveLop()">Use calculated</AppButton>
                </div>
              </section>
              <section class="space-y-2 border-t border-line pt-4">
                <h3 class="text-sm font-semibold text-fg">One-time adjustments</h3>
                <ul v-if="slip.adjustments.length" class="space-y-1 text-sm">
                  <li v-for="a in slip.adjustments" :key="a.id" class="flex items-center justify-between gap-2">
                    <span class="min-w-0 truncate">{{ a.kind === 'EARNING' ? '+' : '−' }} {{ a.label }} <span class="text-fg-muted tabular-nums">{{ rupees(a.amount) }}</span></span>
                    <AppButton size="xs" variant="ghost" :icon="Trash2" :aria-label="`Remove ${a.label}`" :loading="busy === `adj-${a.id}`" @click="removeAdjustment(a.id)" />
                  </li>
                </ul>
                <AppSelect v-model="adj.kind" label="Type" :options="[{ value: 'EARNING', label: 'Earning (bonus, arrears…)' }, { value: 'DEDUCTION', label: 'Deduction (recovery, advance…)' }]" :clearable="false" />
                <AppInput v-model="adj.label" label="Description" :maxlength="100" placeholder="e.g. Performance bonus" />
                <AppInput v-model="adj.amount" label="Amount (₹)" type="number" :min="1" />
                <AppCheckbox v-if="adj.kind === 'EARNING'" v-model="adj.taxable" label="Taxable" />
                <AppButton size="sm" variant="secondary" :icon="Plus" :loading="busy === 'adj'" :disabled="adj.label.trim().length < 2 || !(Number(adj.amount) > 0)" @click="addAdjustment">Add</AppButton>
              </section>
              <section class="space-y-2 border-t border-line pt-4">
                <h3 class="text-sm font-semibold text-fg">Hold salary</h3>
                <AppCheckbox v-model="edit.held" label="Leave out of this run" description="Nothing is paid or published for this employee this month." />
                <AppInput v-if="edit.held" v-model="edit.reason" label="Reason" required :maxlength="300" />
                <AppButton size="sm" variant="secondary" :loading="busy === 'hold'" :disabled="edit.held === slip.excluded || (edit.held && edit.reason.trim().length < 3)" @click="saveHold">Save</AppButton>
              </section>
            </template>
            <AppAlert v-else-if="slip.excluded" tone="warning" title="Held">{{ slip.excludeReason }}</AppAlert>
          </div>
        </div>
      </AppModal>
    </template>
  </div>
</template>
