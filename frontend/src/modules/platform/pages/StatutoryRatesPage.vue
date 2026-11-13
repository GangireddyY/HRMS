<script setup lang="ts">
import { computed, ref } from 'vue';
import { CalendarClock, Landmark, Pencil, Plus, ReceiptIndianRupee, RotateCcw, Trash2 } from '@lucide/vue';
import ContributionRatesModal from '@/modules/platform/components/ContributionRatesModal.vue';
import TaxRulesModal from '@/modules/platform/components/TaxRulesModal.vue';
import { platformApi } from '@/modules/platform/api/platform.api';
import type { ContributionEntry, StatutoryOverview, TaxYear } from '@/modules/platform/types';
import { inr, pct, slabSummary } from '@/modules/platform/utils/statutory';
import { AppAlert, AppBadge, AppButton, AppCard, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/**
 * The statutory rates every organization's payroll uses, kept current each year without a release: PF / EPS / ESI rates
 * and limits from an effective date, and each financial year's income-tax rules.
 */
const feedback = useFeedbackStore();
const data = useAsync(() => platformApi.statutoryRates());
const o = computed(() => data.data.value);
const set = (next: StatutoryOverview) => (data.data.value = next);

const contributionModal = ref<{ open: boolean; entry: ContributionEntry | null }>({ open: false, entry: null });
const taxModal = ref<TaxYear | null>(null);
function contributionSaved(next: StatutoryOverview) {
  contributionModal.value = { open: false, entry: null };
  set(next);
  feedback.success('Rates saved', 'Draft payroll runs use them when recalculated.');
}
function taxSaved(next: StatutoryOverview) {
  const label = taxModal.value?.label;
  taxModal.value = null;
  set(next);
  feedback.success(`Income-tax rules for ${label} saved`);
}
async function removeEntry(e: ContributionEntry) {
  if (!(await feedback.confirm({ title: `Remove the rates from ${formatDate(e.effectiveFrom)}?`, message: 'Months from that date use the previous rates (or the built-in ones).', confirmLabel: 'Remove', danger: true }))) return;
  try {
    set(await platformApi.removeContribution(e.id));
    feedback.success('Rates removed');
  } catch (err) {
    feedback.error('Could not remove the rates', err);
  }
}
async function resetYear(y: TaxYear) {
  if (!(await feedback.confirm({ title: `Use the built-in rules for ${y.label}?`, message: 'The rules entered for this year are removed.', confirmLabel: 'Use built-in rules', danger: true }))) return;
  try {
    set(await platformApi.removeTaxRules(y.financialYear));
    feedback.success(`${y.label} uses the built-in rules`);
  } catch (err) {
    feedback.error('Could not remove the rules', err);
  }
}

/** From February (Budget month) the next financial year's rules should be entered before April's payroll. */
const nextYearDue = computed(() => {
  const v = o.value;
  if (!v) return null;
  const month = Number(v.today.slice(5, 7));
  const next = v.tax.find((t) => t.financialYear === v.currentFinancialYear + 1);
  return next && !next.confirmed && month >= 2 && month <= 3 ? next : null;
});
const unconfirmedCurrent = computed(() => o.value?.tax.find((t) => t.financialYear === o.value!.currentFinancialYear && !t.confirmed) ?? null);
const years = computed(() => [...(o.value?.tax ?? [])].reverse());
const yearTone = (y: TaxYear) => (!y.confirmed ? 'warning' : y.source === 'ENTERED' ? 'success' : 'neutral');
const yearLabel = (y: TaxYear) => (!y.confirmed ? `Uses ${o.value?.tax.find((t) => t.financialYear === y.rulesYear)?.label ?? y.rulesYear} rules` : y.source === 'ENTERED' ? 'Entered' : 'Built in');
</script>

<template>
  <div class="space-y-5">
    <AppPageHeader title="Statutory rates" description="PF, ESI and income-tax rules used by every organization's payroll. Update them when a notification or Finance Act changes them; no release is needed." />

    <AppSkeleton v-if="data.loading.value && !o" :lines="8" />
    <AppErrorState v-else-if="data.error.value" :error="data.error.value" @retry="data.run" />
    <template v-else-if="o">
      <AppAlert v-if="unconfirmedCurrent" tone="warning" :title="`${unconfirmedCurrent.label} has no rules of its own`">Payroll this year is using an earlier year's income-tax rules. Enter this year's rules.</AppAlert>
      <AppAlert v-else-if="nextYearDue" tone="info" :title="`Enter the ${nextYearDue.label} rules before April's payroll`">Until then, payroll from April uses this year's income-tax rules.</AppAlert>

      <!-- PF and ESI -->
      <AppCard :padded="false">
        <div class="flex flex-wrap items-start gap-3 border-b border-line/70 p-4">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg" aria-hidden="true"><Landmark :size="17" /></span>
          <div class="min-w-0 flex-1">
            <h2 class="font-semibold text-fg">Provident fund and ESI</h2>
            <p class="text-sm text-fg-muted">Payroll for a month uses the rates in force on its first day.</p>
          </div>
          <AppButton size="sm" :icon="Plus" @click="contributionModal = { open: true, entry: null }">Add rates from a date</AppButton>
        </div>
        <dl class="grid gap-px bg-line/60 sm:grid-cols-3">
          <div class="bg-surface p-4">
            <dt class="text-xs text-fg-muted">PF (employee and employer)</dt>
            <dd class="mt-1 text-lg font-semibold text-fg">{{ pct(o.contribution.inForce.pfRate) }}</dd>
            <dd class="text-xs text-fg-muted">on wages up to {{ inr(o.contribution.inForce.pfWageCeiling) }} a month · pension {{ pct(o.contribution.inForce.epsRate) }}</dd>
          </div>
          <div class="bg-surface p-4">
            <dt class="text-xs text-fg-muted">ESI (employee + employer)</dt>
            <dd class="mt-1 text-lg font-semibold text-fg">{{ pct(o.contribution.inForce.esiEmployeeRate) }} + {{ pct(o.contribution.inForce.esiEmployerRate) }}</dd>
            <dd class="text-xs text-fg-muted">for gross up to {{ inr(o.contribution.inForce.esiWageLimit) }} a month</dd>
          </div>
          <div class="bg-surface p-4">
            <dt class="text-xs text-fg-muted">In force today</dt>
            <dd class="mt-1 text-lg font-semibold text-fg">{{ o.contribution.inForce.effectiveFrom ? `Since ${formatDate(o.contribution.inForce.effectiveFrom)}` : 'Built-in rates' }}</dd>
            <dd class="text-xs text-fg-muted">{{ o.contribution.entries.filter((e) => e.upcoming).length ? `${o.contribution.entries.filter((e) => e.upcoming).length} change scheduled` : 'No change scheduled' }}</dd>
          </div>
        </dl>
        <ul v-if="o.contribution.entries.length" class="divide-y divide-line/70">
          <li v-for="e in [...o.contribution.entries].reverse()" :key="e.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
            <div class="min-w-40">
              <p class="flex items-center gap-2 font-medium text-fg">
                From {{ formatDate(e.effectiveFrom) }}
                <AppBadge v-if="e.upcoming" size="sm" tone="info" dot>Upcoming</AppBadge>
                <AppBadge v-else-if="o.contribution.inForce.effectiveFrom === e.effectiveFrom" size="sm" tone="success" dot>In force</AppBadge>
              </p>
              <p v-if="e.source" class="text-xs text-fg-muted">{{ e.source }}</p>
            </div>
            <p class="flex-1 text-sm text-fg-muted">
              PF {{ pct(e.pfRate) }} up to {{ inr(e.pfWageCeiling) }} · EPS {{ pct(e.epsRate) }} · ESI {{ pct(e.esiEmployeeRate) }} + {{ pct(e.esiEmployerRate) }} up to {{ inr(e.esiWageLimit) }}
            </p>
            <span class="flex gap-1">
              <AppButton size="sm" variant="ghost" :icon="Pencil" @click="contributionModal = { open: true, entry: e }">Edit</AppButton>
              <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove the rates from ${e.effectiveFrom}`" @click="removeEntry(e)" />
            </span>
          </li>
        </ul>
      </AppCard>

      <!-- Income tax -->
      <section class="space-y-3">
        <div class="flex items-center gap-2">
          <ReceiptIndianRupee :size="17" class="text-fg-muted" aria-hidden="true" />
          <h2 class="font-semibold text-fg">Income tax by financial year</h2>
        </div>
        <ul class="grid gap-3 lg:grid-cols-2">
          <li v-for="y in years" :key="y.financialYear" class="card flex flex-col p-4">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-semibold text-fg">{{ y.label }}</p>
              <AppBadge v-if="y.financialYear === o.currentFinancialYear" size="sm" tone="brand">Current year</AppBadge>
              <AppBadge size="sm" :tone="yearTone(y)" dot>{{ yearLabel(y) }}</AppBadge>
            </div>
            <p v-if="y.note" class="mt-0.5 text-xs text-fg-muted">{{ y.note }}</p>
            <dl class="mt-3 space-y-2 text-sm">
              <div>
                <dt class="text-xs font-medium text-fg-muted">New regime · standard deduction {{ inr(y.rules.NEW.standardDeduction) }} · no tax up to {{ inr(y.rules.NEW.rebateIncomeLimit) }}</dt>
                <dd class="text-fg">{{ slabSummary(y.rules.NEW.slabs) }}</dd>
              </div>
              <div>
                <dt class="text-xs font-medium text-fg-muted">Old regime · standard deduction {{ inr(y.rules.OLD.standardDeduction) }}</dt>
                <dd class="text-fg">{{ slabSummary(y.rules.OLD.slabs) }}</dd>
              </div>
              <div class="text-xs text-fg-muted">Cess {{ pct(y.rules.cess) }}</div>
            </dl>
            <div class="mt-auto flex flex-wrap gap-2 border-t border-line/70 pt-3">
              <AppButton size="sm" variant="secondary" :icon="y.source === 'ENTERED' && y.confirmed ? Pencil : CalendarClock" @click="taxModal = y">
                {{ y.source === 'ENTERED' && y.confirmed ? 'Edit rules' : `Enter ${y.label} rules` }}
              </AppButton>
              <AppButton v-if="y.source === 'ENTERED' && y.confirmed" size="sm" variant="ghost" :icon="RotateCcw" @click="resetYear(y)">Use built-in rules</AppButton>
            </div>
          </li>
        </ul>
      </section>
    </template>

    <ContributionRatesModal v-if="o" :open="contributionModal.open" :entry="contributionModal.entry" :current="o.contribution.inForce" @close="contributionModal = { open: false, entry: null }" @saved="contributionSaved" />
    <TaxRulesModal :open="!!taxModal" :year="taxModal" @close="taxModal = null" @saved="taxSaved" />
  </div>
</template>
