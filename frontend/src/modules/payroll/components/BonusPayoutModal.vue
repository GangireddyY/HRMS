<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { STATUTORY_BONUS, type BonusBasis } from '@contracts';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppButton, AppCheckbox, AppInput, AppModal, AppSegmented, AppSelect } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** A bonus or incentive for everyone in a draft run: fixed, a % of Basic or gross, or the statutory bonus. */
const props = defineProps<{ open: boolean; runId: string }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const feedback = useFeedbackStore();
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ label: '', category: 'BONUS' as 'BONUS' | 'INCENTIVE', basis: 'FIXED' as BonusBasis, value: '' as string | number, taxable: true });
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    Object.assign(form, { label: '', category: 'BONUS', basis: 'FIXED', value: '', taxable: true });
  },
);
const categories = [
  { value: 'BONUS' as const, label: 'Bonus' },
  { value: 'INCENTIVE' as const, label: 'Incentive' },
];
const bases: { value: BonusBasis; label: string; description: string }[] = [
  { value: 'FIXED', label: 'The same amount for everyone', description: 'e.g. ₹5,000 festival bonus' },
  { value: 'PERCENT_OF_BASIC', label: '% of monthly Basic', description: 'Worked out per person' },
  { value: 'PERCENT_OF_GROSS', label: '% of monthly gross', description: 'Worked out per person' },
  {
    value: 'STATUTORY',
    label: 'Statutory bonus (Payment of Bonus Act)',
    description: `Basic up to ${rupees(STATUTORY_BONUS.eligibleUpTo)}: rate × min(Basic, ${rupees(STATUTORY_BONUS.calculationCeiling)}) per month worked this financial year`,
  },
];
const valueLabel = computed(() => (form.basis === 'FIXED' ? 'Amount (₹)' : form.basis === 'STATUTORY' ? `Rate (${STATUTORY_BONUS.minRate}–${STATUTORY_BONUS.maxRate}%)` : 'Percentage'));
const saving = ref(false);
async function save() {
  reset();
  saving.value = true;
  try {
    const r = await payrollApi.addBonus(props.runId, { label: form.label, category: form.category, basis: form.basis, value: Number(form.value), taxable: form.taxable });
    feedback.success(
      r.added ? `${form.label} added for ${r.added} ${r.added === 1 ? 'person' : 'people'}` : 'Nobody qualified',
      [r.added ? `${rupees(r.total)} in total` : null, r.skipped.length ? `${r.skipped.length} skipped (${r.skipped[0]!.reason.toLowerCase()}${r.skipped.length > 1 ? '…' : ''})` : null].filter(Boolean).join(' · ') || undefined,
    );
    emit('saved');
  } catch (e) {
    handle(e, 'Could not add the bonus');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" dialog title="Add a bonus or incentive" description="Added to every payslip in this run as a one-off earning. Remove it from a payslip if someone shouldn't get it." @close="emit('close')">
    <form id="bonus-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppSegmented v-model="form.category" :options="categories" label="Kind" />
      <AppInput v-model="form.label" label="Shown on the payslip as" placeholder="e.g. Diwali bonus" required :error="fieldErrors.label" />
      <AppSelect v-model="form.basis" label="Worked out as" :options="bases" :clearable="false" :searchable="false" />
      <AppInput v-model="form.value" :label="valueLabel" type="number" :min="0.01" :step="0.01" required :error="fieldErrors.value" />
      <AppCheckbox v-model="form.taxable" label="Taxable" description="Counts as salary for income tax (TDS)." />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="bonus-form" :loading="saving" :disabled="form.label.trim().length < 2 || !(Number(form.value) > 0)">Add to payslips</AppButton>
    </template>
  </AppModal>
</template>
