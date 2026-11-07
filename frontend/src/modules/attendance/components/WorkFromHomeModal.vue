<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { WorkFromHome } from '@/modules/attendance/types';
import { addDays } from '@/modules/attendance/utils/attendance-format';
import { AppAlert, AppButton, AppDatePicker, AppModal, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Ask to work from home for a day or a few days; the manager approves. */
const props = defineProps<{ open: boolean; today: string }>();
const emit = defineEmits<{ close: []; saved: [r: WorkFromHome] }>();
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ startDate: undefined as string | undefined, endDate: undefined as string | undefined, reason: '' });
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    Object.assign(form, { startDate: props.today, endDate: props.today, reason: '' });
  },
);
watch(
  () => form.startDate,
  (s) => {
    if (s && (!form.endDate || form.endDate < s)) form.endDate = s;
  },
);
const canSave = computed(() => !!form.startDate && !!form.endDate && form.reason.trim().length >= 5);
const saving = ref(false);
async function save() {
  reset();
  saving.value = true;
  try {
    emit('saved', await attendanceApi.requestWorkFromHome({ startDate: form.startDate!, endDate: form.endDate!, reason: form.reason }));
  } catch (e) {
    handle(e, 'Could not send the request');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Work from home" description="Your manager approves it. On approved days you can punch in from anywhere." size="sm" @close="emit('close')">
    <form id="wfh-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppDatePicker v-model="form.startDate" label="From" required :min="addDays(today, -45)" :max="addDays(today, 90)" :error="fieldErrors.startDate" />
        <AppDatePicker v-model="form.endDate" label="To" required :min="form.startDate" :max="form.startDate ? addDays(form.startDate, 30) : undefined" :error="fieldErrors.endDate" />
      </div>
      <AppTextarea v-model="form.reason" label="Reason" required :rows="2" :maxlength="500" :error="fieldErrors.reason" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="wfh-form" :loading="saving" :disabled="!canSave">Send request</AppButton>
    </template>
  </AppModal>
</template>
