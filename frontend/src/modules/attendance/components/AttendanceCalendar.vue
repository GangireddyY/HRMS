<script setup lang="ts">
import { computed } from 'vue';
import { Hourglass, House, Timer } from '@lucide/vue';
import type { DayStatus } from '@contracts';
import type { AttendanceCalendar, CalendarDay } from '@/modules/attendance/types';
import { DAY_STATUS_LABELS, formatMinutes, formatTime, monthLabel } from '@/modules/attendance/utils/attendance-format';
import { AppCalendarEvent, AppMonthCalendar } from '@/shared/components';

const props = defineProps<{ calendar: AttendanceCalendar; selectable?: boolean }>();
const emit = defineEmits<{ prev: []; next: []; today: []; select: [day: CalendarDay] }>();

const byDate = computed(() => new Map(props.calendar.days.map((d) => [d.date, d])));
const dayOf = (iso: string) => byDate.value.get(iso);

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'orange' | 'cyan' | 'neutral';
/** Statuses shown as a chip; weekly offs, upcoming days and days before joining stay plain. */
const STATUS_TONE: Partial<Record<DayStatus, Tone>> = {
  PRESENT: 'success',
  HALF_DAY: 'warning',
  ABSENT: 'danger',
  IN_PROGRESS: 'info',
  MISSED_PUNCH: 'orange',
  ON_LEAVE: 'cyan',
  HOLIDAY: 'violet',
};
const TONE_COLOR: Record<Tone, string> = { success: 'var(--status-success)', warning: 'var(--status-warning)', danger: 'var(--status-danger)', info: 'var(--status-info)', violet: 'var(--status-special)', orange: 'var(--status-caution)', cyan: 'var(--status-away)', neutral: 'var(--status-neutral)' };

const muted = (iso: string) => {
  const s = dayOf(iso)?.status;
  return s === 'WEEKLY_OFF' || s === 'HOLIDAY' || s === 'NOT_EMPLOYED' || !s;
};
const disabled = (iso: string) => !dayOf(iso) || dayOf(iso)!.status === 'NOT_EMPLOYED';

/** Colour dots for phones, where cells are too small for chips. */
function dots(day: CalendarDay): string[] {
  const out: string[] = [];
  if (day.leave) out.push(day.leave.color);
  else if (STATUS_TONE[day.status]) out.push(TONE_COLOR[STATUS_TONE[day.status]!]);
  if (day.workFromHome) out.push(TONE_COLOR.info);
  if (day.overtime) out.push(TONE_COLOR.violet);
  if (day.pendingRegularizationId) out.push(TONE_COLOR.warning);
  return out.slice(0, 3);
}

function label(day: CalendarDay): string {
  const parts = [DAY_STATUS_LABELS[day.status]];
  if (day.leave) parts.push(`${day.leave.name}${day.leave.session !== 'FULL' ? ', half day' : ''}`);
  else if (day.holiday) parts.push(day.holiday.name);
  if (day.shift?.rostered) parts.push(`rostered ${day.shift.name}`);
  if (day.workFromHome) parts.push('working from home');
  if (day.overtime) parts.push(`overtime ${formatMinutes(day.overtime.minutes)} ${day.overtime.status.toLowerCase()}`);
  if (day.pendingRegularizationId) parts.push('regularization pending');
  return parts.join(', ');
}

const legend: { label: string; color: string }[] = [
  { label: 'Present', color: TONE_COLOR.success },
  { label: 'Half day', color: TONE_COLOR.warning },
  { label: 'Absent', color: TONE_COLOR.danger },
  { label: 'Missed punch-out', color: TONE_COLOR.orange },
  { label: 'On leave', color: TONE_COLOR.cyan },
  { label: 'Holiday', color: TONE_COLOR.violet },
  { label: 'Work from home', color: TONE_COLOR.info },
];
</script>

<template>
  <AppMonthCalendar
    :month="calendar.month"
    :today="calendar.today"
    :selectable="selectable"
    :is-disabled="disabled"
    :is-muted="muted"
    navigable
    :aria-label="`Attendance for ${monthLabel(calendar.month)}`"
    @prev="emit('prev')"
    @next="emit('next')"
    @today="emit('today')"
    @select="(iso) => dayOf(iso) && emit('select', dayOf(iso)!)"
  >
    <template #day="{ date }">
      <template v-for="day in [dayOf(date)]" :key="date">
        <template v-if="day && day.status !== 'NOT_EMPLOYED'">
          <span class="sr-only">{{ label(day) }}</span>
          <span class="flex justify-center gap-0.5 sm:hidden" aria-hidden="true">
            <span v-for="(c, i) in dots(day)" :key="i" class="h-1.5 w-1.5 rounded-full" :style="{ backgroundColor: c }" />
          </span>
          <div class="flex min-w-0 flex-col gap-0.5 max-sm:hidden" aria-hidden="true">
            <AppCalendarEvent v-if="day.leave" :color="day.leave.color" :label="`${day.leave.name}${day.leave.session !== 'FULL' ? ' · ½' : ''}`" />
            <AppCalendarEvent v-else-if="day.holiday" tone="violet" :label="day.holiday.name" />
            <AppCalendarEvent v-if="STATUS_TONE[day.status] && day.status !== 'ON_LEAVE' && day.status !== 'HOLIDAY'" :tone="STATUS_TONE[day.status]" :label="DAY_STATUS_LABELS[day.status]" />
            <span
              v-if="day.record?.checkInAt"
              class="truncate px-1.5 text-2xs text-fg-muted tabular-nums"
              :title="day.record.workedMinutes ? `${formatMinutes(day.record.workedMinutes)} worked` : undefined"
            >
              {{ formatTime(day.record.checkInAt, calendar.timeZone) }}–{{ day.record.checkOutAt ? formatTime(day.record.checkOutAt, calendar.timeZone) : '' }}
            </span>
            <AppCalendarEvent v-if="day.shift?.rostered && day.status !== 'WEEKLY_OFF'" variant="dot" tone="neutral" :label="day.shift.name" />
            <AppCalendarEvent v-if="day.workFromHome" variant="dot" tone="info" :icon="House" label="Work from home" />
            <AppCalendarEvent
              v-if="day.overtime"
              :variant="day.overtime.status === 'APPROVED' ? 'dot' : 'outline'"
              tone="violet"
              :icon="Timer"
              :label="`OT ${formatMinutes(day.overtime.minutes)}`"
            />
            <AppCalendarEvent v-if="day.pendingRegularizationId" variant="outline" tone="warning" :icon="Hourglass" label="Correction pending" />
            <span v-if="day.status === 'WEEKLY_OFF'" class="px-1.5 text-2xs text-fg-subtle">Weekly off</span>
          </div>
        </template>
      </template>
    </template>
    <template #legend>
      <ul class="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-fg-muted" aria-label="Legend">
        <li v-for="l in legend" :key="l.label" class="inline-flex items-center gap-1.5">
          <span class="h-2 w-2 rounded-full" :style="{ backgroundColor: l.color }" aria-hidden="true" />{{ l.label }}
        </li>
        <li class="inline-flex items-center gap-1.5"><Timer :size="12" class="text-special-fg" aria-hidden="true" />Overtime</li>
        <li class="inline-flex items-center gap-1.5"><Hourglass :size="12" class="text-warning-fg" aria-hidden="true" />Correction pending</li>
      </ul>
    </template>
  </AppMonthCalendar>
</template>
