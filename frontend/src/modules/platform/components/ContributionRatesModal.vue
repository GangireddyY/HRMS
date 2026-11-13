<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { contributionRatesProblem, type ContributionRates } from '@contracts';
import { platformApi } from '@/modules/platform/api/platform.api';
import type { ContributionEntry, StatutoryOverview } from '@/modules/platform/types';
import { toPercent, toRate } from '@/modules/platform/utils/statutory';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Add or change the PF / EPS / ESI rates in force from a date (prefilled with the rates in force now). */
const props = defineProps<{ open: boolean; entry: ContributionEntry | null; current: ContributionRates }>();
const emit = defineEmits<{ close: []; saved: [o: StatutoryOverview] }>();
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ effectiveFrom: '', pfRate: 12 as number | string, epsRate: 8.33 as number | string, pfWageCeiling: 15000 as number | string, esiEmployeeRate: 0.75 as number | string, esiEmployerRate: 3.25 as number | string, esiWageLimit: 21000 as number | string, source: '' });
const saving = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const r = props.entry ?? props.current;
    Object.assign(form, {
      effectiveFrom: props.entry?.effectiveFrom ?? '',
      pfRate: toPercent(r.pfRate),
      epsRate: toPercent(r.epsRate),
      pfWageCeiling: r.pfWageCeiling,
      esiEmployeeRate: toPercent(r.esiEmployeeRate),
      esiEmployerRate: toPercent(r.esiEmployerRate),
      esiWageLimit: r.esiWageLimit,
      source: props.entry?.source ?? '',
    });
  },
  { immediate: true },
);

const rates = computed<ContributionRates>(() => ({
  pfRate: toRate(form.pfRate),
  epsRate: toRate(form.epsRate),
  pfWageCeiling: Number(form.pfWageCeiling),
  esiEmployeeRate: toRate(form.esiEmployeeRate),
  esiEmployerRate: toRate(form.esiEmployerRate),
  esiWageLimit: Number(form.esiWageLimit),
}));
const problem = computed(() => contributionRatesProblem(rates.value));
const canSave = computed(() => !!form.effectiveFrom && !problem.value);

async function save() {
  reset();
  saving.value = true;
  try {
    emit('saved', await platformApi.saveContribution({ effectiveFrom: form.effectiveFrom, ...rates.value, source: form.source.trim() || null }));
  } catch (e) {
    handle(e, 'Could not save the rates');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal
    :open="open"
    :title="entry ? `Rates from ${entry.effectiveFrom}` : 'Add rates from a date'"
    description="Payroll for a month uses the rates in force on its first day. Draft runs pick up a change when recalculated; approved payslips keep their figures."
    size="lg"
    @close="emit('close')"
  >
    <form id="contribution-form" class="space-y-5" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppDatePicker v-model="form.effectiveFrom" label="In force from" required :disabled="!!entry" :error="fieldErrors.effectiveFrom" />
        <AppInput v-model="form.source" label="Notification or circular (optional)" :maxlength="300" placeholder="e.g. EPFO notification G.S.R. 609(E)" />
      </div>
      <fieldset class="grid gap-4 rounded-lg p-4 ring-1 ring-line ring-inset sm:grid-cols-3">
        <legend class="px-1 text-sm font-semibold text-fg">Provident fund</legend>
        <AppInput v-model="form.pfRate" type="number" label="PF (each side)" suffix="%" :min="0" :max="50" :step="0.01" />
        <AppInput v-model="form.epsRate" type="number" label="Pension (EPS), of employer PF" suffix="%" :min="0" :max="50" :step="0.01" />
        <AppInput v-model="form.pfWageCeiling" type="number" label="Wage ceiling" suffix="₹ / month" :min="1" />
      </fieldset>
      <fieldset class="grid gap-4 rounded-lg p-4 ring-1 ring-line ring-inset sm:grid-cols-3">
        <legend class="px-1 text-sm font-semibold text-fg">Employees' State Insurance</legend>
        <AppInput v-model="form.esiEmployeeRate" type="number" label="Employee" suffix="%" :min="0" :max="50" :step="0.01" />
        <AppInput v-model="form.esiEmployerRate" type="number" label="Employer" suffix="%" :min="0" :max="50" :step="0.01" />
        <AppInput v-model="form.esiWageLimit" type="number" label="Coverage limit" suffix="₹ / month" :min="1" />
      </fieldset>
      <p v-if="problem" class="error-text" role="alert">{{ problem }}</p>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="contribution-form" :loading="saving" :disabled="!canSave">Save rates</AppButton>
    </template>
  </AppModal>
</template>
