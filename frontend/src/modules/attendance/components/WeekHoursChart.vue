<script setup lang="ts">
import { appLocale } from '@/core/locale/locale';
import { computed, ref } from 'vue';
import type { CalendarDay } from '@/modules/attendance/types';
import { WEEKDAY_SHORT, formatMinutes, formatTime } from '@/modules/attendance/utils/attendance-format';

const props = defineProps<{
  /** Oldest first, ending today. */
  days: CalendarDay[];
  today: string;
  /** Minutes worked so far today while punched in. */
  liveMinutes?: number;
  targetMinutes: number;
  timeZone?: string;
  loading?: boolean;
}>();

function short(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

type Marker = { label: string; class: string };

const bars = computed(() =>
  props.days.map((d) => {
    const isToday = d.date === props.today;
    const live = isToday && (props.liveMinutes ?? 0) > 0;
    const minutes = live ? props.liveMinutes! : (d.record?.workedMinutes ?? 0);
    const marker: Marker | null = minutes
      ? null
      : d.holiday
        ? { label: 'Holiday', class: 'bg-special/70' }
        : d.leave
          ? { label: d.leave.code, class: '' }
          : d.status === 'WEEKLY_OFF'
            ? { label: 'Off', class: 'bg-line-strong' }
            : d.status === 'MISSED_PUNCH'
              ? { label: 'Missed', class: 'bg-warning/70' }
              : d.status === 'ABSENT'
                ? { label: 'Absent', class: 'bg-danger/60' }
                : null;
    const date = new Date(`${d.date}T00:00:00Z`);
    return {
      d,
      isToday,
      live,
      minutes,
      marker,
      weekday: WEEKDAY_SHORT[date.getUTCDay()]!,
      day: date.getUTCDate(),
      long: new Intl.DateTimeFormat(appLocale(), { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date),
      times: d.record?.checkInAt ? `${formatTime(d.record.checkInAt, props.timeZone)} – ${d.record.checkOutAt ? formatTime(d.record.checkOutAt, props.timeZone) : 'now'}` : null,
    };
  }),
);

const scale = computed(() => Math.max(props.targetMinutes * 1.2, ...bars.value.map((b) => b.minutes), 60));
const pct = (m: number) => Math.max(4, (m / scale.value) * 100);
const targetPct = computed(() => (props.targetMinutes / scale.value) * 100);
const total = computed(() => bars.value.reduce((s, b) => s + b.minutes, 0));
const finished = computed(() => bars.value.filter((b) => b.minutes > 0 && !b.live));
const workedDays = computed(() => finished.value.length);
const average = computed(() => (workedDays.value ? Math.round(finished.value.reduce((s, b) => s + b.minutes, 0) / workedDays.value) : null));
const onTarget = computed(() => finished.value.filter((b) => b.minutes >= props.targetMinutes).length);

const active = ref<number | null>(null);
const tip = computed(() => (active.value === null ? null : bars.value[active.value]));
const tipAlign = computed(() => (active.value === 0 ? 'start-0' : active.value === bars.value.length - 1 ? 'end-0' : 'left-1/2 -translate-x-1/2'));

function describe(b: (typeof bars.value)[number]): string {
  const what = b.minutes ? `${formatMinutes(b.minutes)} worked${b.live ? ' so far' : ''}` : (b.d.leave?.name ?? b.d.holiday?.name ?? b.marker?.label ?? 'No hours');
  return [b.isToday ? `Today, ${b.long}` : b.long, what, b.times].filter(Boolean).join(', ');
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div>
        <h3 class="text-sm font-medium text-fg">Last 7 days</h3>
        <p class="mt-0.5 text-xs text-fg-muted">Hours worked · full day {{ short(targetMinutes) }}</p>
      </div>
      <dl v-if="!loading" class="flex items-end gap-5 sm:text-end">
        <div>
          <dt class="text-2xs text-fg-muted">Total</dt>
          <dd class="text-sm font-semibold text-fg tabular-nums">{{ formatMinutes(total) }}</dd>
        </div>
        <div>
          <dt class="text-2xs text-fg-muted">Daily average</dt>
          <dd class="text-sm font-semibold text-fg tabular-nums">{{ average === null ? '—' : formatMinutes(average) }}</dd>
        </div>
        <div>
          <dt class="text-2xs text-fg-muted">Full days</dt>
          <dd class="text-sm font-semibold text-fg tabular-nums">{{ onTarget }}<span class="font-normal text-fg-muted"> / {{ workedDays }}</span></dd>
        </div>
      </dl>
    </div>

    <div v-if="loading" class="mt-4 grid h-36 grid-cols-7 items-end gap-2 sm:gap-3" aria-busy="true" aria-label="Loading hours">
      <div v-for="(h, i) in [55, 70, 62, 74, 66, 20, 20]" :key="i" class="flex flex-col items-center gap-2">
        <div class="w-full max-w-10 animate-pulse rounded-t-[4px] bg-surface-muted" :style="{ height: `${h}px` }" />
        <div class="h-2.5 w-8 animate-pulse rounded-sm bg-surface-muted" />
      </div>
    </div>

    <div v-else dir="ltr" class="relative mt-4 h-36" @mouseleave="active = null">
      <div class="pointer-events-none absolute inset-x-0 border-t border-dashed border-fg-subtle/40" :style="{ bottom: `calc(1.75rem + (100% - 3rem) * ${targetPct / 100})` }" aria-hidden="true">
        <span class="absolute end-0 -translate-y-1/2 rounded-sm bg-surface px-1 text-2xs leading-none text-fg-subtle tabular-nums">{{ short(targetMinutes) }}</span>
      </div>

      <ul class="grid h-full grid-cols-7 gap-2 sm:gap-3" aria-label="Hours worked in the last 7 days">
        <li
          v-for="(b, i) in bars"
          :key="b.d.date"
          tabindex="0"
          :aria-label="describe(b)"
          :class="['group relative flex min-w-0 cursor-default flex-col items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40', b.isToday && 'bg-brand-500/[0.045]']"
          @mouseenter="active = i"
          @focus="active = i"
          @blur="active = null"
        >
          <div class="relative mt-5 w-full max-w-10 flex-1" aria-hidden="true">
            <template v-if="b.minutes">
              <div
                :class="[
                  'absolute inset-x-1 bottom-0 origin-bottom animate-grow rounded-t-[4px] transition-colors motion-reduce:animate-none',
                  b.live
                    ? 'bg-brand-500/50 bg-[repeating-linear-gradient(-45deg,transparent_0_4px,rgb(255_255_255/0.3)_4px_8px)]'
                    : b.minutes >= targetMinutes
                      ? 'bg-brand-500 group-hover:bg-brand-600'
                      : 'bg-brand-500/45 group-hover:bg-brand-500/60',
                  active === i && 'ring-2 ring-brand-500/25',
                ]"
                :style="{ height: `${pct(b.minutes)}%`, animationDelay: `${i * 40}ms` }"
              />
              <span
                :class="['absolute left-1/2 -translate-x-1/2 pb-1 text-2xs leading-none whitespace-nowrap tabular-nums transition-opacity', b.isToday ? 'font-semibold text-accent-fg' : 'text-fg-muted', active === i && 'opacity-0']"
                :style="{ bottom: `${pct(b.minutes)}%` }"
              >{{ short(b.minutes) }}</span>
            </template>
            <template v-else-if="b.marker">
              <div :class="['absolute inset-x-1 bottom-0 h-1 rounded-full', b.marker.class]" :style="b.d.leave && !b.d.holiday ? { backgroundColor: b.d.leave.color } : undefined" />
              <span class="absolute bottom-0 left-1/2 max-w-full -translate-x-1/2 truncate pb-2 text-2xs leading-none text-fg-subtle">{{ b.marker.label }}</span>
            </template>
            <div v-else class="absolute inset-x-1 bottom-0 h-1 rounded-full bg-surface-muted" />
          </div>
          <div class="flex h-7 items-center gap-1 text-2xs leading-none" aria-hidden="true">
            <span :class="b.isToday ? 'font-semibold text-fg' : 'text-fg-muted'">{{ b.weekday }}</span>
            <span :class="['tabular-nums max-sm:hidden', b.isToday ? 'grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-2xs font-semibold text-white' : 'text-fg-subtle']">{{ b.day }}</span>
          </div>
        </li>
      </ul>

      <Transition enter-active-class="transition duration-100 ease-out" enter-from-class="opacity-0 translate-y-1" leave-active-class="transition duration-75" leave-to-class="opacity-0">
        <div
          v-if="tip"
          :key="tip.d.date"
          class="pointer-events-none absolute z-10 w-max max-w-56 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-lift"
          :class="tipAlign"
          :style="{
            bottom: `calc(1.75rem + (100% - 3rem) * ${(tip.minutes ? pct(tip.minutes) : 0) / 100} + 0.5rem)`,
            ...(active !== null && active > 0 && active < bars.length - 1 ? { left: `${((active + 0.5) / bars.length) * 100}%` } : {}),
          }"
          aria-hidden="true"
        >
          <p class="font-medium text-fg">{{ tip.isToday ? 'Today' : tip.long }}</p>
          <p class="mt-1 flex items-baseline gap-2 text-fg-muted">
            <span v-if="tip.minutes" class="text-sm font-semibold text-fg tabular-nums">{{ formatMinutes(tip.minutes) }}</span>
            <span v-if="tip.minutes">{{ tip.live ? 'so far' : 'worked' }}</span>
            <span v-else>{{ tip.d.leave?.name ?? tip.d.holiday?.name ?? tip.marker?.label ?? 'No hours recorded' }}</span>
          </p>
          <p v-if="tip.times" class="mt-0.5 text-fg-muted tabular-nums">{{ tip.times }}</p>
          <p v-if="tip.d.record?.lateMinutes || tip.d.overtime || tip.d.workFromHome || (tip.minutes && tip.minutes < targetMinutes && !tip.live)" class="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-2xs">
            <span v-if="tip.d.record?.lateMinutes" class="text-warning-fg">Late {{ formatMinutes(tip.d.record.lateMinutes) }}</span>
            <span v-if="tip.d.overtime" class="text-special-fg">Overtime {{ formatMinutes(tip.d.overtime.minutes) }}</span>
            <span v-if="tip.d.workFromHome" class="text-info-fg">From home</span>
            <span v-if="tip.minutes && tip.minutes < targetMinutes && !tip.live" class="text-fg-subtle">{{ formatMinutes(targetMinutes - tip.minutes) }} short</span>
          </p>
        </div>
      </Transition>
    </div>
  </div>
</template>
