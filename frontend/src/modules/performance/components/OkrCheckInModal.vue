<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { CircleCheck, CircleDashed, TriangleAlert, OctagonAlert } from '@lucide/vue';
import type { OkrHealth } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import type { KeyResult, ObjectiveDetail } from '@/modules/performance/types';
import { OKR_HEALTH_LABELS, krValue } from '@/modules/performance/utils/performance-format';
import { AppAlert, AppButton, AppInput, AppModal, AppSegmented, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { formatMoney } from '@/shared/utils/format';

/** Record where a key result stands now and how confident you are of hitting it. */
const props = defineProps<{ open: boolean; keyResult: KeyResult | null }>();
const emit = defineEmits<{ close: []; saved: [o: ObjectiveDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ value: null as number | string | null, done: 'NO' as 'YES' | 'NO', health: 'ON_TRACK' as OkrHealth, note: '' });
const saving = ref(false);
const healthOptions = [
  { value: 'ON_TRACK' as const, label: OKR_HEALTH_LABELS.ON_TRACK, icon: CircleCheck },
  { value: 'AT_RISK' as const, label: OKR_HEALTH_LABELS.AT_RISK, icon: TriangleAlert },
  { value: 'OFF_TRACK' as const, label: OKR_HEALTH_LABELS.OFF_TRACK, icon: OctagonAlert },
];
const doneOptions = [
  { value: 'NO' as const, label: 'Not yet', icon: CircleDashed },
  { value: 'YES' as const, label: 'Done', icon: CircleCheck },
];
watch(
  () => props.open,
  (open) => {
    if (!open || !props.keyResult) return;
    reset();
    const k = props.keyResult;
    Object.assign(form, { value: k.currentValue, done: k.currentValue >= 1 ? 'YES' : 'NO', health: k.checkIns?.[0]?.health ?? 'ON_TRACK', note: '' });
  },
  { immediate: true },
);
const milestone = computed(() => props.keyResult?.metric === 'MILESTONE');
const numeric = computed(() => (milestone.value ? (form.done === 'YES' ? 1 : 0) : Number(form.value)));
const preview = computed(() => {
  const k = props.keyResult;
  if (!k || milestone.value || !Number.isFinite(numeric.value) || form.value === '' || form.value === null) return null;
  const span = k.targetValue - k.startValue;
  return Math.max(0, Math.min(100, Math.round(((numeric.value - k.startValue) / span) * 100)));
});
const canSave = computed(() => milestone.value || (form.value !== '' && form.value !== null && Number.isFinite(numeric.value)));

async function save() {
  reset();
  saving.value = true;
  try {
    emit('saved', await performanceApi.okrCheckIn(props.keyResult!.id, { value: numeric.value, health: form.health, note: form.note || null }));
  } catch (e) {
    handle(e, 'Could not record the check-in');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Check in" :description="keyResult?.title" size="sm" @close="emit('close')">
    <form v-if="keyResult" id="okr-check-in" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div v-if="milestone">
        <p class="label">Status</p>
        <AppSegmented v-model="form.done" :options="doneOptions" label="Milestone status" />
      </div>
      <div v-else>
        <AppInput
          v-model="form.value"
          type="number"
          label="Current value"
          required
          :suffix="keyResult.metric === 'PERCENT' ? '%' : (keyResult.unit ?? undefined)"
          :help="`From ${krValue(keyResult.startValue, keyResult, formatMoney)} to ${krValue(keyResult.targetValue, keyResult, formatMoney)}${preview !== null ? ` · ${preview}% of the way` : ''}`"
          :error="fieldErrors.value"
        />
      </div>
      <div>
        <p class="label">Confidence</p>
        <AppSegmented v-model="form.health" :options="healthOptions" label="How it is going" size="sm" />
      </div>
      <AppTextarea v-model="form.note" label="Note (optional)" :rows="3" :maxlength="1000" placeholder="What moved, what's blocking, what's next" :error="fieldErrors.note" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="okr-check-in" :loading="saving" :disabled="!canSave">Save check-in</AppButton>
    </template>
  </AppModal>
</template>
