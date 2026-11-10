<script setup lang="ts">
import { computed, reactive, ref, watch, type Component } from 'vue';
import { useRoute } from 'vue-router';
import { BadgeCheck, Ban, CalendarCheck, CalendarClock, Check, CheckCircle2, CircleCheck, FileCheck2, HandCoins, Landmark, ListChecks, ReceiptText, Send, Wallet, X, XCircle } from '@lucide/vue';
import type { LoanRepaymentSource, LoanType } from '@contracts';
import { loansApi } from '@/modules/payroll/api/payroll.api';
import type { LoanDetail } from '@/modules/payroll/types';
import { LOAN_STATUS_LABELS, LOAN_TYPE_LABELS, MONTH_NAMES, REPAYMENT_SOURCE_LABELS, loanEmi, loanTone, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppDatePicker, AppErrorState, AppInput, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';
import { localToday } from '@/shared/utils/dates';

/** One loan or advance: terms, repayments and the remaining schedule; HR actions depend on the caller's permissions. */
const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const hr = computed(() => route.path.startsWith('/hr'));
const loan = useAsync(() => loansApi.get(id.value));
watch(id, () => void loan.run());
const l = computed(() => loan.data.value);
const today = localToday();
const { fieldErrors, formError, handle, reset } = useFormErrors();
const busy = ref(false);
const modal = ref<'approve' | 'reject' | 'disburse' | 'defer' | 'repay' | null>(null);

// Months payroll can still deduct from (first open month and the next twelve).
const months = ref<{ value: string; label: string }[]>([]);
async function loadMonths() {
  if (months.value.length) return;
  const first = await loansApi.firstMonth();
  months.value = Array.from({ length: 13 }, (_, i) => {
    const index = first.year * 12 + first.month - 1 + i;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    return { value: `${y}-${m}`, label: `${MONTH_NAMES[m - 1]} ${y}` };
  });
}
const parseMonth = (v: string) => {
  const [y, m] = v.split('-').map(Number) as [number, number];
  return { year: y, month: m };
};

const approveForm = reactive({ amount: '' as string | number, tenureMonths: '' as string | number, interestRate: 0 as string | number, start: '', note: '' });
const rejectNote = ref('');
const disburseForm = reactive({ disbursedOn: today as string | undefined, reference: '' });
const deferForm = reactive({ start: '', note: '' });
const repayForm = reactive({ amount: '' as string | number, paidOn: today as string | undefined, note: '' });
const previewEmi = computed(() => loanEmi(Number(approveForm.amount), l.value?.type === 'ADVANCE' ? 0 : Number(approveForm.interestRate), Number(approveForm.tenureMonths)));

async function open(kind: NonNullable<typeof modal.value>) {
  reset();
  const x = l.value!;
  try {
    if (kind === 'approve' || kind === 'defer') await loadMonths();
  } catch (e) {
    feedback.error('Could not load the payroll months', e);
    return;
  }
  if (kind === 'approve') Object.assign(approveForm, { amount: x.principal, tenureMonths: x.tenureMonths, interestRate: 0, start: months.value[0]?.value ?? '', note: '' });
  if (kind === 'reject') rejectNote.value = '';
  if (kind === 'disburse') Object.assign(disburseForm, { disbursedOn: today, reference: '' });
  if (kind === 'defer') Object.assign(deferForm, { start: months.value[1]?.value ?? months.value[0]?.value ?? '', note: '' });
  if (kind === 'repay') Object.assign(repayForm, { amount: x.outstanding, paidOn: today, note: '' });
  modal.value = kind;
}

async function act(fn: () => Promise<LoanDetail>, success: string) {
  reset();
  busy.value = true;
  try {
    loan.data.value = await fn();
    feedback.success(success);
    modal.value = null;
  } catch (e) {
    handle(e, 'Could not complete the action');
  } finally {
    busy.value = false;
  }
}
const approve = () =>
  act(
    () =>
      loansApi.approve(id.value, {
        amount: Number(approveForm.amount),
        tenureMonths: Number(approveForm.tenureMonths),
        ...(l.value!.type === 'LOAN' ? { interestRate: Number(approveForm.interestRate) } : {}),
        startYear: parseMonth(approveForm.start).year,
        startMonth: parseMonth(approveForm.start).month,
        note: approveForm.note || null,
      }),
    'Approved',
  );
const reject = () => act(() => loansApi.reject(id.value, rejectNote.value), 'Request turned down');
const disburse = () => act(() => loansApi.disburse(id.value, { disbursedOn: disburseForm.disbursedOn!, reference: disburseForm.reference }), 'Marked as paid out');
const defer = () => act(() => loansApi.defer(id.value, { startYear: parseMonth(deferForm.start).year, startMonth: parseMonth(deferForm.start).month, note: deferForm.note }), 'Deductions moved');
const repay = () => act(() => loansApi.repay(id.value, { amount: Number(repayForm.amount), paidOn: repayForm.paidOn!, note: repayForm.note }), 'Repayment recorded');
async function cancel() {
  if (!(await feedback.confirm({ title: `Cancel ${l.value?.reference}?`, message: 'Nothing will be paid out or deducted.', confirmLabel: 'Cancel it' }))) return;
  busy.value = true;
  try {
    loan.data.value = await loansApi.cancel(id.value);
    feedback.success('Cancelled');
  } catch (e) {
    feedback.error('Could not cancel it', e);
  } finally {
    busy.value = false;
  }
}
const period = (y: number, m: number) => `${MONTH_NAMES[m - 1]} ${y}`;

// ---- Presentation -----------------------------------------------------------------------------------------------
const TYPE_ICON: Record<LoanType, Component> = { ADVANCE: Wallet, LOAN: Landmark };
const TYPE_TILE: Record<LoanType, string> = {
  ADVANCE: 'bg-sky-50 text-sky-600 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300',
  LOAN: 'bg-violet-50 text-violet-600 ring-violet-600/15 dark:bg-violet-500/15 dark:text-violet-300',
};
const SOURCE_ICON: Record<LoanRepaymentSource, Component> = { PAYROLL: ReceiptText, MANUAL: HandCoins, SETTLEMENT: FileCheck2 };
const repaying = computed(() => l.value?.status === 'ACTIVE' || l.value?.status === 'CLOSED');
const pct = computed(() => (l.value && l.value.principal ? Math.min(100, Math.round((l.value.repaid / l.value.principal) * 100)) : 0));
const CIRC = 2 * Math.PI * 42;

/** Workflow: requested, approved, paid out, repaying, repaid; a request turned down or cancelled stops at the first step. */
const steps = computed(() => {
  const x = l.value;
  if (!x) return [];
  const firstRepayment = [...x.repayments].sort((a, b) => a.paidOn.localeCompare(b.paidOn))[0];
  return [
    { key: 'requested', label: 'Requested', icon: Send, at: x.createdAt, by: x.raisedBy },
    { key: 'approved', label: x.status === 'REJECTED' ? 'Turned down' : 'Approved', icon: x.status === 'REJECTED' ? X : BadgeCheck, at: x.decidedAt, by: x.decidedBy },
    { key: 'paid', label: 'Paid out', icon: HandCoins, at: x.disbursedOn, by: x.disbursedBy },
    { key: 'repaying', label: 'Repaying', icon: CalendarClock, at: firstRepayment?.paidOn ?? null, by: null },
    { key: 'repaid', label: 'Repaid', icon: CircleCheck, at: x.closedAt, by: null },
  ];
});
const current = computed(() => ({ REQUESTED: 1, APPROVED: 2, ACTIVE: 3, CLOSED: 5, REJECTED: 1, CANCELLED: -1 })[l.value?.status ?? 'REQUESTED']);
const stepState = (i: number) => {
  const s = l.value?.status;
  if (s === 'CANCELLED') return 'off';
  if (s === 'REJECTED') return i === 0 ? 'done' : i === 1 ? 'failed' : 'off';
  return i < current.value ? 'done' : i === current.value ? 'now' : 'next';
};
const WAITING: Record<string, string> = { approved: 'Waiting for a decision', paid: 'Waiting to be paid out', repaying: 'Deducted from salary every month' };

const facts = computed(() => {
  const x = l.value;
  if (!x) return [];
  const last = x.schedule.at(-1);
  return [
    { key: 'amount', icon: HandCoins, label: x.status === 'REQUESTED' ? 'Requested' : 'Amount', value: rupees(x.principal), hint: x.interestRate ? `${x.interestRate}% a year, reducing balance` : x.emi ? 'Interest-free' : `${x.tenureMonths} months asked`, tone: 'text-accent-fg bg-accent-soft' },
    { key: 'emi', icon: CalendarClock, label: 'Monthly instalment', value: x.emi ? rupees(x.emi) : '—', hint: `${x.tenureMonths} month${x.tenureMonths === 1 ? '' : 's'}`, tone: 'text-info-fg bg-info-soft' },
    {
      key: 'repaid',
      icon: CircleCheck,
      label: 'Repaid',
      value: rupees(x.repaid),
      hint: x.interestPaid ? `plus ${rupees(x.interestPaid)} interest` : `${x.instalmentsPaid} instalment${x.instalmentsPaid === 1 ? '' : 's'} via payroll`,
      tone: 'text-success-fg bg-success-soft',
    },
    {
      key: 'done',
      icon: CalendarCheck,
      label: x.status === 'CLOSED' ? 'Closed' : 'Last deduction',
      value: x.status === 'CLOSED' && x.closedAt ? formatDate(x.closedAt) : last ? period(last.year, last.month) : '—',
      hint: x.status === 'CLOSED' ? 'Fully repaid' : last ? 'If every instalment is deducted' : 'Set when approved',
      tone: 'text-special-fg bg-special-soft',
    },
  ];
});
</script>

<template>
  <div>
    <AppSkeleton v-if="loan.loading.value && !l" :lines="8" />
    <AppErrorState v-else-if="loan.error.value" :error="loan.error.value" title="This loan isn't available" @retry="loan.run" />
    <template v-else-if="l">
      <AppPageHeader
        :title="`${LOAN_TYPE_LABELS[l.type]} · ${l.reference}`"
        :description="hr ? [l.employee?.name, l.employee?.employeeCode, l.employee?.department].filter(Boolean).join(' · ') : l.purpose"
        :back="hr ? '/hr/payroll/loans' : '/me/loans'"
        back-label="Loans & advances"
      >
        <template #leading>
          <span :class="['flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset max-sm:hidden', TYPE_TILE[l.type]]" aria-hidden="true"><component :is="TYPE_ICON[l.type]" :size="20" /></span>
        </template>
        <template #badges><AppBadge :tone="loanTone[l.status]" dot>{{ LOAN_STATUS_LABELS[l.status] }}</AppBadge></template>
        <template #actions>
          <AppButton v-if="l.permissions.cancel" variant="ghost" :icon="Ban" :loading="busy && !modal" @click="cancel">Cancel</AppButton>
          <AppButton v-if="l.permissions.reject" variant="secondary" :icon="XCircle" @click="open('reject')">Turn down</AppButton>
          <AppButton v-if="l.permissions.approve" :icon="CheckCircle2" @click="open('approve')">Approve</AppButton>
          <AppButton v-if="l.permissions.disburse" :icon="Send" @click="open('disburse')">Mark paid out</AppButton>
          <AppButton v-if="l.permissions.defer" variant="secondary" :icon="CalendarClock" @click="open('defer')">Defer deductions</AppButton>
          <AppButton v-if="l.permissions.repay" variant="secondary" :icon="Wallet" @click="open('repay')">Record repayment</AppButton>
        </template>
      </AppPageHeader>
      <AppAlert v-if="l.status === 'REJECTED' && l.decisionNote" tone="warning" class="mb-4">Not approved by {{ l.decidedBy }}: {{ l.decisionNote }}</AppAlert>

      <!-- Workflow, balance and terms -->
      <section class="card mb-4 overflow-hidden" aria-label="Loan summary">
        <ol class="grid grid-cols-1 gap-3 border-b border-line/70 bg-surface-muted/40 px-5 py-4 sm:grid-cols-5 sm:gap-0" aria-label="Progress">
          <li v-for="(s, i) in steps" :key="s.key" class="relative flex gap-3 sm:flex-col sm:items-center sm:gap-2 sm:px-2 sm:text-center" :aria-current="stepState(i) === 'now' ? 'step' : undefined">
            <span v-if="i < steps.length - 1" :class="['absolute top-4 hidden h-0.5 sm:start-[calc(50%+1.25rem)] sm:end-[calc(-50%+1.25rem)] sm:block', stepState(i) === 'done' && stepState(i + 1) !== 'failed' ? 'bg-success' : 'bg-line']" aria-hidden="true" />
            <span
              :class="[
                'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface-muted',
                stepState(i) === 'done' && 'bg-success text-white',
                stepState(i) === 'now' && 'border-2 border-brand-500 bg-accent-soft text-accent-fg',
                stepState(i) === 'failed' && 'bg-danger text-white',
                (stepState(i) === 'next' || stepState(i) === 'off') && 'border border-line bg-surface text-fg-subtle',
              ]"
              aria-hidden="true"
            >
              <Check v-if="stepState(i) === 'done'" :size="15" :stroke-width="3" />
              <component :is="s.icon" v-else :size="15" />
            </span>
            <div class="min-w-0">
              <p :class="['text-sm', stepState(i) === 'now' || stepState(i) === 'failed' ? 'font-semibold text-fg' : stepState(i) === 'done' ? 'font-medium text-fg' : 'text-fg-muted']">
                {{ s.label }}<span class="sr-only">{{ stepState(i) === 'done' ? ' (done)' : stepState(i) === 'now' ? ' (in progress)' : '' }}</span>
              </p>
              <p v-if="(stepState(i) === 'done' || stepState(i) === 'failed') && s.at" class="truncate text-2xs text-fg-muted">{{ s.by ? `${s.by} · ` : '' }}{{ formatDate(s.at) }}</p>
              <p v-else-if="stepState(i) === 'now'" class="text-2xs font-medium text-accent-fg">{{ WAITING[s.key] }}</p>
            </div>
          </li>
        </ol>
        <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div class="flex items-center gap-5 p-5 lg:border-e lg:border-line/70">
            <div class="min-w-0 flex-1">
              <p class="text-xs font-medium text-fg-muted">{{ repaying ? 'Still owed' : l.status === 'APPROVED' ? 'To pay out' : 'Amount' }}</p>
              <p class="mt-0.5 text-3xl font-semibold tracking-tight text-fg tabular-nums">{{ repaying ? rupees(l.outstanding) : rupees(l.principal) }}</p>
              <p class="mt-1 text-xs text-fg-muted tabular-nums">
                <template v-if="repaying">of {{ rupees(l.principal) }} · {{ rupees(l.repaid) }} repaid</template>
                <template v-else-if="l.status === 'APPROVED' && l.start">Deductions start in {{ l.start.label }}, once it's paid out</template>
                <template v-else-if="l.status === 'REQUESTED'">Over {{ l.tenureMonths }} month{{ l.tenureMonths === 1 ? '' : 's' }} · {{ l.purpose }}</template>
                <template v-else>Nothing is paid out or deducted</template>
              </p>
              <p v-if="l.nextInstalment && l.status === 'ACTIVE'" class="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-fg tabular-nums">
                <CalendarClock :size="13" aria-hidden="true" />Next deduction {{ rupees(l.nextInstalment.amount) }}{{ l.schedule[0] ? ` · ${period(l.schedule[0].year, l.schedule[0].month)}` : '' }}
              </p>
            </div>
            <div v-if="repaying" class="relative h-24 w-24 shrink-0">
              <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" class="stroke-surface-muted" />
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" stroke-linecap="round" :class="[l.status === 'CLOSED' ? 'stroke-success' : 'stroke-brand-500', 'transition-[stroke-dashoffset] duration-700']" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - pct / 100)" />
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center" role="img" :aria-label="`${pct}% repaid`">
                <span class="text-xl font-semibold text-fg tabular-nums">{{ pct }}%</span>
                <span class="text-2xs text-fg-muted">repaid</span>
              </div>
            </div>
          </div>
          <dl class="grid grid-cols-2 gap-px bg-line/70">
            <div v-for="f in facts" :key="f.key" class="flex items-center gap-3 bg-surface px-4 py-3.5">
              <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', f.tone]" aria-hidden="true"><component :is="f.icon" :size="17" /></span>
              <div class="min-w-0">
                <dt class="text-xs text-fg-muted">{{ f.label }}</dt>
                <dd class="truncate text-base leading-6 font-semibold text-fg tabular-nums">{{ f.value }}</dd>
                <dd class="truncate text-2xs text-fg-subtle">{{ f.hint }}</dd>
              </div>
            </div>
          </dl>
        </div>
      </section>

      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div class="min-w-0 space-y-4">
          <AppCard title="Repayment schedule" :icon="ListChecks" :padded="!l.schedule.length" :description="l.schedule.length ? `What payroll will deduct, month by month · ${l.schedule.length} to go` : undefined">
            <div v-if="!l.schedule.length" class="flex items-center gap-3 rounded-lg bg-surface-muted/60 px-3 py-3">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface text-fg-subtle ring-1 ring-line ring-inset" aria-hidden="true"><CalendarClock :size="15" /></span>
              <p class="text-sm text-fg-muted">{{ l.status === 'CLOSED' ? 'Fully repaid.' : 'The schedule appears once the request is approved.' }}</p>
            </div>
            <div v-else class="overflow-x-auto">
              <table class="w-full text-sm">
                <caption class="sr-only">Repayment schedule</caption>
                <thead class="border-b border-line bg-surface-muted/70 text-xs text-fg-muted">
                  <tr>
                    <th scope="col" class="h-10 px-4 text-start font-semibold">Month</th>
                    <th scope="col" class="h-10 px-4 text-end font-semibold">Principal</th>
                    <th scope="col" class="h-10 px-4 text-end font-semibold">Interest</th>
                    <th scope="col" class="h-10 px-4 text-end font-semibold">Deduction</th>
                    <th scope="col" class="h-10 px-4 text-end font-semibold">Balance after</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-line/70">
                  <tr v-for="(r, i) in l.schedule" :key="`${r.year}-${r.month}`" :class="i === 0 && l.status === 'ACTIVE' && 'bg-accent-soft/40'">
                    <td class="h-11 px-4 text-fg">
                      {{ period(r.year, r.month) }}<AppBadge v-if="i === 0 && l.status === 'ACTIVE'" tone="brand" size="sm" class="ms-2">Next</AppBadge>
                    </td>
                    <td class="px-4 text-end text-fg-muted tabular-nums">{{ rupees(r.principal, true) }}</td>
                    <td class="px-4 text-end text-fg-muted tabular-nums">{{ rupees(r.interest, true) }}</td>
                    <td class="px-4 text-end font-semibold tabular-nums">{{ rupees(r.amount, true) }}</td>
                    <td class="px-4 text-end text-fg-muted tabular-nums">{{ rupees(r.balance, true) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </AppCard>
          <AppCard title="Repayments" :icon="CircleCheck" :description="l.repayments.length ? `${rupees(l.repaid + l.interestPaid, true)} received so far` : undefined">
            <div v-if="!l.repayments.length" class="flex items-center gap-3 rounded-lg bg-surface-muted/60 px-3 py-3">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface text-fg-subtle ring-1 ring-line ring-inset" aria-hidden="true"><Wallet :size="15" /></span>
              <p class="text-sm text-fg-muted">Nothing repaid yet. Salary deductions and direct repayments appear here.</p>
            </div>
            <ul v-else class="-my-2 divide-y divide-line/70 text-sm">
              <li v-for="r in l.repayments" :key="r.id" class="flex items-center gap-3 py-2.5">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success-fg" aria-hidden="true"><component :is="SOURCE_ICON[r.source]" :size="15" /></span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-fg">{{ REPAYMENT_SOURCE_LABELS[r.source] }}{{ r.period ? ` · ${r.period} payroll` : '' }}</p>
                  <p class="truncate text-xs text-fg-muted">{{ formatDate(r.paidOn) }}{{ r.note ? ` · ${r.note}` : '' }}</p>
                </div>
                <p class="text-end tabular-nums">
                  <span class="font-semibold text-fg">{{ rupees(r.principal + r.interest, true) }}</span>
                  <span v-if="r.interest" class="block text-2xs text-fg-muted">incl. {{ rupees(r.interest, true) }} interest</span>
                </p>
              </li>
            </ul>
          </AppCard>
        </div>
        <AppCard title="Details" :icon="FileCheck2">
          <dl class="space-y-3 text-sm">
            <div><dt class="text-xs text-fg-muted">Purpose</dt><dd class="text-fg">{{ l.purpose }}</dd></div>
            <div v-if="hr && l.employee"><dt class="text-xs text-fg-muted">Employee</dt><dd class="text-fg">{{ l.employee.name }} <span class="text-fg-muted">· {{ l.employee.employeeCode }}</span></dd></div>
            <div><dt class="text-xs text-fg-muted">Requested</dt><dd class="text-fg">{{ formatDate(l.createdAt) }}{{ l.raisedBy ? ` · raised by ${l.raisedBy}` : '' }}</dd></div>
            <div v-if="l.decidedBy">
              <dt class="text-xs text-fg-muted">{{ l.status === 'REJECTED' ? 'Turned down' : 'Approved' }}</dt>
              <dd class="text-fg">{{ l.decidedBy }}, {{ formatDate(l.decidedAt) }}</dd>
              <dd v-if="l.decisionNote && l.status !== 'REJECTED'" class="mt-1 rounded-md bg-surface-muted/70 px-2 py-1 text-xs text-fg-muted">“{{ l.decisionNote }}”</dd>
            </div>
            <div v-if="l.start"><dt class="text-xs text-fg-muted">Deductions from</dt><dd class="text-fg">{{ l.start.label }}</dd></div>
            <div v-if="l.disbursedOn"><dt class="text-xs text-fg-muted">Paid out</dt><dd class="text-fg">{{ formatDate(l.disbursedOn) }}{{ l.disbursementReference ? ` · ref ${l.disbursementReference}` : '' }}{{ l.disbursedBy ? ` · ${l.disbursedBy}` : '' }}</dd></div>
            <div v-if="l.closedAt"><dt class="text-xs text-fg-muted">Closed</dt><dd class="text-fg">{{ formatDate(l.closedAt) }}</dd></div>
          </dl>
        </AppCard>
      </div>

      <AppModal :open="modal === 'approve'" :title="`Approve ${l.reference}`" description="The instalment is fixed now and deducted by payroll from the month you choose, once the money is paid out." @close="modal = null">
        <form id="approve-loan" class="space-y-4" novalidate @submit.prevent="approve">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <div class="grid gap-4 sm:grid-cols-2">
            <AppInput v-model="approveForm.amount" label="Amount (₹)" type="number" :min="1000" :max="l.principal" required :help="`Requested ${rupees(l.principal)}`" :error="fieldErrors.amount" />
            <AppInput v-model="approveForm.tenureMonths" label="Repay over" type="number" :min="1" :max="l.type === 'ADVANCE' ? 12 : 60" suffix="months" required :error="fieldErrors.tenureMonths" />
            <AppInput v-if="l.type === 'LOAN'" v-model="approveForm.interestRate" label="Interest a year" type="number" :min="0" :max="30" :step="0.25" suffix="%" help="On the reducing balance; 0 for interest-free" :error="fieldErrors.interestRate" />
            <AppSelect v-model="approveForm.start" label="First deduction" :options="months" :clearable="false" :error="fieldErrors.startMonth" />
          </div>
          <AppTextarea v-model="approveForm.note" label="Note to the employee" :rows="2" :maxlength="1000" />
          <p v-if="previewEmi" class="rounded-xl bg-surface-muted/60 px-4 py-3 text-sm text-fg">Instalment <span class="font-semibold tabular-nums">{{ rupees(previewEmi) }}</span> a month for {{ approveForm.tenureMonths }} months.</p>
        </form>
        <template #footer>
          <AppButton variant="secondary" @click="modal = null">Cancel</AppButton>
          <AppButton type="submit" form="approve-loan" :loading="busy" :disabled="!approveForm.start">Approve</AppButton>
        </template>
      </AppModal>

      <AppModal :open="modal === 'reject'" :title="`Turn down ${l.reference}?`" size="sm" @close="modal = null">
        <AppAlert v-if="formError" class="mb-4">{{ formError }}</AppAlert>
        <AppTextarea v-model="rejectNote" label="Reason (shared with the employee)" required :rows="3" :maxlength="1000" :error="fieldErrors.note" />
        <template #footer>
          <AppButton variant="secondary" @click="modal = null">Keep it</AppButton>
          <AppButton variant="danger" :loading="busy" :disabled="rejectNote.trim().length < 3" @click="reject">Turn down</AppButton>
        </template>
      </AppModal>

      <AppModal :open="modal === 'disburse'" :title="`Pay out ${l.reference}`" :description="`${rupees(l.principal)} to ${l.employee?.name ?? 'the employee'}. Deductions start in ${l.start?.label}.`" size="sm" @close="modal = null">
        <div class="space-y-4">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <AppDatePicker v-model="disburseForm.disbursedOn" label="Paid on" required :max="today" :error="fieldErrors.disbursedOn" />
          <AppInput v-model="disburseForm.reference" label="Bank reference" required :maxlength="120" :error="fieldErrors.reference" />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="modal = null">Cancel</AppButton>
          <AppButton :loading="busy" :disabled="!disburseForm.disbursedOn || disburseForm.reference.trim().length < 2" @click="disburse">Mark paid out</AppButton>
        </template>
      </AppModal>

      <AppModal :open="modal === 'defer'" :title="`Defer ${l.reference}`" description="Payroll deducts nothing until the month you choose." size="sm" @close="modal = null">
        <div class="space-y-4">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <AppSelect v-model="deferForm.start" label="Next deduction" :options="months" :clearable="false" :error="fieldErrors.startMonth" />
          <AppTextarea v-model="deferForm.note" label="Reason" required :rows="2" :maxlength="500" :error="fieldErrors.note" />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="modal = null">Cancel</AppButton>
          <AppButton :loading="busy" :disabled="!deferForm.start || deferForm.note.trim().length < 3" @click="defer">Defer</AppButton>
        </template>
      </AppModal>

      <AppModal :open="modal === 'repay'" :title="`Repayment on ${l.reference}`" :description="`${rupees(l.outstanding)} is still owed. Paying it all closes the loan.`" size="sm" @close="modal = null">
        <div class="space-y-4">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <AppInput v-model="repayForm.amount" label="Amount (₹)" type="number" :min="1" :max="l.outstanding" required :error="fieldErrors.amount" />
          <AppDatePicker v-model="repayForm.paidOn" label="Paid on" required :max="today" :error="fieldErrors.paidOn" />
          <AppTextarea v-model="repayForm.note" label="How it was paid" required :rows="2" :maxlength="500" :error="fieldErrors.note" />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="modal = null">Cancel</AppButton>
          <AppButton :loading="busy" :disabled="Number(repayForm.amount) <= 0 || !repayForm.paidOn || repayForm.note.trim().length < 3" @click="repay">Record</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
