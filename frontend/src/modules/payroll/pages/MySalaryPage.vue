<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Wallet } from '@lucide/vue';
import { financialYearLabel } from '@contracts';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import SalaryBreakdownTable from '@/modules/payroll/components/SalaryBreakdownTable.vue';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppButton, AppCard, AppCheckbox, AppEmptyState, AppErrorState, AppInput, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Own salary (current breakdown and history) and the income-tax declaration for the financial year. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const salary = useAsync(() => payrollApi.mySalary());
const today = new Date().toISOString().slice(0, 10);
const current = computed(() => salary.data.value?.salaries.find((s) => s.effectiveFrom <= today) ?? null);
const upcoming = computed(() => salary.data.value?.salaries.filter((s) => s.effectiveFrom > today).at(-1) ?? null);

const canDeclare = computed(() => auth.can('payroll.payslip.view') && !!salary.data.value?.employee);
const declaration = useAsync(() => payrollApi.myDeclaration(), { immediate: false });
watch(canDeclare, (can) => {
  if (can && !declaration.data.value) void declaration.run();
});
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ regime: 'NEW' as 'NEW' | 'OLD', rentPaidAnnual: 0 as number | string, metroCity: false, section80c: 0 as number | string, section80ccd1b: 0 as number | string, section80d: 0 as number | string, homeLoanInterest: 0 as number | string, previousEmployerIncome: 0 as number | string, previousEmployerTds: 0 as number | string });
watch(
  () => declaration.data.value,
  (d) => {
    if (d) Object.assign(form, d);
  },
  { immediate: true },
);
const saving = ref(false);
async function save() {
  reset();
  saving.value = true;
  const n = (v: number | string) => Number(v) || 0;
  try {
    declaration.data.value = await payrollApi.saveMyDeclaration(
      {
        regime: form.regime,
        rentPaidAnnual: n(form.rentPaidAnnual),
        metroCity: form.metroCity,
        section80c: n(form.section80c),
        section80ccd1b: n(form.section80ccd1b),
        section80d: n(form.section80d),
        homeLoanInterest: n(form.homeLoanInterest),
        previousEmployerIncome: n(form.previousEmployerIncome),
        previousEmployerTds: n(form.previousEmployerTds),
      },
      declaration.data.value?.financialYear,
    );
    feedback.success('Tax declaration saved', 'It applies from the next payroll.');
  } catch (e) {
    handle(e, 'Could not save the declaration');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <AppPageHeader title="Salary & tax" description="Your salary structure and the tax regime and investments payroll uses to work out monthly TDS." />
    <div class="grid items-start gap-6 lg:grid-cols-2">
      <AppCard title="Salary">
        <AppSkeleton v-if="salary.loading.value && !salary.data.value" :lines="6" />
        <AppErrorState v-else-if="salary.error.value" :error="salary.error.value" @retry="salary.run" />
        <AppEmptyState v-else-if="!salary.data.value?.employee" :icon="Wallet" title="No employee record" description="Salary and tax details are kept for employees of the organization." compact />
        <AppEmptyState v-else-if="!current && !upcoming" :icon="Wallet" title="No salary on record" description="Your HR team sets it up; it appears here once done." compact />
        <template v-else>
          <AppAlert v-if="upcoming" tone="info" class="mb-4" :title="`New salary from ${formatDate(upcoming.effectiveFrom)}`">{{ rupees(upcoming.annualCtc) }} a year{{ upcoming.reason ? ` · ${upcoming.reason}` : '' }}.</AppAlert>
          <template v-if="current">
            <p class="mb-3 text-sm text-fg-muted">
              <span class="text-2xl font-semibold text-fg tabular-nums">{{ rupees(current.annualCtc) }}</span> a year since {{ formatDate(current.effectiveFrom) }}
            </p>
            <SalaryBreakdownTable :components="current.components" :monthly-gross="current.monthlyGross" :employer-pf="current.employerPf" :employer-esi="current.employerEsi" :monthly-ctc="current.monthlyCtc" />
          </template>
          <details v-if="(salary.data.value?.salaries.length ?? 0) > 1" class="mt-4 text-sm">
            <summary class="cursor-pointer font-medium text-fg">Salary history</summary>
            <ul class="mt-2 space-y-1 text-fg-muted">
              <li v-for="s in salary.data.value!.salaries" :key="s.id">{{ formatDate(s.effectiveFrom) }} · {{ rupees(s.annualCtc) }}{{ s.reason ? ` · ${s.reason}` : '' }}</li>
            </ul>
          </details>
        </template>
      </AppCard>

      <AppCard v-if="canDeclare" :title="declaration.data.value ? `Tax declaration · ${financialYearLabel(declaration.data.value.financialYear)}` : 'Tax declaration'" description="Used for TDS from the next payroll. Keep proofs ready; HR may ask for them.">
        <AppSkeleton v-if="declaration.loading.value && !declaration.data.value" :lines="6" />
        <AppErrorState v-else-if="declaration.error.value" :error="declaration.error.value" @retry="declaration.run" />
        <form v-else class="space-y-4" novalidate @submit.prevent="save">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <fieldset>
            <legend class="label">Tax regime</legend>
            <div class="grid gap-2 sm:grid-cols-2">
              <label v-for="opt in [{ v: 'NEW', t: 'New regime', d: 'Lower rates, ₹75,000 standard deduction, few exemptions.' }, { v: 'OLD', t: 'Old regime', d: 'HRA, 80C, 80D and home-loan interest reduce taxable income.' }]" :key="opt.v" class="flex cursor-pointer gap-3 rounded-xl p-3 ring-1 ring-line has-[:checked]:ring-2 has-[:checked]:ring-brand-500">
                <input v-model="form.regime" type="radio" name="regime" :value="opt.v" class="mt-1 accent-brand-600" />
                <span><span class="block text-sm font-medium text-fg">{{ opt.t }}</span><span class="block text-xs text-fg-muted">{{ opt.d }}</span></span>
              </label>
            </div>
          </fieldset>
          <template v-if="form.regime === 'OLD'">
            <div class="grid gap-4 sm:grid-cols-2">
              <AppInput v-model="form.rentPaidAnnual" label="Rent paid this year (₹)" type="number" :min="0" :error="fieldErrors.rentPaidAnnual" />
              <AppInput v-model="form.section80c" label="80C investments (₹)" type="number" :min="0" help="PPF, ELSS, life insurance… PF is added automatically (cap ₹1.5 lakh)." :error="fieldErrors.section80c" />
              <AppInput v-model="form.section80ccd1b" label="80CCD(1B) – own NPS (₹)" type="number" :min="0" help="Up to ₹50,000." :error="fieldErrors.section80ccd1b" />
              <AppInput v-model="form.section80d" label="80D – health insurance (₹)" type="number" :min="0" :error="fieldErrors.section80d" />
              <AppInput v-model="form.homeLoanInterest" label="Home-loan interest (₹)" type="number" :min="0" help="Self-occupied, up to ₹2 lakh." :error="fieldErrors.homeLoanInterest" />
            </div>
            <AppCheckbox v-model="form.metroCity" label="I live in Delhi, Mumbai, Kolkata or Chennai" description="50% of Basic instead of 40% for the HRA exemption." />
          </template>
          <details class="text-sm">
            <summary class="cursor-pointer font-medium text-fg">Joined this year from another employer?</summary>
            <div class="mt-3 grid gap-4 sm:grid-cols-2">
              <AppInput v-model="form.previousEmployerIncome" label="Taxable salary there (₹)" type="number" :min="0" :error="fieldErrors.previousEmployerIncome" />
              <AppInput v-model="form.previousEmployerTds" label="Tax deducted there (₹)" type="number" :min="0" :error="fieldErrors.previousEmployerTds" />
            </div>
          </details>
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs text-fg-muted">{{ declaration.data.value?.updatedAt ? `Last saved ${timeAgo(declaration.data.value.updatedAt)}` : 'Not saved yet – the new regime applies by default.' }}</p>
            <AppButton type="submit" :loading="saving">Save declaration</AppButton>
          </div>
        </form>
      </AppCard>
    </div>
  </div>
</template>
