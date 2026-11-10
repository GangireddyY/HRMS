<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { performanceApi } from '@/modules/performance/api/performance.api';
import type { OneOnOneDetail, OneOnOneTeamRow } from '@/modules/performance/types';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { addDaysIso, localToday } from '@/shared/utils/dates';

/** Schedule a 1:1 with one of your people (with agenda topics to start from), or move an upcoming one. */
const props = defineProps<{ open: boolean; team?: OneOnOneTeamRow[]; employeeId?: string | null; meeting?: OneOnOneDetail | null }>();
const emit = defineEmits<{ close: []; saved: [m: OneOnOneDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const today = localToday();
const form = reactive({ employeeId: null as string | null, date: undefined as string | undefined, time: '10:00' as string | number | null, duration: 30 as number, topics: '' });
const saving = ref(false);
const people = computed(() => (props.team ?? []).map((r) => ({ value: r.employee.id, label: r.employee.name, description: [r.employee.department, r.next ? 'next 1:1 booked' : null].filter(Boolean).join(' · ') })));
const durations = [15, 30, 45, 60, 90].map((m) => ({ value: m, label: m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : '1½ hours' }));
const pad = (n: number) => String(n).padStart(2, '0');
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const m = props.meeting;
    if (m) {
      const at = new Date(m.scheduledAt);
      Object.assign(form, { employeeId: m.employee.id, date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, time: `${pad(at.getHours())}:${pad(at.getMinutes())}`, duration: m.durationMinutes, topics: '' });
    } else {
      Object.assign(form, { employeeId: props.employeeId ?? null, date: addDaysIso(today, 1), time: '10:00', duration: 30, topics: '' });
    }
  },
  { immediate: true },
);
const scheduledAt = computed(() => (form.date && form.time ? new Date(`${form.date}T${form.time}`) : null));
const inPast = computed(() => !!scheduledAt.value && scheduledAt.value.getTime() < Date.now());
const canSave = computed(() => !!form.employeeId && !!scheduledAt.value && !Number.isNaN(scheduledAt.value.getTime()));

async function save() {
  reset();
  saving.value = true;
  try {
    const at = scheduledAt.value!.toISOString();
    const saved = props.meeting
      ? await performanceApi.updateOneOnOne(props.meeting.id, { scheduledAt: at, durationMinutes: form.duration })
      : await performanceApi.scheduleOneOnOne({
          employeeId: form.employeeId!,
          scheduledAt: at,
          durationMinutes: form.duration,
          topics: form.topics
            .split('\n')
            .map((t) => t.trim())
            .filter((t) => t.length >= 2),
        });
    emit('saved', saved);
  } catch (e) {
    handle(e, props.meeting ? 'Could not move the 1:1' : 'Could not schedule the 1:1');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="meeting ? 'Move 1:1' : 'Schedule a 1:1'" :description="meeting ? `With ${meeting.employee.name}. They're notified of the new time.` : 'They are notified and can add topics to the agenda.'" size="md" @close="emit('close')">
    <form id="one-on-one-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppSelect v-if="!meeting" v-model="form.employeeId" label="With" required :options="people" searchable placeholder="Choose a person" :error="fieldErrors.employeeId" />
      <div class="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <AppDatePicker v-model="form.date" label="Date" required :min="today" :error="fieldErrors.scheduledAt" />
        <AppInput v-model="form.time" type="time" label="Time" required />
      </div>
      <AppSelect v-model="form.duration" label="Length" :options="durations" :clearable="false" />
      <AppAlert v-if="inPast" tone="warning">That time has already passed.</AppAlert>
      <AppTextarea v-if="!meeting" v-model="form.topics" label="Agenda topics (optional)" :rows="3" placeholder="One per line, e.g. Career goals for next year" help="Open topics and actions from your last 1:1 carry over when you complete it." />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="one-on-one-form" :loading="saving" :disabled="!canSave">{{ meeting ? 'Move' : 'Schedule' }}</AppButton>
    </template>
  </AppModal>
</template>
