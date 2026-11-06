<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { trainingApi } from '@/modules/training/api/training.api';
import type { CourseDetail, Session } from '@/modules/training/types';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Schedule or reschedule a session (local date and times). */
const props = defineProps<{ open: boolean; courseId: string; session: Session | null; virtual: boolean }>();
const emit = defineEmits<{ close: []; saved: [c: CourseDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const pad = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) => ({ date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` });
const form = reactive({ date: undefined as string | undefined, start: '10:00', end: '13:00', location: '', trainer: '', capacity: '' as number | string });
const saving = ref(false);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const s = props.session;
    const a = s ? local(new Date(s.startsAt)) : null;
    const b = s ? local(new Date(s.endsAt)) : null;
    Object.assign(form, { date: a?.date, start: a?.time ?? '10:00', end: b?.time ?? '13:00', location: s?.location ?? '', trainer: s?.trainer ?? '', capacity: s?.capacity ?? '' });
  },
  { immediate: true },
);
const today = local(new Date()).date;
const canSave = computed(() => !!form.date && /^\d{2}:\d{2}$/.test(form.start) && /^\d{2}:\d{2}$/.test(form.end) && form.end > form.start);
async function save() {
  reset();
  saving.value = true;
  const at = (t: string) => {
    const [y, m, d] = form.date!.split('-').map(Number) as [number, number, number];
    const [hh, mm] = t.split(':').map(Number) as [number, number];
    return new Date(y, m - 1, d, hh, mm).toISOString();
  };
  const body = { startsAt: at(form.start), endsAt: at(form.end), location: form.location || null, trainer: form.trainer || null, capacity: form.capacity === '' ? null : Number(form.capacity) };
  try {
    emit('saved', props.session ? await trainingApi.updateSession(props.session.id, body) : await trainingApi.createSession(props.courseId, body));
  } catch (e) {
    handle(e, 'Could not save the session');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="session ? 'Reschedule session' : 'Schedule a session'" @close="emit('close')">
    <form id="session-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-3">
        <AppDatePicker v-model="form.date" label="Date" required :min="session ? undefined : today" :error="fieldErrors.startsAt" />
        <AppInput v-model="form.start" label="Starts" type="time" required />
        <AppInput v-model="form.end" label="Ends" type="time" required :error="fieldErrors.endsAt" />
      </div>
      <AppInput v-model="form.location" :label="virtual ? 'Meeting link' : 'Room / venue'" :maxlength="300" />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.trainer" label="Trainer" :maxlength="120" />
        <AppInput v-model="form.capacity" label="Seats" type="number" :min="1" :max="10000" help="Leave empty for no limit." :error="fieldErrors.capacity" />
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="session-form" :loading="saving" :disabled="!canSave">Save</AppButton>
    </template>
  </AppModal>
</template>
