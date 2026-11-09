<script setup lang="ts">
import { computed } from 'vue';
import { apiAssetUrl } from '@/core/http/http-client';
import type { PayslipDetail, PayslipLine } from '@/modules/payroll/types';
import { REGIME_LABELS, rupees } from '@/modules/payroll/utils/payroll-format';
import { formatDate } from '@/shared/utils/format';

/** Payslip as printed: employee details, attendance, earnings, deductions, net pay, employer contributions and the TDS working. */
const props = defineProps<{ payslip: PayslipDetail; showTax?: boolean }>();
const p = computed(() => props.payslip);
const lop = computed(() => p.value.lopOverride ?? p.value.lopDays);
const final = computed(() => p.value.runStatus === 'APPROVED' || p.value.runStatus === 'PAID');
const sum = (lines: PayslipLine[]) => lines.reduce((n, l) => n + l.amount, 0);
const employerTotal = computed(() => sum(p.value.employerContributions));
/** Blank rows that keep the two totals on the same line. */
const pad = computed(() => {
  const n = Math.max(p.value.earnings.length, p.value.deductions.length || 1);
  return { earnings: n - p.value.earnings.length, deductions: n - Math.max(1, p.value.deductions.length) };
});

const facts = computed(() => {
  const e = p.value.employee;
  return [
    { label: 'Employee code', value: e.employeeCode, mono: true },
    { label: 'Date of joining', value: formatDate(e.dateOfJoining) },
    { label: 'Department', value: e.department ?? '—' },
    { label: 'Location', value: e.location ?? '—' },
    { label: 'PAN', value: e.pan ?? 'Not recorded', mono: !!e.pan },
    { label: 'UAN', value: e.uan ?? '—', mono: !!e.uan },
    { label: 'Bank account', value: e.bank ? `${e.bank.name ?? 'Account'} ••${e.bank.accountLast4}` : '—' },
    { label: 'Tax regime', value: p.value.tax ? REGIME_LABELS[p.value.tax.regime] : '—' },
    ...(e.exitDate ? [{ label: 'Last working day', value: formatDate(e.exitDate) }] : []),
  ];
});
const days = computed(() => [
  { label: 'Days in month', value: p.value.daysInMonth },
  { label: 'Days employed', value: p.value.employedDays },
  { label: 'Loss of pay', value: lop.value, warn: lop.value > 0 },
  { label: 'Paid days', value: p.value.payableDays, strong: true },
]);

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
  <article class="payslip card overflow-hidden print:rounded-none print:shadow-none print:ring-0" :aria-label="`Payslip for ${p.period}`">
    <div class="h-1.5 bg-gradient-to-r from-brand-700 via-brand-500 to-brand-300" aria-hidden="true" />
    <div class="p-5 sm:p-6">
      <!-- Letterhead -->
      <header class="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div class="flex min-w-0 items-center gap-3">
          <img v-if="p.organization?.logoUrl" :src="apiAssetUrl(p.organization.logoUrl)!" alt="" class="h-11 w-11 shrink-0 rounded-lg object-contain" />
          <div class="min-w-0">
            <p class="text-lg leading-6 font-semibold text-fg">{{ p.organization?.name }}</p>
            <p v-if="p.organization?.address" class="max-w-sm text-xs text-fg-muted">{{ p.organization.address }}</p>
          </div>
        </div>
        <div class="text-end">
          <p class="text-2xs font-semibold tracking-[0.18em] text-accent-fg uppercase">Payslip</p>
          <p class="text-xl leading-7 font-semibold tracking-tight text-fg">{{ p.period }}</p>
          <p v-if="!final" class="mt-1 inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-semibold text-warning-fg ring-1 ring-warning/20 ring-inset">
            <span class="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />Draft · not final until approved
          </p>
        </div>
      </header>

      <!-- Employee -->
      <section class="grid gap-5 border-b border-line py-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] print:grid-cols-[2fr_3fr]" aria-label="Employee">
        <div class="min-w-0">
          <p class="text-2xs font-medium text-fg-muted">Employee</p>
          <p class="text-base font-semibold text-fg">{{ p.employee.name }}</p>
          <p class="text-sm text-fg-muted">{{ p.employee.designation ?? '—' }}</p>
          <p v-if="p.excluded" class="mt-2 inline-flex rounded-md bg-warning-soft px-2 py-1 text-xs font-medium text-warning-fg">Salary held this month{{ p.excludeReason ? `: ${p.excludeReason}` : '' }}</p>
        </div>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-3 print:grid-cols-3">
          <div v-for="f in facts" :key="f.label" class="min-w-0">
            <dt class="text-2xs text-fg-muted">{{ f.label }}</dt>
            <dd :class="['truncate text-fg', f.mono && 'font-mono text-xs leading-5']">{{ f.value }}</dd>
          </div>
        </dl>
      </section>

      <!-- Attendance -->
      <dl class="my-5 grid grid-cols-2 overflow-hidden rounded-lg bg-line/70 ring-1 ring-line ring-inset sm:grid-cols-4 print:grid-cols-4" style="gap: 1px" aria-label="Attendance">
        <div v-for="d in days" :key="d.label" :class="['px-3 py-2', d.strong ? 'bg-accent-soft/60' : 'bg-surface']">
          <dt class="text-2xs text-fg-muted">{{ d.label }}</dt>
          <dd :class="['text-base font-semibold tabular-nums', d.warn ? 'text-warning-fg' : 'text-fg']">{{ d.value }}</dd>
        </div>
      </dl>

      <!-- Earnings and deductions -->
      <div class="grid items-start gap-5 sm:grid-cols-2 print:grid-cols-2">
        <table class="w-full text-sm">
          <caption class="sr-only">Earnings</caption>
          <thead>
            <tr class="border-b border-line text-2xs tracking-wide text-fg-muted uppercase">
              <th scope="col" class="pb-2 text-start font-semibold">Earnings</th>
              <th scope="col" class="pb-2 text-end font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line/60">
            <tr v-for="(e, i) in p.earnings" :key="`${e.code}-${i}`">
              <td class="py-2 text-fg">{{ e.name }}<span v-if="e.taxable === false" class="ms-1.5 text-2xs text-fg-subtle">tax-free</span></td>
              <td class="py-2 text-end text-fg tabular-nums">{{ rupees(e.amount) }}</td>
            </tr>
            <tr v-for="i in pad.earnings" :key="`pad-${i}`" class="max-sm:hidden" aria-hidden="true"><td colspan="2" class="py-2">&nbsp;</td></tr>
          </tbody>
          <tfoot>
            <tr class="border-t-2 border-line font-semibold">
              <th scope="row" class="pt-2.5 text-start text-fg">Gross earnings</th>
              <td class="pt-2.5 text-end text-fg tabular-nums">{{ rupees(p.gross) }}</td>
            </tr>
          </tfoot>
        </table>
        <table class="w-full text-sm">
          <caption class="sr-only">Deductions</caption>
          <thead>
            <tr class="border-b border-line text-2xs tracking-wide text-fg-muted uppercase">
              <th scope="col" class="pb-2 text-start font-semibold">Deductions</th>
              <th scope="col" class="pb-2 text-end font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line/60">
            <tr v-for="(d, i) in p.deductions" :key="`${d.code}-${i}`">
              <td class="py-2 text-fg">{{ d.name }}</td>
              <td class="py-2 text-end text-fg tabular-nums">{{ rupees(d.amount) }}</td>
            </tr>
            <tr v-if="!p.deductions.length"><td colspan="2" class="py-2 text-fg-muted">No deductions this month</td></tr>
            <tr v-for="i in pad.deductions" :key="`pad-${i}`" class="max-sm:hidden" aria-hidden="true"><td colspan="2" class="py-2">&nbsp;</td></tr>
          </tbody>
          <tfoot>
            <tr class="border-t-2 border-line font-semibold">
              <th scope="row" class="pt-2.5 text-start text-fg">Total deductions</th>
              <td class="pt-2.5 text-end text-fg tabular-nums">{{ rupees(p.totalDeductions) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Net pay -->
      <section class="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-accent-soft px-5 py-4 ring-1 ring-brand-500/15 ring-inset" aria-label="Net pay">
        <div class="min-w-0">
          <p class="text-xs font-semibold tracking-wide text-accent-fg uppercase">Net pay</p>
          <p class="mt-0.5 text-sm text-fg">Rupees {{ inWords(p.netPay) }} only</p>
          <p class="mt-0.5 text-2xs text-fg-muted tabular-nums">Gross {{ rupees(p.gross) }} − deductions {{ rupees(p.totalDeductions) }}</p>
        </div>
        <p class="text-3xl font-semibold tracking-tight text-fg tabular-nums">{{ rupees(p.netPay) }}</p>
      </section>

      <section v-if="p.employerContributions.length" class="mt-5 rounded-lg px-4 py-3 text-sm ring-1 ring-line ring-inset" aria-label="Employer contributions">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <p class="text-xs font-medium text-fg-muted">Employer contributions <span class="text-fg-subtle">· part of CTC, not deducted</span></p>
          <p class="text-xs font-semibold text-fg tabular-nums">{{ rupees(employerTotal) }}</p>
        </div>
        <ul class="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
          <li v-for="c in p.employerContributions" :key="c.code" class="text-fg-muted">{{ c.name }} <span class="text-fg tabular-nums">{{ rupees(c.amount) }}</span></li>
        </ul>
      </section>

      <details v-if="showTax !== false && p.tax" class="group mt-5 rounded-xl text-sm ring-1 ring-line ring-inset print:hidden">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-medium text-fg [&::-webkit-details-marker]:hidden">
          <span>How income tax was worked out <span class="font-normal text-fg-muted">· {{ REGIME_LABELS[p.tax.regime] }}</span></span>
          <span class="text-xs font-normal text-accent-fg group-open:hidden">Show</span><span class="hidden text-xs font-normal text-accent-fg group-open:inline">Hide</span>
        </summary>
        <dl class="grid gap-x-6 gap-y-2 border-t border-line/70 px-4 py-3 sm:grid-cols-2">
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

      <footer class="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-3 text-2xs text-fg-subtle">
        <span>This is a computer-generated payslip and does not need a signature.</span>
        <span>{{ p.organization?.name }} · {{ p.period }}</span>
      </footer>
    </div>
  </article>
</template>

<style scoped>
/* Paper is white whatever the screen theme, and the tinted panels print as they look. */
@media print {
  .payslip {
    --app-surface: #fff;
    --app-surface-muted: #f4f4f5;
    --app-border: #e4e4e7;
    --app-border-strong: #d4d4d8;
    --app-text: #18181b;
    --app-text-muted: #52525b;
    --app-text-subtle: #71717a;
    --accent-soft: color-mix(in oklab, var(--brand-500) 10%, #fff);
    --accent-fg: var(--brand-700);
    background: #fff;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
    break-inside: avoid;
  }
}
</style>
