<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, History, Users } from '@lucide/vue';
import type { PolicySummary } from '@/modules/compliance/types';
import { POLICY_CATEGORY_LABELS, POLICY_STATUS_LABELS, policyTone } from '@/modules/compliance/utils/compliance-format';
import { POLICY_VISUALS, ackBar, ackPct, relativeDays } from '@/modules/compliance/utils/compliance-visuals';
import { AppBadge } from '@/shared/components';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** A policy in the library grid: category and version, status, how many have acknowledged it and when it is next reviewed. */
const props = defineProps<{ policy: PolicySummary }>();

const p = computed(() => props.policy);
const visual = computed(() => POLICY_VISUALS[p.value.category]);
const pct = computed(() => ackPct(p.value.stats));
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <span :class="['grid h-11 w-11 shrink-0 place-items-center rounded-xl ring-1 ring-inset', visual.tile]" aria-hidden="true"><component :is="visual.icon" :size="19" /></span>
      <div class="min-w-0 flex-1">
        <h3 class="line-clamp-2 text-sm leading-snug font-semibold text-fg">{{ p.title }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted">
          {{ POLICY_CATEGORY_LABELS[p.category] }}<template v-if="p.currentVersion"> · <span class="font-mono text-2xs">v{{ p.currentVersion.version }}</span></template>
        </p>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-1">
        <AppBadge :tone="policyTone[p.status]" size="sm" dot>{{ POLICY_STATUS_LABELS[p.status] }}</AppBadge>
        <AppBadge v-if="p.hasDraft && p.currentVersion" size="sm" tone="info">Draft changes</AppBadge>
      </div>
    </div>

    <p v-if="p.summary" class="line-clamp-2 text-xs leading-relaxed text-fg-muted" :title="p.summary">{{ p.summary }}</p>

    <div v-if="p.stats" class="rounded-lg border border-line/70 px-3 py-2.5">
      <div class="flex items-baseline justify-between gap-2 text-xs">
        <span class="flex items-center gap-1 font-medium text-fg-muted"><Users :size="12" aria-hidden="true" />Acknowledged</span>
        <span class="text-fg-subtle tabular-nums"><span class="font-semibold text-fg">{{ pct }}%</span> · {{ p.stats.acknowledged }}/{{ p.stats.audience }}</span>
      </div>
      <div
        class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        :aria-valuenow="pct"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`${p.title}: acknowledged`"
      >
        <div :class="['h-full rounded-full', ackBar(pct, p.stats.overdue)]" :style="{ width: `${Math.max(pct, p.stats.acknowledged ? 3 : 0)}%` }" />
      </div>
      <p v-if="p.stats.overdue" class="mt-1.5 flex items-center gap-1 text-2xs font-medium text-danger-fg">
        <AlertTriangle :size="11" aria-hidden="true" />{{ p.stats.overdue }} overdue<template v-if="p.stats.pending"><span class="font-normal text-fg-subtle"> · {{ p.stats.pending }} still to acknowledge</span></template>
      </p>
      <p v-else-if="p.stats.pending" class="mt-1.5 text-2xs text-fg-subtle tabular-nums">{{ p.stats.pending }} still to acknowledge</p>
      <p v-else class="mt-1.5 flex items-center gap-1 text-2xs text-success-fg"><CheckCircle2 :size="11" aria-hidden="true" />Everyone has acknowledged</p>
    </div>
    <p v-else class="flex items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-2 text-xs text-fg-subtle">
      <Users :size="12" aria-hidden="true" />{{ p.requiresAck ? 'Acknowledgement required' : 'Acknowledgement not required' }}
    </p>

    <dl class="grid grid-cols-2 gap-2">
      <div :class="['rounded-lg px-3 py-2', p.reviewDue ? 'bg-warning-soft' : 'bg-surface-muted/50']">
        <dt :class="['flex items-center gap-1 text-2xs', p.reviewDue ? 'text-warning-fg' : 'text-fg-subtle']"><CalendarClock :size="11" aria-hidden="true" />{{ p.reviewDue ? 'Review due' : 'Next review' }}</dt>
        <template v-if="p.nextReviewOn">
          <dd :class="['mt-0.5 truncate text-xs font-medium tabular-nums', p.reviewDue ? 'text-warning-fg' : 'text-fg']">{{ formatDate(p.nextReviewOn) }}</dd>
          <dd :class="['truncate text-2xs', p.reviewDue ? 'text-warning-fg/80' : 'text-fg-subtle']">{{ relativeDays(p.nextReviewOn) }}</dd>
        </template>
        <dd v-else class="mt-0.5 truncate text-xs text-fg-subtle">{{ p.reviewMonths ? '—' : 'No review cycle' }}</dd>
      </div>
      <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
        <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><History :size="11" aria-hidden="true" />Updated</dt>
        <dd class="mt-0.5 truncate text-xs font-medium text-fg" :title="formatDate(p.updatedAt)">{{ timeAgo(p.updatedAt) }}</dd>
      </div>
    </dl>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3 text-2xs text-fg-subtle">
      <span v-if="p.currentVersion?.publishedOn" class="min-w-0 truncate">Version {{ p.currentVersion.version }} published {{ formatDate(p.currentVersion.publishedOn) }}</span>
      <span v-else class="min-w-0 truncate">Not published yet</span>
      <span class="ms-auto inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-accent-fg opacity-0 transition group-hover/card:opacity-100 group-focus-visible/card:opacity-100" aria-hidden="true">
        Open policy <ChevronRight :size="13" />
      </span>
    </div>
  </div>
</template>
