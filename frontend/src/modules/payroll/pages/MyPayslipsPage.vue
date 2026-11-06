<script setup lang="ts">
import { computed } from 'vue';
import { ChevronRight, FileText } from '@lucide/vue';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { AppBadge, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton, AppStatCard } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { financialYearLabel, financialYearOf } from '@contracts';

const list = useAsync(() => payrollApi.myPayslips());
/** Totals for the financial year of the latest payslip. */
const year = computed(() => {
  const rows = list.data.value ?? [];
  if (!rows.length) return null;
  const fy = financialYearOf(rows[0]!.year, rows[0]!.month);
  const inYear = rows.filter((p) => financialYearOf(p.year, p.month) === fy);
  return { label: financialYearLabel(fy), gross: inYear.reduce((n, p) => n + p.gross, 0), net: inYear.reduce((n, p) => n + p.netPay, 0), deductions: inYear.reduce((n, p) => n + p.totalDeductions, 0) };
});
</script>

<template>
  <div class="space-y-6">
    <AppPageHeader title="Payslips" description="Your monthly payslips once payroll is approved. Open one to print or save it as a PDF." />
    <AppSkeleton v-if="list.loading.value && !list.data.value" :lines="5" />
    <AppErrorState v-else-if="list.error.value" :error="list.error.value" @retry="list.run" />
    <template v-else>
      <div v-if="year" class="grid gap-4 sm:grid-cols-3">
        <AppStatCard :label="`Gross pay · ${year.label}`" :value="rupees(year.gross)" />
        <AppStatCard :label="`Deductions · ${year.label}`" :value="rupees(year.deductions)" tone="warning" />
        <AppStatCard :label="`Net pay · ${year.label}`" :value="rupees(year.net)" tone="success" />
      </div>
      <AppCard v-if="!list.data.value?.length"><AppEmptyState :icon="FileText" title="No payslips yet" description="Your payslip appears here as soon as the month's payroll is approved." /></AppCard>
      <AppCard v-else :padded="false">
        <ul class="divide-y divide-line">
          <li v-for="p in list.data.value" :key="p.id">
            <RouterLink :to="`/me/payslips/${p.id}`" class="flex items-center gap-4 px-5 py-4 hover:bg-surface-muted/50">
              <div class="min-w-0 flex-1">
                <p class="font-medium text-fg">{{ p.period }}</p>
                <p class="text-xs text-fg-muted">Gross {{ rupees(p.gross) }} · deductions {{ rupees(p.totalDeductions) }}</p>
              </div>
              <AppBadge :tone="p.status === 'PAID' ? 'success' : 'info'" size="sm">{{ p.status === 'PAID' ? 'Paid' : 'Approved' }}</AppBadge>
              <span class="text-right font-semibold text-fg tabular-nums">{{ rupees(p.netPay) }}</span>
              <ChevronRight :size="16" class="text-fg-subtle" aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
      </AppCard>
    </template>
  </div>
</template>
