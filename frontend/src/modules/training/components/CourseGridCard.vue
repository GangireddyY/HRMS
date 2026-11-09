<script setup lang="ts">
import { computed } from 'vue';
import { Award, CalendarClock, CalendarX2, ChevronRight, ClipboardCheck, Clock, Hand, Star } from '@lucide/vue';
import type { CourseCategory } from '@contracts';
import type { CourseRow } from '@/modules/training/types';
import { COURSE_VISUALS, DELIVERY_ICON, pct } from '@/modules/training/utils/course-visuals';
import { CATEGORY_LABELS, COURSE_STATUS_LABELS, DELIVERY_LABELS, courseTone, hours, isSessionBasedDelivery } from '@/modules/training/utils/training-format';
import { AppBadge } from '@/shared/components';

/** A course in the catalog grid: a cover tinted by category, how it's delivered, what it awards and how its learners are doing. */
const props = defineProps<{ course: CourseRow; showLearners: boolean }>();

const ACCENT: Record<CourseCategory, string> = {
  TECHNICAL: 'var(--status-info)',
  SOFT_SKILLS: 'var(--status-special)',
  LEADERSHIP: 'var(--status-warning)',
  COMPLIANCE: 'var(--status-success)',
  ONBOARDING: 'var(--status-away)',
  SAFETY: 'var(--status-caution)',
  OTHER: 'var(--status-neutral)',
};
const c = computed(() => props.course);
const accent = computed(() => ACCENT[c.value.category]);
const tint = (pctValue: number) => `color-mix(in oklab, ${accent.value} ${pctValue}%, var(--app-surface))`;
const cover = computed(() => ({
  backgroundImage: [`radial-gradient(120% 170% at 100% 0%, color-mix(in oklab, ${accent.value} 24%, transparent), transparent 62%)`, `linear-gradient(135deg, ${tint(15)}, ${tint(5)})`].join(', '),
}));
const ink = computed(() => ({ color: `color-mix(in oklab, ${accent.value} 78%, var(--app-text))` }));
const watermark = computed(() => ({ color: `color-mix(in oklab, ${accent.value} 28%, transparent)` }));

const learners = computed(() => (c.value.enrolled ?? 0) + (c.value.completed ?? 0));
const rate = computed(() => pct(c.value.completed ?? 0, learners.value));
const sessionBased = computed(() => isSessionBasedDelivery(c.value.delivery));
const noSession = computed(() => sessionBased.value && !c.value.upcomingSessions && c.value.status === 'PUBLISHED');
const how = computed(() =>
  sessionBased.value
    ? { icon: noSession.value || !c.value.upcomingSessions ? CalendarX2 : CalendarClock, text: c.value.upcomingSessions ? `${c.value.upcomingSessions} upcoming session${c.value.upcomingSessions === 1 ? '' : 's'}` : 'No upcoming session' }
    : c.value.hasAssessment
      ? { icon: ClipboardCheck, text: `Assessment · pass ${c.value.passMark}%` }
      : { icon: Hand, text: 'Mark as done' },
);
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="relative -mx-4 -mt-4 h-20 overflow-hidden border-b border-line/50" :style="cover" aria-hidden="true">
      <component :is="COURSE_VISUALS[c.category].icon" :size="88" :stroke-width="1.25" class="absolute -end-2 -bottom-5 -rotate-12" :style="watermark" />
      <span class="absolute end-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-2xs font-medium text-fg-muted shadow-xs backdrop-blur-sm">
        <component :is="DELIVERY_ICON[c.delivery]" :size="11" />{{ DELIVERY_LABELS[c.delivery] }}
      </span>
    </div>
    <div class="relative z-10 -mt-6 flex items-end justify-between gap-2">
      <span class="grid h-12 w-12 place-items-center rounded-xl bg-surface shadow-xs ring-1 ring-line/70" :style="ink" aria-hidden="true">
        <component :is="COURSE_VISUALS[c.category].icon" :size="22" />
      </span>
      <AppBadge class="mb-0.5" :tone="courseTone[c.status]" size="sm" dot>{{ COURSE_STATUS_LABELS[c.status] }}</AppBadge>
    </div>

    <h3 class="mt-3 line-clamp-2 text-sm leading-snug font-semibold text-fg">{{ c.title }}</h3>
    <p class="mt-0.5 truncate text-xs text-fg-muted">
      <span class="font-mono">{{ c.code }}</span> · {{ CATEGORY_LABELS[c.category] }}<template v-if="c.provider"> · {{ c.provider }}</template>
    </p>

    <ul class="mt-3 flex flex-wrap gap-1.5 text-2xs" aria-label="Course details">
      <li v-if="c.mandatory" class="inline-flex items-center gap-1 rounded-md bg-special-soft px-1.5 py-0.5 font-medium text-special-fg"><Star :size="11" aria-hidden="true" />Mandatory</li>
      <li v-if="c.durationHours" class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-fg-muted"><Clock :size="11" aria-hidden="true" />{{ hours(c.durationHours) }}</li>
      <li class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-fg-muted" :title="c.validityMonths ? `Certificate valid for ${c.validityMonths} months` : 'Certificate does not expire'">
        <Award :size="11" aria-hidden="true" />Certificate<template v-if="c.validityMonths"> · {{ c.validityMonths }} mo</template>
      </li>
    </ul>

    <div v-if="showLearners" class="mt-3">
      <div v-if="learners" class="rounded-lg bg-surface-muted/50 px-3 py-2.5">
        <div class="flex items-baseline justify-between gap-2 text-xs">
          <span class="text-fg-muted"><span class="font-semibold text-fg tabular-nums">{{ c.completed ?? 0 }}</span> of <span class="tabular-nums">{{ learners }}</span> completed</span>
          <span class="font-semibold text-fg tabular-nums">{{ rate }}%</span>
        </div>
        <div class="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`${rate}% completed, ${c.enrolled ?? 0} in progress or not started`">
          <span class="h-full bg-success" :style="{ width: `${rate}%` }" />
          <span class="h-full bg-info/45" :style="{ width: `${100 - rate}%` }" />
        </div>
        <p class="mt-1.5 text-2xs text-fg-subtle tabular-nums">{{ c.enrolled ? `${c.enrolled} learning now` : 'Everyone has finished' }}</p>
      </div>
      <p v-else class="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-fg-subtle">No learners yet</p>
    </div>

    <div class="mt-auto pt-3">
      <div class="flex items-center gap-2 border-t border-line/60 pt-3 text-xs">
        <span :class="['inline-flex min-w-0 flex-1 items-center gap-1.5', noSession ? 'font-medium text-warning-fg' : 'text-fg-muted']">
          <component :is="how.icon" :size="13" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ how.text }}</span>
        </span>
        <ChevronRight :size="16" class="shrink-0 text-fg-subtle transition group-hover/card:translate-x-0.5 group-hover/card:text-fg-muted rtl:rotate-180" aria-hidden="true" />
      </div>
    </div>
  </div>
</template>
