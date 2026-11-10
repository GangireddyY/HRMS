<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, X } from '@lucide/vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import TimesheetEntries, { type EditableEntry } from '@/modules/attendance/components/TimesheetEntries.vue';
import type { TimesheetDetail } from '@/modules/attendance/types';
import { dateRange } from '@/modules/attendance/utils/attendance-format';
import { TIMESHEET_LABELS, hoursLabel, shortDate, timesheetTone } from '@/modules/attendance/utils/timesheet-format';
import { AppAvatar, AppBadge, AppButton, AppErrorState, AppInput, AppModal, AppSkeleton, AppStatStrip, type StripItem } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

/** A submitted timesheet in full (read-only grid, days off and punched hours) with approve / send back. */
const props = defineProps<{ open: boolean; timesheetId: string | null; action?: 'approve' | 'reject' | null }>();
const emit = defineEmits<{ close: []; reviewed: [t: TimesheetDetail] }>();
const feedback = useFeedbackStore();

const detail = ref<TimesheetDetail | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);
const note = ref('');
const mode = ref<'approve' | 'reject' | null>(null);
const busy = ref(false);

async function load() {
  if (!props.timesheetId) return;
  loading.value = true;
  error.value = null;
  try {
    detail.value = await attendanceApi.timesheet(props.timesheetId);
  } catch (e) {
    error.value = e;
  } finally {
    loading.value = false;
  }
}
watch(
  () => [props.open, props.timesheetId] as const,
  ([open]) => {
    if (!open) return;
    detail.value = null;
    note.value = '';
    mode.value = props.action ?? null;
    void load();
  },
  { immediate: true },
);

const entries = computed<EditableEntry[]>(() => (detail.value?.entries ?? []).map((e, i) => ({ key: i, ...e })));
const strip = computed<StripItem[]>(() => {
  const d = detail.value;
  if (!d) return [];
  const expected = d.days.reduce((a, x) => a + x.expectedMinutes, 0);
  const punched = d.days.reduce((a, x) => a + (x.workedMinutes ?? 0), 0);
  return [
    { key: 'logged', label: 'Logged', value: hoursLabel(d.totalMinutes), tone: 'brand' },
    { key: 'expected', label: 'Expected', value: hoursLabel(expected), tone: 'neutral', hint: `${d.days.filter((x) => x.kind === 'WORKING').length} working days` },
    {
      key: 'punched',
      label: 'Punched in attendance',
      value: hoursLabel(punched),
      tone: 'info',
      hint: punched && d.totalMinutes && punched !== d.totalMinutes ? `${hoursLabel(Math.abs(punched - d.totalMinutes))} ${punched > d.totalMinutes ? 'more' : 'less'} than logged` : undefined,
    },
    { key: 'due', label: 'Due by', value: shortDate(d.dueDate), tone: 'warning' },
  ];
});
const needsNote = computed(() => mode.value === 'reject');
const canSubmit = computed(() => !!mode.value && (!needsNote.value || note.value.trim().length >= 3));

async function submit() {
  const d = detail.value;
  if (!d || !mode.value) return;
  busy.value = true;
  try {
    const updated = mode.value === 'approve' ? await attendanceApi.approveTimesheet(d.id, note.value.trim() || null) : await attendanceApi.rejectTimesheet(d.id, note.value.trim());
    feedback.success(mode.value === 'approve' ? 'Timesheet approved' : 'Timesheet sent back', `${d.employee?.name ?? 'The employee'} has been notified.`);
    emit('reviewed', updated);
  } catch (e) {
    feedback.error('Could not update the timesheet', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="detail ? `Timesheet · ${detail.employee?.name ?? ''}` : 'Timesheet'" :description="detail ? `Week of ${dateRange(detail.weekStart, detail.weekEnd)}` : undefined" size="xl" @close="emit('close')">
    <AppSkeleton v-if="loading && !detail" :lines="8" />
    <AppErrorState v-else-if="error" :error="error" title="Could not load the timesheet" @retry="load" />
    <div v-else-if="detail" class="space-y-4">
      <div class="flex flex-wrap items-center gap-3">
        <AppAvatar :name="detail.employee?.name ?? '?'" size="md" />
        <div class="min-w-0 flex-1">
          <p class="truncate font-semibold text-fg">{{ detail.employee?.name }}</p>
          <p class="truncate text-xs text-fg-muted">{{ [detail.employee?.employeeCode, detail.employee?.department].filter(Boolean).join(' · ') }}</p>
        </div>
        <div class="text-end">
          <AppBadge :tone="timesheetTone[detail.status]" dot>{{ TIMESHEET_LABELS[detail.status] }}</AppBadge>
          <p class="mt-1 text-xs text-fg-subtle">
            <template v-if="detail.status === 'SUBMITTED'">Submitted {{ timeAgo(detail.submittedAt) }}</template>
            <template v-else-if="detail.reviewedBy">By {{ detail.reviewedBy }} {{ timeAgo(detail.reviewedAt) }}</template>
          </p>
        </div>
      </div>

      <AppStatStrip :items="strip" label="Timesheet summary" />

      <div class="card overflow-hidden">
        <TimesheetEntries :entries="entries" :days="detail.days" readonly />
      </div>

      <blockquote v-if="detail.note" class="rounded-lg border-s-2 border-brand-500 bg-surface-muted/60 px-4 py-3 text-sm text-fg-muted">
        <span class="block text-2xs font-semibold tracking-wide text-fg-subtle uppercase">Note from {{ detail.employee?.name ?? 'the employee' }}</span>
        {{ detail.note }}
      </blockquote>
      <p v-if="detail.reviewNote && detail.status !== 'SUBMITTED'" class="text-sm text-fg-muted"><span class="font-medium text-fg">Review note:</span> {{ detail.reviewNote }}</p>

      <div v-if="detail.permissions.review" class="card space-y-3 p-4">
        <p class="text-sm font-semibold text-fg">Your decision</p>
        <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Decision">
          <button
            type="button"
            role="radio"
            :aria-checked="mode === 'approve'"
            :class="['inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ring-1 transition ring-inset', mode === 'approve' ? 'bg-success-soft text-success-fg ring-success/40' : 'text-fg-muted ring-line hover:bg-surface-muted']"
            @click="mode = 'approve'"
          >
            <Check :size="15" aria-hidden="true" />Approve
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="mode === 'reject'"
            :class="['inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ring-1 transition ring-inset', mode === 'reject' ? 'bg-warning-soft text-warning-fg ring-warning/40' : 'text-fg-muted ring-line hover:bg-surface-muted']"
            @click="mode = 'reject'"
          >
            <X :size="15" aria-hidden="true" />Send back for changes
          </button>
        </div>
        <AppInput
          v-if="mode"
          v-model="note"
          :label="mode === 'reject' ? 'What needs to change?' : 'Note to the employee'"
          :placeholder="mode === 'reject' ? 'e.g. Tuesday is missing the client work' : 'Optional'"
          :required="needsNote"
          :maxlength="500"
        />
      </div>
    </div>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">{{ detail?.permissions.review ? 'Cancel' : 'Close' }}</AppButton>
      <AppButton
        v-if="detail?.permissions.review"
        :variant="mode === 'reject' ? 'danger' : 'primary'"
        :icon="mode === 'reject' ? X : Check"
        :loading="busy"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ mode === 'reject' ? 'Send back' : 'Approve timesheet' }}
      </AppButton>
    </template>
  </AppModal>
</template>
