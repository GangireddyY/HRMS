<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { AlarmClock, CalendarDays, CircleCheck, CircleDashed, CircleX, Clock, House, Lock, Plane, Timer, TimerOff } from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import AttendanceCalendarView from '@/modules/attendance/components/AttendanceCalendar.vue';
import DayEditModal from '@/modules/attendance/components/DayEditModal.vue';
import PunchCard from '@/modules/attendance/components/PunchCard.vue';
import WorkFromHomeModal from '@/modules/attendance/components/WorkFromHomeModal.vue';
import type { CalendarDay } from '@/modules/attendance/types';
import { OVERTIME_LABELS, REGULARIZATION_LABELS, currentMonth, dateRange, formatMinutes, formatTime, monthLabel, overtimeTone, regularizationTone, shiftMonth } from '@/modules/attendance/utils/attendance-format';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSegmented, AppSkeleton } from '@/shared/components';
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

// ---- Month at a glance -----------------------------------------------------------------------------------------
const summary = computed(() => calendar.data.value?.summary ?? null);
/** Working days so far that needed attendance (leave, holidays and weekly offs don't count). */
const workingDays = computed(() => (summary.value ? summary.value.present + summary.value.halfDay + summary.value.absent + summary.value.missedPunch : 0));
const rate = computed(() => (summary.value && workingDays.value ? Math.round(((summary.value.present + summary.value.halfDay / 2) / workingDays.value) * 100) : null));
const rateTone = computed(() => (rate.value === null ? 'text-fg-subtle' : rate.value >= 90 ? 'text-success' : rate.value >= 75 ? 'text-warning' : 'text-danger'));
const CIRC = 2 * Math.PI * 40;
const tiles = computed<{ label: string; value: string | number; hint?: string; icon: Component; tone: string }[]>(() => {
  const s = summary.value;
  if (!s) return [];
  const attended = s.present + s.halfDay;
  return [
    { label: 'Present', value: s.present, icon: CircleCheck, tone: 'bg-success-soft text-success-fg' },
    { label: 'Half days', value: s.halfDay, icon: CircleDashed, tone: 'bg-warning-soft text-warning-fg' },
    { label: 'Absent', value: s.absent, icon: CircleX, tone: s.absent ? 'bg-danger-soft text-danger-fg' : 'bg-surface-muted text-fg-muted' },
    { label: 'Missed punches', value: s.missedPunch, hint: s.missedPunch ? 'Request a correction' : undefined, icon: TimerOff, tone: s.missedPunch ? 'bg-caution-soft text-caution-fg' : 'bg-surface-muted text-fg-muted' },
    { label: 'Late arrivals', value: s.lateDays, icon: AlarmClock, tone: s.lateDays ? 'bg-caution-soft text-caution-fg' : 'bg-surface-muted text-fg-muted' },
    { label: 'On leave', value: s.onLeave, icon: Plane, tone: 'bg-info-soft text-info-fg' },
    { label: 'From home', value: s.workFromHomeDays, icon: House, tone: 'bg-accent-soft text-accent-fg' },
    { label: 'Overtime', value: formatMinutes(s.overtimeMinutes), hint: 'Approved', icon: Timer, tone: 'bg-special-soft text-special-fg' },
    { label: 'Hours worked', value: formatMinutes(s.workedMinutes), hint: attended ? `${formatMinutes(Math.round(s.workedMinutes / attended))} a day on average` : undefined, icon: Clock, tone: 'bg-surface-muted text-fg' },
  ];
});

// ---- Requests --------------------------------------------------------------------------------------------------
type RequestTab = 'corrections' | 'wfh' | 'overtime';
const requestTab = ref<RequestTab>('corrections');
const pendingCount = computed(
  () => (requests.data.value?.items.filter((r) => r.status === 'PENDING').length ?? 0) + (wfh.data.value?.items.filter((r) => r.status === 'PENDING').length ?? 0) + (overtime.data.value?.items.filter((o) => o.status === 'PENDING').length ?? 0),
);
const requestTabs = computed(() => [
  { value: 'corrections' as const, label: `Corrections ${requests.data.value?.items.length ?? ''}`.trim() },
  ...(canWfh.value ? [{ value: 'wfh' as const, label: `From home ${wfh.data.value?.items.length ?? ''}`.trim() }] : []),
  ...(overtime.data.value?.items.length ? [{ value: 'overtime' as const, label: `Overtime ${overtime.data.value.items.length}` }] : []),
]);
const tileOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return { day: d.getUTCDate(), month: new Intl.DateTimeFormat(appLocale(), { month: 'short', timeZone: 'UTC' }).format(d) };
};
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="My attendance" description="Punch in and out, check your month and request corrections." />
    <PunchCard @changed="calendar.run()" />

    <!-- Month at a glance -->
    <section v-if="calendar.data.value && summary" class="card overflow-hidden" aria-labelledby="month-glance">
      <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
        <h2 id="month-glance" class="text-sm font-semibold text-fg">{{ monthLabel(calendar.data.value.month) }} at a glance</h2>
        <AppBadge v-if="calendar.data.value.closed" size="sm"><Lock :size="11" class="me-1" aria-hidden="true" />Closed</AppBadge>
        <span class="ms-auto inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs text-fg-muted">
          <Clock :size="12" aria-hidden="true" />{{ calendar.data.value.shift.name }} · {{ calendar.data.value.shift.startTime }}–{{ calendar.data.value.shift.endTime }} · late after {{ calendar.data.value.shift.graceMinutes }} min
        </span>
      </header>
      <div class="grid gap-px bg-line/70 md:grid-cols-[220px_minmax(0,1fr)]">
        <div class="flex items-center gap-4 bg-surface px-5 py-4">
          <div class="relative h-24 w-24 shrink-0">
            <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="40" fill="none" stroke-width="10" class="stroke-surface-muted" />
              <circle cx="50" cy="50" r="40" fill="none" stroke-width="10" stroke-linecap="round" :class="['stroke-current transition-[stroke-dashoffset] duration-700', rateTone]" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - (rate ?? 0) / 100)" />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-xl font-semibold text-fg tabular-nums">{{ rate === null ? '—' : `${rate}%` }}</span>
            </div>
          </div>
          <div>
            <p class="text-sm font-medium text-fg">Attendance</p>
            <p class="text-xs text-fg-muted">{{ workingDays ? `${summary.present + summary.halfDay} of ${workingDays} working days` : 'No working days yet' }}</p>
          </div>
        </div>
        <dl class="grid grid-cols-2 gap-px bg-line/70 sm:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9">
          <!-- Nine tiles: the last one spans two columns where the row would otherwise end with a gap. -->
          <div
            v-for="(t, i) in tiles"
            :key="t.label"
            :class="['flex items-start gap-3 bg-surface px-4 py-3.5 2xl:flex-col 2xl:gap-2', i === tiles.length - 1 && 'col-span-2 sm:col-span-1 xl:col-span-2 2xl:col-span-1']"
          >
            <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', t.tone]" aria-hidden="true"><component :is="t.icon" :size="15" /></span>
            <div class="min-w-0">
              <dt class="truncate text-2xs font-medium text-fg-muted">{{ t.label }}</dt>
              <dd class="text-lg leading-6 font-semibold text-fg tabular-nums">{{ t.value }}</dd>
              <dd v-if="t.hint" class="truncate text-2xs text-fg-subtle" :title="t.hint">{{ t.hint }}</dd>
            </div>
          </div>
        </dl>
      </div>
    </section>

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <AppCard title="Calendar" :icon="CalendarDays" :description="calendar.data.value?.closed ? 'This month is closed; corrections are no longer possible.' : canRequest ? 'Select a past day to request a correction.' : undefined">
        <AppSkeleton v-if="calendar.loading.value && !calendar.data.value" :lines="8" />
        <AppErrorState v-else-if="calendar.error.value" :error="calendar.error.value" @retry="calendar.run" />
        <AttendanceCalendarView
          v-else-if="calendar.data.value"
          :calendar="calendar.data.value"
          :selectable="canRequest && !calendar.data.value.closed"
          @prev="month = shiftMonth(month, -1)"
          @next="month = shiftMonth(month, 1)"
          @today="month = currentMonth()"
          @select="onSelect"
        />
      </AppCard>

      <!-- Corrections, work from home and overtime in one place -->
      <section class="card" aria-labelledby="my-requests">
        <header class="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-3">
          <h2 id="my-requests" class="text-sm font-semibold text-fg">My requests</h2>
          <AppBadge v-if="pendingCount" size="sm" tone="warning">{{ pendingCount }} pending</AppBadge>
          <AppButton v-if="canWfh" class="ms-auto" size="sm" variant="secondary" :icon="House" @click="askingWfh = true">Work from home</AppButton>
        </header>
        <div class="px-4 pt-3"><AppSegmented v-model="requestTab" class="w-full" size="sm" :options="requestTabs" label="Request type" /></div>

        <div class="p-4 pt-3">
          <template v-if="requestTab === 'corrections'">
            <AppSkeleton v-if="requests.loading.value && !requests.data.value" :lines="3" />
            <AppErrorState v-else-if="requests.error.value" :error="requests.error.value" @retry="requests.run" />
            <AppEmptyState v-else-if="!requests.data.value?.items.length" compact :icon="CalendarDays" title="No corrections yet" :description="canRequest ? 'Missed a punch? Select the day on the calendar to request a correction.' : undefined" />
            <ul v-else class="space-y-2">
              <li v-for="r in requests.data.value.items" :key="r.id" class="flex items-start gap-3 rounded-lg p-2.5 ring-1 ring-line/70">
                <span class="flex w-11 shrink-0 flex-col items-center rounded-md bg-surface-muted py-1" aria-hidden="true">
                  <span class="text-2xs font-semibold text-fg-muted uppercase">{{ tileOf(r.workDate).month }}</span>
                  <span class="text-base leading-5 font-semibold text-fg tabular-nums">{{ tileOf(r.workDate).day }}</span>
                </span>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-fg tabular-nums">{{ formatTime(r.checkInAt, calendar.data.value?.timeZone) }} – {{ formatTime(r.checkOutAt, calendar.data.value?.timeZone) }}</p>
                  <p class="truncate text-xs text-fg-muted" :title="r.reason">{{ r.reason }}</p>
                  <p v-if="r.reviewNote" class="mt-0.5 text-xs text-fg-subtle italic">“{{ r.reviewNote }}” — {{ r.reviewedBy }}</p>
                  <p class="sr-only">{{ formatDate(r.workDate) }}</p>
                </div>
                <div class="flex shrink-0 flex-col items-end gap-1.5">
                  <AppBadge :tone="regularizationTone[r.status]" size="sm" dot>{{ REGULARIZATION_LABELS[r.status] }}</AppBadge>
                  <AppButton v-if="r.status === 'PENDING'" size="xs" variant="ghost" @click="cancel(r.id)">Cancel</AppButton>
                </div>
              </li>
            </ul>
          </template>

          <template v-else-if="requestTab === 'wfh'">
            <AppSkeleton v-if="wfh.loading.value && !wfh.data.value" :lines="2" />
            <AppEmptyState v-else-if="!wfh.data.value?.items.length" compact :icon="House" title="No work-from-home requests" description="Planning to work remotely? Ask your manager in advance.">
              <AppButton size="sm" :icon="House" @click="askingWfh = true">Request work from home</AppButton>
            </AppEmptyState>
            <ul v-else class="space-y-2">
              <li v-for="r in wfh.data.value.items" :key="r.id" class="flex items-start gap-3 rounded-lg p-2.5 ring-1 ring-line/70">
                <span class="flex w-11 shrink-0 flex-col items-center rounded-md bg-accent-soft py-1 text-accent-fg" aria-hidden="true">
                  <span class="text-2xs font-semibold uppercase">{{ tileOf(r.startDate).month }}</span>
                  <span class="text-base leading-5 font-semibold tabular-nums">{{ tileOf(r.startDate).day }}</span>
                </span>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-fg">{{ dateRange(r.startDate, r.endDate) }}</p>
                  <p class="truncate text-xs text-fg-muted" :title="r.reason">{{ r.reason }}</p>
                  <p v-if="r.reviewNote" class="mt-0.5 text-xs text-fg-subtle italic">“{{ r.reviewNote }}” — {{ r.reviewedBy }}</p>
                </div>
                <div class="flex shrink-0 flex-col items-end gap-1.5">
                  <AppBadge :tone="regularizationTone[r.status]" size="sm" dot>{{ REGULARIZATION_LABELS[r.status] }}</AppBadge>
                  <AppButton v-if="r.permissions.cancel && (r.status === 'PENDING' || r.startDate > (calendar.data.value?.today ?? ''))" size="xs" variant="ghost" @click="cancelWfh(r.id)">Withdraw</AppButton>
                </div>
              </li>
            </ul>
          </template>

          <ul v-else class="space-y-2">
            <li v-for="o in overtime.data.value?.items ?? []" :key="o.id" class="flex items-start gap-3 rounded-lg p-2.5 ring-1 ring-line/70">
              <span class="flex w-11 shrink-0 flex-col items-center rounded-md bg-special-soft py-1 text-special-fg" aria-hidden="true">
                <span class="text-2xs font-semibold uppercase">{{ tileOf(o.workDate).month }}</span>
                <span class="text-base leading-5 font-semibold tabular-nums">{{ tileOf(o.workDate).day }}</span>
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-fg tabular-nums">{{ formatMinutes(o.approvedMinutes ?? o.minutes) }} overtime</p>
                <p class="text-xs text-fg-muted">
                  <template v-if="o.approvedMinutes !== null && o.approvedMinutes !== o.minutes">of {{ formatMinutes(o.minutes) }} worked · </template>
                  <template v-if="o.paidIn">paid in {{ o.paidIn }} payroll</template>
                  <template v-else-if="o.status === 'APPROVED'">paid with the next payroll</template>
                  <template v-else-if="o.status === 'PENDING'">waiting for approval</template>
                </p>
                <p v-if="o.reviewNote" class="mt-0.5 text-xs text-fg-subtle italic">“{{ o.reviewNote }}” — {{ o.reviewedBy }}</p>
              </div>
              <AppBadge :tone="overtimeTone[o.status]" size="sm" dot>{{ OVERTIME_LABELS[o.status] }}</AppBadge>
            </li>
          </ul>
        </div>
      </section>
    </div>

    <DayEditModal :open="!!selected" :day="selected" mode="regularize" :time-zone="calendar.data.value?.timeZone ?? 'UTC'" @close="selected = null" @saved="onRequested" />
    <WorkFromHomeModal :open="askingWfh" :today="calendar.data.value?.today ?? new Date().toISOString().slice(0, 10)" @close="askingWfh = false" @saved="onWfh" />
  </div>
</template>
