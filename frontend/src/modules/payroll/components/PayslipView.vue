<script setup lang="ts">
import { computed } from 'vue';
import { apiAssetUrl } from '@/core/http/http-client';
import type { PayslipDetail } from '@/modules/payroll/types';
import { REGIME_LABELS, rupees } from '@/modules/payroll/utils/payroll-format';
import { formatDate } from '@/shared/utils/format';

/** Payslip as printed: employee details, attendance, earnings, deductions, net pay, employer contributions and the TDS working. */
const props = defineProps<{ payslip: PayslipDetail; showTax?: boolean }>();
const p = computed(() => props.payslip);
const rows = computed(() => {
  const n = Math.max(p.value.earnings.length, p.value.deductions.length);
  return Array.from({ length: n }, (_, i) => ({ earning: p.value.earnings[i], deduction: p.value.deductions[i] }));
});

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ones[h]} Hundred` : '', r < 20 ? ones[r] : `${tens[Math.floor(r / 10)]}${r % 10 ? ` ${ones[r % 10]}` : ''}`].filter(Boolean).join(' ');
}
/** Indian numbering in words: "One Lakh Twenty Three Thousand Four Hundred Fifty Six". */
function inWords(amount: number): string {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  for (const [size, name] of [[10_000_000, 'Crore'], [100_000, 'Lakh'], [1000, 'Thousand']] as const) {
    const q = Math.floor(n / size);
    if (q) parts.push(`${q >= 1000 ? inWords(q) : below1000(q)} ${name}`);
    n %= size;
  }
  if (n) parts.push(below1000(n));
  return parts.join(' ');
}
</script>

<template>
  <article class="payslip card p-4 print:rounded-none print:p-0 print:ring-0">
    <header class="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
      <div class="flex items-center gap-3">
        <img v-if="p.organization?.logoUrl" :src="apiAssetUrl(p.organization.logoUrl)!" alt="" class="h-10 w-10 rounded-lg object-contain" />
        <div>
          <p class="text-lg font-semibold text-fg">{{ p.organization?.name }}</p>
          <p v-if="p.organization?.address" class="text-xs text-fg-muted">{{ p.organization.address }}</p>
        </div>
      </div>
      <div class="text-end">
        <p class="text-xs tracking-wide text-fg-muted uppercase">Payslip</p>
        <p class="text-lg font-semibold text-fg">{{ p.period }}</p>
      </div>
    </header>

    <dl class="grid gap-x-4 gap-y-2 border-b border-line py-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <div><dt class="text-xs text-fg-muted">Employee</dt><dd class="font-medium text-fg">{{ p.employee.name }} ({{ p.employee.employeeCode }})</dd></div>
      <div><dt class="text-xs text-fg-muted">Designation</dt><dd class="text-fg">{{ p.employee.designation ?? '—' }}</dd></div>
      <div><dt class="text-xs text-fg-muted">Department</dt><dd class="text-fg">{{ p.employee.department ?? '—' }}</dd></div>
      <div><dt class="text-xs text-fg-muted">Date of joining</dt><dd class="text-fg">{{ formatDate(p.employee.dateOfJoining) }}</dd></div>
      <div><dt class="text-xs text-fg-muted">PAN</dt><dd class="text-fg">{{ p.employee.pan ?? 'Not recorded' }}</dd></div>
      <div><dt class="text-xs text-fg-muted">UAN</dt><dd class="text-fg">{{ p.employee.uan ?? '—' }}</dd></div>
      <div><dt class="text-xs text-fg-muted">Bank account</dt><dd class="text-fg">{{ p.employee.bank ? `${p.employee.bank.name ?? 'Account'} ••${p.employee.bank.accountLast4}` : '—' }}</dd></div>
      <div><dt class="text-xs text-fg-muted">Days paid</dt><dd class="text-fg">{{ p.payableDays }} of {{ p.daysInMonth }}</dd></div>
      <div><dt class="text-xs text-fg-muted">Loss of pay</dt><dd class="text-fg">{{ p.lopOverride ?? p.lopDays }} day{{ (p.lopOverride ?? p.lopDays) === 1 ? '' : 's' }}</dd></div>
    </dl>

    <div class="overflow-x-auto py-4">
      <table class="w-full min-w-[480px] text-sm">
        <caption class="sr-only">Earnings and deductions</caption>
        <thead>
          <tr class="text-start text-xs text-fg-muted">
            <th scope="col" class="pb-2 font-medium">Earnings</th>
            <th scope="col" class="pb-2 pe-6 text-end font-medium">Amount</th>
            <th scope="col" class="pb-2 font-medium">Deductions</th>
            <th scope="col" class="pb-2 text-end font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i" class="border-t border-line/50">
            <td class="py-2 text-fg">{{ r.earning?.name }}</td>
            <td class="py-2 pe-6 text-end tabular-nums">{{ r.earning ? rupees(r.earning.amount) : '' }}</td>
            <td class="py-2 text-fg">{{ r.deduction?.name }}</td>
            <td class="py-2 text-end tabular-nums">{{ r.deduction ? rupees(r.deduction.amount) : '' }}</td>
          </tr>
          <tr class="border-t border-line font-semibold">
            <td class="py-2 text-fg">Gross earnings</td>
            <td class="py-2 pe-6 text-end tabular-nums">{{ rupees(p.gross) }}</td>
            <td class="py-2 text-fg">Total deductions</td>
            <td class="py-2 text-end tabular-nums">{{ rupees(p.totalDeductions) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent-soft px-4 py-3 print:bg-transparent print:px-0">
      <div>
        <p class="text-xs text-fg-muted">Net pay</p>
        <p class="text-xs text-fg-muted">Rupees {{ inWords(p.netPay) }} only</p>
      </div>
      <p class="text-2xl font-semibold tracking-tight text-fg tabular-nums">{{ rupees(p.netPay) }}</p>
    </div>

    <div v-if="p.employerContributions.length" class="pt-4 text-sm">
      <p class="mb-1 text-xs text-fg-muted">Employer contributions (part of CTC, not deducted)</p>
      <p class="text-fg-muted">
        <span v-for="(c, i) in p.employerContributions" :key="c.code">{{ c.name }} {{ rupees(c.amount) }}<template v-if="i < p.employerContributions.length - 1"> · </template></span>
      </p>
    </div>

    <details v-if="showTax !== false && p.tax" class="mt-4 rounded-xl p-4 text-sm ring-1 ring-line print:hidden">
      <summary class="cursor-pointer font-medium text-fg">How income tax was worked out ({{ REGIME_LABELS[p.tax.regime] }})</summary>
      <dl class="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <div class="flex justify-between gap-3"><dt class="text-fg-muted">Projected salary for the year</dt><dd class="tabular-nums">{{ rupees(p.tax.projectedGross) }}</dd></div>
        <div class="flex justify-between gap-3"><dt class="text-fg-muted">Standard deduction</dt><dd class="tabular-nums">− {{ rupees(p.tax.standardDeduction) }}</dd></div>
        <div v-if="p.tax.hraExemption" class="flex justify-between gap-3"><dt class="text-fg-muted">HRA exemption</dt><dd class="tabular-nums">− {{ rupees(p.tax.hraExemption) }}</dd></div>
        <div v-if="p.tax.deductions.section80c" class="flex justify-between gap-3"><dt class="text-fg-muted">Section 80C (incl. PF)</dt><dd class="tabular-nums">− {{ rupees(p.tax.deductions.section80c) }}</dd></div>
        <div v-if="p.tax.deductions.section80ccd1b" class="flex justify-between gap-3"><dt class="text-fg-muted">Section 80CCD(1B)</dt><dd class="tabular-nums">− {{ rupees(p.tax.deductions.section80ccd1b) }}</dd></div>
        <div v-if="p.tax.deductions.section80d" class="flex justify-between gap-3"><dt class="text-fg-muted">Section 80D</dt><dd class="tabular-nums">− {{ rupees(p.tax.deductions.section80d) }}</dd></div>
        <div v-if="p.tax.deductions.homeLoanInterest" class="flex justify-between gap-3"><dt class="text-fg-muted">Home loan interest</dt><dd class="tabular-nums">− {{ rupees(p.tax.deductions.homeLoanInterest) }}</dd></div>
        <div v-if="p.tax.deductions.professionalTax" class="flex justify-between gap-3"><dt class="text-fg-muted">Professional tax</dt><dd class="tabular-nums">− {{ rupees(p.tax.deductions.professionalTax) }}</dd></div>
        <div class="flex justify-between gap-3 font-medium"><dt>Taxable income</dt><dd class="tabular-nums">{{ rupees(p.tax.tax.taxableIncome) }}</dd></div>
        <div class="flex justify-between gap-3"><dt class="text-fg-muted">Tax on slabs</dt><dd class="tabular-nums">{{ rupees(p.tax.tax.slabTax) }}</dd></div>
        <div v-if="p.tax.tax.rebate" class="flex justify-between gap-3"><dt class="text-fg-muted">Rebate (section 87A)</dt><dd class="tabular-nums">− {{ rupees(p.tax.tax.rebate) }}</dd></div>
        <div v-if="p.tax.tax.surcharge" class="flex justify-between gap-3"><dt class="text-fg-muted">Surcharge</dt><dd class="tabular-nums">{{ rupees(p.tax.tax.surcharge) }}</dd></div>
        <div class="flex justify-between gap-3"><dt class="text-fg-muted">Health & education cess (4%)</dt><dd class="tabular-nums">{{ rupees(p.tax.tax.cess) }}</dd></div>
        <div class="flex justify-between gap-3 font-medium"><dt>Tax for the year</dt><dd class="tabular-nums">{{ rupees(p.tax.tax.total) }}</dd></div>
        <div class="flex justify-between gap-3"><dt class="text-fg-muted">Deducted so far</dt><dd class="tabular-nums">{{ rupees(p.tax.alreadyDeducted) }}</dd></div>
        <div class="flex justify-between gap-3 font-medium"><dt>This month ({{ p.tax.monthsLeftIncludingThis }} month{{ p.tax.monthsLeftIncludingThis === 1 ? '' : 's' }} left)</dt><dd class="tabular-nums">{{ rupees(p.tax.thisMonth) }}</dd></div>
      </dl>
    </details>
    <p class="mt-4 text-2xs text-fg-subtle">This is a computer-generated payslip and does not need a signature.</p>
  </article>
</template>
