<script setup lang="ts">
import { appLocale } from '@/core/locale/locale';
import { computed } from 'vue';

/**
 * One small month, for year views and calendar side panels: marked days get a tinted circle in their colour, `dots`
 * draws small dots under days, `range` shades the days currently shown elsewhere, today is filled. Weeks start on
 * Monday.
 */
const props = defineProps<{
  /** `YYYY-MM`. */
  month: string;
  today?: string;
  /** Day → colour and tooltip. */
  marks?: Map<string, { color: string; title: string }>;
  /** Day → up to three dot colours. */
  dots?: Map<string, string[]>;
  range?: { from: string; to: string };
  hideTitle?: boolean;
}>();
const emit = defineEmits<{ select: [iso: string] }>();

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const title = computed(() => new Intl.DateTimeFormat(appLocale(), { month: 'long', timeZone: 'UTC' }).format(utc(`${props.month}-01`)));
const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(appLocale(), { weekday: 'narrow', timeZone: 'UTC' }).format(utc(addDays('2024-01-01', i))));
const dayFormat = new Intl.DateTimeFormat(appLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fullLabel = (iso: string) => dayFormat.format(utc(iso));
const cells = computed(() => {
  const first = `${props.month}-01`;
  const start = addDays(first, -((utc(first).getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
});
const inRange = (d: string) => !!props.range && d >= props.range.from && d <= props.range.to;
</script>

<template>
  <section class="min-w-0">
    <h3 v-if="!hideTitle" class="mb-1.5 px-1 text-sm font-semibold text-fg">{{ title }}</h3>
    <div class="grid grid-cols-7 text-center">
      <span v-for="(w, i) in weekdays" :key="i" class="py-1 text-2xs font-medium text-fg-subtle" aria-hidden="true">{{ w }}</span>
      <template v-for="(d, i) in cells" :key="d">
        <span v-if="d.slice(0, 7) !== month && !range" class="h-7" aria-hidden="true" />
        <span
          v-else
          :class="[
            'relative flex h-8 items-center justify-center',
            inRange(d) && 'bg-accent-soft',
            inRange(d) && (!inRange(addDays(d, -1)) || i % 7 === 0) && 'rounded-s-full',
            inRange(d) && (!inRange(addDays(d, 1)) || i % 7 === 6) && 'rounded-e-full',
          ]"
        >
          <button
            type="button"
            :title="marks?.get(d)?.title"
            :aria-current="d === today ? 'date' : undefined"
            :class="[
              'flex h-7 w-7 items-center justify-center rounded-full text-xs tabular-nums transition focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
              d === today
                ? 'bg-brand-600 font-semibold text-white'
                : marks?.get(d)
                  ? 'font-semibold'
                  : d.slice(0, 7) !== month
                    ? 'text-fg-subtle hover:bg-surface-muted'
                    : [0, 6].includes(utc(d).getUTCDay())
                      ? 'text-fg-subtle hover:bg-surface-muted'
                      : 'text-fg hover:bg-surface-muted',
            ]"
            :style="
              d !== today && marks?.get(d)
                ? { backgroundColor: `color-mix(in oklab, ${marks.get(d)!.color} 18%, transparent)`, color: `color-mix(in oklab, ${marks.get(d)!.color} 70%, var(--app-text))` }
                : undefined
            "
            @click="emit('select', d)"
          >
            <span aria-hidden="true">{{ Number(d.slice(8)) }}</span>
            <span class="sr-only">{{ fullLabel(d) }}{{ marks?.get(d) ? `, ${marks.get(d)!.title}` : '' }}</span>
          </button>
          <span v-if="dots?.get(d)?.length" class="pointer-events-none absolute bottom-0.5 flex gap-px" aria-hidden="true">
            <span v-for="(c, ci) in dots.get(d)!.slice(0, 3)" :key="ci" class="h-1 w-1 rounded-full" :style="{ backgroundColor: c }" />
          </span>
        </span>
      </template>
    </div>
  </section>
</template>
