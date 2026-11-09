<script setup lang="ts">
import { computed, type Component } from 'vue';
import { Building2, CalendarOff, ChevronRight, Clock, House, PartyPopper, Timer, UserX } from '@lucide/vue';
import type { DailyRow } from '@/modules/attendance/types';
import { DAY_STATUS_LABELS, dayStatusTone, formatMinutes, formatTime } from '@/modules/attendance/utils/attendance-format';
import { clockMinutes } from '@/modules/attendance/utils/attendance-ops';
import { AppAvatar, AppBadge } from '@/shared/components';

/** One person's day in the register grid: status, punches against the shift window, and anything worth a look. */
const props = defineProps<{ row: DailyRow; source: { icon: Component; label: string } | null }>();

const r = computed(() => props.row);
const rec = computed(() => (r.value.record?.checkInAt ? r.value.record : null));
const subtitle = computed(() => [r.value.employee.employeeCode, r.value.employee.designation].filter(Boolean).join(' · '));
const late = computed(() => r.value.record?.lateMinutes ?? 0);
/** Minutes worked; while still punched in, the time since punching in. */
const worked = computed(() => {
  const x = rec.value;
  if (!x) return null;
  if (x.workedMinutes !== null || x.checkOutAt || r.value.status !== 'IN_PROGRESS') return x.workedMinutes;
  return Math.max(0, Math.round((Date.now() - new Date(x.checkInAt!).getTime()) / 60_000));
});

/** Where the day stands when nobody punched in. */
const note = computed<{ icon: Component; text: string; tone: string } | null>(() => {
  if (rec.value) return null;
  const s = r.value.status;
  if (s === 'ON_LEAVE' && r.value.leave) return { icon: CalendarOff, text: `${r.value.leave.name}${r.value.leave.session !== 'FULL' ? ' · half day' : ''}`, tone: 'bg-away-soft text-away-fg' };
  if (s === 'ABSENT') return { icon: UserX, text: 'No punches recorded', tone: 'bg-danger-soft text-danger-fg' };
  if (s === 'UPCOMING') return { icon: Clock, text: 'No punch-in yet', tone: 'bg-surface-muted text-fg-muted' };
  if (s === 'HOLIDAY') return { icon: PartyPopper, text: 'Holiday, nobody expected', tone: 'bg-special-soft text-special-fg' };
  return { icon: CalendarOff, text: s === 'WEEKLY_OFF' ? 'Weekly off' : DAY_STATUS_LABELS[s], tone: 'bg-surface-muted text-fg-muted' };
});

const localMinutes = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};
/** Shift window and punches on one axis, an hour either side; overnight shifts carry past midnight. */
const track = computed(() => {
  const x = rec.value;
  if (!x?.checkInAt || (!x.checkOutAt && r.value.status !== 'IN_PROGRESS')) return null;
  const s = clockMinutes(r.value.shift.startTime);
  const e = clockMinutes(r.value.shift.endTime) <= s ? clockMinutes(r.value.shift.endTime) + 1440 : clockMinutes(r.value.shift.endTime);
  const rel = (m: number) => (m < s - 360 ? m + 1440 : m);
  const inM = rel(localMinutes(x.checkInAt));
  let outM = rel(localMinutes(x.checkOutAt ?? new Date().toISOString()));
  if (outM < inM) outM += 1440;
  const lo = Math.min(s, inM) - 60;
  const hi = Math.max(e, outM) + 60;
  const p = (m: number) => ((m - lo) / (hi - lo)) * 100;
  const span = (from: number, to: number) => ({ left: `${p(from)}%`, width: `${Math.max(0.8, p(to) - p(from))}%` });
  return {
    shift: span(s, e),
    late: late.value > 0 && inM > s ? span(s, inM) : null,
    worked: span(inM, Math.min(outM, Math.max(e, inM))),
    over: outM > e ? span(Math.max(inM, e), outM) : null,
    live: !x.checkOutAt,
  };
});
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <AppAvatar :name="r.employee.name" size="md" />
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm leading-snug font-semibold text-fg">{{ r.employee.name }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted">{{ subtitle }}</p>
      </div>
      <AppBadge class="shrink-0" :tone="dayStatusTone[r.status]" size="sm" dot>{{ r.status === 'UPCOMING' ? 'Not in yet' : DAY_STATUS_LABELS[r.status] }}</AppBadge>
    </div>

    <ul class="flex flex-wrap gap-1.5 text-xs" aria-label="Day details">
      <li class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-fg-muted">
        <Clock :size="12" aria-hidden="true" />{{ r.shift.name }} <span class="tabular-nums">{{ r.shift.startTime }}–{{ r.shift.endTime }}</span>
      </li>
      <li v-if="r.shift.rostered" class="rounded-md bg-info-soft px-2 py-1 text-info-fg">Rostered</li>
      <li v-if="r.workFromHome" class="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-1 text-accent-fg"><House :size="12" aria-hidden="true" />From home</li>
      <li v-if="r.record?.overtimeMinutes" class="inline-flex items-center gap-1 rounded-md bg-special-soft px-2 py-1 text-special-fg tabular-nums">
        <Timer :size="12" aria-hidden="true" />+{{ formatMinutes(r.record.overtimeMinutes) }}<span class="sr-only"> overtime</span>
      </li>
      <li v-if="r.leave && rec" class="inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-2 py-1 text-fg-muted">
        <span class="h-1.5 w-1.5 rounded-full" :style="{ backgroundColor: r.leave.color }" aria-hidden="true" />{{ r.leave.name }}{{ r.leave.session !== 'FULL' ? ' · half day' : '' }}
      </li>
    </ul>

    <template v-if="rec">
      <dl class="grid grid-cols-3 gap-2">
        <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
          <dt class="text-2xs text-fg-subtle">In</dt>
          <dd class="mt-0.5 text-sm font-semibold whitespace-nowrap text-fg tabular-nums">{{ formatTime(rec.checkInAt) }}</dd>
          <dd :class="['flex items-center gap-1 text-2xs', late ? 'font-medium text-caution-fg' : 'text-fg-subtle']">
            <component :is="source.icon" v-if="source" :size="11" class="shrink-0 text-fg-subtle" :aria-label="source.label" role="img" />{{ late ? `${formatMinutes(late)} late` : 'On time' }}
          </dd>
        </div>
        <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
          <dt class="text-2xs text-fg-subtle">Out</dt>
          <dd v-if="rec.checkOutAt" class="mt-0.5 text-sm font-semibold whitespace-nowrap text-fg tabular-nums">{{ formatTime(rec.checkOutAt) }}</dd>
          <dd v-else-if="r.status === 'MISSED_PUNCH'" class="mt-0.5 text-sm font-semibold text-special-fg">Missing</dd>
          <dd v-else class="mt-0.5 text-sm font-semibold text-info-fg">Still in</dd>
          <dd class="text-2xs text-fg-subtle tabular-nums">Ends {{ r.shift.endTime }}</dd>
        </div>
        <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
          <dt class="text-2xs text-fg-subtle">Worked</dt>
          <dd :class="['mt-0.5 text-sm font-semibold whitespace-nowrap tabular-nums', worked !== null ? 'text-fg' : 'text-fg-subtle']">{{ formatMinutes(worked) }}</dd>
          <dd class="text-2xs text-fg-subtle">{{ rec.checkOutAt ? 'Total' : 'So far' }}</dd>
        </div>
      </dl>

      <div v-if="track" dir="ltr" class="relative h-2 rounded-full bg-surface-muted" aria-hidden="true">
        <span class="absolute inset-y-0 rounded-full bg-brand-500/12 ring-1 ring-brand-500/30 ring-inset" :style="track.shift" />
        <span v-if="track.late" class="absolute inset-y-0 rounded-s-full bg-warning" :style="track.late" />
        <span
          :class="['absolute inset-y-0 bg-brand-500', !track.late && 'rounded-s-full', !track.over && 'rounded-e-full', track.live && 'bg-[repeating-linear-gradient(-45deg,transparent_0_5px,rgb(255_255_255/0.25)_5px_10px)]']"
          :style="track.worked"
        />
        <span v-if="track.over" class="absolute inset-y-0 rounded-e-full bg-special" :style="track.over" />
      </div>
    </template>
    <p v-else-if="note" :class="['flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium', note.tone]">
      <component :is="note.icon" :size="14" class="shrink-0" aria-hidden="true" />
      <span v-if="r.leave && r.status === 'ON_LEAVE'" class="h-1.5 w-1.5 shrink-0 rounded-full" :style="{ backgroundColor: r.leave.color }" aria-hidden="true" />
      <span class="truncate">{{ note.text }}</span>
    </p>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3 text-xs text-fg-muted">
      <Building2 :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
      <span class="min-w-0 truncate">{{ r.employee.department?.name ?? 'No department' }}</span>
      <span class="ms-auto inline-flex shrink-0 items-center gap-0.5 font-medium text-accent-fg opacity-0 transition group-hover/card:opacity-100 group-focus-visible/card:opacity-100">
        Month view <ChevronRight :size="13" class="rtl:rotate-180" aria-hidden="true" />
      </span>
    </div>
  </div>
</template>
