<script setup lang="ts">
import { computed } from 'vue';
import { AlertCircle, ArrowRight, CalendarClock, CalendarRange, CheckCircle2, Repeat, Rocket, UsersRound } from '@lucide/vue';
import type { Cycle } from '@/modules/performance/types';
import { CYCLE_STATUS_LABELS, STAGE_LABELS, STAGE_ORDER, cycleTone } from '@/modules/performance/utils/performance-format';
import { STAGE_FILL, daysBetween, pct, plural, relativeDay, todayIso } from '@/modules/performance/utils/performance-ops';
import { AppBadge } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/** A review cycle in the grid: which phase it is in, how many reviews are done, its period and the next deadline. */
const props = defineProps<{ cycle: Cycle }>();

const c = computed(() => props.cycle);
const today = todayIso();
const total = computed(() => Object.values(c.value.stages).reduce((a, b) => a + b, 0));
const done = computed(() => c.value.stages.COMPLETED + c.value.stages.ACKNOWLEDGED);
const complete = computed(() => pct(done.value, total.value));
const elapsed = computed(() => Math.min(100, Math.max(0, pct(daysBetween(c.value.periodStart, today), daysBetween(c.value.periodStart, c.value.periodEnd)))));

const PHASES = ['Goals', 'Self-review', 'Manager', 'Calibration', 'Closed'];
/** Current phase: from the stage deadlines, or where the open reviews are when no deadlines are set. */
const phase = computed(() => {
  const x = c.value;
  if (x.status === 'DRAFT') return -1;
  if (x.status === 'CLOSED') return PHASES.length;
  if (x.resultsReleasedAt) return 4;
  const dues = [x.goalsDue, x.selfReviewDue, x.managerReviewDue];
  const next = dues.findIndex((d) => d && d >= today);
  if (next >= 0) return next;
  if (dues.some(Boolean) || !total.value || done.value === total.value) return 3;
  const s = x.stages;
  return s.GOAL_SETTING + s.GOAL_APPROVAL ? 0 : s.SELF_REVIEW ? 1 : 2;
});

/** The next deadline (or the latest one already missed), as on the spotlight cards. */
const deadline = computed(() => {
  const x = c.value;
  const s = x.stages;
  const dates = [
    { label: 'Goals', date: x.goalsDue, open: s.GOAL_SETTING + s.GOAL_APPROVAL },
    { label: 'Self-reviews', date: x.selfReviewDue, open: s.GOAL_SETTING + s.GOAL_APPROVAL + s.SELF_REVIEW },
    { label: 'Manager reviews', date: x.managerReviewDue, open: total.value - done.value },
  ].filter((d): d is { label: string; date: string; open: number } => !!d.date);
  const missed = dates.filter((d) => d.date < today && d.open > 0).at(-1);
  if (missed) return { ...missed, late: true };
  const upcoming = dates.find((d) => d.date >= today);
  return upcoming ? { ...upcoming, late: false } : null;
});
const footer = computed(() => {
  const x = c.value;
  if (x.status === 'ACTIVE' && deadline.value) {
    const d = deadline.value;
    return { icon: d.late ? AlertCircle : CalendarClock, text: `${d.label} ${d.late ? 'were due' : 'due'} ${relativeDay(d.date)}${d.late ? ` · ${d.open} open` : ''}`, tone: d.late ? 'font-medium text-danger-fg' : 'text-fg-muted' };
  }
  if (x.resultsReleasedAt) return { icon: CheckCircle2, text: `Results released ${formatDate(x.resultsReleasedAt)}`, tone: 'text-success-fg' };
  if (x.status === 'CLOSED' && x.closedAt) return { icon: CheckCircle2, text: `Closed ${formatDate(x.closedAt)}`, tone: 'text-fg-muted' };
  return { icon: CalendarClock, text: x.status === 'DRAFT' ? `Created ${formatDate(x.createdAt)}` : 'No deadlines set', tone: 'text-fg-muted' };
});

const tile = computed(() =>
  c.value.status === 'ACTIVE' ? 'bg-info-soft text-info-fg ring-info/15' : c.value.status === 'CLOSED' ? 'bg-success-soft text-success-fg ring-success/15' : 'bg-surface-muted text-fg-muted ring-line',
);
const subtitle = computed(() => c.value.description || `Goals ${c.value.goalsWeight}% · ${plural(c.value.competencies.length, 'competency', 'competencies')}`);
/** Completion ring: circumference of r=15. */
const C = 2 * Math.PI * 15;
const dash = computed(() => `${(complete.value / 100) * C} ${C}`);
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <span :class="['grid h-11 w-11 shrink-0 place-items-center rounded-xl ring-1 ring-inset', tile]" aria-hidden="true">
        <component :is="c.status === 'DRAFT' ? Rocket : c.status === 'CLOSED' ? CheckCircle2 : Repeat" :size="19" />
      </span>
      <div class="min-w-0 flex-1">
        <h3 class="line-clamp-2 text-sm leading-snug font-semibold text-fg">{{ c.name }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted">{{ subtitle }}</p>
      </div>
      <AppBadge class="shrink-0" :tone="cycleTone[c.status]" size="sm" dot>{{ CYCLE_STATUS_LABELS[c.status] }}</AppBadge>
    </div>

    <ol class="grid grid-cols-5 gap-1" aria-label="Cycle phases">
      <li v-for="(p, i) in PHASES" :key="p" class="min-w-0">
        <span
          :class="['block h-1.5 rounded-full', i < phase ? 'bg-success/70' : i === phase ? (deadline?.late ? 'bg-danger' : 'bg-brand-500') : 'bg-surface-muted ring-1 ring-line ring-inset']"
          aria-hidden="true"
        />
        <span :class="['mt-1.5 block truncate text-2xs', i === phase ? 'font-semibold text-fg' : i < phase ? 'text-fg-muted' : 'text-fg-subtle']">
          {{ p }}<span class="sr-only">{{ i < phase ? ' (done)' : i === phase ? ' (current)' : '' }}</span>
        </span>
      </li>
    </ol>

    <div v-if="total" class="flex items-center gap-3 rounded-lg bg-surface-muted/50 px-3 py-2.5">
      <div class="relative h-11 w-11 shrink-0">
        <svg viewBox="0 0 36 36" class="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="18" cy="18" r="15" fill="none" class="stroke-surface-muted" stroke-width="3.5" />
          <circle cx="18" cy="18" r="15" fill="none" :class="['transition-all', complete === 100 ? 'stroke-success' : 'stroke-brand-500']" stroke-width="3.5" :stroke-linecap="done ? 'round' : 'butt'" :stroke-dasharray="dash" />
        </svg>
        <span class="absolute inset-0 grid place-items-center text-2xs font-semibold text-fg tabular-nums">{{ complete }}%</span>
      </div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs text-fg-muted"><span class="font-semibold text-fg tabular-nums">{{ done }}</span> of {{ plural(total, 'review') }} complete</p>
        <div class="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-surface ring-1 ring-line/70 ring-inset" role="img" :aria-label="STAGE_ORDER.map((s) => `${STAGE_LABELS[s]}: ${c.stages[s]}`).join(', ')">
          <span v-for="s in STAGE_ORDER" v-show="c.stages[s]" :key="s" :class="['h-full border-e border-surface last:border-0', STAGE_FILL[s]]" :style="{ width: `${(c.stages[s] / total) * 100}%` }" />
        </div>
      </div>
    </div>
    <p v-else class="rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-fg-muted">
      {{ c.status === 'DRAFT' ? 'Not launched yet. Launching creates a review for everyone eligible.' : 'Nobody is in this cycle.' }}
    </p>

    <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
      <p class="flex items-center justify-between gap-2 text-2xs">
        <span class="flex items-center gap-1 text-fg-subtle"><CalendarRange :size="11" aria-hidden="true" />Review period</span>
        <span v-if="c.status === 'ACTIVE'" class="text-fg-muted">Ends {{ relativeDay(c.periodEnd) }}</span>
      </p>
      <p class="mt-0.5 truncate text-xs font-medium text-fg tabular-nums">{{ formatDate(c.periodStart) }} – {{ formatDate(c.periodEnd) }}</p>
      <div v-if="c.status === 'ACTIVE'" class="mt-2 h-1 overflow-hidden rounded-full bg-surface ring-1 ring-line/70 ring-inset" role="img" :aria-label="`${elapsed}% of the review period has passed`">
        <div class="h-full rounded-full bg-fg-subtle" :style="{ width: `${elapsed}%` }" />
      </div>
    </div>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3 text-xs">
      <component :is="footer.icon" :size="14" :class="['shrink-0', footer.tone]" aria-hidden="true" />
      <span :class="['min-w-0 flex-1 truncate', footer.tone]">{{ footer.text }}</span>
      <span class="inline-flex shrink-0 items-center gap-1 text-fg-muted" :title="total ? plural(total, 'participant') : 'No participants yet'">
        <UsersRound :size="13" aria-hidden="true" /><span class="font-medium text-fg tabular-nums">{{ total }}</span><span class="sr-only"> participants</span>
      </span>
      <ArrowRight :size="15" class="shrink-0 text-fg-subtle transition group-hover/card:translate-x-0.5 group-hover/card:text-accent-fg" aria-hidden="true" />
    </div>
  </div>
</template>
