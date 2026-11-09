<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Lock, UserX } from '@lucide/vue';
import type { CaseRow } from '@/modules/grievance/types';
import { CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS, priorityTone, statusTone } from '@/modules/grievance/utils/grievance-format';
import { CATEGORY_VISUALS, SLA_BAR, SLA_TEXT, caseSla, daysBetween, isOpenCase, plural, todayIso } from '@/modules/grievance/utils/case-sla';
import { AppAvatar, AppBadge } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/** A grievance case in the queue grid: what it is about, who raised it (only when the list shows it), its handler and the target date. */
const props = defineProps<{ grievance: CaseRow }>();

const c = computed(() => props.grievance);
const visual = computed(() => CATEGORY_VISUALS[c.value.category]);
const sla = computed(() => caseSla(c.value, todayIso()));
const open = computed(() => isOpenCase(c.value));
const age = computed(() => {
  const d = daysBetween(c.value.submittedOn, todayIso());
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${plural(d, 'day')} ago`;
});
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <span :class="['grid h-11 w-11 shrink-0 place-items-center rounded-xl ring-1 ring-inset', visual.tile]" aria-hidden="true"><component :is="visual.icon" :size="19" /></span>
      <div class="min-w-0 flex-1">
        <h3 class="line-clamp-2 text-sm leading-snug font-semibold text-fg">{{ c.subject }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted">
          <span class="font-mono text-2xs text-fg-subtle">{{ c.reference }}</span> · {{ CATEGORY_LABELS[c.category] }}
        </p>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-1">
        <AppBadge :tone="statusTone[c.status]" size="sm" dot>{{ STATUS_LABELS[c.status] }}</AppBadge>
        <AppBadge v-if="c.priority && c.priority !== 'MEDIUM'" :tone="priorityTone[c.priority]" size="sm">{{ PRIORITY_LABELS[c.priority] }}<span class="sr-only"> priority</span></AppBadge>
        <AppBadge v-if="c.posh" tone="violet" size="sm">POSH</AppBadge>
      </div>
    </div>

    <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
      <p class="text-2xs text-fg-subtle">Raised by</p>
      <div v-if="c.complainant" class="mt-1 flex min-w-0 items-center gap-2">
        <AppAvatar :name="c.complainant.name" size="xs" />
        <p class="min-w-0 truncate text-xs">
          <span class="font-medium text-fg">{{ c.complainant.name }}</span><template v-if="c.complainant.department"><span class="text-fg-muted"> · {{ c.complainant.department }}</span></template>
        </p>
      </div>
      <p v-else class="mt-0.5 flex items-center gap-1 text-xs text-fg-subtle"><Lock :size="11" aria-hidden="true" />Not shown</p>
    </div>

    <div>
      <p v-if="c.resolvedOn" class="flex items-center gap-1.5 text-xs font-medium text-success-fg"><CheckCircle2 :size="13" aria-hidden="true" />Resolved {{ formatDate(c.resolvedOn) }}</p>
      <template v-else-if="sla.state !== 'done'">
        <div class="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
          <span :class="['flex items-center gap-1 font-medium tabular-nums', SLA_TEXT[sla.state]]">
            <AlertTriangle v-if="sla.state === 'overdue'" :size="12" aria-hidden="true" /><CalendarClock v-else :size="12" aria-hidden="true" />{{ sla.text }}
          </span>
          <span class="text-2xs text-fg-subtle tabular-nums">Target {{ formatDate(c.dueOn) }}</span>
        </div>
        <span class="block h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
          <span :class="['block h-full rounded-full', SLA_BAR[sla.state]]" :style="{ width: `${sla.used}%` }" />
        </span>
      </template>
      <p v-else class="flex items-center gap-1.5 text-xs text-fg-muted"><CalendarClock :size="13" aria-hidden="true" />Target {{ formatDate(c.dueOn) }}</p>
    </div>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <template v-if="c.assignee">
        <AppAvatar :name="c.assignee.name" size="sm" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs font-medium text-fg">{{ c.assignee.name }}</p>
          <p class="truncate text-2xs text-fg-subtle">Handler · <span :title="formatDate(c.submittedOn)">raised {{ age }}</span></p>
        </div>
      </template>
      <template v-else>
        <span :class="['grid h-7 w-7 shrink-0 place-items-center rounded-full border border-dashed', open ? 'border-warning/60 text-warning-fg' : 'border-line text-fg-subtle']" aria-hidden="true"><UserX :size="13" /></span>
        <div class="min-w-0 flex-1">
          <p :class="['truncate text-xs font-medium', open ? 'text-warning-fg' : 'text-fg-muted']">Unassigned</p>
          <p class="truncate text-2xs text-fg-subtle"><span :title="formatDate(c.submittedOn)">Raised {{ age }}</span></p>
        </div>
      </template>
      <span class="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-accent-fg opacity-0 transition group-hover/card:opacity-100 group-focus-visible/card:opacity-100" aria-hidden="true">
        Open case <ChevronRight :size="13" />
      </span>
    </div>
  </div>
</template>
