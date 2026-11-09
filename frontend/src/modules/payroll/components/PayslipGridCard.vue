<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, ArrowRight, CalendarDays, Landmark, PauseCircle } from '@lucide/vue';
import PaySplitBar, { type PaySegment } from '@/modules/payroll/components/PaySplitBar.vue';
import type { PayslipSummary } from '@/modules/payroll/types';
import { isBlocking, rupees, warningText } from '@/modules/payroll/utils/payroll-format';
import { AppAvatar, AppBadge } from '@/shared/components';

/** A payslip inside a payroll run: who, net pay, how the gross splits into net and deductions, days paid and anything to review. */
const props = defineProps<{ payslip: PayslipSummary }>();

const p = computed(() => props.payslip);
const lop = computed(() => p.value.lopOverride ?? p.value.lopDays);
const blocking = computed(() => p.value.warnings.some(isBlocking));
const firstWarning = computed(() => p.value.warnings.find(isBlocking) ?? p.value.warnings[0] ?? null);
const split = computed<PaySegment[]>(() => [
  { key: 'net', label: 'Net pay', amount: p.value.netPay, color: 'bg-brand-500' },
  { key: 'deductions', label: 'Deductions', amount: p.value.totalDeductions, color: 'bg-warning' },
]);
const bank = computed(() => {
  const b = p.value.employee.bank;
  return b ? `${b.name ?? 'Bank'} ••${b.accountLast4}` : null;
});
</script>

<template>
  <div :class="['flex h-full flex-col gap-4', p.excluded && 'opacity-80']">
    <div class="flex items-start gap-3">
      <AppAvatar :name="p.employee.name" />
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm leading-snug font-semibold text-fg">{{ p.employee.name }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted">
          <span class="font-mono">{{ p.employee.employeeCode }}</span><template v-if="p.employee.department"> · {{ p.employee.department }}</template>
        </p>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-1">
        <AppBadge v-if="p.excluded" tone="warning" size="sm" dot>Held</AppBadge>
        <AppBadge v-if="blocking" tone="danger" size="sm" dot>Problem</AppBadge>
        <AppBadge v-else-if="p.warnings.length" tone="warning" size="sm" :title="p.warnings.map(warningText).join('\n')">
          <AlertTriangle :size="11" aria-hidden="true" />{{ p.warnings.length }}<span class="sr-only"> warning{{ p.warnings.length === 1 ? '' : 's' }}</span>
        </AppBadge>
      </div>
    </div>

    <div class="flex items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="text-2xs font-medium text-fg-subtle">Net pay</p>
        <p :class="['text-xl font-semibold tracking-tight tabular-nums', p.netPay < 0 ? 'text-danger-fg' : 'text-fg', p.excluded && 'line-through decoration-fg-subtle/50']">{{ rupees(p.netPay) }}</p>
      </div>
      <div class="text-end">
        <p class="inline-flex items-center gap-1 text-2xs text-fg-subtle"><CalendarDays :size="11" aria-hidden="true" />Days paid</p>
        <p class="text-sm font-semibold text-fg tabular-nums">{{ p.payableDays }}<span class="font-normal text-fg-subtle">/{{ p.daysInMonth }}</span></p>
      </div>
    </div>

    <div>
      <PaySplitBar :segments="split" :label="`${p.employee.name} gross pay`" size="sm" />
      <dl class="mt-2 grid grid-cols-2 gap-2">
        <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
          <dt class="flex items-center gap-1.5 text-2xs text-fg-subtle"><span class="h-1.5 w-1.5 rounded-full bg-line-strong" aria-hidden="true" />Gross</dt>
          <dd class="mt-0.5 truncate text-xs font-medium text-fg tabular-nums">{{ rupees(p.gross) }}</dd>
        </div>
        <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
          <dt class="flex items-center gap-1.5 text-2xs text-fg-subtle"><span class="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />Deductions</dt>
          <dd class="mt-0.5 truncate text-xs font-medium text-fg tabular-nums">{{ p.totalDeductions ? `− ${rupees(p.totalDeductions)}` : rupees(0) }}</dd>
        </div>
      </dl>
    </div>

    <ul v-if="lop > 0 || p.excluded || firstWarning" class="space-y-1.5 text-xs">
      <li v-if="lop > 0" class="flex items-center gap-1.5 font-medium text-warning-fg tabular-nums">
        <CalendarDays :size="12" class="shrink-0" aria-hidden="true" />{{ lop }} day{{ lop === 1 ? '' : 's' }} loss of pay{{ p.lopOverride !== null ? ' · edited' : '' }}
      </li>
      <li v-if="p.excluded" class="flex items-start gap-1.5 text-warning-fg">
        <PauseCircle :size="12" class="mt-0.5 shrink-0" aria-hidden="true" /><span class="line-clamp-2">Held{{ p.excludeReason ? `: ${p.excludeReason}` : '' }}</span>
      </li>
      <li v-if="firstWarning" :class="['flex items-start gap-1.5', isBlocking(firstWarning) ? 'text-danger-fg' : 'text-warning-fg']">
        <AlertTriangle :size="12" class="mt-0.5 shrink-0" aria-hidden="true" />
        <span class="line-clamp-2">{{ warningText(firstWarning) }}<template v-if="p.warnings.length > 1"> (+{{ p.warnings.length - 1 }} more)</template></span>
      </li>
    </ul>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <Landmark :size="13" :class="['shrink-0', bank ? 'text-fg-subtle' : 'text-warning-fg']" aria-hidden="true" />
      <p :class="['min-w-0 flex-1 truncate text-2xs', bank ? 'text-fg-muted' : 'text-warning-fg']">{{ bank ?? 'No bank account on file' }}</p>
      <span class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-fg-subtle transition group-hover/card:text-accent-fg" aria-hidden="true">
        Payslip<ArrowRight :size="13" class="transition group-hover/card:translate-x-0.5 rtl:rotate-180" />
      </span>
    </div>
  </div>
</template>
