<script setup lang="ts">
import { computed } from 'vue';
import { ChevronLeft, ChevronRight, Hourglass, House, Timer } from '@lucide/vue';
import type { AttendanceCalendar, CalendarDay } from '@/modules/attendance/types';
import { DAY_STATUS_LABELS, WEEKDAY_SHORT, dayStatusCell, formatMinutes, formatTime, monthLabel } from '@/modules/attendance/utils/attendance-format';
import { AppButton } from '@/shared/components';

const props = defineProps<{ calendar: AttendanceCalendar; selectable?: boolean }>();
const emit = defineEmits<{ prev: []; next: []; select: [day: CalendarDay] }>();

/** Leading blanks so the 1st falls on its weekday (weeks start on Monday). */
const leading = computed(() => {
  const first = new Date(`${props.calendar.days[0]!.date}T00:00:00Z`).getUTCDay();
  return (first + 6) % 7;
});
const headers = [...WEEKDAY_SHORT.slice(1), WEEKDAY_SHORT[0]!];
const dayNumber = (d: string) => Number(d.slice(8));
const isToday = (d: string) => d === props.calendar.today;

const legend = ['PRESENT', 'HALF_DAY', 'ABSENT', 'MISSED_PUNCH', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF'] as const;

function label(day: CalendarDay): string {
  const parts = [`${day.date}: ${DAY_STATUS_LABELS[day.status]}`];
  if (day.leave) parts.push(`${day.leave.name}${day.leave.session !== 'FULL' ? ', half day' : ''}`);
  else if (day.holiday) parts.push(day.holiday.name);
  if (day.shift?.rostered) parts.push(`rostered ${day.shift.name}`);
  if (day.workFromHome) parts.push('working from home');
  if (day.overtime) parts.push(`overtime ${formatMinutes(day.overtime.minutes)} ${day.overtime.status.toLowerCase()}`);
  if (day.pendingRegularizationId) parts.push('regularization pending');
  return parts.join(', ');
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-3">
      <h3 class="text-base font-semibold text-fg">{{ monthLabel(calendar.month) }}</h3>
      <div class="flex items-center gap-1">
        <AppButton size="sm" variant="ghost" :icon="ChevronLeft" aria-label="Previous month" @click="emit('prev')" />
        <AppButton size="sm" variant="ghost" :icon="ChevronRight" aria-label="Next month" @click="emit('next')" />
      </div>
    </div>

    <div class="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-fg-subtle uppercase" aria-hidden="true">
      <div v-for="h in headers" :key="h" class="pb-1">{{ h }}</div>
    </div>
    <ol class="grid grid-cols-7 gap-1.5" :aria-label="`Attendance for ${monthLabel(calendar.month)}`">
      <li v-for="n in leading" :key="`blank-${n}`" aria-hidden="true" />
      <li v-for="day in calendar.days" :key="day.date">
        <component
          :is="selectable && day.status !== 'NOT_EMPLOYED' ? 'button' : 'div'"
          :type="selectable ? 'button' : undefined"
          :class="[
            'flex h-full min-h-[68px] w-full flex-col rounded-lg p-1.5 text-left ring-1 ring-inset transition sm:min-h-[84px] sm:p-2',
            dayStatusCell[day.status],
            isToday(day.date) && 'outline-2 outline-offset-1 outline-brand-500',
            selectable && day.status !== 'NOT_EMPLOYED' && 'hover:ring-brand-400',
          ]"
          :aria-label="label(day)"
          :title="day.shift?.rostered ? `${day.shift.name} ${day.shift.startTime}–${day.shift.endTime} (rostered)` : undefined"
          @click="selectable && day.status !== 'NOT_EMPLOYED' && emit('select', day)"
        >
          <span class="flex items-center justify-between gap-1">
            <span :class="['text-xs font-semibold tabular-nums', isToday(day.date) ? 'text-brand-600 dark:text-brand-300' : 'text-fg']">{{ dayNumber(day.date) }}</span>
            <span class="flex items-center gap-0.5">
              <House v-if="day.workFromHome" :size="12" class="text-sky-600 dark:text-sky-400" aria-hidden="true" />
              <Timer v-if="day.overtime" :size="12" :class="day.overtime.status === 'APPROVED' ? 'text-violet-600 dark:text-violet-400' : 'text-fg-subtle'" aria-hidden="true" />
              <Hourglass v-if="day.pendingRegularizationId" :size="12" class="text-amber-600 dark:text-amber-400" aria-hidden="true" />
            </span>
          </span>
          <span v-if="day.shift?.rostered && day.status !== 'WEEKLY_OFF'" class="hidden truncate text-[10px] text-fg-subtle sm:block">{{ day.shift.name }}</span>
          <span class="mt-auto hidden text-[11px] leading-tight sm:block">
            <template v-if="day.record?.checkInAt">{{ formatTime(day.record.checkInAt, calendar.timeZone) }}–{{ formatTime(day.record.checkOutAt, calendar.timeZone) }}</template>
            <template v-else-if="day.leave">
              <span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full" :style="{ backgroundColor: day.leave.color }" aria-hidden="true" />{{ day.leave.code }}{{ day.leave.session !== 'FULL' ? ' · ½' : '' }}</span>
            </template>
            <template v-else-if="day.holiday">{{ day.holiday.name }}</template>
          </span>
          <span class="mt-0.5 truncate text-[10px] font-medium sm:text-[11px]">
            {{ day.record?.workedMinutes ? formatMinutes(day.record.workedMinutes) : DAY_STATUS_LABELS[day.status] }}
          </span>
        </component>
      </li>
    </ol>

    <ul class="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-muted" aria-label="Legend">
      <li v-for="s in legend" :key="s" class="inline-flex items-center gap-1.5">
        <span :class="['h-2.5 w-2.5 rounded-sm ring-1 ring-inset', dayStatusCell[s]]" aria-hidden="true" />{{ DAY_STATUS_LABELS[s] }}
      </li>
      <li class="inline-flex items-center gap-1.5"><House :size="12" class="text-sky-600 dark:text-sky-400" aria-hidden="true" />Work from home</li>
      <li class="inline-flex items-center gap-1.5"><Timer :size="12" class="text-violet-600 dark:text-violet-400" aria-hidden="true" />Overtime</li>
    </ul>
  </div>
</template>
