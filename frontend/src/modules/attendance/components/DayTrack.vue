<script setup lang="ts">
import { computed } from 'vue';
import { formatClockMinutes } from '@/core/locale/locale';
import { formatMinutes } from '@/modules/attendance/utils/attendance-format';

const props = defineProps<{
  /** Shift start and end, "HH:MM" in the organization's time zone. */
  start: string;
  end: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  lateMinutes?: number;
  now: number;
  timeZone?: string;
  /** Hide the Now marker, e.g. on days off. */
  hideNow?: boolean;
}>();

const hm = (s: string) => {
  const [h = 0, m = 0] = s.split(':').map(Number);
  return h * 60 + m;
};
function minutesOfDay(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: props.timeZone }).formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
}
const clock = formatClockMinutes;

type Kind = 'late' | 'worked' | 'live' | 'over';
const SEGMENT: Record<Kind, string> = {
  late: 'bg-warning',
  worked: 'bg-brand-500',
  live: 'bg-brand-500 bg-[repeating-linear-gradient(-45deg,transparent_0_5px,rgb(255_255_255/0.25)_5px_10px)]',
  over: 'bg-special',
};

const model = computed(() => {
  const s = hm(props.start);
  const e = hm(props.end) <= s ? hm(props.end) + 1440 : hm(props.end);
  const rel = (m: number) => (m < s - 360 ? m + 1440 : m);
  const nowM = rel(minutesOfDay(props.now));
  const inM = props.checkInAt ? rel(minutesOfDay(Date.parse(props.checkInAt))) : null;
  const live = inM !== null && !props.checkOutAt;
  let outM = props.checkOutAt ? rel(minutesOfDay(Date.parse(props.checkOutAt))) : live ? nowM : null;
  if (inM !== null && outM !== null && outM < inM) outM += 1440;

  const lo = Math.floor(Math.min(s - 60, inM ?? Infinity) / 60) * 60;
  const hi = Math.ceil(Math.max(e + 60, outM ?? -Infinity) / 60) * 60;
  const p = (m: number) => ((Math.min(hi, Math.max(lo, m)) - lo) / (hi - lo)) * 100;

  const hours: { pct: number; label: string; minor: boolean; edge: boolean }[] = [];
  const step = (hi - lo) / 60 > 14 ? 2 : 1;
  for (let m = lo, i = 0; m <= hi; m += 60 * step, i++) hours.push({ pct: p(m), label: clock(m), minor: i % 2 === 1, edge: m === lo || m + 60 * step > hi });

  const segments: { from: number; to: number; kind: Kind }[] = [];
  let lateM = 0;
  let overM = 0;
  if (inM !== null && outM !== null) {
    if ((props.lateMinutes ?? 0) > 0 && inM > s) {
      segments.push({ from: p(s), to: p(inM), kind: 'late' });
      lateM = props.lateMinutes!;
    }
    const inShift = Math.min(outM, e);
    if (inShift > inM) segments.push({ from: p(inM), to: p(inShift), kind: live ? 'live' : 'worked' });
    if (outM > e) {
      segments.push({ from: p(Math.max(inM, e)), to: p(outM), kind: 'over' });
      overM = outM - Math.max(inM, e);
    }
  }

  const showNow = !props.hideNow && !props.checkOutAt && nowM >= lo && nowM <= hi;
  const pins: { pct: number; label: string; time: string; strong?: boolean; align: string }[] = [];
  if (inM !== null) pins.push({ pct: p(inM), label: 'In', time: clock(inM), align: '' });
  if (props.checkOutAt && outM !== null) pins.push({ pct: p(outM), label: 'Out', time: clock(outM), align: '' });
  if (showNow) pins.push({ pct: p(nowM), label: 'Now', time: clock(nowM), strong: true, align: '' });
  pins.sort((a, b) => a.pct - b.pct);
  for (const pin of pins) pin.align = align(pin.pct);
  // Labels too close to centre on their points sit side by side instead: the earlier one ends at its point, the later one starts at its own.
  for (let i = 1; i < pins.length; i++) {
    const a = pins[i - 1]!;
    const b = pins[i]!;
    if (b.pct - a.pct >= 16) continue;
    if (a.pct < 8) {
      a.align = 'translate-x-0';
      b.align = 'translate-x-0 ms-[4.5rem]';
    } else {
      a.align = '-translate-x-full -ms-0.5';
      b.align = 'translate-x-0 ms-0.5';
    }
  }
  const marks = [inM, props.checkOutAt ? outM : null].filter((m): m is number => m !== null).map(p);

  return {
    shift: { from: p(s), to: p(e) },
    hours,
    segments,
    pins,
    marks,
    now: showNow ? p(nowM) : null,
    live,
    lateM,
    overM,
    workedInShift: inM !== null && outM !== null ? Math.max(0, Math.min(outM, e) - inM) : 0,
    left: live && nowM < e ? e - nowM : 0,
  };
});

const align = (pct: number) => (pct < 6 ? 'translate-x-0' : pct > 94 ? '-translate-x-full' : '-translate-x-1/2');

const summary = computed(() => {
  const m = model.value;
  return [
    `Shift ${props.start} to ${props.end}`,
    m.workedInShift ? `worked ${formatMinutes(m.workedInShift)}` : 'not punched in',
    m.lateM ? `late ${formatMinutes(m.lateM)}` : '',
    m.overM ? `${formatMinutes(m.overM)} after the shift` : '',
    m.left ? `${formatMinutes(m.left)} of the shift left` : '',
  ]
    .filter(Boolean)
    .join(', ');
});
</script>

<template>
  <div dir="ltr" role="img" :aria-label="summary">
    <div class="relative h-6" aria-hidden="true">
      <span
        v-for="pin in model.pins"
        :key="pin.label"
        :class="[
          'absolute bottom-1 inline-flex items-baseline gap-1 rounded-sm px-1.5 py-0.5 text-2xs leading-none whitespace-nowrap tabular-nums',
          pin.align,
          pin.strong ? 'bg-fg font-semibold text-surface' : 'bg-accent-soft font-semibold text-accent-fg ring-1 ring-brand-500/30 ring-inset',
        ]"
        :style="{ left: `${pin.pct}%` }"
      >
        <span class="font-normal">{{ pin.label }}</span>{{ pin.time }}
      </span>
    </div>

    <div class="relative h-3 rounded-[3px] bg-surface-muted" aria-hidden="true">
      <div class="absolute inset-y-0 rounded-[3px] bg-brand-500/12 ring-1 ring-brand-500/30 ring-inset" :style="{ left: `${model.shift.from}%`, width: `${model.shift.to - model.shift.from}%` }" />
      <div
        v-for="(seg, i) in model.segments"
        :key="i"
        :class="['absolute inset-y-0 transition-[width] duration-700', i === 0 && 'rounded-s-[3px]', i === model.segments.length - 1 && 'rounded-e-[3px]', SEGMENT[seg.kind]]"
        :style="{ left: `${seg.from}%`, width: `${Math.max(0.6, seg.to - seg.from)}%` }"
      />
      <span v-for="m in model.marks" :key="m" class="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-brand-700 dark:bg-brand-300" :style="{ left: `${m}%` }" />
      <span v-if="model.now !== null" class="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-fg" :style="{ left: `${model.now}%` }" />
    </div>

    <div class="relative mt-1 h-5" aria-hidden="true">
      <template v-for="h in model.hours" :key="h.label">
        <span class="absolute top-0 h-1 w-px bg-line-strong" :style="{ left: `${h.pct}%` }" />
        <span v-if="!h.edge" :class="['absolute top-1.5 -translate-x-1/2 text-2xs leading-none text-fg-subtle tabular-nums', h.minor && 'max-sm:hidden']" :style="{ left: `${h.pct}%` }">{{ h.label }}</span>
      </template>
    </div>

    <ul class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-fg-muted" aria-hidden="true">
      <li class="inline-flex items-center gap-1.5"><span class="h-2 w-3 rounded-[2px] bg-brand-500/12 ring-1 ring-brand-500/30 ring-inset" />Shift {{ start }}–{{ end }}</li>
      <li v-if="model.workedInShift" class="inline-flex items-center gap-1.5">
        <span :class="['h-2 w-3 rounded-[2px]', SEGMENT[model.live ? 'live' : 'worked']]" />Worked <span class="font-medium text-fg tabular-nums">{{ formatMinutes(model.workedInShift) }}</span>
      </li>
      <li v-if="model.lateM" class="inline-flex items-center gap-1.5"><span :class="['h-2 w-3 rounded-[2px]', SEGMENT.late]" />Late <span class="font-medium text-fg tabular-nums">{{ formatMinutes(model.lateM) }}</span></li>
      <li v-if="model.overM" class="inline-flex items-center gap-1.5"><span :class="['h-2 w-3 rounded-[2px]', SEGMENT.over]" />After shift <span class="font-medium text-fg tabular-nums">{{ formatMinutes(model.overM) }}</span></li>
      <li v-if="model.left" class="inline-flex items-center gap-1.5"><span class="h-3 w-0.5 rounded-full bg-fg" />Now · shift ends in <span class="font-medium text-fg tabular-nums">{{ formatMinutes(model.left) }}</span></li>
    </ul>
  </div>
</template>
