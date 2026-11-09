<script setup lang="ts">
import { computed, reactive, ref, watch, type Component } from 'vue';
import { useRoute } from 'vue-router';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  BadgeCheck,
  Calculator,
  CalendarCheck,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  History,
  Landmark,
  Lock,
  PauseCircle,
  PieChart,
  Plus,
  Send,
  Trash2,
  Undo2,
  Users,
  Wallet,
  X,
} from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import PaySplitBar, { type PaySegment } from '@/modules/payroll/components/PaySplitBar.vue';
import PayslipView from '@/modules/payroll/components/PayslipView.vue';
import RunStepper from '@/modules/payroll/components/RunStepper.vue';
import type { PayrollRunDetail, PayslipDetail, PayslipLine, PayslipSummary } from '@/modules/payroll/types';
import { isBlocking, RUN_STATUS_LABELS, rupees, runTone, warningText } from '@/modules/payroll/utils/payroll-format';
import { change } from '@/modules/payroll/utils/run-compare';
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
  AppTabs,
  AppTextarea,
  type TableColumn,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

/** One payroll run: where it is in the workflow, totals against the month before, every payslip (review, hold, adjust) and the files. */
const route = useRoute();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const run = useAsync(() => payrollApi.run(id.value));
const r = computed(() => run.data.value);
const filter = ref('all');
const filterTabs = computed(() => [
  { key: 'all', label: 'All payslips', icon: Users, count: (r.value?.employeeCount ?? 0) + (r.value?.summary.held ?? 0) },
  { key: 'warnings', label: 'With warnings', icon: AlertTriangle, count: r.value?.calculatedAt ? r.value.warningCount : null },
  { key: 'held', label: 'Held', icon: PauseCircle, count: r.value?.summary.held ?? 0 },
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

// ---- Totals against the month before -----------------------------------------------------------------------------
/** The previous month's run (if it was calculated), for the variance; the page works without it. */
const previous = useAsync(
  async () => {
    const x = r.value!;
    const year = x.month === 1 ? x.year - 1 : x.year;
    const month = x.month === 1 ? 12 : x.month - 1;
    const page = await payrollApi.runs({ year, pageSize: 20 });
    return page.items.find((p) => p.month === month && p.status !== 'CANCELLED' && p.calculatedAt) ?? null;
  },
  { immediate: false },
);
watch(
  () => r.value?.id,
  (runId) => {
    if (runId) void previous.run();
  },
  { immediate: true },
);
const prev = computed(() => (previous.data.value && r.value && previous.data.value.id !== r.value.id ? previous.data.value : null));
const employerCost = (x: { totalGross: number; totalEmployerContributions: number }) => x.totalGross + x.totalEmployerContributions;
const totals = computed(() => {
  const x = r.value;
  if (!x) return [];
  const p = prev.value;
  return [
    { key: 'gross', label: 'Gross pay', value: x.totalGross, dot: 'bg-line-strong', hint: 'Earnings before deductions', change: p ? change(x.totalGross, p.totalGross) : null },
    { key: 'deductions', label: 'Deductions', value: x.totalDeductions, dot: 'bg-amber-400 dark:bg-amber-500', hint: x.totalGross ? `${pct(x.totalDeductions, x.totalGross)} of gross` : '', change: p ? change(x.totalDeductions, p.totalDeductions) : null },
    { key: 'net', label: 'Net pay', value: x.totalNet, dot: 'bg-brand-500', hint: 'Transferred to employees', change: p ? change(x.totalNet, p.totalNet) : null, strong: true },
    { key: 'cost', label: 'Employer cost', value: employerCost(x), dot: 'bg-violet-500', hint: `Gross + ${rupees(x.totalEmployerContributions)} employer contributions`, change: p ? change(employerCost(x), employerCost(p)) : null },
  ];
});
const pct = (part: number, whole: number) => {
  const v = whole ? (part / whole) * 100 : 0;
  return v > 0 && v < 1 ? '<1%' : `${Math.round(v)}%`;
};
const DEDUCTION_COLORS = ['bg-amber-400 dark:bg-amber-500', 'bg-orange-400 dark:bg-orange-500', 'bg-rose-400 dark:bg-rose-500', 'bg-yellow-400 dark:bg-yellow-500', 'bg-red-400 dark:bg-red-500'];
const EARNING_COLORS = ['bg-brand-500', 'bg-sky-500', 'bg-teal-500', 'bg-indigo-400', 'bg-emerald-400', 'bg-cyan-400'];
const split = computed<PaySegment[]>(() => {
  const x = r.value;
  if (!x) return [];
  const deductions = x.summary.deductions.length
    ? x.summary.deductions.map((d, i) => ({ key: `d-${d.code}-${i}`, label: d.name, amount: d.amount, color: DEDUCTION_COLORS[i % DEDUCTION_COLORS.length]! }))
    : [{ key: 'deductions', label: 'Deductions', amount: x.totalDeductions, color: DEDUCTION_COLORS[0]! }];
  return [{ key: 'net', label: 'Net pay', amount: x.totalNet, color: 'bg-brand-500' }, ...deductions];
});
const groups = computed(() => {
  const x = r.value;
  if (!x) return [];
  const g = (key: string, label: string, lines: PayslipLine[], colors: string[]) => {
    const total = lines.reduce((n, l) => n + l.amount, 0);
    return { key, label, total, lines: lines.map((l, i) => ({ ...l, share: total ? (l.amount / total) * 100 : 0, color: colors[i % colors.length]! })) };
  };
  return [g('earnings', 'Earnings', x.summary.earnings, EARNING_COLORS), g('deductions', 'Deductions', x.summary.deductions, DEDUCTION_COLORS), g('employer', 'Employer contributions', x.summary.employerContributions, ['bg-violet-500', 'bg-fuchsia-400', 'bg-purple-400'])].filter(
    (x) => x.lines.length,
  );
});

// ---- Side panel -------------------------------------------------------------------------------------------------
const tile = computed(() => (r.value ? { month: new Date(r.value.year, r.value.month - 1, 1).toLocaleDateString(appLocale(), { month: 'short' }), year: r.value.year } : null));
const approved = computed(() => r.value?.status === 'APPROVED' || r.value?.status === 'PAID');
const exportsList = computed(() => {
  const x = r.value;
  if (!x) return [];
  return [
    { key: 'register', icon: FileSpreadsheet, label: 'Payroll register', hint: 'Every payslip line, CSV', available: true, run: () => payrollApi.downloadRegister(x.id) },
    { key: 'ecr', icon: FileText, label: 'PF return (ECR)', hint: approved.value ? 'For the EPFO portal, TXT' : 'Available once approved', available: approved.value, run: () => payrollApi.downloadPfEcr(x.id) },
    ...(auth.can('payroll.disburse')
      ? [{ key: 'bank', icon: Landmark, label: 'Bank transfer file', hint: approved.value ? 'Salary transfers, CSV' : 'Available once approved', available: approved.value, run: () => payrollApi.downloadBankFile(x.id) }]
      : []),
  ];
});
interface RunEvent {
  key: string;
  icon: Component;
  label: string;
  by: string | null;
  at: string;
  tone: string;
  note?: string | null;
}
const events = computed<RunEvent[]>(() => {
  const x = r.value;
  if (!x) return [];
  const list: RunEvent[] = [{ key: 'created', icon: FilePlus2, label: 'Started', by: null, at: x.createdAt, tone: 'bg-surface-muted text-fg-muted' }];
  if (x.calculatedAt) list.push({ key: 'calc', icon: Calculator, label: 'Calculated', by: x.calculatedBy, at: x.calculatedAt, tone: 'bg-info-soft text-info-fg' });
  if (x.submittedAt) list.push({ key: 'submit', icon: Send, label: 'Submitted for approval', by: x.submittedBy, at: x.submittedAt, tone: 'bg-warning-soft text-warning-fg' });
  if (x.reviewedAt)
    list.push(
      x.status === 'DRAFT'
        ? { key: 'review', icon: Undo2, label: 'Sent back', by: x.reviewedBy, at: x.reviewedAt, tone: 'bg-danger-soft text-danger-fg', note: x.reviewNote }
        : { key: 'review', icon: BadgeCheck, label: 'Approved · payslips published', by: x.reviewedBy, at: x.reviewedAt, tone: 'bg-success-soft text-success-fg', note: x.reviewNote },
    );
  if (x.paidAt) list.push({ key: 'paid', icon: Wallet, label: 'Paid', by: x.paidBy, at: x.paidAt, tone: 'bg-success-soft text-success-fg', note: x.paymentReference ? `Reference ${x.paymentReference}` : null });
  return list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
});

// ---- Payslip dialog ---------------------------------------------------------------------------------------------
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
const lop = (row: PayslipSummary) => row.lopOverride ?? row.lopDays;
</script>

<template>
  <div>
    <AppSkeleton v-if="run.loading.value && !r" :lines="8" />
    <AppErrorState v-else-if="run.error.value" :error="run.error.value" title="Could not load the payroll run" @retry="run.run" />
    <template v-else-if="r">
      <AppPageHeader :title="`Payroll · ${r.period}`" :description="r.notes ?? undefined" back="/hr/payroll/runs" back-label="Payroll runs">
        <template #leading>
          <div v-if="tile" class="flex w-12 shrink-0 flex-col items-center rounded-xl bg-accent-soft py-1.5 ring-1 ring-brand-500/15 ring-inset max-sm:hidden" aria-hidden="true">
            <span class="text-2xs leading-4 font-semibold text-accent-fg uppercase">{{ tile.month }}</span>
            <span class="text-sm leading-5 font-semibold text-fg tabular-nums">{{ tile.year }}</span>
          </div>
        </template>
        <template #badges>
          <AppBadge :tone="r.status === 'DRAFT' && r.reviewNote ? 'danger' : runTone[r.status]" dot>{{ r.status === 'DRAFT' && r.reviewNote ? 'Sent back' : RUN_STATUS_LABELS[r.status] }}</AppBadge>
        </template>
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

      <div class="mb-4 space-y-3 empty:hidden">
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

      <!-- Workflow and totals -->
      <section class="card mb-4 overflow-hidden" aria-label="Run summary">
        <div v-if="r.status !== 'CANCELLED'" class="border-b border-line/70 bg-surface-muted/40 px-5 py-4"><RunStepper :run="r" /></div>
        <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div class="flex flex-col gap-4 p-5 lg:border-e lg:border-line/70">
            <div>
              <p class="text-xs font-medium text-fg-muted">Net pay · {{ r.period }}</p>
              <p class="mt-0.5 text-3xl font-semibold tracking-tight text-fg tabular-nums">{{ rupees(r.totalNet) }}</p>
              <p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                <span class="inline-flex items-center gap-1 tabular-nums"><Users :size="13" aria-hidden="true" />{{ r.employeeCount }} employee{{ r.employeeCount === 1 ? '' : 's' }} paid</span>
                <span v-if="r.summary.held" class="inline-flex items-center gap-1 text-warning-fg tabular-nums"><PauseCircle :size="13" aria-hidden="true" />{{ r.summary.held }} held</span>
                <span v-if="r.calculatedAt && r.warningCount" class="inline-flex items-center gap-1 text-warning-fg tabular-nums"><AlertTriangle :size="13" aria-hidden="true" />{{ r.warningCount }} with warnings</span>
              </p>
            </div>
            <div v-if="r.totalGross > 0">
              <div class="mb-2 flex items-baseline justify-between gap-3 text-xs text-fg-muted">
                <span>Where the gross pay goes</span>
                <span>Gross <span class="font-semibold text-fg tabular-nums">{{ rupees(r.totalGross) }}</span></span>
              </div>
              <PaySplitBar :segments="split" :label="`${r.period} gross pay`" size="lg" />
              <p class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" aria-hidden="true">
                <span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-sm bg-brand-500" />Net pay <span class="font-medium text-fg tabular-nums">{{ pct(r.totalNet, r.totalGross) }}</span></span>
                <span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-sm bg-amber-400 dark:bg-amber-500" />Deductions <span class="font-medium text-fg tabular-nums">{{ pct(r.totalDeductions, r.totalGross) }}</span></span>
              </p>
            </div>
            <p v-else class="rounded-lg bg-surface-muted/60 px-3 py-3 text-sm text-fg-muted">Totals appear once the payslips are calculated.</p>
          </div>
          <dl class="grid grid-cols-2 gap-px bg-line/70">
            <div v-for="t in totals" :key="t.key" :class="['flex flex-col gap-0.5 px-5 py-4', t.strong ? 'bg-accent-soft/50' : 'bg-surface']">
              <dt class="flex items-center gap-1.5 text-xs font-medium text-fg-muted"><span :class="['h-2 w-2 rounded-sm', t.dot]" aria-hidden="true" />{{ t.label }}</dt>
              <dd class="text-xl font-semibold tracking-tight text-fg tabular-nums">{{ rupees(t.value) }}</dd>
              <dd class="truncate text-2xs text-fg-subtle">{{ t.hint }}</dd>
              <dd v-if="t.change && prev" class="mt-1 text-2xs text-fg-muted tabular-nums">
                <span v-if="t.change.direction === 'same'">Same as {{ prev.period }}</span>
                <span v-else class="inline-flex items-center gap-0.5">
                  <component :is="t.change.direction === 'up' ? ArrowUpRight : ArrowDownRight" :size="12" :class="t.change.direction === 'up' ? 'text-warning-fg' : 'text-success-fg'" aria-hidden="true" />
                  <span class="font-medium text-fg">{{ t.change.diff > 0 ? '+' : '' }}{{ rupees(t.change.diff) }}</span> ({{ t.change.pct }}%) vs {{ prev.period }}
                </span>
              </dd>
            </div>
          </dl>
        </div>
        <p v-if="!prev && !previous.loading.value && r.calculatedAt" class="border-t border-line/70 px-5 py-2 text-2xs text-fg-subtle">No calculated run for the month before, so there's nothing to compare with yet.</p>
      </section>

      <div class="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div class="min-w-0">
          <AppTabs v-model="filter" :tabs="filterTabs">
            <AppCard :padded="false">
              <div class="border-b border-line/70 p-3">
                <AppSearchInput v-model="table.search.value" placeholder="Search by name or employee code" aria-label="Search payslips" />
              </div>
              <AppDataTable
                :columns="columns"
                :rows="table.rows.value"
                :loading="table.loading.value"
                :error="table.error.value"
                :meta="table.meta.value"
                clickable
                caption="Payslips"
                :empty-title="filter === 'held' ? 'No salaries held' : filter === 'warnings' ? 'No warnings' : r.calculatedAt ? 'No payslips' : 'Not calculated yet'"
                :empty-description="filter === 'held' ? 'Open a payslip to hold a salary for this run.' : filter === 'warnings' ? 'Every payslip calculated cleanly.' : r.calculatedAt ? undefined : 'Recalculate to work out everyone\'s payslip.'"
                :filtered="table.isFiltered.value"
                @page="table.setPage"
                @retry="table.load"
                @row-click="openSlip"
                @clear="table.clearFilters()"
              >
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
                  <span class="tabular-nums">{{ row.payableDays }}<span class="text-fg-subtle">/{{ row.daysInMonth }}</span></span>
                  <p v-if="lop(row) > 0" class="text-2xs font-medium text-warning-fg tabular-nums">{{ lop(row) }} LOP{{ row.lopOverride !== null ? ' · edited' : '' }}</p>
                </template>
                <template #cell-gross="{ row }"><span class="text-fg-muted tabular-nums">{{ rupees(row.gross) }}</span></template>
                <template #cell-deductions="{ row }"><span class="text-fg-muted tabular-nums">{{ row.totalDeductions ? `− ${rupees(row.totalDeductions)}` : rupees(0) }}</span></template>
                <template #cell-net="{ row }"><span class="font-semibold tabular-nums" :class="row.netPay < 0 && 'text-danger-fg'">{{ rupees(row.netPay) }}</span></template>
                <template #cell-flags="{ row }">
                  <div class="flex justify-end gap-1">
                    <AppBadge v-if="row.excluded" tone="warning" size="sm" dot>Held</AppBadge>
                    <AppBadge v-if="row.warnings.some(isBlocking)" tone="danger" size="sm" dot>Problem</AppBadge>
                    <AppBadge v-else-if="row.warnings.length" tone="warning" size="sm" :title="row.warnings.map(warningText).join('\n')"><AlertTriangle :size="11" aria-hidden="true" />{{ row.warnings.length }}<span class="sr-only"> warning{{ row.warnings.length === 1 ? '' : 's' }}</span></AppBadge>
                  </div>
                </template>
              </AppDataTable>
            </AppCard>
          </AppTabs>
        </div>

        <aside class="space-y-4">
          <AppCard title="Totals by component" :icon="PieChart">
            <p v-if="!groups.length" class="text-sm text-fg-muted">Nothing calculated yet.</p>
            <div v-else class="space-y-4">
              <section v-for="g in groups" :key="g.key">
                <h3 class="mb-1.5 flex items-center justify-between text-2xs font-semibold tracking-wide text-fg-muted uppercase">
                  <span>{{ g.label }}</span><span class="tabular-nums normal-case">{{ rupees(g.total) }}</span>
                </h3>
                <ul class="space-y-2 text-sm">
                  <li v-for="l in g.lines" :key="l.code">
                    <div class="flex items-baseline justify-between gap-3">
                      <span class="truncate text-fg">{{ l.name }}</span>
                      <span class="shrink-0 text-fg tabular-nums">{{ rupees(l.amount) }}</span>
                    </div>
                    <div class="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                      <div :class="['h-full rounded-full', l.color]" :style="{ width: `${Math.max(2, l.share)}%` }" />
                    </div>
                  </li>
                </ul>
              </section>
            </div>
          </AppCard>

          <AppCard title="Files" :icon="Download" description="Downloads for payment and compliance">
            <ul class="-my-1 divide-y divide-line/60">
              <li v-for="f in exportsList" :key="f.key" class="flex items-center gap-3 py-2">
                <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1 ring-inset', f.available ? 'bg-accent-soft text-accent-fg ring-brand-500/15' : 'bg-surface-muted text-fg-subtle ring-line']" aria-hidden="true">
                  <component :is="f.available ? f.icon : Lock" :size="15" />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-fg">{{ f.label }}</p>
                  <p class="truncate text-2xs text-fg-muted">{{ f.hint }}</p>
                </div>
                <AppButton v-if="f.available" size="xs" variant="ghost" :icon="Download" :aria-label="`Download ${f.label}`" @click="download(f.run)" />
              </li>
            </ul>
          </AppCard>

          <AppCard title="Activity" :icon="History">
            <ol class="space-y-4">
              <li v-for="(e, i) in events" :key="e.key" class="relative flex gap-3">
                <span v-if="i < events.length - 1" class="absolute start-3.5 top-8 -bottom-4 w-px bg-line" aria-hidden="true" />
                <span :class="['relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-surface', e.tone]" aria-hidden="true"><component :is="e.icon" :size="14" /></span>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-fg">{{ e.label }}</p>
                  <p class="text-xs text-fg-muted" :title="formatDateTime(e.at)">{{ e.by ? `${e.by} · ` : '' }}{{ timeAgo(e.at) }}</p>
                  <p v-if="e.note" class="mt-1 rounded-md bg-surface-muted/70 px-2 py-1 text-xs text-fg-muted">{{ e.note }}</p>
                </div>
              </li>
            </ol>
            <p v-if="r.attendance.lopFromAttendance" class="mt-4 flex items-center gap-2 border-t border-line/70 pt-3 text-xs text-fg-muted">
              <CalendarCheck :size="14" :class="r.attendance.monthClosed ? 'text-success-fg' : 'text-warning-fg'" aria-hidden="true" />Attendance for the month {{ r.attendance.monthClosed ? 'is closed' : 'is still open' }}
            </p>
          </AppCard>
        </aside>
      </div>

      <AppModal :open="!!decision" :title="decision === 'approve' ? `Approve payroll for ${r.period}?` : 'Send back for changes'" :description="decision === 'approve' ? `${r.employeeCount} employees, net pay ${rupees(r.totalNet)}. Payslips are published to employees.` : undefined" size="sm" @close="decision = null">
        <AppTextarea v-model="note" :label="decision === 'approve' ? 'Note (optional)' : 'What needs to change?'" :required="decision === 'reject'" :rows="3" :maxlength="500" />
        <template #footer>
          <AppButton variant="secondary" @click="decision = null">Cancel</AppButton>
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
        <div v-else-if="slip" class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div class="min-w-0">
            <ul v-if="slip.warnings.length" class="mb-4 space-y-1.5 rounded-lg bg-warning-soft/60 px-3 py-2.5 ring-1 ring-warning/20 ring-inset">
              <li v-for="w in slip.warnings" :key="w" class="flex items-start gap-2 text-sm" :class="isBlocking(w) ? 'text-danger-fg' : 'text-warning-fg'">
                <AlertTriangle :size="14" class="mt-0.5 shrink-0" aria-hidden="true" />{{ warningText(w) }}
              </li>
            </ul>
            <PayslipView :payslip="slip" />
          </div>
          <div class="space-y-5">
            <AppButton block variant="secondary" :icon="ExternalLink" :to="`/hr/payroll/payslips/${slip.id}`">Open full payslip</AppButton>
            <template v-if="r.permissions.process">
              <section class="space-y-2 border-t border-line pt-4">
                <h3 class="flex items-center gap-2 text-sm font-semibold text-fg"><CalendarCheck :size="15" class="text-fg-muted" aria-hidden="true" />Loss of pay</h3>
                <p class="text-xs text-fg-muted">From {{ r.attendance.lopFromAttendance ? 'attendance and unpaid leave' : 'unpaid leave' }}: {{ slip.lopDays }} day{{ slip.lopDays === 1 ? '' : 's' }}.</p>
                <AppInput v-model="edit.lop" label="Override (days)" type="number" :min="0" :max="slip.employedDays" placeholder="Use the calculated days" help="Whole or half days." />
                <div class="flex gap-2">
                  <AppButton size="sm" :loading="busy === 'lop'" @click="saveLop">Save</AppButton>
                  <AppButton v-if="slip.lopOverride !== null" size="sm" variant="ghost" :icon="Undo2" @click="edit.lop = ''; saveLop()">Use calculated</AppButton>
                </div>
              </section>
              <section class="space-y-2 border-t border-line pt-4">
                <h3 class="flex items-center gap-2 text-sm font-semibold text-fg"><Plus :size="15" class="text-fg-muted" aria-hidden="true" />One-time adjustments</h3>
                <ul v-if="slip.adjustments.length" class="divide-y divide-line/60 rounded-lg text-sm ring-1 ring-line ring-inset">
                  <li v-for="a in slip.adjustments" :key="a.id" class="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <span class="min-w-0 truncate">
                      <span :class="a.kind === 'EARNING' ? 'text-success-fg' : 'text-danger-fg'">{{ a.kind === 'EARNING' ? '+' : '−' }}</span> {{ a.label }} <span class="text-fg-muted tabular-nums">{{ rupees(a.amount) }}</span>
                    </span>
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
                <h3 class="flex items-center gap-2 text-sm font-semibold text-fg"><PauseCircle :size="15" class="text-fg-muted" aria-hidden="true" />Hold salary</h3>
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
