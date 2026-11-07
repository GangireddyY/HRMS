<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Printer } from '@lucide/vue';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import PayslipView from '@/modules/payroll/components/PayslipView.vue';
import { REGIME_LABELS, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppButton, AppCard, AppErrorState, AppFacts, AppPageHeader, AppSkeleton, AppSplit, type Fact } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAssistantStore } from '@/modules/assistant/assistant.store';

/** One payslip, printable (browser "Save as PDF"). Used in My Workspace and from payroll runs. */
const route = useRoute();
const assistant = useAssistantStore();
const id = computed(() => String(route.params.id));
const payslip = useAsync(() => payrollApi.payslip(id.value));
watch(id, () => void payslip.run());
const print = () => window.print();
const hr = computed(() => route.path.startsWith('/hr'));
const back = computed(() => (hr.value && payslip.data.value ? `/hr/payroll/runs/${payslip.data.value.runId}` : '/me/payslips'));

const p = computed(() => payslip.data.value);
const deductionShare = computed(() => (p.value && p.value.gross > 0 ? Math.round((p.value.totalDeductions / p.value.gross) * 100) : 0));
const days = computed<Fact[]>(() =>
  p.value
    ? [
        { label: 'Days in month', value: p.value.daysInMonth },
        { label: 'Days employed', value: p.value.employedDays },
        { label: 'Loss of pay', value: p.value.lopOverride ?? p.value.lopDays },
        { label: 'Paid days', value: p.value.payableDays, strong: true },
      ]
    : [],
);
const employee = computed<Fact[]>(() => {
  const e = p.value?.employee;
  if (!e) return [];
  return [
    { label: 'Employee code', value: e.employeeCode, mono: true },
    { label: 'Department', value: e.department },
    { label: 'PAN', value: e.pan, mono: true },
    { label: 'UAN', value: e.uan, mono: true },
    { label: 'Bank', value: e.bank ? `${e.bank.name ?? 'Account'} ··${e.bank.accountLast4}` : null },
    { label: 'Tax regime', value: p.value?.tax ? REGIME_LABELS[p.value.tax.regime] : null },
  ];
});
</script>

<template>
  <div>
    <AppPageHeader class="print:hidden" :title="p ? `Payslip · ${p.period}` : 'Payslip'" :back="back" :back-label="hr ? 'Payroll run' : 'Payslips'">
      <template #actions><AppButton variant="secondary" :icon="Printer" :disabled="!p" @click="print">Print / save as PDF</AppButton></template>
    </AppPageHeader>
    <AppSkeleton v-if="payslip.loading.value && !p" :lines="10" />
    <AppErrorState v-else-if="payslip.error.value" :error="payslip.error.value" title="This payslip isn't available" @retry="payslip.run" />
    <AppSplit v-else-if="p">
      <PayslipView :payslip="p" />
      <template #aside>
        <section class="card ai-ring bg-ai-wash p-4">
          <p class="text-xs font-medium tracking-wide text-fg-muted uppercase">Net pay · {{ p.period }}</p>
          <p class="mt-1 text-2xl font-semibold text-fg tabular-nums">{{ rupees(p.netPay) }}</p>
          <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`Deductions are ${deductionShare}% of gross`">
            <div class="h-full bg-brand-500" :style="{ width: `${100 - deductionShare}%` }" />
          </div>
          <div class="mt-2 flex justify-between text-xs text-fg-muted">
            <span>Gross {{ rupees(p.gross) }}</span>
            <span>Deductions {{ rupees(p.totalDeductions) }} ({{ deductionShare }}%)</span>
          </div>
        </section>
        <AppCard title="Attendance"><AppFacts :items="days" /></AppCard>
        <AppCard title="Details"><AppFacts :items="employee" /></AppCard>
        <AppButton v-if="!hr" block variant="secondary" @click="assistant.ask('my latest payslip')">Ask AI about my pay</AppButton>
      </template>
    </AppSplit>
  </div>
</template>
