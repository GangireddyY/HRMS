<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { trainingApi } from '@/modules/training/api/training.api';
import type { RosterRow, Session } from '@/modules/training/types';
import { ENROLLMENT_STATUS_LABELS, enrollmentTone, sessionWhen } from '@/modules/training/utils/training-format';
import { AppAlert, AppBadge, AppButton, AppCheckbox, AppModal, AppSkeleton } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Attendance sheet for one session: ticked people attended; unticked people are no-shows once the session has ended. */
const props = defineProps<{ open: boolean; courseId: string; session: Session | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const feedback = useFeedbackStore();

const rows = ref<RosterRow[]>([]);
const attended = ref<Record<string, boolean>>({});
const loading = ref(false);
const saving = ref(false);
watch(
  () => props.open,
  async (open) => {
    if (!open || !props.session) return;
    loading.value = true;
    try {
      rows.value = (await trainingApi.roster(props.courseId, props.session.id)).filter((r) => r.status !== 'CANCELLED');
      attended.value = Object.fromEntries(rows.value.map((r) => [r.id, r.attended || r.status === 'COMPLETED']));
    } catch (e) {
      feedback.error('Could not load the roster', e);
    } finally {
      loading.value = false;
    }
  },
);
const editable = computed(() => rows.value.filter((r) => r.status !== 'COMPLETED' && r.status !== 'FAILED'));
const ended = computed(() => !!props.session && new Date(props.session.endsAt) <= new Date());
async function save() {
  saving.value = true;
  try {
    await trainingApi.attendance(props.session!.id, editable.value.map((r) => ({ enrollmentId: r.id, attended: !!attended.value[r.id] })));
    feedback.success('Attendance saved');
    emit('saved');
  } catch (e) {
    feedback.error('Could not save attendance', e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Attendance" :description="session ? sessionWhen(session) : undefined" @close="emit('close')">
    <AppSkeleton v-if="loading" :lines="4" />
    <template v-else>
      <AppAlert v-if="!ended" tone="info" class="mb-4">The session hasn't ended: people you don't tick stay enrolled for now.</AppAlert>
      <p v-if="!rows.length" class="text-sm text-fg-muted">Nobody is enrolled in this session.</p>
      <ul v-else class="divide-y divide-line">
        <li v-for="r in rows" :key="r.id" class="flex items-center justify-between gap-3 py-3">
          <AppCheckbox v-model="attended[r.id]" :label="r.employee.name" :description="r.employee.department ?? r.employee.employeeCode" :disabled="r.status === 'COMPLETED' || r.status === 'FAILED'" />
          <AppBadge :tone="enrollmentTone[r.status]" size="sm">{{ ENROLLMENT_STATUS_LABELS[r.status] }}</AppBadge>
        </li>
      </ul>
    </template>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton :loading="saving" :disabled="!editable.length" @click="save">Save attendance</AppButton>
    </template>
  </AppModal>
</template>
