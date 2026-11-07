<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { LeaveCalendar } from '@/modules/leave/types';
import { addDays, formatIso, isWeekend } from '@/modules/leave/utils/calendar-dates';
import { LEAVE_STATUS_LABELS, formatLeaveRange } from '@/modules/leave/utils/leave-format';

type Entry = LeaveCalendar['entries'][number];

/**
 * Month and week views in the style of a calendar app. Approved leave of a full day or more is an all-day bar that
 * spans its days (split at week ends); a half day reads like a timed event (dot, AM / PM, name); pending leave is a
 * hollow dot, or a light dashed bar when it spans days. Holidays sit on the first lane. In the month view a day shows
 * the lanes that fit (or `maxLanes`) and "N more" for the rest.
 */
const props = withDefaults(
  defineProps<{
    /** Mondays of the weeks to draw. */
    weeks: string[];
    entries: Entry[];
    holidays: Map<string, string>;
    today: string;
    /** Days outside it are greyed (the month being shown). */
    month?: string;
    mode: 'month' | 'week';
    /** Lanes per day in the month view when not fitting to a height. */
    maxLanes?: number;
    /** Fill the given height without scrolling (needs a parent with a fixed height). */
    fit?: boolean;
  }>(),
  { month: undefined, maxLanes: 3, fit: false },
);
const emit = defineEmits<{ open: [entry: Entry, el: HTMLElement]; day: [iso: string] }>();

type Kind = 'bar' | 'pending-bar' | 'dot' | 'holiday';
interface Segment {
  key: string;
  start: number;
  end: number;
  lane: number;
  kind: Kind;
  entry?: Entry;
  holiday?: string;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

const halfOf = (e: Entry) => (e.startDate === e.endDate && e.startSession !== 'FULL' ? (e.startSession === 'FIRST_HALF' ? 'AM' : 'PM') : null);
function kindOf(e: Entry): Kind {
  const multi = e.startDate !== e.endDate;
  if (e.status === 'PENDING') return multi ? 'pending-bar' : 'dot';
  return halfOf(e) ? 'dot' : 'bar';
}

/** Greedy lane packing: holidays first, then earliest start, longer first, each into the first lane free from its start. */
function pack(monday: string): { segments: Segment[]; lanes: number } {
  const sunday = addDays(monday, 6);
  const idx = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${monday}T00:00:00Z`)) / 86_400_000);
  const items: Omit<Segment, 'lane'>[] = [];
  for (let i = 0; i < 7; i++) {
    const name = props.holidays.get(addDays(monday, i));
    if (name) items.push({ key: `h-${i}`, start: i, end: i, kind: 'holiday', holiday: name, continuesBefore: false, continuesAfter: false });
  }
  for (const e of props.entries) {
    if (e.endDate < monday || e.startDate > sunday) continue;
    items.push({ key: e.id, start: Math.max(0, idx(e.startDate)), end: Math.min(6, idx(e.endDate)), kind: kindOf(e), entry: e, continuesBefore: e.startDate < monday, continuesAfter: e.endDate > sunday });
  }
  const rank = (k: Kind) => (k === 'holiday' ? 0 : k === 'dot' ? 2 : 1);
  items.sort((a, b) => rank(a.kind) - rank(b.kind) || a.start - b.start || b.end - b.start - (a.end - a.start) || (a.entry?.employee.name ?? '').localeCompare(b.entry?.employee.name ?? ''));
  const laneEnds: number[] = [];
  const segments = items.map((s) => {
    let lane = laneEnds.findIndex((end) => end < s.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = s.end;
    return { ...s, lane };
  });
  return { segments, lanes: laneEnds.length };
}

const weekdays = computed(() => Array.from({ length: 7 }, (_, i) => formatIso(addDays('2024-01-01', i), { weekday: 'short' })));
const LANE = computed(() => (props.mode === 'week' ? 26 : 22));
/** Where the event lanes start in a row: under the day number (and the weekday labels on the first month row). */
const top = (ri: number) => (props.mode === 'week' ? 8 : ri === 0 ? 48 : 32);

/** With `fit`, the month's weeks share the measured height equally and each shows the lanes that fit in its row. */
const body = ref<HTMLElement | null>(null);
const bodyHeight = ref(0);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(([e]) => (bodyHeight.value = e!.contentRect.height));
  if (body.value) observer.observe(body.value);
});
onBeforeUnmount(() => observer?.disconnect());
const fitted = computed(() => props.fit && props.mode === 'month' && bodyHeight.value > 0);
/** Lanes a row has room for, counting the one "N more" needs. */
function capacity(ri: number): number {
  if (props.mode === 'week') return Number.POSITIVE_INFINITY;
  if (!fitted.value) return props.maxLanes + 1;
  return Math.max(1, Math.floor((bodyHeight.value / props.weeks.length - top(ri) - 4) / (LANE.value + 2)));
}

const rows = computed(() =>
  props.weeks.map((monday, ri) => {
    const { segments, lanes } = pack(monday);
    const room = capacity(ri);
    const limit = lanes <= room ? lanes : room - 1;
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const hidden = days.map((_, i) => segments.filter((s) => s.lane >= limit && s.start <= i && s.end >= i).length);
    return { monday, days, segments: segments.filter((s) => s.lane < limit), hidden, lanes: Math.min(lanes, limit), moreRow: limit + 1 };
  }),
);
const outside = (d: string) => !!props.month && d.slice(0, 7) !== props.month;

function style(s: Segment) {
  if (s.kind === 'holiday') return { backgroundColor: 'color-mix(in oklab, #8b5cf6 16%, var(--app-surface))', color: 'color-mix(in oklab, #8b5cf6 72%, var(--app-text))' };
  const c = s.entry!.leaveType.color;
  if (s.kind === 'bar') return { backgroundColor: c, color: '#fff' };
  if (s.kind === 'pending-bar')
    return {
      color: `color-mix(in oklab, ${c} 72%, var(--app-text))`,
      backgroundColor: `color-mix(in oklab, ${c} 10%, var(--app-surface))`,
      border: `1px dashed color-mix(in oklab, ${c} 70%, transparent)`,
    };
  return {};
}
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
const label = (s: Segment) =>
  s.holiday ? `Holiday: ${s.holiday}` : `${s.entry!.employee.name}, ${s.entry!.leaveType.name}, ${formatLeaveRange(s.entry!)}, ${LEAVE_STATUS_LABELS[s.entry!.status].toLowerCase()}`;
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface" role="grid" :aria-label="mode === 'month' ? 'Month' : 'Week'">
    <!-- Week view: weekday and a large date, like a calendar app's week header -->
    <div v-if="mode === 'week'" class="grid shrink-0 grid-cols-7 border-b border-line" role="row">
      <div v-for="(d, i) in rows[0]?.days ?? []" :key="d" role="columnheader" :class="['pt-2 pb-2 text-center', d === today ? 'text-brand-600 dark:text-brand-300' : 'text-fg-muted']">
        <span class="block text-2xs font-semibold tracking-wide uppercase">{{ weekdays[i] }}</span>
        <button
          type="button"
          :class="['mx-auto mt-1 flex h-11 w-11 items-center justify-center rounded-full text-2xl tabular-nums transition', d === today ? 'bg-brand-600 text-white shadow-xs dark:bg-brand-500' : 'text-fg hover:bg-surface-muted']"
          :aria-label="formatIso(d, { weekday: 'long', day: 'numeric', month: 'long' })"
          @click="emit('day', d)"
        >
          {{ Number(d.slice(8)) }}
        </button>
      </div>
    </div>

    <div ref="body" class="flex min-h-0 flex-1 flex-col">
      <div
        v-for="(r, ri) in rows"
        :key="r.monday"
        :class="['relative', ri < rows.length - 1 && 'border-b border-line/80', fit && mode === 'month' ? 'min-h-0 flex-1 basis-0 overflow-hidden' : 'flex-1']"
        role="row"
        :style="
          fit && mode === 'month'
            ? undefined
            : { minHeight: mode === 'month' ? `${top(ri) + 6 + Math.max(2, r.moreRow - (r.hidden.some(Boolean) ? 0 : 1)) * (LANE + 2)}px` : `${Math.max(320, top(ri) + 8 + r.lanes * (LANE + 2))}px` }
        "
      >
        <!-- Day cells -->
        <div class="grid h-full grid-cols-7">
          <div
            v-for="(d, i) in r.days"
            :key="d"
            role="gridcell"
            :aria-current="d === today ? 'date' : undefined"
            :class="['flex flex-col items-center pt-1.5', i < 6 && 'border-e border-line/80', outside(d) ? 'bg-surface-muted/30' : isWeekend(d) && 'bg-surface-muted/20']"
          >
            <template v-if="mode === 'month'">
              <span v-if="ri === 0" class="text-2xs font-semibold tracking-wide text-fg-muted uppercase"><span class="sm:hidden">{{ weekdays[i]!.charAt(0) }}</span><span class="max-sm:hidden">{{ weekdays[i] }}</span></span>
              <button
                type="button"
                :class="[
                  'mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium tabular-nums transition',
                  d === today ? 'bg-brand-600 font-semibold text-white shadow-xs dark:bg-brand-500' : outside(d) ? 'text-fg-subtle hover:bg-surface-muted' : 'text-fg hover:bg-surface-muted',
                ]"
                :aria-label="`Week of ${formatIso(d, { day: 'numeric', month: 'long' })}`"
                @click="emit('day', d)"
              >
                {{ Number(d.slice(8)) === 1 ? formatIso(d, { day: 'numeric', month: 'short' }) : Number(d.slice(8)) }}
              </button>
            </template>
          </div>
        </div>

        <!-- Events -->
        <div class="pointer-events-none absolute inset-x-0 grid grid-cols-7 gap-y-0.5" :style="{ top: `${top(ri)}px`, gridAutoRows: `${LANE}px` }">
          <button
            v-for="s in r.segments"
            :key="s.key"
            type="button"
            :disabled="s.kind === 'holiday'"
            :class="[
              'pointer-events-auto flex min-w-0 items-center gap-1.5 px-1.5 text-start font-medium transition focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
              mode === 'week' ? 'text-xs' : 'text-2xs sm:text-[12px]',
              s.kind === 'dot' ? 'mx-1 rounded-[4px] text-fg hover:bg-surface-muted' : 'shadow-xs enabled:hover:shadow-card enabled:hover:brightness-95',
              s.kind !== 'dot' && (s.continuesBefore ? 'rounded-s-none' : 'ms-1 rounded-s-[4px]'),
              s.kind !== 'dot' && (s.continuesAfter ? 'rounded-e-none' : 'me-1 rounded-e-[4px]'),
              s.kind === 'holiday' && 'cursor-default shadow-none',
            ]"
            :style="{ gridColumn: `${s.start + 1} / ${s.end + 2}`, gridRow: `${s.lane + 1}`, ...style(s) }"
            :title="s.holiday ?? `${s.entry!.employee.name} · ${s.entry!.leaveType.name} · ${formatLeaveRange(s.entry!)} · ${LEAVE_STATUS_LABELS[s.entry!.status]}`"
            :aria-label="label(s)"
            @click="(ev: MouseEvent) => s.entry && emit('open', s.entry, ev.currentTarget as HTMLElement)"
          >
            <template v-if="s.kind === 'holiday'"><span class="truncate">{{ s.holiday }}</span></template>
            <template v-else-if="s.kind === 'dot'">
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :style="s.entry!.status === 'PENDING' ? { boxShadow: `inset 0 0 0 1.5px ${s.entry!.leaveType.color}` } : { backgroundColor: s.entry!.leaveType.color }"
                aria-hidden="true"
              />
              <span v-if="halfOf(s.entry!)" class="shrink-0 text-fg-muted tabular-nums max-sm:hidden">{{ halfOf(s.entry!) }}</span>
              <span class="truncate sm:hidden">{{ initials(s.entry!.employee.name) }}</span>
              <span class="truncate max-sm:hidden">{{ s.entry!.employee.name }}</span>
            </template>
            <template v-else>
              <span class="truncate sm:hidden">{{ initials(s.entry!.employee.name) }}</span>
              <span class="max-w-full shrink-0 truncate max-sm:hidden">{{ s.entry!.employee.name }}</span>
              <span class="min-w-0 truncate opacity-80 max-sm:hidden">· {{ s.end > s.start || mode === 'week' ? s.entry!.leaveType.name : s.entry!.leaveType.code }}</span>
            </template>
          </button>
          <template v-for="(n, i) in r.hidden" :key="`more-${i}`">
            <button
              v-if="n"
              type="button"
              class="pointer-events-auto mx-1 truncate rounded-[4px] px-1.5 text-start text-2xs font-semibold text-fg-muted hover:bg-surface-muted sm:text-[12px]"
              :style="{ gridColumn: `${i + 1}`, gridRow: `${r.moreRow}` }"
              @click="emit('day', r.days[i]!)"
            >
              {{ n }} more
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
