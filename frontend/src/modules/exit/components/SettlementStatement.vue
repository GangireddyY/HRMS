<script setup lang="ts">
import { computed } from 'vue';
import type { Settlement } from '@/modules/exit/types';
import { SETTLEMENT_LABELS, TYPE_LABELS, inr, settlementTone } from '@/modules/exit/utils/exit-format';
import { AppBadge } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/** The full & final statement: earnings, deductions and the net amount (printable). */
const props = defineProps<{ settlement: Settlement; organization?: string | null }>();
const earnings = computed(() => props.settlement.lines.filter((l) => l.kind === 'EARNING'));
const deductions = computed(() => props.settlement.lines.filter((l) => l.kind === 'DEDUCTION'));
</script>

<template>
  <section class="rounded-2xl bg-surface p-4 ring-1 ring-line print:p-0 print:ring-0" aria-label="Full and final settlement statement">
    <header class="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
      <div>
        <p v-if="organization" class="text-xs font-medium tracking-wide text-fg-muted uppercase">{{ organization }}</p>
        <h2 class="text-lg font-semibold text-fg">Full &amp; final settlement</h2>
        <p class="text-sm text-fg-muted">
          {{ settlement.employee.name }} ({{ settlement.employee.employeeCode }}){{ settlement.employee.designation ? ` · ${settlement.employee.designation}` : '' }}{{ settlement.employee.department ? ` · ${settlement.employee.department}` : '' }}
        </p>
        <p class="text-sm text-fg-muted">
          {{ TYPE_LABELS[settlement.exitType] }} · joined {{ formatDate(settlement.employee.dateOfJoining) }} · last working day {{ settlement.lastWorkingDay ? formatDate(settlement.lastWorkingDay) : '—' }}
        </p>
      </div>
      <div class="text-right">
        <AppBadge :tone="settlementTone[settlement.status]" dot>{{ SETTLEMENT_LABELS[settlement.status] }}</AppBadge>
        <p class="mt-1 text-xs" :class="settlement.overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-fg-muted'">
          <template v-if="settlement.paidOn">Paid {{ formatDate(settlement.paidOn) }}{{ settlement.paymentReference ? ` · ref ${settlement.paymentReference}` : '' }}</template>
          <template v-else>Due by {{ formatDate(settlement.dueOn) }}{{ settlement.overdue ? ' · overdue' : '' }}</template>
        </p>
      </div>
    </header>
    <div class="grid gap-4 md:grid-cols-2">
      <div v-for="group in [{ title: 'Earnings', lines: earnings, total: settlement.totalEarnings }, { title: 'Deductions', lines: deductions, total: settlement.totalDeductions }]" :key="group.title">
        <h3 class="mb-2 text-sm font-medium text-fg">{{ group.title }}</h3>
        <p v-if="!group.lines.length" class="text-sm text-fg-muted">None</p>
        <dl v-else class="space-y-2 text-sm">
          <div v-for="l in group.lines" :key="l.code" class="flex justify-between gap-4">
            <dt class="min-w-0">
              <p class="text-fg">{{ l.label }}</p>
              <p v-if="l.detail" class="text-xs text-fg-muted">{{ l.detail }}</p>
            </dt>
            <dd class="shrink-0 font-medium text-fg tabular-nums">{{ inr(l.amount) }}</dd>
          </div>
        </dl>
        <p class="mt-3 flex justify-between border-t border-line pt-2 text-sm font-medium text-fg"><span>Total {{ group.title.toLowerCase() }}</span><span class="tabular-nums">{{ inr(group.total) }}</span></p>
      </div>
    </div>
    <p class="mt-4 flex items-baseline justify-between rounded-xl bg-surface-muted/60 px-4 py-3">
      <span class="text-sm font-medium text-fg">{{ settlement.netPayable < 0 ? 'Payable by the employee' : 'Net payable' }}</span>
      <span class="text-2xl font-semibold text-fg tabular-nums">{{ inr(Math.abs(settlement.netPayable)) }}</span>
    </p>
    <p class="mt-3 text-xs text-fg-muted">The salary for the final month is paid with the regular payroll, prorated to the last working day.</p>
  </section>
</template>
