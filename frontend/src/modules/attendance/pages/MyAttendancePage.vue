<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import AttendanceCalendarView from '@/modules/attendance/components/AttendanceCalendar.vue';
import DayEditModal from '@/modules/attendance/components/DayEditModal.vue';
import PunchCard from '@/modules/attendance/components/PunchCard.vue';
import WorkFromHomeModal from '@/modules/attendance/components/WorkFromHomeModal.vue';
import type { CalendarDay } from '@/modules/attendance/types';
import { OVERTIME_LABELS, REGULARIZATION_LABELS, currentMonth, dateRange, formatMinutes, formatTime, overtimeTone, regularizationTone, shiftMonth } from '@/modules/attendance/utils/attendance-format';
import { House } from '@lucide/vue';
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
const canWfh = computed(() => auth.can('attendance.wfh.apply'));
const wfh = useAsync(() => attendanceApi.workFromHome({ view: 'mine', pageSize: 6 }));
const overtime = useAsync(() => attendanceApi.overtime({ view: 'mine', pageSize: 6 }));
watch(month, () => void calendar.run());
const askingWfh = ref(false);
async function onWfh() {
  askingWfh.value = false;
  feedback.success('Request sent', 'Your manager has been notified.');
  await wfh.run();
}
async function cancelWfh(id: string) {
  try {
    await attendanceApi.cancelWorkFromHome(id);
    feedback.success('Request withdrawn');
    await Promise.all([wfh.run(), calendar.run()]);
  } catch (e) {
    feedback.error('Could not withdraw the request', e);
  }
}

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
    { label: 'Present', value: s.present, tone: 'text-success-fg' },
    { label: 'Half days', value: s.halfDay, tone: 'text-warning-fg' },
    { label: 'Absent', value: s.absent, tone: 'text-danger-fg' },
    { label: 'Late days', value: s.lateDays, tone: 'text-caution-fg' },
    { label: 'Worked', value: formatMinutes(s.workedMinutes), tone: 'text-fg' },
    ...(s.workFromHomeDays ? [{ label: 'From home', value: s.workFromHomeDays, tone: 'text-info-fg' }] : []),
    ...(s.overtimeMinutes ? [{ label: 'Overtime approved', value: formatMinutes(s.overtimeMinutes), tone: 'text-special-fg' }] : []),
  ];
});
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="My attendance" description="Punch in and out, check your month and request corrections." />
    <PunchCard @changed="calendar.run()" />

    <div class="grid items-start gap-4 xl:grid-cols-3">
      <AppCard class="xl:col-span-2" :description="canRequest ? 'Select a past day to request a correction.' : undefined">
        <AppSkeleton v-if="calendar.loading.value && !calendar.data.value" :lines="8" />
        <AppErrorState v-else-if="calendar.error.value" :error="calendar.error.value" @retry="calendar.run" />
        <template v-else-if="calendar.data.value">
          <AttendanceCalendarView :calendar="calendar.data.value" :selectable="canRequest && !calendar.data.value.closed" @prev="month = shiftMonth(month, -1)" @next="month = shiftMonth(month, 1)" @today="month = currentMonth()" @select="onSelect" />
          <p v-if="calendar.data.value.closed" class="mt-3 text-xs text-fg-muted">This month is closed; corrections are no longer possible.</p>
        </template>
      </AppCard>

      <div class="space-y-4">
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
            <li v-for="r in requests.data.value.items" :key="r.id" class="flex items-start justify-between gap-3 py-3">
              <div class="min-w-0">
                <p class="text-sm font-medium text-fg">{{ formatDate(r.workDate) }}</p>
                <p class="text-xs text-fg-muted">{{ formatTime(r.checkInAt, calendar.data.value?.timeZone) }}–{{ formatTime(r.checkOutAt, calendar.data.value?.timeZone) }} · {{ r.reason }}</p>
                <p v-if="r.reviewNote" class="mt-0.5 text-xs text-fg-subtle italic">“{{ r.reviewNote }}” — {{ r.reviewedBy }}</p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-2">
                <AppBadge :tone="regularizationTone[r.status]" dot>{{ REGULARIZATION_LABELS[r.status] }}</AppBadge>
                <AppButton v-if="r.status === 'PENDING'" size="xs" variant="ghost" @click="cancel(r.id)">Cancel</AppButton>
              </div>
            </li>
          </ul>
        </AppCard>

        <AppCard v-if="canWfh" title="Work from home">
          <template #actions><AppButton size="sm" variant="secondary" :icon="House" @click="askingWfh = true">Request</AppButton></template>
          <AppSkeleton v-if="wfh.loading.value && !wfh.data.value" :lines="2" />
          <AppEmptyState v-else-if="!wfh.data.value?.items.length" compact title="No requests yet" />
          <ul v-else class="divide-y divide-line">
            <li v-for="r in wfh.data.value.items" :key="r.id" class="flex items-start justify-between gap-3 py-3">
              <div class="min-w-0">
                <p class="text-sm font-medium text-fg">{{ dateRange(r.startDate, r.endDate) }}</p>
                <p class="truncate text-xs text-fg-muted">{{ r.reason }}</p>
                <p v-if="r.reviewNote" class="mt-0.5 text-xs text-fg-subtle italic">“{{ r.reviewNote }}” — {{ r.reviewedBy }}</p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-2">
                <AppBadge :tone="regularizationTone[r.status]" dot>{{ REGULARIZATION_LABELS[r.status] }}</AppBadge>
                <AppButton v-if="r.permissions.cancel && (r.status === 'PENDING' || r.startDate > (calendar.data.value?.today ?? ''))" size="xs" variant="ghost" @click="cancelWfh(r.id)">Withdraw</AppButton>
              </div>
            </li>
          </ul>
        </AppCard>

        <AppCard v-if="overtime.data.value?.items.length" title="Overtime">
          <ul class="divide-y divide-line">
            <li v-for="o in overtime.data.value.items" :key="o.id" class="flex items-start justify-between gap-3 py-3">
              <div class="min-w-0">
                <p class="text-sm font-medium text-fg">{{ formatDate(o.workDate) }} · {{ formatMinutes(o.approvedMinutes ?? o.minutes) }}</p>
                <p class="text-xs text-fg-muted">
                  <template v-if="o.approvedMinutes !== null && o.approvedMinutes !== o.minutes">of {{ formatMinutes(o.minutes) }} worked · </template>
                  <template v-if="o.paidIn">paid in {{ o.paidIn }} payroll</template>
                  <template v-else-if="o.status === 'APPROVED'">paid with the next payroll</template>
                </p>
                <p v-if="o.reviewNote" class="mt-0.5 text-xs text-fg-subtle italic">“{{ o.reviewNote }}” — {{ o.reviewedBy }}</p>
              </div>
              <AppBadge :tone="overtimeTone[o.status]" dot>{{ OVERTIME_LABELS[o.status] }}</AppBadge>
            </li>
          </ul>
        </AppCard>
      </div>
    </div>

    <DayEditModal :open="!!selected" :day="selected" mode="regularize" :time-zone="calendar.data.value?.timeZone ?? 'UTC'" @close="selected = null" @saved="onRequested" />
    <WorkFromHomeModal :open="askingWfh" :today="calendar.data.value?.today ?? new Date().toISOString().slice(0, 10)" @close="askingWfh = false" @saved="onWfh" />
  </div>
</template>
