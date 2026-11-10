<script setup lang="ts">
import { computed } from 'vue';
import { BriefcaseBusiness, CalendarClock, CalendarOff, MapPin, Pencil, Trash2 } from '@lucide/vue';
import type { Holiday } from '@/modules/attendance/types';
import { holidayWhere } from '@/modules/attendance/utils/attendance-format';
import { dateTile, daysBetween, longDay, relativeDay } from '@/modules/attendance/utils/attendance-ops';
import { AppBadge, AppButton } from '@/shared/components';

/** A holiday in the grid as a calendar tile: the date, what it is, whether it's a day off, and how far away it is. */
const props = defineProps<{ holiday: Holiday; today: string; next?: boolean; canManage: boolean }>();
const emit = defineEmits<{ edit: []; remove: [] }>();

const h = computed(() => props.holiday);
const tile = computed(() => dateTile(h.value.date));
const until = computed(() => daysBetween(props.today, h.value.date));
const when = computed(() => (until.value === 0 ? 'Today' : relativeDay(h.value.date, props.today).replace(/^./, (c) => c.toUpperCase())));
const where = computed(() => holidayWhere(h.value));
const whereTitle = computed(() => (h.value.locations.length ? h.value.locations.map((l) => l.name).join(', ') : 'Every location'));
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3.5">
      <span :class="['flex w-14 shrink-0 flex-col overflow-hidden rounded-xl bg-surface text-center shadow-xs ring-1 ring-line', until < 0 && 'opacity-60']" aria-hidden="true">
        <span :class="['py-0.5 text-2xs font-semibold tracking-wide uppercase', h.isOptional ? 'bg-surface-muted text-fg-muted' : 'bg-special-soft text-special-fg']">{{ tile.month }}</span>
        <span class="py-1.5 text-2xl leading-7 font-semibold text-fg tabular-nums">{{ tile.day }}</span>
      </span>
      <div class="min-w-0 flex-1 pt-0.5">
        <h3 class="line-clamp-2 text-sm leading-snug font-semibold text-fg">{{ h.name }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted">{{ longDay(h.date) }}</p>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <AppBadge :tone="h.isOptional ? 'neutral' : 'violet'" size="sm">{{ h.isOptional ? 'Optional' : 'Public holiday' }}</AppBadge>
          <AppBadge v-if="next" tone="brand" size="sm" dot>Next up</AppBadge>
        </div>
        <p class="mt-2 flex items-center gap-1 text-xs text-fg-muted" :title="whereTitle">
          <MapPin :size="12" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ where }}</span>
        </p>
      </div>
    </div>

    <div class="mt-auto flex items-center gap-3 border-t border-line/60 pt-3 text-xs">
      <span :class="['inline-flex items-center gap-1', until < 0 ? 'text-fg-subtle' : until <= 7 ? 'font-medium text-accent-fg' : 'text-fg-muted']">
        <CalendarClock :size="13" aria-hidden="true" />{{ when }}
      </span>
      <span class="inline-flex min-w-0 items-center gap-1 truncate text-fg-subtle">
        <component :is="h.isOptional ? BriefcaseBusiness : CalendarOff" :size="12" class="shrink-0" aria-hidden="true" />{{ h.isOptional ? 'Working day' : 'Day off' }}
      </span>
      <div v-if="canManage" class="ms-auto flex shrink-0 gap-1">
        <AppButton size="xs" variant="ghost" :icon="Pencil" :aria-label="`Edit ${h.name}`" @click.stop="emit('edit')" />
        <AppButton size="xs" variant="ghost" :icon="Trash2" :aria-label="`Delete ${h.name}`" @click.stop="emit('remove')" />
      </div>
    </div>
  </div>
</template>
