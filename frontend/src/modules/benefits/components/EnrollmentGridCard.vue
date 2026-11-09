<script setup lang="ts">
import { computed } from 'vue';
import { CalendarDays, Check, CircleSlash, HeartHandshake, Hourglass, ShieldOff, Wallet, X } from '@lucide/vue';
import type { Enrollment } from '@/modules/benefits/types';
import { BENEFIT_TYPE_VISUALS } from '@/modules/benefits/utils/benefit-visuals';
import { ENROLLMENT_STATUS_LABELS, LIFE_EVENT_LABELS, REASON_LABELS, RELATION_LABELS, enrollmentTone, inr } from '@/modules/benefits/utils/benefits-format';
import { AppAvatar, AppBadge, AppButton } from '@/shared/components';
import { formatDate, timeAgo } from '@/shared/utils/format';

/**
 * A benefit enrolment in the grid: the plan and who chose it, the cover and dependants, cost, when it applies and the
 * HR decision. `selectable` keeps the top-start corner free for the bulk checkbox.
 */
const props = withDefaults(defineProps<{ enrollment: Enrollment; showPlan?: boolean; canManage: boolean; busy?: boolean; selectable?: boolean }>(), { showPlan: false, busy: false, selectable: false });
const emit = defineEmits<{ approve: []; reject: []; end: [] }>();

const e = computed(() => props.enrollment);
const name = computed(() => e.value.employee?.name ?? 'Unknown employee');
const visual = computed(() => BENEFIT_TYPE_VISUALS[e.value.plan.type ?? 'OTHER']);
const total = computed(() => e.value.employeeMonthly + e.value.employerMonthly);
const pending = computed(() => e.value.status === 'PENDING');
const waited = computed(() => Math.floor((Date.now() - new Date(e.value.createdAt).getTime()) / 86_400_000));
const footnote = computed(() => [props.showPlan && e.value.plan.name ? REASON_LABELS[e.value.reason] : null, !pending.value && e.value.decidedAt ? formatDate(e.value.decidedAt) : null].filter(Boolean).join(' · '));
const covered = computed(() => e.value.dependents.map((d) => `${d.name} (${RELATION_LABELS[d.relationship]})`).join(', '));
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div :class="['-mt-1 flex min-h-7 items-center gap-2', selectable && 'ps-8']">
      <span v-if="showPlan && e.plan.name" class="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg">
        <span :class="['grid h-6 w-6 shrink-0 place-items-center rounded-md ring-1 ring-inset', visual.tile]" aria-hidden="true"><component :is="visual.icon" :size="13" /></span>
        <span class="truncate" :title="[e.plan.name, e.plan.provider].filter(Boolean).join(' · ')">{{ e.plan.name }}</span>
      </span>
      <span v-else class="truncate text-xs text-fg-muted">{{ REASON_LABELS[e.reason] }}</span>
      <AppBadge class="ms-auto shrink-0" :tone="enrollmentTone[e.status]" size="sm" dot>{{ ENROLLMENT_STATUS_LABELS[e.status] }}</AppBadge>
    </div>

    <div class="flex items-center gap-3">
      <AppAvatar :name="name" size="md" />
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm font-semibold text-fg">{{ name }}</h3>
        <p class="truncate text-xs text-fg-muted">
          <span class="font-mono">{{ e.employee?.employeeCode }}</span><template v-if="e.employee?.department"> · {{ e.employee.department }}</template>
        </p>
      </div>
    </div>

    <p v-if="!e.option" class="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-fg-subtle">
      <ShieldOff :size="14" class="shrink-0" aria-hidden="true" />{{ e.status === 'WAIVED' ? 'Chose not to enrol in this plan' : 'No cover option' }}
    </p>
    <div v-else class="rounded-lg border border-line/70 px-3 py-2.5">
      <div class="flex items-baseline justify-between gap-2">
        <p class="min-w-0 truncate text-sm font-semibold text-fg">{{ e.option.name ?? '—' }}</p>
        <p v-if="e.coverageAmount" class="shrink-0 text-xs text-fg-muted tabular-nums"><span class="font-medium text-fg">{{ inr(e.coverageAmount) }}</span> cover</p>
      </div>
      <div v-if="e.dependents.length" class="mt-2 flex items-center gap-2" :title="covered">
        <span class="flex shrink-0 -space-x-1" aria-hidden="true">
          <AppAvatar :name="name" size="xs" class="ring-2 ring-surface" />
          <AppAvatar v-for="d in e.dependents.slice(0, 3)" :key="d.id" :name="d.name" size="xs" class="ring-2 ring-surface" />
        </span>
        <span class="min-w-0 truncate text-2xs text-fg-muted">
          +{{ e.dependents.length }} dependant{{ e.dependents.length === 1 ? '' : 's' }} · {{ [...new Set(e.dependents.map((d) => RELATION_LABELS[d.relationship].toLowerCase()))].join(', ') }}
        </span>
        <span class="sr-only">: {{ covered }}</span>
      </div>
      <p v-else class="mt-1 text-2xs text-fg-subtle">No dependants · covers {{ name.split(' ')[0] }} only</p>
    </div>

    <dl v-if="e.option || total || e.effectiveFrom" class="grid grid-cols-2 gap-2">
      <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
        <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><Wallet :size="11" aria-hidden="true" />Monthly cost</dt>
        <template v-if="total">
          <dd class="mt-0.5 truncate text-xs font-medium text-fg tabular-nums">{{ inr(total) }}</dd>
          <dd class="truncate text-2xs text-fg-muted tabular-nums">{{ e.employeeMonthly ? `${inr(e.employeeMonthly)} employee` : 'No cost to employee' }}</dd>
        </template>
        <dd v-else class="mt-0.5 text-xs text-fg-subtle">—</dd>
      </div>
      <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
        <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><CalendarDays :size="11" aria-hidden="true" />Effective</dt>
        <template v-if="e.effectiveFrom">
          <dd class="mt-0.5 truncate text-xs font-medium text-fg">{{ formatDate(e.effectiveFrom) }}</dd>
          <dd class="truncate text-2xs text-fg-muted">{{ e.effectiveTo ? `to ${formatDate(e.effectiveTo)}` : 'No end date' }}</dd>
        </template>
        <dd v-else class="mt-0.5 text-xs text-fg-subtle">Not set</dd>
      </div>
    </dl>

    <p v-if="e.lifeEvent" class="flex items-center gap-2 rounded-lg bg-special-soft px-2.5 py-1.5 text-xs text-special-fg">
      <HeartHandshake :size="13" class="shrink-0" aria-hidden="true" />
      <span class="min-w-0 truncate"><span class="font-medium">{{ LIFE_EVENT_LABELS[e.lifeEvent] }}</span><template v-if="e.lifeEventDate"> on {{ formatDate(e.lifeEventDate) }}</template></span>
    </p>
    <p v-if="e.status === 'REJECTED' && e.decisionNote" class="line-clamp-2 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs text-danger-fg" :title="e.decisionNote">“{{ e.decisionNote }}”</p>
    <p v-else-if="e.note" class="line-clamp-2 border-s-2 border-line ps-2.5 text-xs text-fg-muted italic" :title="e.note">“{{ e.note }}”</p>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <div class="min-w-0 flex-1">
        <p v-if="pending" :class="['flex items-center gap-1 truncate text-xs font-medium', waited >= 3 ? 'text-warning-fg' : 'text-fg-muted']" :title="formatDate(e.createdAt)">
          <Hourglass :size="12" class="shrink-0" aria-hidden="true" />Requested {{ timeAgo(e.createdAt) }}
        </p>
        <p v-else-if="e.decidedBy" class="truncate text-xs font-medium text-fg-muted">by {{ e.decidedBy }}</p>
        <p v-if="footnote" class="truncate text-2xs text-fg-subtle">{{ footnote }}</p>
      </div>
      <template v-if="canManage">
        <template v-if="pending">
          <AppButton size="xs" variant="secondary" :icon="X" :aria-label="`Reject ${name}'s enrolment`" @click.stop="emit('reject')">Reject</AppButton>
          <AppButton size="xs" :icon="Check" :loading="busy" :aria-label="`Approve ${name}'s enrolment`" @click.stop="emit('approve')">Approve</AppButton>
        </template>
        <AppButton v-else-if="e.status === 'ACTIVE'" size="xs" variant="ghost" :icon="CircleSlash" :aria-label="`End ${name}'s cover`" @click.stop="emit('end')">End cover</AppButton>
      </template>
    </div>
  </div>
</template>
