<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { performanceApi } from '@/modules/performance/api/performance.api';
import type { Goal, ReviewDetail } from '@/modules/performance/types';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Add or edit a goal: what, how it's measured, its weight and due date. */
const props = defineProps<{ open: boolean; reviewId: string; goal: Goal | null; remainingWeight: number; periodStart: string; periodEnd: string }>();
const emit = defineEmits<{ close: []; saved: [r: ReviewDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ title: '', description: '', measure: '', weight: 0 as number | string, dueDate: undefined as string | undefined });
const saving = ref(false);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const g = props.goal;
    Object.assign(form, { title: g?.title ?? '', description: g?.description ?? '', measure: g?.measure ?? '', weight: g?.weight ?? Math.max(1, props.remainingWeight), dueDate: g?.dueDate ?? undefined });
  },
  { immediate: true },
);

async function save() {
  reset();
  saving.value = true;
  const body = { title: form.title, description: form.description || null, measure: form.measure || null, weight: Number(form.weight), dueDate: form.dueDate ?? null };
  try {
    emit('saved', props.goal ? await performanceApi.updateGoal(props.reviewId, props.goal.id, body) : await performanceApi.addGoal(props.reviewId, body));
  } catch (e) {
    handle(e, 'Could not save the goal');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="goal ? 'Edit goal' : 'Add goal'" description="Make it specific and measurable. All goals together add up to 100%." @close="emit('close')">
    <form id="goal-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppInput v-model="form.title" label="Goal" required :maxlength="200" placeholder="e.g. Launch the self-service portal" :error="fieldErrors.title" />
      <AppTextarea v-model="form.description" label="Details" :rows="2" :maxlength="2000" />
      <AppInput v-model="form.measure" label="How success is measured" :maxlength="500" placeholder="e.g. Live by September with 80% adoption" />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.weight" label="Weight (%)" type="number" :min="1" :max="100" required :error="fieldErrors.weight" />
        <AppDatePicker v-model="form.dueDate" label="Due by" :min="periodStart" :max="periodEnd" :error="fieldErrors.dueDate" />
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="goal-form" :loading="saving" :disabled="form.title.trim().length < 3 || !(Number(form.weight) >= 1)">Save goal</AppButton>
    </template>
  </AppModal>
</template>
