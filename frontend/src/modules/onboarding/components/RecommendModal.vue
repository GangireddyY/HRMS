<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import type { ProbationRecommendation } from '@contracts';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import type { ProbationDue } from '@/modules/onboarding/types';
import { AppAlert, AppButton, AppDatePicker, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { formatDate } from '@/shared/utils/format';

/** The manager (or HR) recommends confirming or extending probation; someone else decides. */
const props = defineProps<{ open: boolean; due: ProbationDue | null }>();
const emit = defineEmits<{ close: []; submitted: [] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const form = reactive({ recommendation: 'CONFIRM' as ProbationRecommendation, extendTo: undefined as string | undefined, comments: '' });
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    Object.assign(form, { recommendation: 'CONFIRM', extendTo: undefined, comments: '' });
  },
);
const options = [
  { value: 'CONFIRM' as const, label: 'Confirm', description: 'Probation completed successfully' },
  { value: 'EXTEND' as const, label: 'Extend probation', description: 'More time is needed' },
];
const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

async function submit() {
  reset();
  saving.value = true;
  try {
    await onboardingApi.submitReview({ employeeId: props.due!.employee.id, recommendation: form.recommendation, extendTo: form.recommendation === 'EXTEND' ? (form.extendTo ?? null) : null, comments: form.comments });
    emit('submitted');
  } catch (e) {
    handle(e, 'Could not submit the recommendation');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Probation review" :description="due ? `${due.employee.name} · probation ends ${formatDate(due.probationEndDate)}` : undefined" @close="emit('close')">
    <form id="recommend-form" class="space-y-4" novalidate @submit.prevent="submit">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppAlert tone="info">Your recommendation goes to HR for a decision. The employee isn't notified until it is approved.</AppAlert>
      <AppSelect v-model="form.recommendation" label="Recommendation" :options="options" :clearable="false" />
      <AppDatePicker
        v-if="form.recommendation === 'EXTEND' && due"
        v-model="form.extendTo"
        label="Extend until"
        required
        :min="plusDays(due.probationEndDate, 1)"
        :max="plusDays(due.probationEndDate, 365)"
        :error="fieldErrors.extendTo"
      />
      <AppTextarea v-model="form.comments" label="Assessment" required :rows="4" :maxlength="1000" placeholder="Performance, conduct and anything that supports the recommendation" :error="fieldErrors.comments" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="recommend-form" :loading="saving" :disabled="form.comments.trim().length < 10 || (form.recommendation === 'EXTEND' && !form.extendTo)">Submit recommendation</AppButton>
    </template>
  </AppModal>
</template>
