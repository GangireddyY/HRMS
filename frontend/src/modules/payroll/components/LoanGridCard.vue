<script setup lang="ts">
import { computed, type Component } from 'vue';
import { ArrowRight, CalendarClock, Hourglass, Landmark, Wallet } from '@lucide/vue';
import type { LoanType } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import type { Loan } from '@/modules/payroll/types';
import { instalmentsLeft, nextInstalmentNumber } from '@/modules/payroll/utils/loan-progress';
import { LOAN_STATUS_LABELS, LOAN_TYPE_LABELS, loanTone, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAvatar, AppBadge } from '@/shared/components';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** A loan or salary advance in the grid: what was lent and on what terms, how much is repaid and what's left, and whose it is. */
const props = defineProps<{ loan: Loan }>();

const TYPE_ICON: Record<LoanType, Component> = { ADVANCE: Wallet, LOAN: Landmark };
const TYPE_TILE: Record<LoanType, string> = { ADVANCE: 'bg-info-soft text-info-fg ring-info/15', LOAN: 'bg-special-soft text-special-fg ring-special/15' };

const l = computed(() => props.loan);
const repaying = computed(() => l.value.status === 'ACTIVE' || l.value.status === 'CLOSED');
const progress = computed(() => (l.value.principal ? Math.min(100, Math.round((l.value.repaid / l.value.principal) * 100)) : 0));
const left = computed(() => instalmentsLeft(l.value));
const nextMonth = computed(() => (l.value.start ? new Date(l.value.start.year, l.value.start.month - 1 + l.value.instalmentsPaid, 1).toLocaleDateString(appLocale(), { month: 'short', year: 'numeric' }) : null));
const terms = computed(() => [l.value.emi ? `${rupees(l.value.emi)} × ${l.value.tenureMonths}` : `${l.value.tenureMonths} months`, l.value.interestRate ? `${l.value.interestRate}% a year` : 'Interest-free'].join(' · '));
</script>

<template>
  <div :class="['flex h-full flex-col gap-4', (l.status === 'CANCELLED' || l.status === 'REJECTED') && 'opacity-75']">
    <div class="flex items-start gap-3">
      <span :class="['grid h-11 w-11 shrink-0 place-items-center rounded-xl ring-1 ring-inset', TYPE_TILE[l.type]]" aria-hidden="true"><component :is="TYPE_ICON[l.type]" :size="19" /></span>
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm leading-snug font-semibold text-fg">{{ LOAN_TYPE_LABELS[l.type] }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted"><span class="font-mono">{{ l.reference }}</span><template v-if="l.disbursedOn"> · paid out {{ formatDate(l.disbursedOn) }}</template></p>
      </div>
      <AppBadge class="shrink-0" :tone="loanTone[l.status]" size="sm" dot>{{ LOAN_STATUS_LABELS[l.status] }}</AppBadge>
    </div>

    <div>
      <p class="text-2xs font-medium text-fg-subtle">Amount</p>
      <p class="text-xl font-semibold tracking-tight text-fg tabular-nums">{{ rupees(l.principal) }}</p>
      <p class="mt-0.5 text-2xs text-fg-muted tabular-nums">{{ terms }}</p>
      <p v-if="l.purpose" class="mt-2 line-clamp-2 text-xs text-fg-subtle" :title="l.purpose">{{ l.purpose }}</p>
    </div>

    <div v-if="repaying" class="rounded-lg bg-surface-muted/50 px-3 py-2.5">
      <div class="flex items-baseline justify-between gap-2 text-2xs text-fg-muted tabular-nums">
        <span><span class="text-sm font-semibold text-fg">{{ progress }}%</span> repaid</span>
        <span>{{ l.status === 'CLOSED' ? 'Fully repaid' : `${rupees(l.outstanding)} left` }}</span>
      </div>
      <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" :aria-label="`${l.reference} repaid`">
        <div :class="['h-full rounded-full transition-all', l.status === 'CLOSED' ? 'bg-success' : 'bg-brand-500']" :style="{ width: `${progress}%` }" />
      </div>
      <p v-if="l.status === 'ACTIVE' && l.nextInstalment" class="mt-1.5 flex items-center gap-1 text-2xs text-fg-muted tabular-nums">
        <CalendarClock :size="11" class="shrink-0 text-fg-subtle" aria-hidden="true" />
        <span class="truncate">Next {{ rupees(l.nextInstalment.amount) }}{{ nextMonth ? ` · ${nextMonth}` : '' }} · {{ nextInstalmentNumber(l) }} of {{ l.tenureMonths }}<template v-if="left > 1"> · {{ left }} left</template></span>
      </p>
    </div>
    <p v-else-if="l.status === 'REQUESTED'" class="flex items-center gap-2 rounded-lg bg-warning-soft/60 px-3 py-2 text-xs text-warning-fg">
      <Hourglass :size="13" class="shrink-0" aria-hidden="true" />Asked {{ timeAgo(l.createdAt) }}
    </p>
    <p v-else-if="l.status === 'APPROVED'" class="flex items-center gap-2 rounded-lg bg-info-soft/60 px-3 py-2 text-xs text-info-fg">
      <CalendarClock :size="13" class="shrink-0" aria-hidden="true" /><span class="min-w-0 truncate">To pay out{{ l.start ? ` · deductions from ${l.start.label}` : '' }}</span>
    </p>

    <div class="mt-auto flex items-center gap-2.5 border-t border-line/60 pt-3">
      <AppAvatar :name="l.employee?.name ?? '?'" size="sm" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs font-medium text-fg">{{ l.employee?.name }}</p>
        <p class="truncate text-2xs text-fg-subtle">{{ l.employee?.employeeCode }}{{ l.employee?.department ? ` · ${l.employee.department}` : '' }}</p>
      </div>
      <ArrowRight :size="14" class="shrink-0 text-fg-subtle transition group-hover/card:translate-x-0.5 group-hover/card:text-accent-fg rtl:rotate-180" aria-hidden="true" />
    </div>
  </div>
</template>
