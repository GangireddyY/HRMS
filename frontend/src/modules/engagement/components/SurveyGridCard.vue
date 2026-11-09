<script setup lang="ts">
import { computed } from 'vue';
import { BarChart3, CalendarClock, ClipboardList, Globe, ListOrdered, Lock, Pencil, Rocket, ShieldCheck, Target, Trash2, UserRound } from '@lucide/vue';
import type { SurveyResults, SurveySummary } from '@/modules/engagement/types';
import { SURVEY_STATUS_LABELS, surveyTone } from '@/modules/engagement/utils/engagement-format';
import { AppBadge, AppButton } from '@/shared/components';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

/** A survey in the HR grid: who it asks and how, how many have answered, when it closes, and the next step. */
const props = defineProps<{ survey: SurveySummary; rate?: Pick<SurveyResults, 'audience' | 'responseRate' | 'hidden' | 'threshold'> }>();
const emit = defineEmits<{ results: []; edit: []; remove: []; close: []; open: [] }>();

const s = computed(() => props.survey);
const overdue = computed(() => s.value.status === 'OPEN' && !s.value.open);
const TILE = { OPEN: 'bg-success-soft text-success-fg', DRAFT: 'bg-surface-muted text-fg-muted', CLOSED: 'bg-warning-soft text-warning-fg' };
const responses = computed(() => s.value.responses ?? 0);
const pct = computed(() => (props.rate?.responseRate != null ? Math.min(100, props.rate.responseRate) : null));
const ring = computed(() => (pct.value === null ? 'stroke-transparent' : pct.value >= 70 ? 'stroke-success' : pct.value >= 40 ? 'stroke-brand-500' : 'stroke-warning'));
const C = 2 * Math.PI * 15;
const left = computed(() => (s.value.closesAt ? Math.ceil((new Date(s.value.closesAt).getTime() - Date.now()) / 86_400_000) : null));
const timing = computed(() => {
  const v = s.value;
  if (v.status === 'DRAFT') return { text: `Drafted ${timeAgo(v.createdAt)}`, tone: 'text-fg-muted' };
  if (v.status === 'CLOSED') return { text: `Closed ${timeAgo(v.closedAt ?? v.closesAt)}`, tone: 'text-fg-muted' };
  if (overdue.value) return { text: 'Past its closing time', tone: 'font-medium text-warning-fg' };
  if (left.value === null) return { text: 'No closing date', tone: 'text-fg-muted' };
  return { text: left.value <= 1 ? 'Closes within a day' : `Closes in ${left.value} days`, tone: left.value <= 3 ? 'font-medium text-warning-fg' : 'text-fg-muted' };
});
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <span :class="['grid h-11 w-11 shrink-0 place-items-center rounded-xl', TILE[s.status]]" aria-hidden="true"><ClipboardList :size="19" /></span>
      <div class="min-w-0 flex-1">
        <h3 class="line-clamp-2 text-sm leading-snug font-semibold text-fg">{{ s.title }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted">{{ s.openedAt ? `Opened ${timeAgo(s.openedAt)}` : 'Not sent yet' }}</p>
      </div>
      <AppBadge class="shrink-0" :tone="overdue ? 'warning' : surveyTone[s.status]" size="sm" dot>{{ overdue ? 'Past closing' : SURVEY_STATUS_LABELS[s.status] }}</AppBadge>
    </div>

    <ul class="flex flex-wrap gap-1.5 text-xs" aria-label="Survey details">
      <li :class="['inline-flex items-center gap-1 rounded-md px-2 py-1', s.anonymous ? 'bg-special-soft text-special-fg' : 'bg-surface-muted text-fg-muted']">
        <component :is="s.anonymous ? Lock : UserRound" :size="12" aria-hidden="true" />{{ s.anonymous ? 'Anonymous' : 'Named' }}
      </li>
      <li class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-fg-muted"><ListOrdered :size="12" aria-hidden="true" />{{ s.questions }} question{{ s.questions === 1 ? '' : 's' }}</li>
      <li class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-fg-muted">
        <component :is="s.departmentIds?.length ? Target : Globe" :size="12" aria-hidden="true" />{{ s.departmentIds?.length ? `${s.departmentIds.length} department${s.departmentIds.length === 1 ? '' : 's'}` : 'Everyone' }}
      </li>
    </ul>

    <p v-if="s.description" class="line-clamp-2 text-xs leading-relaxed text-fg-muted" :title="s.description">{{ s.description }}</p>

    <p v-if="s.status === 'DRAFT'" class="rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-fg-subtle">Open the survey to notify its audience and start collecting answers.</p>
    <div v-else class="flex items-center gap-3 rounded-lg bg-surface-muted/50 px-3 py-2.5">
      <div class="relative h-12 w-12 shrink-0">
        <svg class="h-full w-full -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="15" fill="none" stroke-width="4" class="stroke-line/70" />
          <circle v-if="pct" cx="18" cy="18" r="15" fill="none" stroke-width="4" stroke-linecap="round" :class="ring" :stroke-dasharray="`${(pct / 100) * C} ${C}`" />
        </svg>
        <span class="absolute inset-0 grid place-items-center text-2xs font-semibold text-fg tabular-nums">{{ pct === null ? '—' : `${pct}%` }}</span>
      </div>
      <div class="min-w-0 flex-1 text-xs">
        <p class="text-fg-muted">
          <span class="font-semibold text-fg tabular-nums">{{ responses }}</span><template v-if="rate"> of <span class="tabular-nums">{{ rate.audience }}</span></template> responded
        </p>
        <p v-if="rate?.hidden" class="mt-0.5 flex items-center gap-1 text-2xs text-info-fg"><ShieldCheck :size="11" class="shrink-0" aria-hidden="true" />Results unlock at {{ rate.threshold }}</p>
        <p v-else-if="rate && s.status === 'OPEN'" class="mt-0.5 text-2xs text-fg-subtle tabular-nums">{{ Math.max(0, rate.audience - responses) }} yet to answer</p>      </div>
      <span class="sr-only">{{ pct === null ? '' : `Response rate ${pct}%` }}</span>
    </div>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <p :class="['flex min-w-0 flex-1 items-center gap-1 text-xs', timing.tone]" :title="s.closesAt ? `Closes ${formatDateTime(s.closesAt)}` : undefined">
        <CalendarClock :size="12" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ timing.text }}</span>
      </p>
      <AppButton v-if="s.status !== 'CLOSED'" size="xs" variant="ghost" :icon="Pencil" :aria-label="`Edit ${s.title}`" title="Edit" @click.stop="emit('edit')" />
      <AppButton v-if="s.status === 'DRAFT'" size="xs" variant="ghost" :icon="Trash2" :aria-label="`Delete ${s.title}`" title="Delete" @click.stop="emit('remove')" />
      <AppButton v-if="s.status === 'OPEN'" size="xs" variant="ghost" :icon="Lock" :aria-label="`Close ${s.title}`" title="Close" @click.stop="emit('close')" />
      <AppButton v-if="s.status !== 'DRAFT'" size="xs" variant="secondary" :icon="BarChart3" @click.stop="emit('results')">Results</AppButton>
      <AppButton v-if="s.status === 'DRAFT'" size="xs" :icon="Rocket" @click.stop="emit('open')">Open</AppButton>
    </div>
  </div>
</template>
