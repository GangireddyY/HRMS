<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { UserRound } from '@lucide/vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import AttendanceCalendarView from '@/modules/attendance/components/AttendanceCalendar.vue';
import DayEditModal from '@/modules/attendance/components/DayEditModal.vue';
import type { CalendarDay } from '@/modules/attendance/types';
import { currentMonth, formatMinutes, shiftMonth } from '@/modules/attendance/utils/attendance-format';
import { AppButton, AppCard, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const month = ref(typeof route.query.month === 'string' ? route.query.month : currentMonth());
const calendar = useAsync(() => attendanceApi.calendar(month.value, id.value));
watch(month, (m) => {
  void router.replace({ query: { month: m } });
  void calendar.run();
});

const canCorrect = computed(() => auth.can('attendance.manage') && !calendar.data.value?.closed);
const selected = ref<CalendarDay | null>(null);
function onSelect(day: CalendarDay) {
  if (!canCorrect.value || day.date > calendar.data.value!.today) return;
  selected.value = day;
}
async function onSaved() {
  selected.value = null;
  feedback.success('Attendance saved', 'The change is recorded in the audit log.');
  await calendar.run();
}

const stats = computed(() => {
  const s = calendar.data.value?.summary;
  return s
    ? [
        ['Present', s.present],
        ['Half days', s.halfDay],
        ['Absent', s.absent],
        ['Missed punch-out', s.missedPunch],
        ['On leave', s.onLeave],
        ['Late days', s.lateDays],
        ['Holidays', s.holidays],
        ['Worked', formatMinutes(s.workedMinutes)],
      ]
    : [];
});
</script>

<template>
  <div>
    <AppSkeleton v-if="calendar.loading.value && !calendar.data.value" :lines="8" />
    <AppErrorState v-else-if="calendar.error.value" :error="calendar.error.value" title="Could not load attendance" @retry="calendar.run" />
    <template v-else-if="calendar.data.value">
      <AppPageHeader
        :title="calendar.data.value.employee.name"
        :description="`${calendar.data.value.employee.employeeCode} · ${calendar.data.value.shift.name} (${calendar.data.value.shift.startTime}–${calendar.data.value.shift.endTime})`"
        back="/hr/attendance"
        back-label="Attendance register"
      >
        <template #actions>
          <AppButton v-if="auth.can('employee.view', 'TEAM')" variant="secondary" :icon="UserRound" :to="`/hr/employees/${id}`">Employee profile</AppButton>
        </template>
      </AppPageHeader>
      <div class="grid items-start gap-6 xl:grid-cols-3">
        <AppCard class="xl:col-span-2" :description="canCorrect ? 'Select a day to correct its punch times.' : calendar.data.value.closed ? 'This month is closed.' : undefined">
          <AttendanceCalendarView :calendar="calendar.data.value" :selectable="canCorrect" @prev="month = shiftMonth(month, -1)" @next="month = shiftMonth(month, 1)" @select="onSelect" />
        </AppCard>
        <AppCard title="Month summary">
          <dl class="space-y-2.5 text-sm">
            <div v-for="[label, value] in stats" :key="label" class="flex justify-between gap-3">
              <dt class="text-fg-muted">{{ label }}</dt>
              <dd class="font-medium text-fg tabular-nums">{{ value }}</dd>
            </div>
          </dl>
        </AppCard>
      </div>
      <DayEditModal :open="!!selected" :day="selected" mode="correct" :time-zone="calendar.data.value.timeZone" :employee-id="id" @close="selected = null" @saved="onSaved" />
    </template>
  </div>
</template>
