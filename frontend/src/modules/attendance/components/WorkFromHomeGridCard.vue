<script setup lang="ts">
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { Check, Hourglass, X } from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import type { WorkFromHome } from '@/modules/attendance/types';
import { REGULARIZATION_LABELS, addDays, regularizationTone } from '@/modules/attendance/utils/attendance-format';
import { dateTile, daysBetween, plural, waiting } from '@/modules/attendance/utils/attendance-ops';
import { AppAvatar, AppBadge, AppButton } from '@/shared/components';

/** A work-from-home request in the approvals grid: the days asked for as a strip, why, and who is waiting on it. */
const props = defineProps<{ request: WorkFromHome; today: string; when: string; to?: RouteLocationRaw; selectable?: boolean }>();
const emit = defineEmits<{ approve: []; reject: [] }>();

const r = computed(() => props.request);
const tile = computed(() => dateTile(r.value.startDate));
const range = computed(() => {
  const f = new Intl.DateTimeFormat(appLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const day = (d: string) => new Date(`${d}T00:00:00Z`);
  return r.value.startDate === r.value.endDate ? f.format(day(r.value.startDate)) : f.formatRange(day(r.value.startDate), day(r.value.endDate));
});
const span = computed(() => daysBetween(r.value.startDate, r.value.endDate) + 1);
const wait = computed(() => waiting(r.value.createdAt));
const WAIT_TONE = { neutral: 'text-fg-subtle', warning: 'text-warning-fg', danger: 'font-medium text-danger-fg' };
/** One cell per day; past a week the strip ends in a "+N" cell. */
const days = computed(() => {
  const shown = span.value > 7 ? 6 : span.value;
  return Array.from({ length: shown }, (_, i) => {
    const iso = addDays(r.value.startDate, i);
    const t = dateTile(iso);
    return { iso, day: t.day, weekday: t.weekday, today: iso === props.today, past: iso < props.today };
  });
});
const muted = computed(() => r.value.status === 'REJECTED' || r.value.status === 'CANCELLED');
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div :class="['flex items-start gap-3', selectable && 'ps-7']">
      <span class="flex w-11 shrink-0 flex-col items-center rounded-xl bg-accent-soft py-1 text-accent-fg" aria-hidden="true">
        <span class="text-2xs leading-3 font-semibold uppercase">{{ tile.month }}</span>
        <span class="text-lg leading-6 font-semibold tabular-nums">{{ tile.day }}</span>
      </span>
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm leading-snug font-semibold text-fg">{{ range }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted first-letter:uppercase" :title="when">{{ plural(span, 'day') }} · {{ when }}</p>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-1">
        <AppBadge :tone="regularizationTone[r.status]" size="sm" dot>{{ REGULARIZATION_LABELS[r.status] }}</AppBadge>
        <span v-if="r.status === 'PENDING'" :class="['inline-flex items-center gap-1 text-2xs', WAIT_TONE[wait.tone]]"><Hourglass :size="10" aria-hidden="true" />Sent {{ wait.label }}</span>
        <span v-else-if="r.reviewedBy" class="max-w-32 truncate text-2xs text-fg-subtle">by {{ r.reviewedBy }}</span>
      </div>
    </div>

    <ol class="grid grid-cols-7 gap-1" aria-hidden="true">
      <li
        v-for="d in days"
        :key="d.iso"
        :class="[
          'flex flex-col items-center rounded-md py-1 leading-none',
          muted ? 'bg-surface-muted text-fg-subtle' : d.past ? 'bg-surface-muted text-fg-muted' : 'bg-accent-soft text-accent-fg',
          d.today && 'ring-1 ring-brand-500 ring-inset',
        ]"
      >
        <span class="text-2xs">{{ d.weekday }}</span>
        <span class="mt-1 text-xs font-semibold tabular-nums">{{ d.day }}</span>
      </li>
      <li v-if="span > 7" class="flex items-center justify-center rounded-md border border-dashed border-line text-2xs font-medium text-fg-muted">+{{ span - 6 }}</li>
    </ol>

    <blockquote class="line-clamp-2 border-s-2 border-line ps-3 text-xs leading-relaxed text-fg-muted" :title="r.reason">{{ r.reason }}</blockquote>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <AppAvatar :name="r.employee?.name ?? '?'" size="sm" />
      <div class="min-w-0 flex-1">
        <RouterLink v-if="r.employee && to" :to="to" class="block truncate text-xs font-medium text-fg hover:text-accent-fg hover:underline" @click.stop>{{ r.employee.name }}</RouterLink>
        <p v-else class="truncate text-xs font-medium text-fg">{{ r.employee?.name ?? 'Unknown employee' }}</p>
        <p class="truncate text-2xs text-fg-subtle">{{ r.employee?.employeeCode }}</p>
      </div>
      <template v-if="r.permissions.review">
        <AppButton size="xs" variant="secondary" :icon="X" @click.stop="emit('reject')">Reject</AppButton>
        <AppButton size="xs" :icon="Check" @click.stop="emit('approve')">Approve</AppButton>
      </template>
    </div>
  </div>
</template>
