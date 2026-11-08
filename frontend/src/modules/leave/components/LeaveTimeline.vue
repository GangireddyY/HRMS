<script setup lang="ts">
import { fillForWhiteText } from '@/shared/utils/color-contrast';
import { computed, reactive } from 'vue';
import { ChevronDown } from '@lucide/vue';
import type { LeaveCalendar } from '@/modules/leave/types';
import { formatIso, isWeekend, weekday } from '@/modules/leave/utils/calendar-dates';
import { LEAVE_STATUS_LABELS, formatDays, formatLeaveRange } from '@/modules/leave/utils/leave-format';
import { AppAvatar } from '@/shared/components';

type Entry = LeaveCalendar['entries'][number];

/**
 * A resource timeline: people (grouped by department, groups collapsible) down the side, days across. Each leave is a
 * bar over the days it covers — solid in its type's colour when approved, tinted and dashed while pending, half a
 * column for a half day, squared off where it runs past the range. Weekends and holidays are shaded, weeks divided,
 * today marked through every row, and a bottom row counts the people away each day.
 */
const props = defineProps<{ days: string[]; entries: Entry[]; holidays: Map<string, string>; today: string }>();
const emit = defineEmits<{ open: [entry: Entry, el: HTMLElement] }>();

const offDay = (d: string) => isWeekend(d) || props.holidays.has(d);
const todayIndex = computed(() => props.days.indexOf(props.today));
const cols = computed(() => `repeat(${props.days.length}, minmax(1.5rem, 1fr))`);

function workingDays(e: Entry): number {
  let n = 0;
  for (const d of props.days) {
    if (d < e.startDate || d > e.endDate || offDay(d)) continue;
    n += (d === e.startDate && e.startSession === 'SECOND_HALF') || (d === e.endDate && e.endSession === 'FIRST_HALF') ? 0.5 : 1;
  }
  return n;
}
function bar(e: Entry) {
  const list = props.days;
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const s = e.startDate < first ? first : e.startDate;
  const end = e.endDate > last ? last : e.endDate;
  if (s > end) return null;
  let from = list.indexOf(s);
  let to = list.indexOf(end) + 1;
  if (s === e.startDate && e.startSession === 'SECOND_HALF') from += 0.5;
  if (end === e.endDate && e.endSession === 'FIRST_HALF') to -= 0.5;
  return { entry: e, from, span: to - from, clippedStart: e.startDate < first, clippedEnd: e.endDate > last };
}
type Bar = NonNullable<ReturnType<typeof bar>>;

const groups = computed(() => {
  const people = new Map<string, { employee: Entry['employee']; entries: Entry[] }>();
  for (const e of props.entries) {
    const p = people.get(e.employee.id) ?? { employee: e.employee, entries: [] };
    p.entries.push(e);
    people.set(e.employee.id, p);
  }
  const byDept = new Map<string, { name: string; rows: { employee: Entry['employee']; bars: Bar[]; total: number }[] }>();
  for (const p of people.values()) {
    const name = p.employee.department ?? 'No department';
    const g = byDept.get(name) ?? { name, rows: [] };
    g.rows.push({ employee: p.employee, bars: p.entries.map(bar).filter((b): b is Bar => !!b), total: p.entries.reduce((n, e) => n + workingDays(e), 0) });
    byDept.set(name, g);
  }
  return [...byDept.values()].sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({ ...g, rows: g.rows.sort((a, b) => a.employee.name.localeCompare(b.employee.name)) }));
});
const collapsed = reactive(new Set<string>());
const toggleGroup = (name: string) => (collapsed.has(name) ? collapsed.delete(name) : collapsed.add(name));

/** People away each day (approved or pending), for the bottom row. */
const away = computed(() => props.days.map((d) => new Set(props.entries.filter((e) => e.startDate <= d && e.endDate >= d).map((e) => e.employee.id)).size));
const peak = computed(() => Math.max(1, ...away.value));

const pos = (b: Bar) => ({ left: `calc(${(b.from / props.days.length) * 100}% + ${b.clippedStart ? 0 : 3}px)`, width: `calc(${(b.span / props.days.length) * 100}% - ${(b.clippedStart ? 0 : 3) + (b.clippedEnd ? 0 : 3)}px)` });
function barStyle(b: Bar) {
  const c = b.entry.leaveType.color;
  if (b.entry.status === 'PENDING')
    return {
      ...pos(b),
      color: `color-mix(in oklab, ${c} 55%, var(--app-text))`,
      backgroundColor: `color-mix(in oklab, ${c} 12%, var(--app-surface))`,
      border: `1.5px dashed color-mix(in oklab, ${c} 75%, transparent)`,
    };
  return { ...pos(b), backgroundColor: fillForWhiteText(c), color: '#fff', boxShadow: `0 1px 2px color-mix(in oklab, ${c} 45%, transparent)` };
}
const weekStart = (i: number) => i > 0 && weekday(props.days[i]!) === 1;
</script>

<template>
  <div dir="ltr" class="h-full overflow-auto overscroll-contain bg-surface [--name-w:13rem] max-sm:[--name-w:10rem]">
    <div class="relative flex min-h-full w-full min-w-max flex-col" role="table" aria-label="Timeline">
      <!-- Header -->
      <div class="sticky top-0 z-30 flex border-b border-line bg-surface/95 backdrop-blur" role="row">
        <div class="sticky start-0 z-10 flex w-52 shrink-0 items-end border-e border-line bg-surface px-4 pb-2 max-sm:w-40 max-sm:px-3" role="columnheader">
          <span class="text-xs font-semibold text-fg">People</span>
          <span class="ms-1.5 text-xs text-fg-subtle tabular-nums">{{ groups.reduce((n, g) => n + g.rows.length, 0) }}</span>
        </div>
        <div class="grid flex-1" :style="{ gridTemplateColumns: cols }">
          <div
            v-for="(d, i) in days"
            :key="d"
            role="columnheader"
            :title="holidays.get(d)"
            :aria-current="d === today ? 'date' : undefined"
            :class="['relative flex flex-col items-center gap-1 pt-2 pb-2', weekStart(i) && 'border-s border-line', offDay(d) ? 'text-fg-subtle' : 'text-fg-muted']"
          >
            <span :class="['text-2xs font-semibold tracking-wider uppercase', d === today && 'text-accent-fg']">{{ formatIso(d, { weekday: 'short' }).slice(0, 2) }}</span>
            <span
              :class="[
                'flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums 2xl:h-7 2xl:w-7 2xl:text-xs',
                d === today ? 'bg-brand-600 font-semibold text-white shadow-xs' : offDay(d) ? 'font-medium' : 'font-semibold text-fg',
              ]"
            >
              {{ Number(d.slice(8)) }}
            </span>
            <span v-if="holidays.has(d)" class="absolute bottom-0.5 h-1 w-4 rounded-full bg-special" aria-hidden="true" />
          </div>
        </div>
      </div>

      <!-- Groups and people -->
      <div class="relative flex-1">
        <!-- Column shading and dividers behind every row -->
        <div class="pointer-events-none absolute inset-y-0 start-52 end-0 grid max-sm:start-40" :style="{ gridTemplateColumns: cols }" aria-hidden="true">
          <div
            v-for="(d, i) in days"
            :key="d"
            :class="[
              'border-e border-line/40',
              weekStart(i) && 'border-s border-s-line',
              holidays.has(d) ? 'bg-special/[0.06]' : isWeekend(d) ? 'bg-surface-muted/60' : '',
            ]"
          />
        </div>
        <div
          v-if="todayIndex >= 0"
          class="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 rounded-full bg-brand-500/80"
          :style="{ left: `calc(var(--name-w) + (100% - var(--name-w)) * ${(todayIndex + 0.5) / days.length})` }"
          aria-hidden="true"
        />

        <template v-for="g in groups" :key="g.name">
          <div class="relative flex border-b border-line/70 bg-surface-muted/50" role="row">
            <button
              type="button"
              class="sticky start-0 z-20 flex w-52 shrink-0 items-center gap-2 bg-surface-muted px-4 py-1.5 text-start max-sm:w-40 max-sm:px-3"
              :aria-expanded="!collapsed.has(g.name)"
              @click="toggleGroup(g.name)"
            >
              <ChevronDown :class="['h-3.5 w-3.5 text-fg-muted transition', collapsed.has(g.name) && '-rotate-90']" aria-hidden="true" />
              <span class="truncate text-xs font-semibold text-fg">{{ g.name }}</span>
              <span class="ms-auto rounded-full bg-surface px-1.5 text-2xs font-semibold text-fg-muted tabular-nums ring-1 ring-line">{{ g.rows.length }}</span>
            </button>
            <div class="flex-1" />
          </div>

          <template v-if="!collapsed.has(g.name)">
            <div v-for="r in g.rows" :key="r.employee.id" class="group relative flex border-b border-line/60" role="row">
              <div class="sticky start-0 z-20 flex w-52 shrink-0 items-center gap-3 border-e border-line bg-surface px-4 py-2 transition-colors group-hover:bg-surface-muted max-sm:w-40 max-sm:gap-2 max-sm:px-3" role="rowheader">
                <AppAvatar :name="r.employee.name" size="sm" class="max-sm:hidden" />
                <span class="min-w-0 flex-1">
                  <RouterLink :to="`/hr/employees/${r.employee.id}`" class="block truncate text-sm font-medium text-fg hover:text-accent-fg">{{ r.employee.name }}</RouterLink>
                  <span class="block truncate text-xs text-fg-subtle">{{ r.employee.employeeCode }}</span>
                </span>
                <span class="shrink-0 text-xs font-semibold text-fg-muted tabular-nums" :title="`${formatDays(r.total)} of working days in view`">{{ r.total }}d</span>
              </div>
              <div class="relative h-14 flex-1 transition-colors group-hover:bg-brand-500/[0.03]" role="cell">
                <button
                  v-for="b in r.bars"
                  :key="b.entry.id"
                  type="button"
                  :class="[
                    'absolute top-1/2 flex h-8 -translate-y-1/2 items-center gap-1.5 overflow-hidden px-2 text-xs font-semibold whitespace-nowrap transition hover:z-20 hover:-translate-y-[calc(50%+1px)] hover:shadow-lift focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:outline-none',
                    b.clippedStart ? 'rounded-s-none' : 'rounded-s-md',
                    b.clippedEnd ? 'rounded-e-none' : 'rounded-e-md',
                    b.span < 1.5 && 'justify-center px-0',
                  ]"
                  :style="barStyle(b)"
                  :title="`${b.entry.leaveType.name} · ${formatLeaveRange(b.entry)} · ${formatDays(b.entry.days)} · ${LEAVE_STATUS_LABELS[b.entry.status]}`"
                  :aria-label="`${r.employee.name}: ${b.entry.leaveType.name}, ${formatLeaveRange(b.entry)}, ${LEAVE_STATUS_LABELS[b.entry.status].toLowerCase()}`"
                  @click="(ev: MouseEvent) => emit('open', b.entry, ev.currentTarget as HTMLElement)"
                >
                  <template v-if="b.span >= 4">
                    <span class="truncate">{{ b.entry.leaveType.name }}</span>
                    <span class="shrink-0 font-normal">{{ formatDays(b.entry.days) }}</span>
                  </template>
                  <span v-else-if="b.span >= 1">{{ b.entry.leaveType.code }}</span>
                </button>
              </div>
            </div>
          </template>
        </template>
      </div>

      <!-- Away per day -->
      <div class="sticky bottom-0 z-30 flex border-t border-line bg-surface/95 backdrop-blur" role="row">
        <div class="sticky start-0 z-10 flex w-52 shrink-0 items-center border-e border-line bg-surface px-4 py-2 max-sm:w-40 max-sm:px-3" role="rowheader">
          <span class="text-xs font-semibold text-fg">Away per day</span>
        </div>
        <div class="grid flex-1" :style="{ gridTemplateColumns: cols }">
          <div v-for="(n, i) in away" :key="days[i]" :class="['flex items-center justify-center py-2', weekStart(i) && 'border-s border-line']" role="cell">
            <span
              v-if="n"
              class="flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-2xs font-semibold tabular-nums"
              :style="{ backgroundColor: `color-mix(in oklab, var(--brand-500) ${18 + (n / peak) * 62}%, transparent)`, color: n / peak > 0.55 ? '#fff' : 'var(--app-text)' }"
              :title="`${n} away on ${formatIso(days[i]!, { day: 'numeric', month: 'short' })}`"
            >
              {{ n }}
            </span>
            <span v-else class="h-1 w-1 rounded-full bg-line" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
