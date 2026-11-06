<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { CalendarDay } from '@/modules/attendance/types';
import { DAY_STATUS_LABELS, formatTime } from '@/modules/attendance/utils/attendance-format';
import { AppAlert, AppBadge, AppButton, AppInput, AppModal, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { formatDate } from '@/shared/utils/format';

/**
 * `regularize`: the employee asks for corrected times (needs approval).
 * `correct`: HR records the times directly (attendance.manage, audited).
 */
const props = defineProps<{ open: boolean; day: CalendarDay | null; mode: 'regularize' | 'correct'; timeZone: string; employeeId?: string }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const form = reactive({ checkIn: '', checkOut: '', text: '' });

watch(
  () => [props.open, props.day] as const,
  ([open, day]) => {
    if (!open || !day) return;
    reset();
    const t = (iso: string | null | undefined) => (iso ? formatTime(iso, props.timeZone) : '');
    form.checkIn = t(day.record?.checkInAt) || '09:00';
    form.checkOut = t(day.record?.checkOutAt) || '18:00';
    form.text = '';
  },
  { immediate: true },
);

const title = computed(() => (props.mode === 'regularize' ? 'Request regularization' : 'Correct attendance'));
const crossesMidnight = computed(() => !!form.checkIn && !!form.checkOut && form.checkOut <= form.checkIn);

async function save() {
  if (!props.day) return;
  reset();
  saving.value = true;
  try {
    if (props.mode === 'regularize') {
      await attendanceApi.requestRegularization({ workDate: props.day.date, checkIn: form.checkIn, checkOut: form.checkOut, reason: form.text });
    } else {
      await attendanceApi.upsertRecord({ employeeId: props.employeeId!, workDate: props.day.date, checkIn: form.checkIn, checkOut: form.checkOut || null, note: form.text });
    }
    emit('saved');
  } catch (e) {
    handle(e, props.mode === 'regularize' ? 'Could not submit the request' : 'Could not save attendance');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="title" :description="day ? formatDate(day.date) : undefined" size="sm" @close="emit('close')">
    <form v-if="day" id="day-edit" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        Currently: <AppBadge>{{ DAY_STATUS_LABELS[day.status] }}</AppBadge>
        <span v-if="day.record?.checkInAt">{{ formatTime(day.record.checkInAt, timeZone) }}–{{ formatTime(day.record.checkOutAt, timeZone) }}</span>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <AppInput v-model="form.checkIn" type="time" label="Check-in" required :error="fieldErrors.checkIn" />
        <AppInput v-model="form.checkOut" type="time" :label="mode === 'correct' ? 'Check-out (optional)' : 'Check-out'" :required="mode === 'regularize'" :error="fieldErrors.checkOut" />
      </div>
      <p v-if="crossesMidnight" class="text-xs text-fg-muted">Check-out is earlier than check-in, so it counts as the next morning (night shift).</p>
      <AppTextarea
        v-model="form.text"
        :label="mode === 'regularize' ? 'Reason' : 'Note for the audit trail'"
        required
        :rows="3"
        :maxlength="500"
        :placeholder="mode === 'regularize' ? 'e.g. Forgot to punch in, was at a client site' : 'e.g. Biometric device was down'"
        :error="fieldErrors.reason ?? fieldErrors.note ?? fieldErrors.workDate"
      />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="day-edit" :loading="saving" :disabled="!form.checkIn || (mode === 'regularize' && !form.checkOut) || form.text.trim().length < (mode === 'regularize' ? 5 : 3)">
        {{ mode === 'regularize' ? 'Submit request' : 'Save attendance' }}
      </AppButton>
    </template>
  </AppModal>
</template>
