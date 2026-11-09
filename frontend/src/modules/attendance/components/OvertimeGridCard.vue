<script setup lang="ts">
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { Check, Lock, X } from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import type { Overtime } from '@/modules/attendance/types';
import { OVERTIME_LABELS, formatMinutes, formatTime, monthLabel, overtimeTone } from '@/modules/attendance/utils/attendance-format';
import { dateTile, longDay, relativeDay } from '@/modules/attendance/utils/attendance-ops';
import { AppAvatar, AppBadge, AppButton } from '@/shared/components';

/** An overtime claim in the approvals grid: how much, out of a day of how long, and who is waiting on it. */
const props = defineProps<{ overtime: Overtime; today: string; blocksClose: boolean; to?: RouteLocationRaw; selectable?: boolean }>();
const emit = defineEmits<{ approve: []; reject: [] }>();

const o = computed(() => props.overtime);
const tile = computed(() => dateTile(o.value.workDate));
const shortDay = (d: string) => new Intl.DateTimeFormat(appLocale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const partial = computed(() => o.value.approvedMinutes !== null && o.value.approvedMinutes !== o.value.minutes);
/** The day split into regular hours, overtime counted and overtime claimed but not counted, as shares of the longer of worked and claimed. */
const bar = computed(() => {
  const worked = o.value.record?.workedMinutes ?? 0;
  const counted = o.value.status === 'REJECTED' ? 0 : (o.value.approvedMinutes ?? o.value.minutes);
  const whole = Math.max(worked, o.value.minutes, 1);
  const segments = [
    { key: 'regular', minutes: worked - o.value.minutes, class: 'bg-brand-500' },
    { key: 'counted', minutes: counted, class: 'bg-special' },
    { key: 'dropped', minutes: o.value.minutes - counted, class: 'bg-special/30' },
  ].filter((s) => s.minutes > 0);
  return { segments: segments.map((s) => ({ ...s, width: `${(s.minutes / whole) * 100}%` })), label: `${formatMinutes(Math.max(0, worked - o.value.minutes))} regular, ${formatMinutes(o.value.minutes)} overtime` };
});
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div :class="['flex items-start gap-3', selectable && 'ps-7']">
      <span class="flex w-11 shrink-0 flex-col items-center rounded-xl bg-special-soft py-1 text-special-fg" aria-hidden="true">
        <span class="text-2xs leading-3 font-semibold uppercase">{{ tile.month }}</span>
        <span class="text-lg leading-6 font-semibold tabular-nums">{{ tile.day }}</span>
      </span>
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm leading-snug font-semibold text-fg" :title="longDay(o.workDate)">{{ shortDay(o.workDate) }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted first-letter:uppercase">{{ relativeDay(o.workDate, today) }}</p>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-1">
        <AppBadge :tone="overtimeTone[o.status]" size="sm" dot>{{ OVERTIME_LABELS[o.status] }}</AppBadge>
        <span v-if="o.paidIn" class="max-w-32 truncate text-2xs text-fg-subtle">paid in {{ o.paidIn }}</span>
        <span v-else-if="o.reviewedBy" class="max-w-32 truncate text-2xs text-fg-subtle">by {{ o.reviewedBy }}</span>
      </div>
    </div>

    <div class="flex items-end justify-between gap-3">
      <div>
        <p class="text-2xs text-fg-subtle">{{ o.status === 'APPROVED' ? 'Overtime approved' : 'Overtime claimed' }}</p>
        <p :class="['text-2xl leading-8 font-semibold tabular-nums', o.status === 'REJECTED' ? 'text-fg-subtle line-through' : 'text-fg']">{{ formatMinutes(o.approvedMinutes ?? o.minutes) }}</p>
        <p v-if="partial" class="text-2xs text-fg-muted tabular-nums">of {{ formatMinutes(o.minutes) }} claimed</p>
      </div>
      <div class="text-end">
        <p class="text-2xs text-fg-subtle">Punched</p>
        <p class="text-sm font-medium text-fg tabular-nums">{{ formatTime(o.record?.checkInAt) }}–{{ formatTime(o.record?.checkOutAt) }}</p>
        <p class="text-2xs text-fg-muted tabular-nums">{{ formatMinutes(o.record?.workedMinutes) }} worked</p>
      </div>
    </div>

    <div>
      <div class="flex h-2 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="bar.label">
        <span v-for="s in bar.segments" :key="s.key" :class="['h-full border-e-2 border-surface last:border-e-0', s.class]" :style="{ width: s.width }" />
      </div>
      <ul class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-muted" aria-hidden="true">
        <li class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-brand-500" />Regular</li>
        <li class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-special" />Overtime</li>
        <li v-if="o.status === 'REJECTED' || partial" class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-special/30" />Not counted</li>
      </ul>
    </div>

    <p v-if="o.status === 'PENDING' && blocksClose" class="-mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-warning-soft px-2 py-1 text-xs text-warning-fg" :title="`Blocks closing ${monthLabel(o.workDate.slice(0, 7))}`">
      <Lock :size="12" aria-hidden="true" />Holding up the {{ tile.month }} close
    </p>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <AppAvatar :name="o.employee?.name ?? '?'" size="sm" />
      <div class="min-w-0 flex-1">
        <RouterLink v-if="o.employee && to" :to="to" class="block truncate text-xs font-medium text-fg hover:text-accent-fg hover:underline" @click.stop>{{ o.employee.name }}</RouterLink>
        <p v-else class="truncate text-xs font-medium text-fg">{{ o.employee?.name ?? 'Unknown employee' }}</p>
        <p class="truncate text-2xs text-fg-subtle">{{ o.employee?.employeeCode }}</p>
      </div>
      <template v-if="o.permissions.review">
        <AppButton size="xs" variant="secondary" :icon="X" @click.stop="emit('reject')">Reject</AppButton>
        <AppButton size="xs" :icon="Check" @click.stop="emit('approve')">Approve</AppButton>
      </template>
    </div>
  </div>
</template>
