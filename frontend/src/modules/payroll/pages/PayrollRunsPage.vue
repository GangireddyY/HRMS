<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, CalendarClock, Calculator, Info, LineChart, Play, ReceiptText, Send, Wallet } from '@lucide/vue';
import type { PayrollRunStatus } from '@contracts';
import { financialYearLabel, financialYearOf } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import RunStepper from '@/modules/payroll/components/RunStepper.vue';
import type { PayrollRun } from '@/modules/payroll/types';
import { MONTH_NAMES, RUN_STATUS_LABELS, rupees, runTone } from '@/modules/payroll/utils/payroll-format';
import { change, monthIndex, previousRun } from '@/modules/payroll/utils/run-compare';
import { AppAlert, AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppSparkline, AppStatStrip, AppTextarea, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Payroll runs: the cycle in progress and what it needs next, totals by status (also a filter), the net pay trend and every run. */
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canProcess = computed(() => auth.can('payroll.process'));
const table = useTable((q) => payrollApi.runs(q), { filters: { status: undefined as PayrollRunStatus | undefined } });
/** Every run: summary, comparisons and the trend don't depend on the table's page or filter. */
const all = useAsync(() => fetchAllPages((page, pageSize) => payrollApi.runs({ page, pageSize })));
const runs = computed(() => all.data.value ?? []);
const counted = computed(() => runs.value.filter((r) => r.status !== 'CANCELLED'));

const now = new Date();
/** The current month and the eleven before it. */
const monthOptions = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
  return { value: `${d.getFullYear()}-${d.getMonth() + 1}`, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` };
});
const createOpen = ref(false);
const period = ref<string | null>(monthOptions[0]!.value);
const notes = ref('');
const creating = ref(false);
const { formError, handle, reset } = useFormErrors();
function openCreate(preset?: string) {
  reset();
  notes.value = '';
  if (preset && monthOptions.some((o) => o.value === preset)) period.value = preset;
  createOpen.value = true;
}
async function create() {
  reset();
  creating.value = true;
  const [year, month] = period.value!.split('-').map(Number) as [number, number];
  try {
    const run = await payrollApi.createRun({ year, month, notes: notes.value || null });
    createOpen.value = false;
    feedback.success(`Payroll for ${run.period} started`, run.calculatedAt ? `${run.employeeCount} employees calculated.` : undefined);
    await router.push(`/hr/payroll/runs/${run.id}`);
  } catch (e) {
    handle(e, 'Could not start the payroll');
  } finally {
    creating.value = false;
  }
}

// ---- Current cycle ---------------------------------------------------------------------------------------------
/** The open run furthest along the year (draft, waiting for approval or approved but not paid). */
const open = computed(() => counted.value.filter((r) => r.status !== 'PAID').sort((a, b) => monthIndex(b) - monthIndex(a))[0] ?? null);
const lastPaid = computed(() => counted.value.filter((r) => r.status === 'PAID').sort((a, b) => monthIndex(b) - monthIndex(a))[0] ?? null);
/** The month after the latest run; this month when there's none. */
const nextMonth = computed(() => {
  const latest = [...counted.value].sort((a, b) => monthIndex(b) - monthIndex(a))[0];
  const d = latest ? new Date(latest.year, latest.month, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  return { value: `${d.getFullYear()}-${d.getMonth() + 1}`, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`, startable: monthOptions.some((o) => o.value === `${d.getFullYear()}-${d.getMonth() + 1}`) };
});
const NEXT_STEP: Record<PayrollRunStatus, { text: string; icon: typeof Send }> = {
  DRAFT: { text: 'Calculate, review and submit for approval', icon: Calculator },
  SUBMITTED: { text: 'Waiting for an approver; payslips are published on approval', icon: BadgeCheck },
  APPROVED: { text: 'Transfer the salaries, then mark the run as paid', icon: Wallet },
  PAID: { text: 'Done', icon: BadgeCheck },
  CANCELLED: { text: 'Cancelled', icon: BadgeCheck },
};
const openChange = computed(() => {
  const r = open.value;
  const prev = r && r.calculatedAt ? previousRun(runs.value, r) : null;
  return r && prev ? { ...change(r.totalNet, prev.totalNet), period: prev.period } : null;
});

// ---- Summary strip (doubles as the status filter) --------------------------------------------------------------
const fy = financialYearOf(now.getFullYear(), now.getMonth() + 1);
const strip = computed<StripItem[]>(() => {
  const by = (s: PayrollRunStatus) => counted.value.filter((r) => r.status === s);
  const paidFy = by('PAID').filter((r) => financialYearOf(r.year, r.month) === fy);
  return [
    { key: 'DRAFT', label: 'In progress', value: by('DRAFT').length, tone: 'neutral', hint: by('DRAFT').length ? by('DRAFT').map((r) => r.period).join(', ') : 'No drafts' },
    { key: 'SUBMITTED', label: 'Awaiting approval', value: by('SUBMITTED').length, tone: 'warning', hint: by('SUBMITTED').length ? `${rupees(by('SUBMITTED').reduce((n, r) => n + r.totalNet, 0))} net` : 'Nothing waiting' },
    { key: 'APPROVED', label: 'Approved · to pay', value: by('APPROVED').length, tone: 'info', hint: by('APPROVED').length ? `${rupees(by('APPROVED').reduce((n, r) => n + r.totalNet, 0))} to transfer` : 'Nothing to pay' },
    { key: 'PAID', label: `Paid · ${financialYearLabel(fy)}`, value: paidFy.length, tone: 'success', hint: paidFy.length ? `${rupees(paidFy.reduce((n, r) => n + r.totalNet, 0))} net pay` : 'No runs paid yet' },
  ];
});
const selectStatus = (key: string | null) => (table.filters.status = (key as PayrollRunStatus | null) ?? undefined);

// ---- Trend -----------------------------------------------------------------------------------------------------
const trend = computed(() => counted.value.filter((r) => r.calculatedAt).sort((a, b) => monthIndex(a) - monthIndex(b)).slice(-12));
const trendStats = computed(() => {
  const v = trend.value.map((r) => r.totalNet);
  if (v.length < 2) return null;
  return { high: Math.max(...v), low: Math.min(...v), average: Math.round(v.reduce((n, x) => n + x, 0) / v.length), from: trend.value[0]!.period, to: trend.value.at(-1)!.period };
});

// ---- Table -----------------------------------------------------------------------------------------------------
const columns: TableColumn<PayrollRun>[] = [
  { key: 'period', label: 'Month' },
  { key: 'status', label: 'Status' },
  { key: 'employees', label: 'Employees', align: 'right' },
  { key: 'gross', label: 'Gross', align: 'right' },
  { key: 'net', label: 'Net pay', align: 'right' },
  { key: 'updated', label: 'Last step' },
];
const tile = (r: PayrollRun) => ({ month: new Date(r.year, r.month - 1, 1).toLocaleDateString(appLocale(), { month: 'short' }), year: r.year });
const rowChange = (r: PayrollRun) => {
  if (!r.calculatedAt || r.status === 'CANCELLED') return null;
  const prev = previousRun(runs.value, r);
  return prev?.calculatedAt ? change(r.totalNet, prev.totalNet) : null;
};
const lastStep = (r: PayrollRun) =>
  r.paidAt
    ? { text: `Paid by ${r.paidBy ?? '—'}`, at: r.paidAt }
    : r.reviewedAt && r.status === 'APPROVED'
      ? { text: `Approved by ${r.reviewedBy ?? '—'}`, at: r.reviewedAt }
      : r.submittedAt && r.status === 'SUBMITTED'
        ? { text: `Submitted by ${r.submittedBy ?? '—'}`, at: r.submittedAt }
        : r.calculatedAt
          ? { text: `Calculated${r.calculatedBy ? ` by ${r.calculatedBy}` : ''}`, at: r.calculatedAt }
          : { text: 'Created', at: r.createdAt };
const HOW = [
  { icon: Play, title: 'Start the month', text: 'Everyone with a salary who was employed during the month is included.' },
  { icon: Calculator, title: 'Calculate & review', text: 'Check loss of pay and warnings, add one-time adjustments or hold a salary.' },
  { icon: Send, title: 'Submit for approval', text: 'Someone other than you approves; payslips are published then.' },
  { icon: Wallet, title: 'Pay', text: 'Download the bank file, transfer the salaries and record the payment reference.' },
];
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Payroll runs" description="Monthly payroll: calculate, review and hold or adjust payslips, then send for approval. Someone else approves; payslips are published on approval.">
      <template v-if="canProcess" #actions><AppButton :icon="Play" @click="openCreate()">Run payroll</AppButton></template>
    </AppPageHeader>

    <!-- Current cycle -->
    <AppSkeleton v-if="all.loading.value && !all.data.value" :lines="4" />
    <section v-else-if="open" class="card overflow-hidden" aria-labelledby="cycle-title">
      <div class="flex flex-wrap items-start gap-4 p-5">
        <div class="flex w-16 shrink-0 flex-col items-center rounded-xl bg-accent-soft py-2 ring-1 ring-brand-500/15 ring-inset" aria-hidden="true">
          <span class="text-2xs font-semibold text-accent-fg uppercase">{{ tile(open).month }}</span>
          <span class="text-lg leading-6 font-semibold text-fg tabular-nums">{{ tile(open).year }}</span>
        </div>
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-2 text-xs font-medium text-fg-muted">
            Payroll in progress <AppBadge :tone="runTone[open.status]" size="sm" dot>{{ open.status === 'DRAFT' && open.reviewNote ? 'Sent back' : RUN_STATUS_LABELS[open.status] }}</AppBadge>
          </p>
          <h2 id="cycle-title" class="mt-0.5 text-lg font-semibold text-fg">{{ open.period }}</h2>
          <p class="mt-0.5 inline-flex items-center gap-1.5 text-sm text-fg-muted">
            <component :is="NEXT_STEP[open.status].icon" :size="14" class="text-accent-fg" aria-hidden="true" />{{ open.status === 'DRAFT' && !open.calculatedAt ? 'Not calculated yet — calculate the payslips to review them' : NEXT_STEP[open.status].text }}
          </p>
        </div>
        <dl v-if="open.calculatedAt" class="flex flex-wrap gap-x-6 gap-y-2 text-end">
          <div><dt class="text-2xs text-fg-subtle">Employees</dt><dd class="text-sm font-semibold text-fg tabular-nums">{{ open.employeeCount }}</dd></div>
          <div><dt class="text-2xs text-fg-subtle">Gross</dt><dd class="text-sm font-semibold text-fg tabular-nums">{{ rupees(open.totalGross) }}</dd></div>
          <div>
            <dt class="text-2xs text-fg-subtle">Net pay</dt>
            <dd class="text-sm font-semibold text-fg tabular-nums">{{ rupees(open.totalNet) }}</dd>
            <dd v-if="openChange && openChange.direction !== 'same'" :class="['inline-flex items-center gap-0.5 text-2xs font-medium tabular-nums', openChange.direction === 'up' ? 'text-warning-fg' : 'text-success-fg']">
              <component :is="openChange.direction === 'up' ? ArrowUpRight : ArrowDownRight" :size="11" aria-hidden="true" />{{ openChange.pct }}% vs {{ openChange.period }}
            </dd>
          </div>
        </dl>
        <AppButton :icon-right="ArrowRight" :to="`/hr/payroll/runs/${open.id}`">Open run</AppButton>
      </div>
      <div class="border-t border-line/70 bg-surface-muted/40 px-5 py-4"><RunStepper :run="open" /></div>
    </section>
    <section v-else class="card overflow-hidden" aria-labelledby="cycle-title">
      <div class="flex flex-wrap items-center gap-5 bg-gradient-to-r from-brand-500/10 via-transparent to-sky-500/10 p-5">
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface text-accent-fg shadow-xs ring-1 ring-line" aria-hidden="true"><CalendarClock :size="22" /></span>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium text-fg-muted">Next payroll</p>
          <h2 id="cycle-title" class="text-lg font-semibold text-fg">{{ nextMonth.label }} <span class="text-sm font-normal text-fg-muted">· not started</span></h2>
          <p class="text-sm text-fg-muted">
            <template v-if="lastPaid">Last run {{ lastPaid.period }}: {{ rupees(lastPaid.totalNet) }} net to {{ lastPaid.employeeCount }} employees<template v-if="lastPaid.paidAt">, paid {{ formatDate(lastPaid.paidAt) }}</template>.</template>
            <template v-else>Set everyone's salary, then run payroll for the month. Nothing is paid or published until it's approved.</template>
          </p>
        </div>
        <AppButton v-if="canProcess" :icon="Play" @click="openCreate(nextMonth.startable ? nextMonth.value : undefined)">Run {{ nextMonth.startable ? MONTH_NAMES[Number(nextMonth.value.split('-')[1]) - 1] : '' }} payroll</AppButton>
      </div>
    </section>

    <AppStatStrip :items="strip" :loading="all.loading.value && !all.data.value" selectable :selected="table.filters.status ?? null" label="Payroll runs by status" @select="selectStatus" />

    <div class="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <AppCard :padded="false" :title="table.filters.status ? `${RUN_STATUS_LABELS[table.filters.status]} runs` : 'All runs'" :icon="ReceiptText" description="Open a run to review payslips, approve or download the bank and PF files.">
        <template v-if="table.filters.status" #actions><AppButton size="sm" variant="ghost" @click="selectStatus(null)">Show all</AppButton></template>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          clickable
          caption="Payroll runs"
          empty-title="No payroll runs yet"
          empty-description="Set everyone's salary, then run payroll for a month."
          :filtered="table.isFiltered.value"
          @page="table.setPage"
          @retry="table.load"
          @row-click="(row) => router.push(`/hr/payroll/runs/${row.id}`)"
          @clear="table.clearFilters()"
        >
          <template #empty><AppButton v-if="canProcess" :icon="Play" @click="openCreate()">Run payroll</AppButton></template>
          <template #cell-period="{ row }">
            <div class="flex items-center gap-3">
              <div class="flex w-11 shrink-0 flex-col items-center rounded-lg bg-surface-muted py-1 ring-1 ring-line/60 ring-inset" aria-hidden="true">
                <span class="text-2xs leading-4 font-semibold text-accent-fg uppercase">{{ tile(row).month }}</span>
                <span class="text-xs leading-4 font-semibold text-fg tabular-nums">{{ tile(row).year }}</span>
              </div>
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.period }}</p>
                <p v-if="row.warningCount && row.status === 'DRAFT'" class="text-2xs text-warning-fg">{{ row.warningCount }} warning{{ row.warningCount === 1 ? '' : 's' }}</p>
              </div>
            </div>
          </template>
          <template #cell-status="{ row }">
            <div class="space-y-1.5">
              <AppBadge :tone="runTone[row.status]" dot>{{ row.status === 'DRAFT' && row.reviewNote ? 'Sent back' : RUN_STATUS_LABELS[row.status] }}</AppBadge>
              <RunStepper v-if="row.status !== 'CANCELLED'" :run="row" compact class="max-md:justify-end" />
            </div>
          </template>
          <template #cell-employees="{ row }"><span class="tabular-nums">{{ row.calculatedAt ? row.employeeCount : '—' }}</span></template>
          <template #cell-gross="{ row }"><span class="text-fg-muted tabular-nums">{{ row.calculatedAt ? rupees(row.totalGross) : '—' }}</span></template>
          <template #cell-net="{ row }">
            <p class="font-semibold tabular-nums">{{ row.calculatedAt ? rupees(row.totalNet) : '—' }}</p>
            <p v-if="rowChange(row)" :class="['inline-flex items-center gap-0.5 text-2xs tabular-nums', rowChange(row)!.direction === 'same' ? 'text-fg-subtle' : 'text-fg-muted']">
              <component :is="rowChange(row)!.direction === 'up' ? ArrowUpRight : ArrowDownRight" v-if="rowChange(row)!.direction !== 'same'" :size="11" aria-hidden="true" />
              {{ rowChange(row)!.direction === 'same' ? 'No change' : `${rowChange(row)!.pct}% vs last month` }}
            </p>
          </template>
          <template #cell-updated="{ row }">
            <p class="text-xs text-fg">{{ lastStep(row).text }}</p>
            <p class="text-2xs text-fg-subtle">{{ timeAgo(lastStep(row).at) }}</p>
          </template>
        </AppDataTable>
      </AppCard>

      <aside class="space-y-4">
        <AppCard title="Net pay trend" :icon="LineChart" :description="trendStats ? `${trendStats.from} – ${trendStats.to}` : 'Month by month'">
          <template v-if="trendStats">
            <AppSparkline :values="trend.map((r) => r.totalNet)" tone="brand" :height="56" />
            <dl class="mt-3 grid grid-cols-3 gap-2 text-center">
              <div><dt class="text-2xs text-fg-muted">Highest</dt><dd class="text-sm font-semibold text-fg tabular-nums">{{ rupees(trendStats.high) }}</dd></div>
              <div><dt class="text-2xs text-fg-muted">Average</dt><dd class="text-sm font-semibold text-fg tabular-nums">{{ rupees(trendStats.average) }}</dd></div>
              <div><dt class="text-2xs text-fg-muted">Lowest</dt><dd class="text-sm font-semibold text-fg tabular-nums">{{ rupees(trendStats.low) }}</dd></div>
            </dl>
          </template>
          <div v-else class="flex items-center gap-3 rounded-lg bg-surface-muted/60 px-3 py-3">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface text-fg-subtle ring-1 ring-line ring-inset" aria-hidden="true"><LineChart :size="15" /></span>
            <p class="text-xs text-fg-muted">The trend appears once two months have been calculated.</p>
          </div>
        </AppCard>

        <AppCard title="How a payroll run works" :icon="Info">
          <ol class="space-y-4">
            <li v-for="(s, i) in HOW" :key="s.title" class="relative flex gap-3">
              <span v-if="i < HOW.length - 1" class="absolute start-3.5 top-8 -bottom-4 w-px bg-line" aria-hidden="true" />
              <span class="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-fg ring-4 ring-surface" aria-hidden="true"><component :is="s.icon" :size="14" /></span>
              <div>
                <p class="text-sm font-medium text-fg">{{ s.title }}</p>
                <p class="text-xs text-fg-muted">{{ s.text }}</p>
              </div>
            </li>
          </ol>
        </AppCard>
      </aside>
    </div>

    <AppModal :open="createOpen" title="Run payroll" description="Everyone employed during the month with a salary is included. Loss of pay comes from unpaid leave (and attendance, if enabled)." size="sm" @close="createOpen = false">
      <div class="space-y-4">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppSelect v-model="period" label="Month" :options="monthOptions" :clearable="false" />
        <AppTextarea v-model="notes" label="Notes" :rows="2" :maxlength="500" placeholder="Optional" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="createOpen = false">Cancel</AppButton>
        <AppButton :icon="Play" :loading="creating" :disabled="!period" @click="create">Start</AppButton>
      </template>
    </AppModal>
  </div>
</template>
