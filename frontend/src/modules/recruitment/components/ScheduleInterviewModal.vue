<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import { INTERVIEW_MODES, type InterviewMode } from '@contracts';
import { employeesApi } from '@/modules/people/api/people.api';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import type { ApplicationDetail } from '@/modules/recruitment/types';
import { MODE_LABELS } from '@/modules/recruitment/utils/recruitment-format';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppSelect } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Schedule an interview round with a panel of employees (they are notified). */
const props = defineProps<{ open: boolean; applicationId: string }>();
const emit = defineEmits<{ close: []; saved: [detail: ApplicationDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const people = useAsync(() => employeesApi.list({ status: 'ACTIVE', pageSize: 100, sort: 'name:asc' }), { immediate: false });
const form = reactive({ roundName: '', date: undefined as string | undefined, time: '10:00', durationMinutes: 60 as number | string, mode: 'VIDEO' as InterviewMode, location: '', panel: [] as string[] });
const pick = ref<string | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    if (!people.data.value) void people.run();
    Object.assign(form, { roundName: '', date: undefined, time: '10:00', durationMinutes: 60, mode: 'VIDEO', location: '', panel: [] });
  },
  { immediate: true },
);
watch(pick, (id) => {
  if (id && !form.panel.includes(id)) form.panel.push(id);
  pick.value = null;
});
const byId = computed(() => new Map((people.data.value?.items ?? []).map((e) => [e.id, e])));
const options = computed(() => (people.data.value?.items ?? []).filter((e) => !form.panel.includes(e.id)).map((e) => ({ value: e.id, label: e.fullName, description: e.designation?.name })));
const modeOptions = INTERVIEW_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }));
const canSave = computed(() => form.roundName.trim().length >= 2 && !!form.date && /^\d{2}:\d{2}$/.test(form.time) && form.panel.length > 0);

async function save() {
  reset();
  saving.value = true;
  try {
    const [y, m, d] = form.date!.split('-').map(Number) as [number, number, number];
    const [hh, mm] = form.time.split(':').map(Number) as [number, number];
    const scheduledAt = new Date(y, m - 1, d, hh, mm).toISOString();
    emit('saved', await recruitmentApi.schedule(props.applicationId, { roundName: form.roundName, scheduledAt, durationMinutes: Number(form.durationMinutes) || 60, mode: form.mode, location: form.location || null, panelistIds: form.panel }));
  } catch (e) {
    handle(e, 'Could not schedule the interview');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Schedule interview" description="Interviewers are notified and see the candidate in My interviews." @close="emit('close')">
    <form id="interview-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppInput v-model="form.roundName" label="Round" required placeholder="e.g. Technical round 1" :error="fieldErrors.roundName" />
      <div class="grid gap-4 sm:grid-cols-3">
        <AppDatePicker v-model="form.date" label="Date" required :error="fieldErrors.scheduledAt" />
        <AppInput v-model="form.time" label="Time" type="time" required />
        <AppInput v-model="form.durationMinutes" label="Duration (min)" type="number" :min="10" :max="480" />
      </div>
      <div class="grid gap-4 sm:grid-cols-[180px_1fr]">
        <AppSelect v-model="form.mode" label="Mode" :options="modeOptions" :clearable="false" />
        <AppInput v-model="form.location" :label="form.mode === 'VIDEO' ? 'Meeting link' : form.mode === 'PHONE' ? 'Phone number' : 'Room'" />
      </div>
      <div>
        <AppSelect v-model="pick" label="Interviewers" required placeholder="Add an interviewer…" :options="options" searchable :error="fieldErrors.panelistIds" />
        <ul v-if="form.panel.length" class="mt-2 flex flex-wrap gap-2">
          <li v-for="pid in form.panel" :key="pid" class="inline-flex items-center gap-2 rounded-full bg-surface-muted py-1 pe-2 ps-3 text-sm text-fg">
            {{ byId.get(pid)?.fullName ?? pid }}
            <button type="button" class="rounded-full p-0.5 text-fg-subtle hover:bg-surface hover:text-fg" :aria-label="`Remove ${byId.get(pid)?.fullName}`" @click="form.panel = form.panel.filter((x) => x !== pid)"><X :size="13" /></button>
          </li>
        </ul>
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="interview-form" :loading="saving" :disabled="!canSave">Schedule</AppButton>
    </template>
  </AppModal>
</template>
