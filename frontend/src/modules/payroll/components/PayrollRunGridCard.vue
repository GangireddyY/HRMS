<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Calculator, History, Users } from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import PaySplitBar, { type PaySegment } from '@/modules/payroll/components/PaySplitBar.vue';
import RunStepper from '@/modules/payroll/components/RunStepper.vue';
import type { PayrollRun } from '@/modules/payroll/types';
import { RUN_STATUS_LABELS, rupees, runTone } from '@/modules/payroll/utils/payroll-format';
import type { Change } from '@/modules/payroll/utils/run-compare';
import { AppBadge } from '@/shared/components';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

/** A payroll run in the grid: the month, where it is in the workflow, net pay against the month before, how the gross splits and the last step. */
const props = defineProps<{ run: PayrollRun; change: Change | null; lastStep: { text: string; at: string } }>();

const r = computed(() => props.run);
const calculated = computed(() => !!r.value.calculatedAt);
const sentBack = computed(() => r.value.status === 'DRAFT' && !!r.value.reviewNote);
const tile = computed(() => ({ month: new Date(r.value.year, r.value.month - 1, 1).toLocaleDateString(appLocale(), { month: 'short' }), year: r.value.year }));
const next = computed(() => {
  const x = r.value;
  if (x.status === 'CANCELLED') return { text: 'Cancelled', tone: 'text-fg-subtle' };
  if (x.status === 'PAID') return { text: x.paymentReference ? `Paid · ${x.paymentReference}` : 'Paid', tone: 'text-success-fg' };
  if (x.status === 'APPROVED') return { text: 'Transfer salaries, then mark paid', tone: 'text-info-fg' };
  if (x.status === 'SUBMITTED') return { text: 'Waiting for an approver', tone: 'text-warning-fg' };
  if (sentBack.value) return { text: 'Sent back · fix and resubmit', tone: 'text-warning-fg' };
  return { text: x.calculatedAt ? 'Review, then submit' : 'Calculate the payslips', tone: 'text-accent-fg' };
});
const pct = (part: number) => {
  const v = r.value.totalGross ? (part / r.value.totalGross) * 100 : 0;
  return v > 0 && v < 1 ? '<1%' : `${Math.round(v)}%`;
};
const split = computed<PaySegment[]>(() => [
  { key: 'net', label: 'Net pay', amount: r.value.totalNet, color: 'bg-brand-500' },
  { key: 'deductions', label: 'Deductions', amount: r.value.totalDeductions, color: 'bg-warning' },
]);
</script>

<template>
  <div :class="['flex h-full flex-col gap-4', r.status === 'CANCELLED' && 'opacity-70']">
    <div class="flex items-start gap-3">
      <div class="flex w-12 shrink-0 flex-col items-center rounded-xl bg-accent-soft py-1.5 ring-1 ring-brand-500/15 ring-inset" aria-hidden="true">
        <span class="text-2xs leading-4 font-semibold text-accent-fg uppercase">{{ tile.month }}</span>
        <span class="text-sm leading-5 font-semibold text-fg tabular-nums">{{ tile.year }}</span>
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm leading-snug font-semibold text-fg">{{ r.period }}</h3>
        <p class="mt-0.5 flex items-center gap-1 truncate text-xs text-fg-muted">
          <Users :size="12" class="shrink-0 text-fg-subtle" aria-hidden="true" />
          <span class="tabular-nums">{{ calculated ? `${r.employeeCount} employee${r.employeeCount === 1 ? '' : 's'}` : 'Not calculated' }}</span>
          <template v-if="r.warningCount && r.status === 'DRAFT'">
            <span class="text-fg-subtle">·</span>
            <span class="inline-flex items-center gap-0.5 font-medium text-warning-fg tabular-nums"><AlertTriangle :size="11" aria-hidden="true" />{{ r.warningCount }} warning{{ r.warningCount === 1 ? '' : 's' }}</span>
          </template>
        </p>
      </div>
      <AppBadge class="shrink-0" :tone="runTone[r.status]" size="sm" dot>{{ sentBack ? 'Sent back' : RUN_STATUS_LABELS[r.status] }}</AppBadge>
    </div>

    <div v-if="r.status !== 'CANCELLED'" class="flex items-center gap-2.5 rounded-lg bg-surface-muted/50 px-3 py-2">
      <RunStepper :run="r" compact />
      <span :class="['min-w-0 flex-1 truncate text-end text-2xs font-medium', next.tone]">{{ next.text }}</span>
    </div>

    <template v-if="calculated">
      <div>
        <p class="text-2xs font-medium text-fg-subtle">Net pay</p>
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p class="text-xl font-semibold tracking-tight text-fg tabular-nums">{{ rupees(r.totalNet) }}</p>
          <span v-if="change && change.direction !== 'same'" :class="['inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-2xs font-semibold tabular-nums', change.direction === 'up' ? 'bg-warning-soft text-warning-fg' : 'bg-success-soft text-success-fg']">
            <component :is="change.direction === 'up' ? ArrowUpRight : ArrowDownRight" :size="11" aria-hidden="true" /><span class="sr-only">{{ change.direction === 'up' ? 'Up' : 'Down' }} </span>{{ change.pct }}%
          </span>
          <span v-if="change" class="text-2xs text-fg-subtle">{{ change.direction === 'same' ? 'Same as last month' : 'vs last month' }}</span>
        </div>
      </div>

      <div v-if="r.totalGross > 0">
        <PaySplitBar :segments="split" :label="`${r.period} gross pay`" size="sm" />
        <p class="mt-1.5 flex gap-3 text-2xs text-fg-muted" aria-hidden="true">
          <span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-brand-500" />Net {{ pct(r.totalNet) }}</span>
          <span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-warning" />Deductions {{ pct(r.totalDeductions) }}</span>
        </p>
      </div>

      <dl class="grid grid-cols-2 gap-2">
        <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
          <dt class="text-2xs text-fg-subtle">Gross</dt>
          <dd class="mt-0.5 truncate text-xs font-medium text-fg tabular-nums">{{ rupees(r.totalGross) }}</dd>
        </div>
        <div class="rounded-lg bg-surface-muted/50 px-3 py-2" :title="`Gross + ${rupees(r.totalEmployerContributions)} employer contributions`">
          <dt class="text-2xs text-fg-subtle">Employer cost</dt>
          <dd class="mt-0.5 truncate text-xs font-medium text-fg tabular-nums">{{ rupees(r.totalGross + r.totalEmployerContributions) }}</dd>
        </div>
      </dl>
    </template>
    <div v-else class="flex items-center gap-3 rounded-lg border border-dashed border-line px-3 py-3">
      <span class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-muted text-fg-subtle" aria-hidden="true"><Calculator :size="15" /></span>
      <p class="text-xs text-fg-muted">{{ r.status === 'CANCELLED' ? 'Cancelled before it was calculated.' : 'Totals appear once the payslips are calculated.' }}</p>
    </div>

    <div class="mt-auto flex items-center gap-2.5 border-t border-line/60 pt-3">
      <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-muted text-fg-subtle" aria-hidden="true"><History :size="13" /></span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs font-medium text-fg">{{ lastStep.text }}</p>
        <p class="truncate text-2xs text-fg-subtle" :title="formatDateTime(lastStep.at)">{{ timeAgo(lastStep.at) }}</p>
      </div>
      <span class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-fg-subtle transition group-hover/card:text-accent-fg" aria-hidden="true">
        Open<ArrowRight :size="13" class="transition group-hover/card:translate-x-0.5 rtl:rotate-180" />
      </span>
    </div>
  </div>
</template>
