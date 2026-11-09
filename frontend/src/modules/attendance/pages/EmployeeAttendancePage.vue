<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AlarmClock, CalendarDays, CircleCheck, CircleDashed, CircleX, Clock, Fingerprint, Hourglass, House, ListChecks, Lock, Plane, Sun, Timer, TimerOff, UserRound } from '@lucide/vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import AttendanceCalendarView from '@/modules/attendance/components/AttendanceCalendar.vue';
import DayEditModal from '@/modules/attendance/components/DayEditModal.vue';
import type { CalendarDay } from '@/modules/attendance/types';
import { DAY_STATUS_LABELS, WEEKDAY_SHORT, currentMonth, dayStatusTone, formatMinutes, formatTime, monthLabel, shiftMonth } from '@/modules/attendance/utils/attendance-format';
import { dateTile, relativeDay } from '@/modules/attendance/utils/attendance-ops';
import { employeesApi } from '@/modules/people/api/people.api';
import { AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppFacts, AppInput, AppPageHeader, AppSkeleton, type Fact } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** One person's month for HR and managers: summary, calendar, days that need a correction and their device number. */
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
const canViewProfile = computed(() => auth.can('employee.view', 'TEAM'));
// Only for the header's job title, department and photo: the page works without it.
const person = useAsync(() => employeesApi.get(id.value), { immediate: canViewProfile.value });

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

// ---- Month at a glance -----------------------------------------------------------------------------------------
const summary = computed(() => calendar.data.value?.summary ?? null);
const workingDays = computed(() => (summary.value ? summary.value.present + summary.value.halfDay + summary.value.absent + summary.value.missedPunch : 0));
const rate = computed(() => (summary.value && workingDays.value ? Math.round(((summary.value.present + summary.value.halfDay / 2) / workingDays.value) * 100) : null));
const rateTone = computed(() => (rate.value === null ? 'text-fg-subtle' : rate.value >= 90 ? 'text-success' : rate.value >= 75 ? 'text-warning' : 'text-danger'));
const CIRC = 2 * Math.PI * 40;
const tiles = computed<{ label: string; value: string | number; hint?: string; icon: Component; tone: string }[]>(() => {
  const s = summary.value;
  if (!s) return [];
  const attended = s.present + s.halfDay;
  const quiet = 'bg-surface-muted text-fg-muted';
  return [
    { label: 'Present', value: s.present, icon: CircleCheck, tone: 'bg-success-soft text-success-fg' },
    { label: 'Half days', value: s.halfDay, icon: CircleDashed, tone: s.halfDay ? 'bg-warning-soft text-warning-fg' : quiet },
    { label: 'Absent', value: s.absent, icon: CircleX, tone: s.absent ? 'bg-danger-soft text-danger-fg' : quiet },
    { label: 'Missed punch-out', value: s.missedPunch, hint: s.missedPunch ? 'Needs a correction' : undefined, icon: TimerOff, tone: s.missedPunch ? 'bg-special-soft text-special-fg' : quiet },
    { label: 'Late days', value: s.lateDays, hint: attended ? `${Math.round((s.lateDays / attended) * 100)}% of days in` : undefined, icon: AlarmClock, tone: s.lateDays ? 'bg-caution-soft text-caution-fg' : quiet },
    { label: 'On leave', value: s.onLeave, icon: Plane, tone: s.onLeave ? 'bg-info-soft text-info-fg' : quiet },
    { label: 'Holidays', value: s.holidays, icon: Sun, tone: s.holidays ? 'bg-special-soft text-special-fg' : quiet },
    { label: 'From home', value: s.workFromHomeDays, icon: House, tone: s.workFromHomeDays ? 'bg-accent-soft text-accent-fg' : quiet },
    { label: 'Overtime approved', value: formatMinutes(s.overtimeMinutes), icon: Timer, tone: s.overtimeMinutes ? 'bg-special-soft text-special-fg' : quiet },
    { label: 'Worked', value: formatMinutes(s.workedMinutes), hint: attended ? `${formatMinutes(Math.round(s.workedMinutes / attended))} a day` : undefined, icon: Clock, tone: 'bg-surface-muted text-fg' },
  ];
});

/** Past days that usually need HR's attention, latest first. */
const toReview = computed(() =>
  (calendar.data.value?.days ?? [])
    .filter((d) => d.date <= calendar.data.value!.today && (d.status === 'MISSED_PUNCH' || d.status === 'ABSENT' || !!d.pendingRegularizationId || (d.overtime?.status === 'PENDING')))
    .reverse(),
);
const reviewReason = (d: CalendarDay) =>
  d.pendingRegularizationId ? 'Correction requested' : d.status === 'MISSED_PUNCH' ? `In ${formatTime(d.record?.checkInAt, calendar.data.value?.timeZone)}, no punch-out` : d.status === 'ABSENT' ? 'No punches' : `Overtime ${formatMinutes(d.overtime!.minutes)} to approve`;

const shiftFacts = computed<Fact[]>(() => {
  const s = calendar.data.value?.shift;
  if (!s) return [];
  return [
    { label: 'Shift', value: s.name, strong: true },
    { label: 'Hours', value: `${s.startTime}–${s.endTime}${s.crossesMidnight ? ' (next day)' : ''}` },
    { label: 'Late after', value: `${s.graceMinutes} min` },
    { label: 'Full day from', value: formatMinutes(s.fullDayMinutes) },
    { label: 'Half day from', value: formatMinutes(s.halfDayMinutes) },
    { label: 'Weekly off', value: s.weeklyOffs.map((d) => WEEKDAY_SHORT[d]).join(', ') || 'None' },
    { label: 'Overtime', value: s.overtimeEnabled ? 'Counted' : 'Not counted' },
    { label: 'Time zone', value: calendar.data.value!.timeZone },
  ];
});
const subtitle = computed(() => {
  const p = person.data.value;
  const c = calendar.data.value;
  return [c?.employee.employeeCode, p?.designation?.name, p?.department?.name, p?.location?.name].filter(Boolean).join(' · ');
});

// Device user number (biometric / card readers).
const canConfigure = computed(() => auth.can('attendance.configure'));
const code = ref('');
watch(
  () => calendar.data.value?.employee.biometricCode,
  (v) => (code.value = v ?? ''),
  { immediate: true },
);
const savingCode = ref(false);
async function saveCode() {
  savingCode.value = true;
  try {
    await attendanceApi.setBiometricCode(id.value, code.value.trim() || null);
    feedback.success(code.value.trim() ? 'Device user number saved' : 'Device user number removed');
    await calendar.run();
  } catch (e) {
    feedback.error('Could not save the device user number', e);
  } finally {
    savingCode.value = false;
  }
}
</script>

<template>
  <div>
    <AppSkeleton v-if="calendar.loading.value && !calendar.data.value" :lines="8" />
    <AppErrorState v-else-if="calendar.error.value" :error="calendar.error.value" title="Could not load attendance" @retry="calendar.run" />
    <template v-else-if="calendar.data.value">
      <AppPageHeader :title="calendar.data.value.employee.name" :description="subtitle" back="/hr/attendance" back-label="Attendance register">
        <template #leading><AppAvatar :name="calendar.data.value.employee.name" :src="person.data.value?.avatarUrl" size="lg" /></template>
        <template #badges>
          <AppBadge v-if="calendar.data.value.closed"><Lock :size="11" class="-ms-0.5" aria-hidden="true" />{{ monthLabel(calendar.data.value.month) }} closed</AppBadge>
          <AppBadge v-if="toReview.length" tone="warning" dot>{{ toReview.length }} to review</AppBadge>
        </template>
        <template #actions>
          <AppButton v-if="canViewProfile" variant="secondary" :icon="UserRound" :to="`/hr/employees/${id}`">Employee profile</AppButton>
        </template>
      </AppPageHeader>

      <div class="space-y-4">
        <!-- Month at a glance -->
        <section v-if="summary" class="card overflow-hidden" aria-labelledby="month-glance">
          <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
            <h2 id="month-glance" class="text-sm font-semibold text-fg">{{ monthLabel(calendar.data.value.month) }} at a glance</h2>
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
                <span class="absolute inset-0 flex items-center justify-center text-xl font-semibold text-fg tabular-nums">{{ rate === null ? '—' : `${rate}%` }}</span>
              </div>
              <div>
                <p class="text-sm font-medium text-fg">Attendance</p>
                <p class="text-xs text-fg-muted">{{ workingDays ? `${summary.present + summary.halfDay} of ${workingDays} working days` : 'No working days yet' }}</p>
              </div>
            </div>
            <dl class="grid grid-cols-2 gap-px bg-line/70 sm:grid-cols-5">
              <div v-for="t in tiles" :key="t.label" class="flex items-start gap-3 bg-surface px-4 py-3.5">
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

        <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
          <AppCard title="Calendar" :icon="CalendarDays" :description="canCorrect ? 'Select a day to correct its punch times.' : calendar.data.value.closed ? 'This month is closed.' : undefined">
            <AttendanceCalendarView :calendar="calendar.data.value" :selectable="canCorrect" @prev="month = shiftMonth(month, -1)" @next="month = shiftMonth(month, 1)" @today="month = currentMonth()" @select="onSelect" />
          </AppCard>

          <div class="space-y-4">
            <section class="card" aria-labelledby="to-review">
              <header class="flex items-center gap-2 border-b border-line/70 px-4 py-3">
                <ListChecks :size="15" class="text-fg-muted" aria-hidden="true" />
                <h2 id="to-review" class="text-sm font-semibold text-fg">Days to review</h2>
                <AppBadge v-if="toReview.length" class="ms-auto" size="sm" tone="warning">{{ toReview.length }}</AppBadge>
              </header>
              <AppEmptyState v-if="!toReview.length" compact :icon="CircleCheck" title="All clear" :description="`No missed punches, absences or open requests in ${monthLabel(calendar.data.value.month)}.`" />
              <ul v-else class="max-h-96 divide-y divide-line/60 overflow-y-auto">
                <li v-for="d in toReview" :key="d.date" class="flex items-center gap-3 px-4 py-2.5">
                  <span class="flex w-10 shrink-0 flex-col items-center rounded-md bg-surface-muted py-0.5" aria-hidden="true">
                    <span class="text-2xs font-semibold text-fg-muted uppercase">{{ dateTile(d.date).weekday }}</span>
                    <span class="text-base leading-5 font-semibold text-fg tabular-nums">{{ dateTile(d.date).day }}</span>
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="flex items-center gap-1.5 text-sm font-medium text-fg">
                      <span :class="['h-1.5 w-1.5 shrink-0 rounded-full', { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info', neutral: 'bg-fg-subtle', violet: 'bg-special' }[dayStatusTone[d.status]]]" aria-hidden="true" />
                      {{ DAY_STATUS_LABELS[d.status] }}
                      <Hourglass v-if="d.pendingRegularizationId" :size="12" class="text-warning-fg" aria-hidden="true" />
                      <span class="sr-only">{{ formatDate(d.date) }}</span>
                    </p>
                    <p class="truncate text-xs text-fg-muted" :title="reviewReason(d)">{{ reviewReason(d) }}</p>
                    <p class="text-2xs text-fg-subtle">{{ relativeDay(d.date, calendar.data.value.today) }}</p>
                  </div>
                  <AppButton v-if="d.pendingRegularizationId || d.overtime?.status === 'PENDING'" size="xs" variant="ghost" :to="`/hr/attendance/regularizations${d.pendingRegularizationId ? '' : '?tab=overtime'}`">Review</AppButton>
                  <AppButton v-else-if="canCorrect" size="xs" variant="secondary" :aria-label="`Correct ${formatDate(d.date)}`" @click="onSelect(d)">Correct</AppButton>
                </li>
              </ul>
            </section>

            <AppCard title="Working pattern" :icon="Clock">
              <AppFacts :items="shiftFacts" />
            </AppCard>

            <AppCard v-if="canConfigure" title="Attendance devices" :icon="Fingerprint" description="User number on biometric or card readers.">
              <form class="space-y-3" @submit.prevent="saveCode">
                <AppInput v-model="code" label="Device user number" :maxlength="30" :placeholder="calendar.data.value.employee.employeeCode" help="Without one, punches are matched by employee code." />
                <div class="flex justify-end">
                  <AppButton type="submit" size="sm" variant="secondary" :loading="savingCode" :disabled="code.trim() === (calendar.data.value.employee.biometricCode ?? '')">Save</AppButton>
                </div>
              </form>
            </AppCard>
          </div>
        </div>
      </div>
      <DayEditModal :open="!!selected" :day="selected" mode="correct" :time-zone="calendar.data.value.timeZone" :employee-id="id" @close="selected = null" @saved="onSaved" />
    </template>
  </div>
</template>
