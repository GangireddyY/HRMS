<script setup lang="ts">
import { computed } from 'vue';
import { BriefcaseBusiness, CalendarDays, Check, CircleDollarSign, ClipboardList, Hourglass, MapPin, Users, X } from '@lucide/vue';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import type { Requisition } from '@/modules/recruitment/types';
import { JOB_STATUS_LABELS, PIPELINE_ORDER, REASON_LABELS, REQUISITION_STATUS_LABELS, STAGE_LABELS, jobTone, money, requisitionTone, stageAccent } from '@/modules/recruitment/utils/recruitment-format';
import { daysSince, dueText, dueTone } from '@/modules/recruitment/utils/recruitment-ui';
import { AppAvatar, AppBadge, AppButton } from '@/shared/components';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** A requisition in the grid: the ask (role, seats, budget, date), where it is in approval, and the hiring it led to. */
const props = defineProps<{ requisition: Requisition; canManage: boolean }>();
const emit = defineEmits<{ approve: []; reject: []; openJob: [] }>();

const r = computed(() => props.requisition);
const pending = computed(() => r.value.status === 'PENDING_APPROVAL');
const waiting = computed(() => daysSince(r.value.submittedAt ?? r.value.createdAt));
const open = computed(() => !['FILLED', 'CANCELLED', 'REJECTED'].includes(r.value.status));
/** Lakh / crore shorthand so a CTC range fits the card: ₹24L – ₹34L. */
const short = (n: number | null) => {
  if (n === null) return '—';
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  return n >= 10_000_000 ? `₹${fmt(n / 10_000_000)}Cr` : n >= 100_000 ? `₹${fmt(n / 100_000)}L` : money(n);
};
const budget = computed(() => (r.value.budgetMin || r.value.budgetMax ? `${short(r.value.budgetMin)} – ${short(r.value.budgetMax)}` : null));
const budgetFull = computed(() => (budget.value ? `${money(r.value.budgetMin)} – ${money(r.value.budgetMax)}` : undefined));
const total = computed(() => Object.values(r.value.job?.pipeline ?? {}).reduce((n, v) => n + (v ?? 0), 0));
const pipelineText = computed(() =>
  r.value.job ? Object.entries(r.value.job.pipeline).map(([s, n]) => `${n} ${STAGE_LABELS[s as keyof typeof STAGE_LABELS].toLowerCase()}`).join(', ') || 'No candidates yet' : '',
);
const tile = computed(() =>
  pending.value ? 'bg-warning-soft text-warning-fg' : r.value.status === 'REJECTED' ? 'bg-danger-soft text-danger-fg' : r.value.status === 'FILLED' ? 'bg-success-soft text-success-fg' : 'bg-accent-soft text-accent-fg',
);
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <span :class="['grid h-11 w-11 shrink-0 place-items-center rounded-xl', tile]" aria-hidden="true"><ClipboardList :size="19" /></span>
      <div class="min-w-0 flex-1">
        <h3 class="line-clamp-2 text-sm leading-snug font-semibold text-fg">{{ r.title }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted">
          <span class="font-mono">{{ r.code }}</span><template v-if="r.department"> · {{ r.department.name }}</template>
        </p>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-1">
        <AppBadge :tone="requisitionTone[r.status]" size="sm" dot>{{ REQUISITION_STATUS_LABELS[r.status] }}</AppBadge>
        <span v-if="pending" :class="['inline-flex items-center gap-1 text-2xs', waiting >= 3 ? 'font-medium text-warning-fg' : 'text-fg-subtle']">
          <Hourglass :size="10" aria-hidden="true" />{{ waiting === 0 ? 'Since today' : `${waiting} day${waiting === 1 ? '' : 's'}` }}
        </span>
        <span v-else-if="r.reviewedBy" class="max-w-28 truncate text-2xs text-fg-subtle">by {{ r.reviewedBy }}</span>
      </div>
    </div>

    <ul class="flex flex-wrap gap-1.5 text-xs" aria-label="Requisition details">
      <li class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-fg-muted"><Users :size="12" aria-hidden="true" />{{ r.openings }} {{ r.openings === 1 ? 'opening' : 'openings' }}</li>
      <li v-if="r.location" class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-fg-muted"><MapPin :size="12" aria-hidden="true" />{{ r.location.name }}</li>
      <li class="rounded-md bg-surface-muted px-2 py-1 text-fg-muted">{{ REASON_LABELS[r.reason] }}</li>
      <li class="rounded-md bg-surface-muted px-2 py-1 text-fg-muted">{{ EMPLOYMENT_TYPE_LABELS[r.employmentType] }}</li>
    </ul>

    <dl class="grid grid-cols-2 gap-2">
      <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
        <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><CircleDollarSign :size="11" aria-hidden="true" />Budget (CTC)</dt>
        <dd :class="['mt-0.5 truncate text-xs font-medium tabular-nums', budget ? 'text-fg' : 'text-fg-subtle']" :title="budgetFull">{{ budget ?? 'Not set' }}</dd>
      </div>
      <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
        <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><CalendarDays :size="11" aria-hidden="true" />Needed by</dt>
        <dd v-if="r.targetDate" :class="['mt-0.5 truncate text-xs font-medium', open ? dueTone(r.targetDate) : 'text-fg']">
          {{ formatDate(r.targetDate) }}<template v-if="open"> · {{ dueText(r.targetDate).toLowerCase() }}</template>
        </dd>
        <dd v-else class="mt-0.5 text-xs text-fg-subtle">No date</dd>
      </div>
    </dl>

    <!-- Hiring against it -->
    <div v-if="r.job" class="rounded-lg border border-line/70 px-3 py-2.5">
      <div class="flex items-center gap-2 text-xs">
        <BriefcaseBusiness :size="13" class="text-fg-subtle" aria-hidden="true" />
        <AppBadge :tone="jobTone[r.job.status]" size="sm">Job {{ JOB_STATUS_LABELS[r.job.status].toLowerCase() }}</AppBadge>
        <span class="ms-auto text-fg-muted tabular-nums">{{ total }} candidate{{ total === 1 ? '' : 's' }}</span>
        <span class="text-fg-muted tabular-nums">· {{ r.hiredCount }}/{{ r.openings }} hired</span>
      </div>
      <div class="mt-2 flex h-1.5 overflow-hidden rounded-full bg-surface-muted" :title="pipelineText" aria-hidden="true">
        <div v-for="s in PIPELINE_ORDER" :key="s" :class="stageAccent[s]" :style="{ width: `${total ? ((r.job.pipeline[s] ?? 0) / total) * 100 : 0}%` }" />
      </div>
      <span class="sr-only">{{ pipelineText }}</span>
    </div>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <AppAvatar v-if="r.requestedBy" :name="r.requestedBy" size="sm" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs font-medium text-fg">{{ r.requestedBy ?? 'A team member' }}</p>
        <p class="truncate text-2xs text-fg-subtle">Raised {{ timeAgo(r.submittedAt ?? r.createdAt) }}</p>
      </div>
      <template v-if="r.permissions.decide">
        <AppButton size="xs" variant="secondary" :icon="X" @click.stop="emit('reject')">Reject</AppButton>
        <AppButton size="xs" :icon="Check" @click.stop="emit('approve')">Approve</AppButton>
      </template>
      <AppButton v-else-if="r.status === 'APPROVED' && !r.job && canManage" size="xs" variant="outline" :icon="BriefcaseBusiness" @click.stop="emit('openJob')">Open job</AppButton>
    </div>
  </div>
</template>
