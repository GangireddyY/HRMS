<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight, CheckCircle2, MessageSquareText, Send, XCircle } from '@lucide/vue';
import type { HikeStatus } from '@contracts';
import RatingChip from '@/modules/performance/components/RatingChip.vue';
import type { HikeRow } from '@/modules/performance/types';
import { HIKE_STATUS_LABELS, hikeTone } from '@/modules/performance/utils/performance-format';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAvatar, AppBadge, AppButton } from '@/shared/components';

/**
 * A salary increase in the grid: the employee and rating, the recommended increase against the merit guideline, the
 * CTC before and after (where the viewer may see salaries), the decision and the row's actions.
 * `scale` is the page's shared guideline scale (in %), so the bars compare across cards.
 */
const props = defineProps<{ row: HikeRow; labels: string[]; showMoney: boolean; scale: number; busy: boolean }>();
const emit = defineEmits<{ recommend: []; submit: []; approve: []; reject: [] }>();

const r = computed(() => props.row);
const rec = computed(() => r.value.recommendation);
const g = computed(() => r.value.guideline);
const subtitle = computed(() => [r.value.employee.designation, r.value.employee.department].filter(Boolean).join(' · ') || r.value.employee.employeeCode);
const range = computed(() => (g.value.max === 0 ? 'No increase' : `${g.value.min}–${g.value.max}% · target ${g.value.target}%`));
const at = (p: number) => `${Math.min(100, (p / props.scale) * 100)}%`;
const raise = computed(() => (rec.value?.newCtc && r.value.currentCtc ? rec.value.newCtc - r.value.currentCtc : null));
const figureTone = computed(() => (!rec.value || rec.value.status === 'REJECTED' ? 'text-fg-muted' : rec.value.percent > 0 ? 'text-success-fg' : 'text-fg'));
const canSubmit = computed(() => r.value.permissions.edit && !!rec.value && (rec.value.status === 'DRAFT' || rec.value.status === 'REJECTED'));
const DECIDED: Partial<Record<HikeStatus, string>> = { APPROVED: 'Approved by', REJECTED: 'Sent back by', APPLIED: 'Approved by' };
const who = computed(() => {
  const x = rec.value;
  if (x?.decidedBy) return { label: DECIDED[x.status] ?? 'Decided by', name: x.decidedBy };
  return x?.recommendedBy ? { label: 'Recommended by', name: x.recommendedBy } : null;
});
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <AppAvatar :name="r.employee.name" size="md" />
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm font-semibold text-fg">{{ r.employee.name }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted" :title="subtitle">{{ subtitle }}</p>
      </div>
      <AppBadge v-if="rec" class="shrink-0" :tone="hikeTone[rec.status]" size="sm" dot>{{ HIKE_STATUS_LABELS[rec.status] }}</AppBadge>
      <AppBadge v-else class="shrink-0" size="sm">Not recommended</AppBadge>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <RatingChip :rating="r.rating" :labels="labels" />
      <AppBadge v-if="rec?.promotion" tone="violet" size="sm">Promotion</AppBadge>
      <AppBadge v-if="rec?.outsideGuideline" tone="warning" size="sm" :title="rec.justification ?? undefined">Outside guideline</AppBadge>
    </div>

    <div class="rounded-lg bg-surface-muted/50 px-3 py-2.5">
      <div class="flex items-end justify-between gap-3">
        <div class="shrink-0">
          <p class="text-2xs text-fg-subtle">Increase</p>
          <p v-if="rec" :class="['text-2xl leading-8 font-semibold tracking-tight tabular-nums', figureTone]">+{{ rec.percent }}%</p>
          <p v-else class="text-sm leading-8 text-fg-subtle">Not recommended yet</p>
        </div>
        <div v-if="showMoney" class="min-w-0 text-end text-xs tabular-nums">
          <template v-if="r.currentCtc === null"><p class="text-fg-subtle">No salary on file</p></template>
          <template v-else>
            <p class="truncate text-fg-muted"><span class="sr-only">Current CTC </span>{{ rupees(r.currentCtc) }}</p>
            <p v-if="rec?.newCtc" class="flex items-center justify-end gap-1 font-semibold text-fg">
              <ArrowRight :size="12" class="shrink-0 text-fg-subtle" aria-hidden="true" /><span class="sr-only">New CTC </span><span class="truncate">{{ rupees(rec.newCtc) }}</span>
            </p>
            <p v-if="raise && rec?.status !== 'REJECTED'" class="text-2xs text-success-fg">+{{ rupees(raise) }} a year</p>
          </template>
        </div>
      </div>

      <div class="mt-3 border-t border-line/60 pt-2.5">
        <p class="mb-1.5 flex justify-between gap-2 text-2xs"><span class="text-fg-subtle">Guideline</span><span class="truncate text-fg-muted tabular-nums">{{ range }}</span></p>
        <div class="relative h-2 rounded-full bg-surface ring-1 ring-line/70 ring-inset" role="img" :aria-label="`Guideline ${range}${rec ? `; recommended ${rec.percent}%` : ''}`">
          <span v-if="g.max > 0" class="absolute inset-y-0 rounded-full bg-brand-500/25" :style="{ insetInlineStart: at(g.min), width: `calc(${at(g.max)} - ${at(g.min)})` }" />
          <span v-if="g.max > 0" class="absolute -inset-y-0.5 w-0.5 rounded-full bg-brand-600 dark:bg-brand-400" :style="{ insetInlineStart: at(g.target) }" />
          <span v-if="rec" :class="['absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface rtl:translate-x-1/2', rec.outsideGuideline ? 'bg-warning' : 'bg-fg']" :style="{ insetInlineStart: at(rec.percent) }" />
        </div>
      </div>
    </div>

    <p v-if="rec?.decisionNote" class="-mt-1 flex items-start gap-1.5 text-xs text-fg-muted">
      <MessageSquareText :size="13" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" /><span class="line-clamp-2">“{{ rec.decisionNote }}”</span>
    </p>

    <div class="mt-auto flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
      <div class="min-w-0 flex-1 basis-24">
        <template v-if="who">
          <p class="text-2xs text-fg-subtle">{{ who.label }}</p>
          <p class="truncate text-xs font-medium text-fg" :title="who.name">{{ who.name }}</p>
        </template>
        <p v-else class="text-2xs text-fg-subtle">Waiting for the reviewer</p>
      </div>
      <div v-if="r.permissions.edit || r.permissions.decide" class="flex shrink-0 flex-wrap justify-end gap-1.5">
        <AppButton v-if="r.permissions.edit" size="xs" variant="secondary" @click.stop="emit('recommend')">{{ rec ? 'Edit' : 'Recommend' }}</AppButton>
        <AppButton v-if="canSubmit" size="xs" :icon="Send" :disabled="busy" @click.stop="emit('submit')">Submit</AppButton>
        <template v-if="r.permissions.decide">
          <AppButton size="xs" variant="secondary" :icon="XCircle" @click.stop="emit('reject')">Reject</AppButton>
          <AppButton size="xs" :icon="CheckCircle2" @click.stop="emit('approve')">Approve</AppButton>
        </template>
      </div>
    </div>
  </div>
</template>
