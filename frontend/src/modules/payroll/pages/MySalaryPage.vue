<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ArrowRight, ArrowUpRight, Building2, CalendarClock, CalendarDays, Check, HandCoins, History, Home, Info, Landmark, Layers, PiggyBank, ReceiptText, Save, Scale, ShieldCheck, Sparkles, Wallet } from '@lucide/vue';
import { financialYearLabel } from '@contracts';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import PaySplitBar, { type PaySegment } from '@/modules/payroll/components/PaySplitBar.vue';
import SalaryBreakdownTable from '@/modules/payroll/components/SalaryBreakdownTable.vue';
import type { EmployeeSalary } from '@/modules/payroll/types';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppCheckbox, AppEmptyState, AppErrorState, AppInput, AppPageHeader, AppSegmented, AppSkeleton } from '@/shared/components';
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

// ---- Declaration helpers ---------------------------------------------------------------------------------------
const AMOUNTS = ['rentPaidAnnual', 'section80c', 'section80ccd1b', 'section80d', 'homeLoanInterest', 'previousEmployerIncome', 'previousEmployerTds'] as const;
const dirty = computed(() => {
  const d = declaration.data.value;
  if (!d) return false;
  return form.regime !== d.regime || form.metroCity !== d.metroCity || AMOUNTS.some((k) => (Number(form[k]) || 0) !== d[k]);
});
function discard() {
  if (declaration.data.value) Object.assign(form, declaration.data.value);
  reset();
}
const declaredTotal = computed(() => (['section80c', 'section80ccd1b', 'section80d', 'homeLoanInterest'] as const).reduce((n, k) => n + (Number(form[k]) || 0), 0));
/** Opens the previous-employer section when the saved declaration has figures there. */
const previousOpen = computed(() => !!(declaration.data.value?.previousEmployerIncome || declaration.data.value?.previousEmployerTds));
const REGIMES = [
  { v: 'NEW' as const, t: 'New regime', d: 'Lower rates, ₹75,000 standard deduction, few exemptions.', icon: Sparkles, note: 'Applies by default' },
  { v: 'OLD' as const, t: 'Old regime', d: 'HRA, 80C, 80D and home-loan interest reduce taxable income.', icon: Scale, note: 'Declare your investments' },
];

// ---- Salary summary --------------------------------------------------------------------------------------------
const shown = computed(() => current.value ?? upcoming.value);
const period = ref<'annual' | 'monthly'>('annual');
const periodOptions = [
  { value: 'annual' as const, label: 'Annual' },
  { value: 'monthly' as const, label: 'Monthly' },
];
const COMPONENT_COLORS = ['bg-brand-600', 'bg-sky-500', 'bg-violet-500', 'bg-teal-500', 'bg-pink-500', 'bg-indigo-400', 'bg-amber-500'];
const segments = computed<PaySegment[]>(() => {
  const s = shown.value;
  if (!s) return [];
  const k = period.value === 'annual' ? 12 : 1;
  return [
    ...s.components.map((c, i) => ({ key: c.componentId, label: c.name, amount: c.monthly * k, color: COMPONENT_COLORS[i % COMPONENT_COLORS.length]! })),
    { key: 'employer-pf', label: 'Employer PF', amount: s.employerPf * k, color: 'bg-slate-400 dark:bg-slate-500' },
    { key: 'employer-esi', label: 'Employer ESI', amount: s.employerEsi * k, color: 'bg-slate-300 dark:bg-slate-600' },
  ];
});
/** Whole months between two ISO dates. */
function monthsBetween(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}
function duration(months: number) {
  if (months < 1) return 'Less than a month';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y && `${y} yr${y === 1 ? '' : 's'}`, m && `${m} mo${m === 1 ? '' : 's'}`].filter(Boolean).join(' ');
}
const stats = computed(() => {
  const s = current.value;
  if (!s) return [];
  const employer = s.employerPf + s.employerEsi;
  return [
    { key: 'gross', label: 'Monthly gross', value: rupees(s.monthlyGross), hint: 'Before deductions', icon: Wallet, tone: 'text-accent-fg bg-accent-soft' },
    { key: 'ctc', label: 'Monthly cost to company', value: rupees(s.monthlyCtc), hint: `${rupees(s.annualCtc)} a year`, icon: Building2, tone: 'text-info-fg bg-info-soft' },
    { key: 'employer', label: 'Employer contributions', value: rupees(employer), hint: employer ? 'Monthly, on top of your gross' : 'None for your salary', icon: ShieldCheck, tone: 'text-success-fg bg-success-soft' },
    { key: 'since', label: 'On this salary', value: duration(monthsBetween(s.effectiveFrom, today)), hint: `Since ${formatDate(s.effectiveFrom)}`, icon: CalendarDays, tone: 'text-fg-muted bg-surface-muted' },
  ];
});
/** Change of an entry against the one before it (the list is newest first). */
function raise(s: EmployeeSalary) {
  const list = salary.data.value?.salaries ?? [];
  const before = list[list.indexOf(s) + 1];
  if (!before || !before.annualCtc) return null;
  return Math.round(((s.annualCtc - before.annualCtc) / before.annualCtc) * 1000) / 10;
}
const raiseText = (p: number) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`;
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Salary & tax" description="Your salary structure and the tax regime and investments payroll uses to work out monthly TDS.">
      <template v-if="auth.can('payroll.payslip.view')" #actions><AppButton variant="secondary" :icon="ReceiptText" to="/me/payslips">Payslips</AppButton></template>
    </AppPageHeader>

    <!-- Salary -->
    <div v-if="salary.loading.value && !salary.data.value" class="card p-4"><AppSkeleton :lines="6" /></div>
    <div v-else-if="salary.error.value" class="card"><AppErrorState :error="salary.error.value" @retry="salary.run" /></div>
    <div v-else-if="!salary.data.value?.employee" class="card"><AppEmptyState :icon="Wallet" title="No employee record" description="Salary and tax details are kept for employees of the organization." /></div>
    <div v-else-if="!shown" class="card"><AppEmptyState :icon="Wallet" title="No salary on record" description="Your HR team sets it up; it appears here once done." /></div>
    <section v-else class="card overflow-hidden" aria-labelledby="ctc-title">
      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div class="relative bg-gradient-to-br from-brand-700 via-brand-600 to-sky-500 p-6 text-white">
          <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_90%_-10%,rgba(255,255,255,0.28),transparent_45%),radial-gradient(circle_at_0%_120%,rgba(255,255,255,0.18),transparent_45%)]" aria-hidden="true" />
          <p class="relative inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
            <Layers :size="13" aria-hidden="true" />{{ shown.structure.name ?? 'Salary structure' }}
          </p>
          <p id="ctc-title" class="relative mt-4 text-xs tracking-wide text-white/75 uppercase">{{ current ? 'Annual cost to company' : 'Starting annual cost to company' }}</p>
          <p class="relative mt-0.5 text-4xl font-semibold tracking-tight tabular-nums">{{ rupees(shown.annualCtc) }}</p>
          <p class="relative mt-1 text-sm text-white/85">
            {{ rupees(shown.monthlyCtc) }} a month · {{ current ? 'since' : 'from' }} {{ formatDate(shown.effectiveFrom) }}
          </p>
          <ul class="relative mt-5 space-y-1.5 text-xs text-white/85">
            <li class="flex items-center gap-2"><Wallet :size="13" aria-hidden="true" />Gross <span class="font-semibold text-white tabular-nums">{{ rupees(shown.monthlyGross) }}</span> a month before deductions</li>
            <li class="flex items-center gap-2"><PiggyBank :size="13" aria-hidden="true" />{{ shown.pfApplicable ? 'Provident fund applies' : 'No provident fund' }}</li>
            <li v-if="shown.reason" class="flex items-center gap-2"><Info :size="13" aria-hidden="true" />{{ shown.reason }}</li>
          </ul>
        </div>
        <div class="p-6">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-fg">How your CTC is made up</h2>
              <p class="text-xs text-fg-muted">Earnings make up your gross; employer contributions are paid on top.</p>
            </div>
            <AppSegmented v-model="period" size="sm" :options="periodOptions" label="Show amounts" />
          </div>
          <PaySplitBar :segments="segments" :label="`${period === 'annual' ? 'Annual' : 'Monthly'} cost to company`" size="lg" legend />
          <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-3 text-sm">
            <span class="text-fg-muted">{{ period === 'annual' ? 'Annual' : 'Monthly' }} cost to company</span>
            <span class="font-semibold text-fg tabular-nums">{{ rupees(period === 'annual' ? shown.monthlyCtc * 12 : shown.monthlyCtc) }}</span>
          </div>
        </div>
      </div>
      <ul v-if="stats.length" class="grid gap-px border-t border-line/70 bg-line/70 sm:grid-cols-2 xl:grid-cols-4">
        <li v-for="s in stats" :key="s.key" class="flex items-center gap-3 bg-surface px-5 py-3.5">
          <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', s.tone]" aria-hidden="true"><component :is="s.icon" :size="17" /></span>
          <div class="min-w-0">
            <p class="text-lg leading-6 font-semibold text-fg tabular-nums">{{ s.value }}</p>
            <p class="text-xs text-fg-muted">{{ s.label }}</p>
            <p class="truncate text-2xs text-fg-subtle" :title="s.hint">{{ s.hint }}</p>
          </div>
        </li>
      </ul>
      <div v-if="upcoming && current" class="flex flex-wrap items-center gap-3 border-t border-line/70 bg-accent-soft/40 px-5 py-3">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white" aria-hidden="true"><CalendarClock :size="15" /></span>
        <div class="min-w-0 flex-1">
          <p class="text-2xs font-semibold tracking-wide text-accent-fg uppercase">New salary from {{ formatDate(upcoming.effectiveFrom) }}</p>
          <p class="text-sm font-medium text-fg">
            {{ rupees(upcoming.annualCtc) }} a year
            <span v-if="raise(upcoming) !== null" class="ms-1 inline-flex items-center gap-0.5 rounded-full bg-success-soft px-1.5 py-px text-xs font-semibold text-success-fg"><ArrowUpRight :size="12" aria-hidden="true" />{{ raiseText(raise(upcoming)!) }}</span>
            <span v-if="upcoming.reason" class="text-xs font-normal text-fg-muted"> · {{ upcoming.reason }}</span>
          </p>
        </div>
      </div>
    </section>

    <div class="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <!-- Breakdown and history -->
      <div v-if="shown" class="space-y-4">
        <AppCard title="Salary breakdown" :description="current ? `Effective ${formatDate(current.effectiveFrom)}` : `From ${formatDate(shown.effectiveFrom)}`" :icon="HandCoins">
          <SalaryBreakdownTable :components="shown.components" :monthly-gross="shown.monthlyGross" :employer-pf="shown.employerPf" :employer-esi="shown.employerEsi" :monthly-ctc="shown.monthlyCtc" />
        </AppCard>

        <AppCard title="Salary history" :icon="History" :description="`${salary.data.value!.salaries.length} revision${salary.data.value!.salaries.length === 1 ? '' : 's'} on record`">
          <ol class="relative space-y-5 border-s border-line ps-5">
            <li v-for="s in salary.data.value!.salaries" :key="s.id" class="relative">
              <span
                :class="[
                  'absolute -start-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-surface',
                  s.effectiveFrom > today ? 'border-2 border-dashed border-brand-500 bg-surface' : s.id === current?.id ? 'bg-brand-500' : 'bg-line-strong',
                ]"
                aria-hidden="true"
              />
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-sm font-semibold text-fg tabular-nums">{{ rupees(s.annualCtc) }} <span class="font-normal text-fg-muted">a year</span></p>
                <AppBadge v-if="s.id === current?.id" size="sm" tone="brand" dot>Current</AppBadge>
                <AppBadge v-else-if="s.effectiveFrom > today" size="sm" tone="info" dot>Upcoming</AppBadge>
                <span
                  v-if="raise(s) !== null"
                  :class="['inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-2xs font-semibold tabular-nums', raise(s)! >= 0 ? 'bg-success-soft text-success-fg' : 'bg-danger-soft text-danger-fg']"
                >
                  {{ raiseText(raise(s)!) }}<span class="sr-only"> change from the previous salary</span>
                </span>
              </div>
              <p class="mt-0.5 text-xs text-fg-muted">
                {{ s.effectiveFrom > today ? 'From' : 'Since' }} {{ formatDate(s.effectiveFrom) }}<template v-if="s.structure.name"> · {{ s.structure.name }}</template><template v-if="s.reason"> · {{ s.reason }}</template>
              </p>
            </li>
          </ol>
          <p v-if="salary.data.value!.salaries.length === 1" class="mt-4 rounded-md bg-surface-muted/70 px-3 py-2 text-xs text-fg-muted">Revisions to your salary will show here with the change from the one before.</p>
        </AppCard>
      </div>

      <!-- Tax declaration (not an AppCard: the save bar sticks, so nothing here clips overflow) -->
      <section v-if="canDeclare" class="card" aria-labelledby="tax-title">
        <header class="flex min-h-12 flex-wrap items-center gap-3 border-b border-line/70 px-4 py-2">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><Landmark :size="16" /></span>
          <div class="min-w-0 flex-1">
            <h2 id="tax-title" class="text-sm font-semibold text-fg">{{ declaration.data.value ? `Tax declaration · ${financialYearLabel(declaration.data.value.financialYear)}` : 'Tax declaration' }}</h2>
            <p class="text-xs text-fg-muted">Used for TDS from the next payroll. Keep proofs ready; HR may ask for them.</p>
          </div>
          <AppBadge v-if="declaration.data.value" :tone="declaration.data.value.updatedAt ? 'success' : 'neutral'" size="sm" dot>{{ declaration.data.value.updatedAt ? `Saved ${timeAgo(declaration.data.value.updatedAt)}` : 'Not saved yet' }}</AppBadge>
        </header>
        <div class="p-4">
          <AppSkeleton v-if="declaration.loading.value && !declaration.data.value" :lines="6" />
          <AppErrorState v-else-if="declaration.error.value" :error="declaration.error.value" @retry="declaration.run" />
          <form v-else class="space-y-5" novalidate @submit.prevent="save">
            <AppAlert v-if="formError">{{ formError }}</AppAlert>
            <fieldset>
              <legend class="label">Tax regime</legend>
              <div class="grid gap-2 sm:grid-cols-2">
                <label
                  v-for="opt in REGIMES"
                  :key="opt.v"
                  class="relative flex cursor-pointer gap-3 rounded-xl p-3.5 ring-1 ring-line transition ring-inset hover:bg-surface-muted/50 has-[:checked]:bg-accent-soft/40 has-[:checked]:ring-2 has-[:checked]:ring-brand-500 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/50"
                >
                  <input v-model="form.regime" type="radio" name="regime" :value="opt.v" class="sr-only" />
                  <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', form.regime === opt.v ? 'bg-brand-600 text-white' : 'bg-surface-muted text-fg-muted']" aria-hidden="true"><component :is="opt.icon" :size="17" /></span>
                  <span class="min-w-0 flex-1">
                    <span class="flex items-center justify-between gap-2">
                      <span class="text-sm font-semibold text-fg">{{ opt.t }}</span>
                      <span :class="['flex h-5 w-5 shrink-0 items-center justify-center rounded-full', form.regime === opt.v ? 'bg-brand-600 text-white' : 'ring-1 ring-line-strong ring-inset']" aria-hidden="true">
                        <Check v-if="form.regime === opt.v" :size="12" :stroke-width="3" />
                      </span>
                    </span>
                    <span class="mt-0.5 block text-xs text-fg-muted">{{ opt.d }}</span>
                    <span class="mt-1.5 block text-2xs font-medium text-fg-subtle">{{ opt.note }}</span>
                  </span>
                </label>
              </div>
            </fieldset>

            <template v-if="form.regime === 'OLD'">
              <fieldset class="space-y-3">
                <legend class="flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-muted uppercase"><Home :size="13" aria-hidden="true" />House rent</legend>
                <AppInput v-model="form.rentPaidAnnual" label="Rent paid this year (₹)" type="number" :min="0" :error="fieldErrors.rentPaidAnnual" />
                <AppCheckbox v-model="form.metroCity" label="I live in Delhi, Mumbai, Kolkata or Chennai" description="50% of Basic instead of 40% for the HRA exemption." />
              </fieldset>
              <fieldset class="space-y-3">
                <legend class="flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-muted uppercase"><PiggyBank :size="13" aria-hidden="true" />Investments & insurance</legend>
                <div class="grid gap-4 sm:grid-cols-2">
                  <AppInput v-model="form.section80c" label="80C investments (₹)" type="number" :min="0" help="PPF, ELSS, life insurance… PF is added automatically (cap ₹1.5 lakh)." :error="fieldErrors.section80c" />
                  <AppInput v-model="form.section80ccd1b" label="80CCD(1B) – own NPS (₹)" type="number" :min="0" help="Up to ₹50,000." :error="fieldErrors.section80ccd1b" />
                  <AppInput v-model="form.section80d" label="80D – health insurance (₹)" type="number" :min="0" :error="fieldErrors.section80d" />
                </div>
              </fieldset>
              <fieldset class="space-y-3">
                <legend class="flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-muted uppercase"><Landmark :size="13" aria-hidden="true" />Home loan</legend>
                <div class="grid gap-4 sm:grid-cols-2">
                  <AppInput v-model="form.homeLoanInterest" label="Home-loan interest (₹)" type="number" :min="0" help="Self-occupied, up to ₹2 lakh." :error="fieldErrors.homeLoanInterest" />
                </div>
              </fieldset>
              <div class="flex items-center justify-between gap-3 rounded-lg bg-surface-muted/70 px-3.5 py-2.5 text-sm">
                <span class="text-fg-muted">Investments, insurance and home-loan interest declared</span>
                <span class="font-semibold text-fg tabular-nums">{{ rupees(declaredTotal) }}</span>
              </div>
            </template>
            <p v-else class="flex items-start gap-2.5 rounded-lg bg-surface-muted/70 px-3.5 py-3 text-xs text-fg-muted">
              <Info :size="14" class="mt-px shrink-0 text-accent-fg" aria-hidden="true" />
              Under the new regime only the standard deduction applies, so there are no investments to declare. Choose the old regime to claim HRA, 80C, 80D and home-loan interest.
            </p>

            <details class="group rounded-xl ring-1 ring-line" :open="previousOpen">
              <summary class="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3 text-sm [&::-webkit-details-marker]:hidden">
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><Building2 :size="14" /></span>
                <span class="min-w-0 flex-1">
                  <span class="block font-medium text-fg">Joined this year from another employer?</span>
                  <span class="block text-xs text-fg-muted">Add the salary and tax there so this year's TDS is right.</span>
                </span>
                <ArrowRight :size="15" class="text-fg-subtle transition group-open:rotate-90" aria-hidden="true" />
              </summary>
              <div class="grid gap-4 border-t border-line/70 px-3.5 py-3.5 sm:grid-cols-2">
                <AppInput v-model="form.previousEmployerIncome" label="Taxable salary there (₹)" type="number" :min="0" :error="fieldErrors.previousEmployerIncome" />
                <AppInput v-model="form.previousEmployerTds" label="Tax deducted there (₹)" type="number" :min="0" :error="fieldErrors.previousEmployerTds" />
              </div>
            </details>

            <!-- Stays in view while scrolling the form. -->
            <div class="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center gap-3 rounded-b-md border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
              <p v-if="dirty" class="me-auto inline-flex items-center gap-2 text-sm text-fg-muted"><span class="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />You have unsaved changes</p>
              <p v-else class="me-auto text-xs text-fg-muted">{{ declaration.data.value?.updatedAt ? `Last saved ${timeAgo(declaration.data.value.updatedAt)}` : 'Not saved yet – the new regime applies by default.' }}</p>
              <AppButton v-if="dirty" variant="ghost" @click="discard">Discard</AppButton>
              <AppButton type="submit" :icon="Save" :loading="saving">Save declaration</AppButton>
            </div>
          </form>
        </div>
      </section>
    </div>
  </div>
</template>
