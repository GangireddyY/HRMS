<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import AttendanceCalendarView from '@/modules/attendance/components/AttendanceCalendar.vue';
import DayEditModal from '@/modules/attendance/components/DayEditModal.vue';
import PunchCard from '@/modules/attendance/components/PunchCard.vue';
import type { CalendarDay } from '@/modules/attendance/types';
import { REGULARIZATION_LABELS, currentMonth, formatMinutes, formatTime, regularizationTone, shiftMonth } from '@/modules/attendance/utils/attendance-format';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const month = ref(currentMonth());
const calendar = useAsync(() => attendanceApi.calendar(month.value));
const requests = useAsync(() => attendanceApi.regularizations({ view: 'mine', pageSize: 8 }));
watch(month, () => void calendar.run());

const canRequest = computed(() => auth.can('attendance.regularize.apply'));
const selected = ref<CalendarDay | null>(null);

function onSelect(day: CalendarDay) {
  if (!canRequest.value || calendar.data.value?.closed) return;
  if (day.date > calendar.data.value!.today) return;
  if (day.pendingRegularizationId) {
    feedback.info('A request for this day is already pending.');
    return;
  }
  selected.value = day;
}

async function onRequested() {
  selected.value = null;
  feedback.success('Request submitted', 'Your manager has been notified.');
  await Promise.all([calendar.run(), requests.run()]);
}

async function cancel(id: string) {
  try {
    await attendanceApi.cancel(id);
    feedback.success('Request cancelled');
    await Promise.all([calendar.run(), requests.run()]);
  } catch (e) {
    feedback.error('Could not cancel the request', e);
  }
}

const stats = computed(() => {
  const s = calendar.data.value?.summary;
  if (!s) return [];
  return [
    { label: 'Present', value: s.present, tone: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Half days', value: s.halfDay, tone: 'text-amber-600 dark:text-amber-400' },
    { label: 'Absent', value: s.absent, tone: 'text-red-600 dark:text-red-400' },
    { label: 'Late days', value: s.lateDays, tone: 'text-orange-600 dark:text-orange-400' },
    { label: 'Worked', value: formatMinutes(s.workedMinutes), tone: 'text-fg' },
  ];
});
</script>

<template>
  <div class="space-y-6">
    <AppPageHeader title="My attendance" description="Punch in and out, check your month and request corrections." />
    <PunchCard @changed="calendar.run()" />

    <div class="grid items-start gap-6 xl:grid-cols-3">
      <AppCard class="xl:col-span-2" :description="canRequest ? 'Select a past day to request a correction.' : undefined">
        <AppSkeleton v-if="calendar.loading.value && !calendar.data.value" :lines="8" />
        <AppErrorState v-else-if="calendar.error.value" :error="calendar.error.value" @retry="calendar.run" />
        <template v-else-if="calendar.data.value">
          <AttendanceCalendarView :calendar="calendar.data.value" :selectable="canRequest && !calendar.data.value.closed" @prev="month = shiftMonth(month, -1)" @next="month = shiftMonth(month, 1)" @select="onSelect" />
          <p v-if="calendar.data.value.closed" class="mt-3 text-xs text-fg-muted">This month is closed; corrections are no longer possible.</p>
        </template>
      </AppCard>

      <div class="space-y-6">
        <AppCard title="This month">
          <dl class="grid grid-cols-2 gap-4">
            <div v-for="s in stats" :key="s.label">
              <dt class="text-xs text-fg-muted">{{ s.label }}</dt>
              <dd :class="['mt-0.5 text-xl font-semibold tabular-nums', s.tone]">{{ s.value }}</dd>
            </div>
          </dl>
          <p v-if="calendar.data.value" class="mt-4 text-xs text-fg-muted">
            {{ calendar.data.value.shift.name }}: {{ calendar.data.value.shift.startTime }}–{{ calendar.data.value.shift.endTime }}, late after {{ calendar.data.value.shift.graceMinutes }} min.
          </p>
        </AppCard>

        <AppCard title="My requests">
          <AppSkeleton v-if="requests.loading.value && !requests.data.value" :lines="3" />
          <AppErrorState v-else-if="requests.error.value" :error="requests.error.value" @retry="requests.run" />
          <AppEmptyState v-else-if="!requests.data.value?.items.length" compact title="No requests yet" />
          <ul v-else class="divide-y divide-line">
            <li v-for="r in requests.data.value.items" :key="r.id" class="flex items-start justify-between gap-3 py-2.5">
              <div class="min-w-0">
                <p class="text-sm font-medium text-fg">{{ formatDate(r.workDate) }}</p>
                <p class="text-xs text-fg-muted">{{ formatTime(r.checkInAt, calendar.data.value?.timeZone) }}–{{ formatTime(r.checkOutAt, calendar.data.value?.timeZone) }} · {{ r.reason }}</p>
                <p v-if="r.reviewNote" class="mt-0.5 text-xs text-fg-subtle italic">“{{ r.reviewNote }}” — {{ r.reviewedBy }}</p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1.5">
                <AppBadge :tone="regularizationTone[r.status]" dot>{{ REGULARIZATION_LABELS[r.status] }}</AppBadge>
                <AppButton v-if="r.status === 'PENDING'" size="xs" variant="ghost" @click="cancel(r.id)">Cancel</AppButton>
              </div>
            </li>
          </ul>
        </AppCard>
      </div>
    </div>

    <DayEditModal :open="!!selected" :day="selected" mode="regularize" :time-zone="calendar.data.value?.timeZone ?? 'UTC'" @close="selected = null" @saved="onRequested" />
  </div>
</template>
