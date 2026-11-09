<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import { Ban, CalendarCheck, CalendarClock, Check, ChevronRight, CircleCheck, HandCoins, Hourglass, Landmark, ListChecks, Plus, Send, Wallet } from '@lucide/vue';
import { ADVANCE_MAX_TENURE_MONTHS, LOAN_MAX_TENURE_MONTHS, type LoanType } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { loansApi } from '@/modules/payroll/api/payroll.api';
import LoanRequestModal from '@/modules/payroll/components/LoanRequestModal.vue';
import type { LoanDetail, MyLoans } from '@/modules/payroll/types';
import { instalmentsLeft as remainingInstalments } from '@/modules/payroll/utils/loan-progress';
import { LOAN_STATUS_LABELS, LOAN_TYPE_LABELS, loanTone, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppBadge, AppButton, AppCard, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Your loans and salary advances: the balance you still owe, the next salary deduction, requests in review and history. */
type MyLoan = MyLoans['loans'][number];
const feedback = useFeedbackStore();
const mine = useAsync(() => loansApi.mine());
const requesting = ref(false);
async function onSaved(l: LoanDetail) {
  requesting.value = false;
  feedback.success('Request sent', `${l.reference} is waiting for approval.`);
  await mine.run();
}
const withdrawing = ref<string | null>(null);
async function withdraw(l: MyLoan) {
  if (!(await feedback.confirm({ title: `Cancel ${l.reference}?`, message: 'Nothing will be paid out or deducted.', confirmLabel: 'Cancel it' }))) return;
  withdrawing.value = l.id;
  try {
    await loansApi.cancel(l.id);
    feedback.success('Cancelled');
    await mine.run();
  } catch (e) {
    feedback.error('Could not cancel it', e);
  } finally {
    withdrawing.value = null;
  }
}
const progress = (repaid: number, principal: number) => Math.min(100, Math.round((repaid / principal) * 100));

// ---- Balance ---------------------------------------------------------------------------------------------------
const loans = computed(() => mine.data.value?.loans ?? []);
const active = computed(() => loans.value.filter((l) => l.status === 'ACTIVE'));
const inReview = computed(() => loans.value.filter((l) => l.status === 'REQUESTED' || l.status === 'APPROVED'));
const sum = (list: MyLoan[], pick: (l: MyLoan) => number) => list.reduce((s, l) => s + pick(l), 0);
const outstanding = computed(() => sum(active.value, (l) => l.outstanding));
const borrowed = computed(() => sum(active.value, (l) => l.principal));
const repaid = computed(() => sum(active.value, (l) => l.repaid));
const pct = computed(() => (borrowed.value ? progress(repaid.value, borrowed.value) : 0));
const nextDeduction = computed(() => sum(active.value, (l) => l.nextInstalment?.amount ?? 0));
const instalmentsLeft = computed(() => sum(active.value, (l) => remainingInstalments(l)));
/** Payroll month of the n-th instalment (0-based), counted from the first deduction month. */
const monthOf = (l: MyLoan, n: number) => (l.start ? new Date(l.start.year, l.start.month - 1 + n, 1) : null);
const monthLabel = (d: Date | null, month: 'long' | 'short' = 'long') => (d ? d.toLocaleDateString(appLocale(), { month, year: 'numeric' }) : '—');
const nextMonth = computed(() => active.value.map((l) => monthOf(l, l.instalmentsPaid)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null);
const lastMonth = computed(() => active.value.map((l) => monthOf(l, l.instalmentsPaid + remainingInstalments(l) - 1)).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null);
const interestFree = computed(() => active.value.every((l) => !l.interestRate));
const heroFacts = computed(() => [
  { key: 'next', icon: CalendarClock, label: 'Next deduction', value: rupees(nextDeduction.value), hint: nextMonth.value ? `${monthLabel(nextMonth.value)} payroll` : 'Not scheduled', tone: 'text-accent-fg bg-accent-soft' },
  { key: 'left', icon: ListChecks, label: 'Instalments left', value: String(instalmentsLeft.value), hint: `of ${sum(active.value, (l) => l.tenureMonths)} in total`, tone: 'text-info-fg bg-info-soft' },
  { key: 'repaid', icon: CircleCheck, label: 'Repaid so far', value: rupees(repaid.value), hint: interestFree.value ? 'Interest-free' : `incl. ${rupees(sum(active.value, (l) => l.interestPaid))} interest`, tone: 'text-success-fg bg-success-soft' },
  { key: 'done', icon: CalendarCheck, label: 'Fully repaid by', value: monthLabel(lastMonth.value), hint: 'If every instalment is deducted', tone: 'text-special-fg bg-special-soft' },
]);
const CIRC = 2 * Math.PI * 42;

// ---- Lists -----------------------------------------------------------------------------------------------------
const TYPE_ICON: Record<LoanType, Component> = { ADVANCE: Wallet, LOAN: Landmark };
const TYPE_TILE: Record<LoanType, string> = {
  ADVANCE: 'bg-sky-50 text-sky-600 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300',
  LOAN: 'bg-violet-50 text-violet-600 ring-violet-600/15 dark:bg-violet-500/15 dark:text-violet-300',
};
const STEPS = ['Requested', 'Approval', 'Payout', 'Repayment'];
/** Index of the step in progress for a request in review. */
const stepOf = (l: MyLoan) => (l.status === 'REQUESTED' ? 1 : 2);
const terms = (l: MyLoan) => (l.emi ? `${rupees(l.emi)} × ${l.tenureMonths} months` : `${l.tenureMonths} months`);
const OPTIONS = [
  { type: 'ADVANCE' as const, title: LOAN_TYPE_LABELS.ADVANCE, text: `Interest-free, repaid within ${ADVANCE_MAX_TENURE_MONTHS} months.` },
  { type: 'LOAN' as const, title: LOAN_TYPE_LABELS.LOAN, text: `Up to ${LOAN_MAX_TENURE_MONTHS} months; the interest rate is set when it's approved.` },
];
const HOW = [
  { icon: Send, title: 'Ask', text: 'Say how much, for what, and over how many months.' },
  { icon: Check, title: 'Approval', text: 'Payroll or HR reviews it and confirms the terms.' },
  { icon: HandCoins, title: 'Paid out', text: 'The money is transferred to your bank account.' },
  { icon: CalendarClock, title: 'Monthly deduction', text: 'Each instalment is taken from your salary.' },
];
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Loans & advances" description="Ask for a salary advance or a loan. Once it's approved and paid out, the instalment is deducted from your salary every month.">
      <template #actions><AppButton :icon="Plus" :disabled="!mine.data.value?.canRequest" @click="requesting = true">Request loan or advance</AppButton></template>
    </AppPageHeader>
    <AppSkeleton v-if="mine.loading.value && !mine.data.value" :lines="5" />
    <AppErrorState v-else-if="mine.error.value" :error="mine.error.value" @retry="mine.run" />
    <template v-else-if="mine.data.value">
      <!-- Balance -->
      <section v-if="active.length" class="card overflow-hidden" aria-labelledby="balance-title">
        <div class="relative flex flex-wrap items-center gap-6 bg-gradient-to-br from-brand-700 via-brand-600 to-sky-500 px-6 py-6 text-white">
          <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_90%_-10%,rgba(255,255,255,0.28),transparent_45%),radial-gradient(circle_at_0%_120%,rgba(255,255,255,0.18),transparent_45%)]" aria-hidden="true" />
          <div class="relative min-w-0 flex-1">
            <p class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
              <HandCoins :size="13" aria-hidden="true" />Repaying {{ active.length === 1 ? `${LOAN_TYPE_LABELS[active[0]!.type].toLowerCase()} ${active[0]!.reference}` : `${active.length} loans and advances` }}
            </p>
            <h2 id="balance-title" class="mt-3 text-sm font-medium text-white/80">Outstanding balance</h2>
            <p class="text-4xl font-semibold tracking-tight tabular-nums">{{ rupees(outstanding) }}</p>
            <p class="mt-1 text-sm text-white/85 tabular-nums">of {{ rupees(borrowed) }} borrowed · {{ rupees(repaid) }} repaid</p>
            <div class="mt-4 h-2 max-w-md overflow-hidden rounded-full bg-white/20" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100" aria-label="Repaid">
              <div class="h-full rounded-full bg-white transition-[width] duration-700" :style="{ width: `${pct}%` }" />
            </div>
          </div>
          <div class="relative h-28 w-28">
            <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" class="stroke-white/20" />
              <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" stroke-linecap="round" class="stroke-white transition-[stroke-dashoffset] duration-700" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - pct / 100)" />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-2xl font-semibold tabular-nums">{{ pct }}%</span>
              <span class="text-2xs text-white/80">repaid</span>
            </div>
          </div>
        </div>
        <dl class="grid grid-cols-2 gap-px bg-line/70 xl:grid-cols-4">
          <div v-for="f in heroFacts" :key="f.key" class="flex items-center gap-3 bg-surface px-4 py-3.5 sm:px-5">
            <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', f.tone]" aria-hidden="true"><component :is="f.icon" :size="17" /></span>
            <div class="min-w-0">
              <dt class="text-xs text-fg-muted">{{ f.label }}</dt>
              <dd class="truncate text-lg leading-6 font-semibold text-fg tabular-nums">{{ f.value }}</dd>
              <dd class="truncate text-2xs text-fg-subtle">{{ f.hint }}</dd>
            </div>
          </div>
        </dl>
      </section>

      <!-- Nothing owed -->
      <section v-else class="card overflow-hidden">
        <div class="flex flex-wrap items-center gap-5 bg-gradient-to-r from-brand-500/10 via-transparent to-sky-500/10 p-5">
          <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface text-accent-fg shadow-xs ring-1 ring-line" aria-hidden="true"><Wallet :size="22" /></span>
          <div class="min-w-0 flex-1">
            <p class="text-lg font-semibold text-fg">{{ loans.length ? 'Nothing to repay' : 'Need some money before payday?' }}</p>
            <p class="text-sm text-fg-muted">
              {{ inReview.length ? 'No deductions are being taken from your salary. Your request below is in progress.' : loans.length ? 'No deductions are being taken from your salary right now.' : 'Ask for an interest-free salary advance or a loan, and repay it from your salary in monthly instalments.' }}
            </p>
          </div>
          <AppButton v-if="mine.data.value.canRequest" :icon="Plus" @click="requesting = true">Request loan or advance</AppButton>
        </div>
      </section>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div class="min-w-0 space-y-4">
          <!-- In review -->
          <section v-for="l in inReview" :key="l.id" class="card overflow-hidden" :aria-label="`${l.reference} in progress`">
            <div class="flex flex-wrap items-start gap-4 p-5">
              <span :class="['flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', TYPE_TILE[l.type]]" aria-hidden="true"><component :is="TYPE_ICON[l.type]" :size="20" /></span>
              <div class="min-w-0 flex-1">
                <p class="inline-flex items-center gap-1.5 text-xs font-semibold text-warning-fg"><Hourglass :size="13" aria-hidden="true" />{{ l.status === 'REQUESTED' ? 'Waiting for approval' : 'Approved · waiting to be paid out' }}</p>
                <p class="mt-1 text-lg font-semibold text-fg tabular-nums">{{ rupees(l.principal) }} <span class="text-sm font-normal text-fg-muted">{{ LOAN_TYPE_LABELS[l.type].toLowerCase() }} · {{ l.reference }}</span></p>
                <p class="truncate text-sm text-fg-muted">{{ l.purpose }} · asked {{ formatDate(l.createdAt) }}</p>
                <p class="mt-1 text-xs text-fg-muted tabular-nums">
                  {{ terms(l) }}<template v-if="l.interestRate"> · {{ l.interestRate }}% a year</template><template v-if="l.start && l.status === 'APPROVED'"> · deductions start in {{ l.start.label }}, once it's paid out</template>
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <AppButton v-if="l.permissions.cancel" variant="ghost" :icon="Ban" :loading="withdrawing === l.id" @click="withdraw(l)">Cancel request</AppButton>
                <AppButton variant="secondary" :icon-right="ChevronRight" :to="`/me/loans/${l.id}`">Details</AppButton>
              </div>
            </div>
            <ol class="flex items-center gap-2 border-t border-line/70 bg-surface-muted/40 px-5 py-3" aria-label="Progress">
              <template v-for="(s, i) in STEPS" :key="s">
                <li class="flex items-center gap-2" :aria-current="i === stepOf(l) ? 'step' : undefined">
                  <span
                    :class="[
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold',
                      i < stepOf(l) ? 'bg-success text-white' : i === stepOf(l) ? 'bg-brand-600 text-white' : 'bg-surface text-fg-muted ring-1 ring-line ring-inset',
                    ]"
                    aria-hidden="true"
                  >
                    <Check v-if="i < stepOf(l)" :size="12" :stroke-width="3" />
                    <template v-else>{{ i + 1 }}</template>
                  </span>
                  <span :class="['text-xs', i === stepOf(l) ? 'font-semibold text-fg' : 'text-fg-muted']">{{ s }}<span class="sr-only">{{ i < stepOf(l) ? ' (done)' : i === stepOf(l) ? ' (in progress)' : '' }}</span></span>
                </li>
                <li v-if="i < STEPS.length - 1" :class="['h-px min-w-4 flex-1', i < stepOf(l) ? 'bg-success' : 'bg-line']" aria-hidden="true" />
              </template>
            </ol>
          </section>

          <!-- All -->
          <section class="card" aria-labelledby="loans-title">
            <header class="flex items-center gap-3 border-b border-line/70 px-4 py-3">
              <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><HandCoins :size="16" /></span>
              <div class="min-w-0 flex-1">
                <h2 id="loans-title" class="flex items-center gap-2 text-sm font-semibold text-fg">All loans & advances <AppBadge v-if="loans.length" size="sm">{{ loans.length }}</AppBadge></h2>
                <p class="text-xs text-fg-muted">Open one for the repayment schedule and every deduction.</p>
              </div>
            </header>
            <ul v-if="loans.length" class="divide-y divide-line/70">
              <li v-for="l in loans" :key="l.id">
                <RouterLink :to="`/me/loans/${l.id}`" class="group flex flex-wrap items-center gap-4 px-4 py-3.5 transition hover:bg-accent-soft/40 focus-visible:bg-accent-soft/40 focus-visible:outline-none">
                  <span :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', TYPE_TILE[l.type]]" aria-hidden="true"><component :is="TYPE_ICON[l.type]" :size="18" /></span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-semibold text-fg">{{ LOAN_TYPE_LABELS[l.type] }} <span class="font-normal text-fg-muted">· {{ l.reference }}</span></p>
                    <p class="truncate text-xs text-fg-muted">{{ l.purpose }} · asked {{ formatDate(l.createdAt) }}</p>
                  </div>
                  <!-- Phones: figures move to a second line under the title. -->
                  <div class="flex items-center gap-4 max-md:order-last max-md:w-full max-md:ps-14">
                    <div class="w-28 shrink-0 md:text-end">
                      <p class="text-sm font-semibold text-fg tabular-nums">{{ rupees(l.principal) }}</p>
                      <p class="text-2xs text-fg-muted tabular-nums">{{ terms(l) }}</p>
                    </div>
                    <div class="min-w-0 flex-1 md:w-40 md:flex-none">
                      <template v-if="l.status === 'ACTIVE' || l.status === 'CLOSED'">
                        <div class="flex justify-between text-2xs text-fg-muted tabular-nums">
                          <span>{{ progress(l.repaid, l.principal) }}% repaid</span>
                          <span>{{ l.status === 'CLOSED' ? 'Done' : `${rupees(l.outstanding)} left` }}</span>
                        </div>
                        <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="progress(l.repaid, l.principal)" aria-valuemin="0" aria-valuemax="100" :aria-label="`${l.reference} repaid`">
                          <div :class="['h-full rounded-full', l.status === 'CLOSED' ? 'bg-success' : 'bg-brand-500']" :style="{ width: `${progress(l.repaid, l.principal)}%` }" />
                        </div>
                        <p v-if="l.nextInstalment && l.status === 'ACTIVE'" class="mt-1 truncate text-2xs text-fg-subtle tabular-nums">Next {{ rupees(l.nextInstalment.amount) }} · {{ monthLabel(monthOf(l, l.instalmentsPaid), 'short') }}</p>
                      </template>
                      <p v-else-if="l.start && l.status === 'APPROVED'" class="text-2xs text-fg-muted">Deductions from {{ l.start.label }}</p>
                      <p v-else-if="l.status === 'REQUESTED'" class="text-2xs text-fg-muted">Deductions start after payout</p>
                      <p v-else class="text-2xs text-fg-subtle">No deductions</p>
                    </div>
                  </div>
                  <AppBadge :tone="loanTone[l.status]" dot>{{ LOAN_STATUS_LABELS[l.status] }}</AppBadge>
                  <ChevronRight :size="16" class="text-fg-subtle transition group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden="true" />
                </RouterLink>
              </li>
            </ul>
            <p v-else class="px-4 py-8 text-center text-sm text-fg-muted">Requests you make appear here with their repayment progress.</p>
          </section>
        </div>

        <aside class="space-y-4">
          <AppCard title="What you can ask for">
            <ul class="space-y-2">
              <li v-for="o in OPTIONS" :key="o.type" class="flex gap-3 rounded-xl p-3 ring-1 ring-line ring-inset">
                <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', TYPE_TILE[o.type]]" aria-hidden="true"><component :is="TYPE_ICON[o.type]" :size="17" /></span>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-fg">{{ o.title }}</p>
                  <p class="text-xs text-fg-muted">{{ o.text }}</p>
                </div>
              </li>
            </ul>
            <AppButton class="mt-3 w-full" size="sm" :icon="Plus" :disabled="!mine.data.value.canRequest" @click="requesting = true">Request loan or advance</AppButton>
            <p v-if="!mine.data.value.canRequest" class="mt-2 text-xs text-fg-muted">
              {{ loans.some((l) => l.status === 'REQUESTED') ? 'You can have one request waiting for approval at a time.' : 'Requests are open to active employees only.' }}
            </p>
          </AppCard>

          <AppCard title="How it works">
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
    </template>
    <LoanRequestModal :open="requesting" @close="requesting = false" @saved="onSaved" />
  </div>
</template>
