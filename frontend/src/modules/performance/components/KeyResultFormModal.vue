<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { OKR_METRICS, type OkrMetric } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import type { KeyResult, ObjectiveDetail } from '@/modules/performance/types';
import { OKR_METRIC_LABELS } from '@/modules/performance/utils/performance-format';
import { AppAlert, AppButton, AppInput, AppModal, AppSelect } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Add a key result to an objective, or change one. */
const props = defineProps<{ open: boolean; objectiveId: string; keyResult?: KeyResult | null }>();
const emit = defineEmits<{ close: []; saved: [o: ObjectiveDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ title: '', metric: 'NUMBER' as OkrMetric, startValue: 0 as number | string | null, targetValue: null as number | string | null, unit: '', weight: 1 as number | string | null });
const saving = ref(false);
const metricOptions = OKR_METRICS.map((m) => ({ value: m, label: OKR_METRIC_LABELS[m] }));
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const k = props.keyResult;
    Object.assign(form, k ? { title: k.title, metric: k.metric, startValue: k.startValue, targetValue: k.targetValue, unit: k.unit ?? '', weight: k.weight } : { title: '', metric: 'NUMBER', startValue: 0, targetValue: null, unit: '', weight: 1 });
  },
  { immediate: true },
);
const milestone = computed(() => form.metric === 'MILESTONE');
const canSave = computed(() => form.title.trim().length >= 3 && (milestone.value || (form.targetValue !== null && form.targetValue !== '' && Number(form.targetValue) !== Number(form.startValue ?? 0))));

async function save() {
  reset();
  saving.value = true;
  const body = {
    title: form.title,
    metric: form.metric,
    ...(milestone.value ? {} : { startValue: Number(form.startValue ?? 0), targetValue: Number(form.targetValue), unit: form.metric === 'NUMBER' ? form.unit || null : null }),
    weight: Number(form.weight) || 1,
  };
  try {
    emit('saved', props.keyResult ? await performanceApi.updateKeyResult(props.keyResult.id, body) : await performanceApi.addKeyResult(props.objectiveId, body));
  } catch (e) {
    handle(e, 'Could not save the key result');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="keyResult ? 'Edit key result' : 'Add key result'" size="md" @close="emit('close')">
    <form id="key-result-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppInput v-model="form.title" label="Key result" required :maxlength="200" placeholder="A measurable outcome" :error="fieldErrors.title" />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppSelect v-model="form.metric" label="Measured as" :options="metricOptions" :clearable="false" />
        <AppInput v-model="form.weight" type="number" label="Weight" :min="1" :max="10" suffix="×" help="1 to 10" :error="fieldErrors.weight" />
      </div>
      <div v-if="!milestone" class="grid gap-4" :class="form.metric === 'NUMBER' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'">
        <AppInput v-model="form.startValue" type="number" label="Starting value" :error="fieldErrors.startValue" />
        <AppInput v-model="form.targetValue" type="number" label="Target" required :error="fieldErrors.targetValue" />
        <AppInput v-if="form.metric === 'NUMBER'" v-model="form.unit" label="Unit" :maxlength="20" placeholder="e.g. deals" />
      </div>
      <p v-else class="text-sm text-fg-muted">A milestone is either done or not: it counts 0% until it's checked in as done.</p>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="key-result-form" :loading="saving" :disabled="!canSave">{{ keyResult ? 'Save' : 'Add' }}</AppButton>
    </template>
  </AppModal>
</template>
