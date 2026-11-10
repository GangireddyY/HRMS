<script setup lang="ts">
import { appLocale } from '@/core/locale/locale';
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import AppButton from '@/shared/components/forms/AppButton.vue';
import { localToday } from '@/shared/utils/dates';

/**
 * Month grid in the style of a calendar app: hairline cells, the day number in a circle (filled for today), days of
 * the neighbouring months greyed, and whatever the page puts in the `day` slot (usually `AppCalendarEvent` chips).
 * Weeks start on Monday. With `navigable` it draws its own toolbar (title, Today, previous / next).
 */
const props = withDefaults(
  defineProps<{
    /** `YYYY-MM`. */
    month: string;
    /** `YYYY-MM-DD`; defaults to the browser's date. */
    today?: string;
    selected?: string | null;
    /** Days are buttons that emit `select`. */
    selectable?: boolean;
    /** Days that can't be selected (and are drawn dimmed). */
    isDisabled?: (iso: string) => boolean;
    /** Days drawn on a shaded background, e.g. weekly offs and holidays; defaults to Saturday and Sunday. */
    isMuted?: (iso: string) => boolean;
    navigable?: boolean;
    ariaLabel?: string;
  }>(),
  { today: undefined, selected: null, isDisabled: undefined, isMuted: undefined, ariaLabel: undefined },
);
const emit = defineEmits<{ select: [iso: string]; prev: []; next: []; today: [] }>();

const todayIso = computed(() => props.today ?? localToday());
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

const title = computed(() => new Intl.DateTimeFormat(appLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(utc(`${props.month}-01`)));
const weekdays = computed(() => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(appLocale(), { weekday: 'short', timeZone: 'UTC' }).format(utc(addDays('2024-01-01', i)))));
const shortMonth = (iso: string) => new Intl.DateTimeFormat(appLocale(), { month: 'short', timeZone: 'UTC' }).format(utc(iso));

/** As many weeks as the month spans (4–6), from the Monday on or before the 1st. */
const weeks = computed(() => {
  const first = `${props.month}-01`;
  const start = addDays(first, -((weekday(first) + 6) % 7));
  const out: { iso: string; inMonth: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const week = Array.from({ length: 7 }, (_, d) => {
      const iso = addDays(start, w * 7 + d);
      return { iso, inMonth: iso.slice(0, 7) === props.month };
    });
    if (w > 0 && !week[0]!.inMonth) break;
    out.push(week);
  }
  return out;
});
const muted = (iso: string) => (props.isMuted ? props.isMuted(iso) : [0, 6].includes(weekday(iso)));
const fullLabel = (iso: string) => new Intl.DateTimeFormat(appLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(utc(iso));
const isCurrentMonth = computed(() => todayIso.value.slice(0, 7) === props.month);
</script>

<template>
  <div>
    <div v-if="navigable || $slots.toolbar" class="mb-3 flex flex-wrap items-center gap-2">
      <template v-if="navigable">
        <AppButton size="sm" variant="secondary" :disabled="isCurrentMonth" @click="emit('today')">Today</AppButton>
        <div class="flex items-center">
          <AppButton size="sm" variant="ghost" :icon="ChevronLeft" aria-label="Previous month" @click="emit('prev')" />
          <AppButton size="sm" variant="ghost" :icon="ChevronRight" aria-label="Next month" @click="emit('next')" />
        </div>
        <h3 class="me-auto text-lg font-semibold text-fg" aria-live="polite">{{ title }}</h3>
      </template>
      <slot name="toolbar" />
    </div>

    <div class="overflow-hidden rounded-md border border-line bg-surface" role="grid" :aria-label="ariaLabel ?? title">
      <div class="grid grid-cols-7 border-b border-line bg-surface-muted/50" role="row">
        <div v-for="(w, i) in weekdays" :key="i" role="columnheader" class="py-2 text-center text-2xs font-semibold tracking-wide text-fg-muted uppercase">
          <span class="sm:hidden">{{ w.charAt(0) }}</span><span class="max-sm:hidden">{{ w }}</span>
        </div>
      </div>
      <div v-for="(week, wi) in weeks" :key="wi" class="grid grid-cols-7" role="row">
        <component
          :is="selectable && !isDisabled?.(c.iso) ? 'button' : 'div'"
          v-for="(c, ci) in week"
          :key="c.iso"
          :type="selectable ? 'button' : undefined"
          role="gridcell"
          :aria-selected="selectable ? c.iso === selected : undefined"
          :aria-current="c.iso === todayIso ? 'date' : undefined"
          :aria-disabled="isDisabled?.(c.iso) || undefined"
          :class="[
            'group relative flex min-h-16 min-w-0 flex-col gap-0.5 p-1 text-start transition-colors sm:min-h-28 sm:p-1.5',
            ci < 6 && 'border-e border-line/70',
            wi < weeks.length - 1 && 'border-b border-line/70',
            !c.inMonth ? 'bg-surface-muted/40' : muted(c.iso) ? 'bg-surface-muted/50' : '',
            c.iso === selected && 'bg-accent-soft ring-2 ring-brand-500/60 ring-inset',
            selectable && !isDisabled?.(c.iso) && 'cursor-pointer hover:bg-accent-soft focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
            isDisabled?.(c.iso) && 'opacity-60',
          ]"
          @click="selectable && !isDisabled?.(c.iso) && emit('select', c.iso)"
        >
          <span class="flex justify-center">
            <span class="sr-only">{{ fullLabel(c.iso) }}</span>
            <span
              aria-hidden="true"
              :class="[
                'flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium tabular-nums transition',
                c.iso === todayIso ? 'bg-brand-600 font-semibold text-white shadow-xs' : c.inMonth ? 'text-fg group-hover:bg-surface-muted' : 'text-fg-subtle',
              ]"
            >
              {{ Number(c.iso.slice(8)) === 1 && !c.inMonth ? `${shortMonth(c.iso)} 1` : Number(c.iso.slice(8)) }}
            </span>
          </span>
          <div class="flex min-w-0 flex-col gap-0.5">
            <slot name="day" :date="c.iso" :in-month="c.inMonth" :is-today="c.iso === todayIso" />
          </div>
        </component>
      </div>
    </div>
    <slot name="legend" />
  </div>
</template>
