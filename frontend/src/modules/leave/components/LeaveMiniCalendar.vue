<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, PartyPopper, Plane } from '@lucide/vue';
import { leaveApi } from '@/modules/leave/api/leave.api';
import type { LeaveCalendar } from '@/modules/leave/types';
import { monthLabel, shiftMonth } from '@/modules/attendance/utils/attendance-format';
import { LEAVE_STATUS_LABELS, todayIso } from '@/modules/leave/utils/leave-format';
import { AppAvatar, AppBadge, AppButton, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';

type Entry = LeaveCalendar['entries'][number];

/**
 * A month at a glance in the style of a calendar app's side panel: dots in leave-type colours under the days someone
 * is away, and the people away on the selected day underneath. Weeks start on Monday.
 */
const props = defineProps<{ departmentId?: string | null }>();

const today = todayIso();
const month = ref(today.slice(0, 7));
const selected = ref(today);
const calendar = useAsync(() => leaveApi.calendar(month.value, props.departmentId ?? undefined));
watch([month, () => props.departmentId], () => void calendar.run());

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Six weeks from the Monday on or before the 1st, so the grid never changes height. */
const cells = computed(() => {
  const first = `${month.value}-01`;
  const start = addDays(first, -((weekday(first) + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
});
const holidays = computed(() => new Map((calendar.data.value?.holidays ?? []).filter((h) => !h.isOptional).map((h) => [h.date, h.name])));
const entries = computed(() => calendar.data.value?.entries ?? []);
const onDay = (d: string) => entries.value.filter((e) => e.startDate <= d && e.endDate >= d);
const dots = (d: string) => [...new Set(onDay(d).map((e) => e.leaveType.color))].slice(0, 3);

const dayEntries = computed(() => onDay(selected.value).sort((a, b) => (a.status === b.status ? a.employee.name.localeCompare(b.employee.name) : a.status === 'APPROVED' ? -1 : 1)));
const selectedDay = computed(() => {
  const d = new Date(`${selected.value}T00:00:00Z`);
  return {
    weekday:
      selected.value === today
        ? 'Today'
        : new Intl.DateTimeFormat('en-GB', {
            weekday: 'long',
            timeZone: 'UTC',
          }).format(d),
    date: new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(d),
  };
});
const session = (e: Entry, d: string) => {
  if (d === e.startDate && e.startSession === 'SECOND_HALF') return 'Afternoon';
  if (d === e.endDate && e.endSession === 'FIRST_HALF') return 'Morning';
  return null;
};
const until = (e: Entry) =>
  e.endDate === selected.value ? null : `Until ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${e.endDate}T00:00:00Z`))}`;

function pick(d: string) {
  selected.value = d;
  if (d.slice(0, 7) !== month.value) month.value = d.slice(0, 7);
}
function go(step: -1 | 1) {
  month.value = shiftMonth(month.value, step);
  selected.value = month.value === today.slice(0, 7) ? today : `${month.value}-01`;
}
function goToday() {
  month.value = today.slice(0, 7);
  selected.value = today;
}
/** Arrow keys move the selection like a date picker. */
function onKey(e: KeyboardEvent) {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (!step) return;
  e.preventDefault();
  pick(addDays(selected.value, step));
  requestAnimationFrame(() => (document.querySelector(`[data-day="${selected.value}"]`) as HTMLElement | null)?.focus());
}
</script>

<template>
  <section class="card overflow-hidden" aria-label="Leave calendar">
    <header class="flex min-h-12 items-center gap-2 border-b border-line/70 px-4 py-2">
      <h2 class="min-w-0 flex-1 truncate text-sm font-semibold text-fg" aria-live="polite">
        {{ monthLabel(month) }}
      </h2>
      <AppButton v-if="month !== today.slice(0, 7) || selected !== today" size="xs" variant="ghost" @click="goToday">Today</AppButton>
      <AppButton size="xs" variant="ghost" :icon="ChevronLeft" aria-label="Previous month" @click="go(-1)" />
      <AppButton size="xs" variant="ghost" :icon="ChevronRight" aria-label="Next month" @click="go(1)" />
    </header>

    <div class="px-3 pt-2 pb-3">
      <div class="grid grid-cols-7 text-center text-2xs font-medium text-fg-subtle" aria-hidden="true">
        <span v-for="(w, i) in WEEK" :key="i" class="py-1.5">{{ w }}</span>
      </div>
      <div class="grid grid-cols-7 gap-y-0.5" role="grid" :aria-busy="calendar.loading.value" @keydown="onKey">
        <button
          v-for="d in cells"
          :key="d"
          type="button"
          role="gridcell"
          :data-day="d"
          :tabindex="d === selected ? 0 : -1"
          :aria-selected="d === selected"
          :aria-current="d === today ? 'date' : undefined"
          :aria-label="`${d}${onDay(d).length ? `, ${onDay(d).length} on leave` : ''}${holidays.has(d) ? `, ${holidays.get(d)}` : ''}`"
          :title="holidays.get(d)"
          class="group relative flex h-10 flex-col items-center justify-start pt-1 focus-visible:outline-none"
          @click="pick(d)"
        >
          <span
            :class="[
              'flex h-7 w-7 items-center justify-center rounded-full text-xs tabular-nums transition',
              d === today
                ? 'bg-brand-600 font-semibold text-white shadow-xs dark:bg-brand-500'
                : d === selected
                  ? 'bg-brand-100 font-semibold text-brand-700 dark:bg-brand-500/25 dark:text-brand-200'
                  : d.slice(0, 7) !== month
                    ? 'text-fg-subtle/60 group-hover:bg-surface-muted'
                    : holidays.has(d)
                      ? 'font-medium text-rose-600 group-hover:bg-surface-muted dark:text-rose-400'
                      : [0, 6].includes(weekday(d))
                        ? 'text-fg-subtle group-hover:bg-surface-muted'
                        : 'text-fg group-hover:bg-surface-muted',
              d === today && d === selected && 'ring-2 ring-brand-200 dark:ring-brand-500/40',
              'group-focus-visible:ring-2 group-focus-visible:ring-brand-500/50',
            ]"
          >
            {{ Number(d.slice(8)) }}
          </span>
          <span v-if="d.slice(0, 7) === month" class="mt-0.5 flex h-1 gap-0.5" aria-hidden="true">
            <span v-for="c in dots(d)" :key="c" class="h-1 w-1 rounded-full" :style="{ backgroundColor: c }" />
          </span>
        </button>
      </div>
    </div>

    <div class="border-t border-line/70 bg-surface-muted/40">
      <div class="flex items-baseline justify-between gap-2 px-4 pt-3 pb-2">
        <h3 class="text-xs font-semibold text-fg">
          {{ selectedDay.weekday }}<span class="font-normal text-fg-muted"> · {{ selectedDay.date }}</span>
        </h3>
        <span v-if="dayEntries.length" class="text-2xs font-medium text-fg-muted tabular-nums">{{ dayEntries.length }} away</span>
      </div>

      <AppSkeleton v-if="calendar.loading.value && !calendar.data.value" class="px-4 pb-4" :lines="3" />
      <div v-else class="max-h-72 space-y-1.5 overflow-y-auto px-3 pb-3">
        <div
          v-if="holidays.has(selected)"
          class="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
        >
          <PartyPopper class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{{ holidays.get(selected) }}
        </div>
        <RouterLink
          v-for="e in dayEntries"
          :key="e.id"
          :to="`/hr/employees/${e.employee.id}`"
          class="flex items-center gap-2.5 rounded-md border border-line/70 bg-surface py-2 ps-2.5 pe-2 shadow-xs transition hover:border-line hover:shadow-card"
          :style="{ boxShadow: `inset 3px 0 0 ${e.leaveType.color}` }"
        >
          <AppAvatar :name="e.employee.name" size="sm" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-fg">{{ e.employee.name }}</span>
            <span class="block truncate text-2xs text-fg-muted">
              {{ e.leaveType.name }}<template v-if="session(e, selected)"> · {{ session(e, selected) }}</template
              ><template v-if="until(e)"> · {{ until(e) }}</template>
            </span>
          </span>
          <AppBadge v-if="e.status !== 'APPROVED'" tone="warning" size="sm">{{ LEAVE_STATUS_LABELS[e.status] }}</AppBadge>
        </RouterLink>
        <p v-if="!dayEntries.length && !holidays.has(selected)" class="flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-3 text-xs text-fg-muted">
          <Plane class="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
          {{ [0, 6].includes(weekday(selected)) ? 'Weekend — no one scheduled.' : 'Everyone is in.' }}
        </p>
      </div>

      <RouterLink to="/hr/leave/calendar" class="flex items-center justify-between border-t border-line/70 px-4 py-2.5 text-xs font-medium text-brand-600 hover:bg-surface-muted dark:text-brand-300">
        Open team calendar
        <ChevronRight class="h-3.5 w-3.5" aria-hidden="true" />
      </RouterLink>
    </div>
  </section>
</template>
