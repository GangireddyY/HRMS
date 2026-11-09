<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowRight, CalendarCheck, Clock, FileText, Printer, ReceiptText, Sparkles } from '@lucide/vue';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import PaySplitBar, { type PaySegment } from '@/modules/payroll/components/PaySplitBar.vue';
import PayslipView from '@/modules/payroll/components/PayslipView.vue';
import { RUN_STATUS_LABELS, rupees, runTone } from '@/modules/payroll/utils/payroll-format';
import { AppBadge, AppButton, AppCard, AppErrorState, AppPageHeader, AppSkeleton, AppSplit } from '@/shared/components';
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
const pct = (part: number, whole: number) => {
  const v = whole ? (part / whole) * 100 : 0;
  return v > 0 && v < 1 ? '<1%' : `${Math.round(v)}%`;
};
const DEDUCTION_COLORS = ['bg-amber-400 dark:bg-amber-500', 'bg-orange-400 dark:bg-orange-500', 'bg-rose-400 dark:bg-rose-500', 'bg-yellow-400 dark:bg-yellow-500', 'bg-red-400 dark:bg-red-500'];
const split = computed<PaySegment[]>(() => {
  const x = p.value;
  if (!x) return [];
  return [
    { key: 'net', label: 'Net pay', amount: x.netPay, color: 'bg-brand-500' },
    ...x.deductions.map((d, i) => ({ key: `d-${d.code}-${i}`, label: d.name, amount: d.amount, color: DEDUCTION_COLORS[i % DEDUCTION_COLORS.length]! })),
  ];
});
const employerTotal = computed(() => p.value?.employerContributions.reduce((n, c) => n + c.amount, 0) ?? 0);
const statusText = computed(() => {
  const s = p.value?.runStatus;
  if (s === 'PAID') return { icon: CalendarCheck, text: 'Paid' };
  if (s === 'APPROVED') return { icon: Clock, text: 'Approved · payment on its way' };
  return { icon: Clock, text: s ? `${RUN_STATUS_LABELS[s]} · not final yet` : '' };
});
</script>

<template>
  <div class="payslip-page">
    <AppPageHeader class="print:hidden" :title="p ? `Payslip · ${p.period}` : 'Payslip'" :description="p ? `${p.employee.name} · ${p.employee.employeeCode}${p.employee.designation ? ` · ${p.employee.designation}` : ''}` : undefined" :back="back" :back-label="hr ? 'Payroll run' : 'Payslips'">
      <template v-if="p" #badges><AppBadge :tone="runTone[p.runStatus]" dot>{{ p.runStatus === 'PAID' ? 'Paid' : RUN_STATUS_LABELS[p.runStatus] }}</AppBadge></template>
      <template #actions><AppButton variant="secondary" :icon="Printer" :disabled="!p" @click="print">Print / save as PDF</AppButton></template>
    </AppPageHeader>
    <AppSkeleton v-if="payslip.loading.value && !p" :lines="10" />
    <AppErrorState v-else-if="payslip.error.value" :error="payslip.error.value" title="This payslip isn't available" @retry="payslip.run" />
    <AppSplit v-else-if="p">
      <PayslipView :payslip="p" />
      <template #aside>
        <section class="card overflow-hidden" aria-labelledby="net-title">
          <div class="relative hero-banner px-5 py-5 text-white">
            <p class="relative inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium"><ReceiptText :size="13" aria-hidden="true" />{{ p.period }}</p>
            <h2 id="net-title" class="relative mt-3 text-xs tracking-wide text-white/75 uppercase">Net pay</h2>
            <p class="relative text-3xl font-semibold tracking-tight tabular-nums">{{ rupees(p.netPay) }}</p>
            <p class="relative mt-1 inline-flex items-center gap-1.5 text-xs text-white/85"><component :is="statusText.icon" :size="13" aria-hidden="true" />{{ statusText.text }}</p>
          </div>
          <div class="space-y-3 p-4">
            <PaySplitBar :segments="split" :label="`${p.period} gross pay`" />
            <dl class="space-y-2 text-sm">
              <div class="flex items-center justify-between gap-3">
                <dt class="flex items-center gap-2 text-fg-muted"><span class="h-2 w-2 rounded-sm bg-line-strong" aria-hidden="true" />Gross earnings</dt>
                <dd class="font-medium text-fg tabular-nums">{{ rupees(p.gross) }}</dd>
              </div>
              <div class="flex items-center justify-between gap-3">
                <dt class="flex items-center gap-2 text-fg-muted"><span class="h-2 w-2 rounded-sm bg-amber-400 dark:bg-amber-500" aria-hidden="true" />Deductions <span class="text-2xs text-fg-subtle">{{ pct(p.totalDeductions, p.gross) }}</span></dt>
                <dd class="font-medium text-fg tabular-nums">− {{ rupees(p.totalDeductions) }}</dd>
              </div>
              <div class="flex items-center justify-between gap-3 border-t border-line/70 pt-2">
                <dt class="flex items-center gap-2 font-medium text-fg"><span class="h-2 w-2 rounded-sm bg-brand-500" aria-hidden="true" />Net pay <span class="text-2xs font-normal text-fg-subtle">{{ pct(p.netPay, p.gross) }}</span></dt>
                <dd class="font-semibold text-fg tabular-nums">{{ rupees(p.netPay) }}</dd>
              </div>
              <div v-if="employerTotal" class="flex items-center justify-between gap-3 text-xs">
                <dt class="text-fg-muted">Employer contributions <span class="text-fg-subtle">(not deducted)</span></dt>
                <dd class="text-fg-muted tabular-nums">{{ rupees(employerTotal) }}</dd>
              </div>
            </dl>
          </div>
        </section>

        <AppCard title="Save a copy" :icon="FileText">
          <p class="text-xs text-fg-muted">Print it, or choose “Save as PDF” as the printer to keep a file. Only the payslip is printed.</p>
          <div class="mt-3 space-y-2">
            <AppButton block :icon="Printer" @click="print">Print / save as PDF</AppButton>
            <AppButton v-if="hr" block variant="ghost" :icon-right="ArrowRight" :to="back">Open the payroll run</AppButton>
            <template v-else>
              <AppButton block variant="secondary" :icon="Sparkles" @click="assistant.ask('my latest payslip')">Ask AI about my pay</AppButton>
              <AppButton block variant="ghost" :icon-right="ArrowRight" to="/me/payslips">All payslips</AppButton>
            </template>
          </div>
        </AppCard>
      </template>
    </AppSplit>
  </div>
</template>

<style>
/* Paper is narrower than the desktop breakpoint, so the phone top bar and tab bar would print with the payslip. */
@media print {
  body:has(.payslip-page) header.glass,
  body:has(.payslip-page) nav[aria-label='Tabs'] {
    display: none !important;
  }
}
</style>
