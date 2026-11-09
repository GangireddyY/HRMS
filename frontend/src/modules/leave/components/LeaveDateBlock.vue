<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight } from '@lucide/vue';
import type { LeaveSession } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { formatDays, formatLeaveRange } from '@/modules/leave/utils/leave-format';
import { formatDate } from '@/shared/utils/format';

/** When a leave is, as calendar tiles banded in the leave type's colour, with the days it counts for. */
const props = defineProps<{ startDate: string; endDate: string; startSession: LeaveSession; endSession: LeaveSession; days: number; color?: string }>();

const thisYear = new Date().getFullYear();
const tile = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  const month = d.toLocaleDateString(appLocale(), d.getFullYear() === thisYear ? { month: 'short' } : { month: 'short', year: '2-digit' });
  return { iso, weekday: d.toLocaleDateString(appLocale(), { weekday: 'short' }), day: d.getDate(), month };
};
const tiles = computed(() => (props.startDate === props.endDate ? [tile(props.startDate)] : [tile(props.startDate), tile(props.endDate)]));
const session = computed(() => {
  if (props.startDate === props.endDate) return props.startSession === 'FIRST_HALF' ? 'Morning' : props.startSession === 'SECOND_HALF' ? 'Afternoon' : 'Full day';
  return [props.startSession === 'SECOND_HALF' && 'From the afternoon', props.endSession === 'FIRST_HALF' && 'Until the morning'].filter(Boolean).join(' · ');
});
const value = computed(() => Math.round(props.days * 100) / 100);
const band = computed(() => (props.color ? { backgroundColor: `color-mix(in srgb, ${props.color} 18%, transparent)` } : undefined));
</script>

<template>
  <div class="flex items-center gap-2 rounded-xl border border-line/70 bg-surface-muted/40 p-2.5">
    <template v-for="(t, i) in tiles" :key="t.iso">
      <ArrowRight v-if="i" :size="14" class="shrink-0 text-fg-subtle rtl:rotate-180" aria-hidden="true" />
      <span class="flex w-12 shrink-0 flex-col overflow-hidden rounded-lg bg-surface text-center shadow-xs ring-1 ring-line/70" :title="formatDate(t.iso)" aria-hidden="true">
        <span :class="['py-0.5 text-2xs font-semibold tracking-wide text-fg uppercase', !band && 'bg-surface-muted']" :style="band">{{ t.weekday }}</span>
        <span class="pt-0.5 text-lg leading-6 font-semibold text-fg tabular-nums">{{ t.day }}</span>
        <span class="pb-1 text-2xs leading-4 text-fg-muted">{{ t.month }}</span>
      </span>
    </template>
    <div class="ms-auto min-w-0 ps-2 text-end" aria-hidden="true">
      <p class="text-2xl leading-7 font-semibold tracking-tight text-fg tabular-nums">
        {{ value }}<span class="ms-1 text-xs font-normal tracking-normal text-fg-muted">{{ value === 1 || value === 0.5 ? 'day' : 'days' }}</span>
      </p>
      <p v-if="session" class="truncate text-2xs text-fg-subtle">{{ session }}</p>
    </div>
    <span class="sr-only">{{ formatLeaveRange(props) }}, {{ formatDays(days) }}</span>
  </div>
</template>
