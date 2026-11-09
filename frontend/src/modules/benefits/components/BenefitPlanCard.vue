<script setup lang="ts">
import { computed } from 'vue';
import { CalendarRange, Hourglass, Pencil, ShieldOff, ShieldPlus, Undo2 } from '@lucide/vue';
import type { Enrollment, MyPlan } from '@/modules/benefits/types';
import { BENEFIT_TYPE_VISUALS, daysUntil } from '@/modules/benefits/utils/benefit-visuals';
import { ENROLLMENT_STATUS_LABELS, LIFE_EVENT_LABELS, RELATION_LABELS, TYPE_LABELS, enrollmentTone, inr } from '@/modules/benefits/utils/benefits-format';
import { AppAlert, AppAvatar, AppBadge, AppButton } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/** One plan as the employee sees it: their cover, its monthly cost split, who it covers, the options and a pending change. */
const props = defineProps<{ plan: MyPlan; you: string }>();
const emit = defineEmits<{ enrol: []; waive: []; withdraw: [e: Enrollment] }>();

const p = computed(() => props.plan);
const visual = computed(() => BENEFIT_TYPE_VISUALS[p.value.type]);
const canChange = computed(() => !p.value.ineligible && p.value.options.length > 0);
const cost = computed(() => {
  const c = p.value.current;
  if (!c) return null;
  const total = c.employeeMonthly + c.employerMonthly;
  return { you: c.employeeMonthly, employer: c.employerMonthly, total, youPct: total ? Math.round((c.employeeMonthly / total) * 100) : 0 };
});
const daysLeft = computed(() => (p.value.window ? daysUntil(p.value.window.closesOn) : null));
const windowLabel = computed(() => (p.value.window?.kind === 'NEW_JOINER' ? 'New joiner enrolment' : 'Open enrolment'));
const left = (n: number) => (n <= 0 ? 'closes today' : `${n} day${n === 1 ? '' : 's'} left`);
const allowed = (o: MyPlan['options'][number]) =>
  o.maxDependents ? `You + up to ${o.maxDependents} (${o.allowedRelations.map((r) => RELATION_LABELS[r].toLowerCase()).join(', ')})` : 'Just you';
</script>

<template>
  <article class="card overflow-hidden" :aria-labelledby="`plan-${p.id}`">
    <header class="flex flex-wrap items-start gap-4 border-b border-line/70 px-5 py-4">
      <span :class="['flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', visual.tile]" aria-hidden="true"><component :is="visual.icon" :size="20" /></span>
      <div class="min-w-0 flex-1">
        <h2 :id="`plan-${p.id}`" class="text-base font-semibold text-fg">{{ p.name }}</h2>
        <p class="text-xs text-fg-muted">{{ [TYPE_LABELS[p.type], p.provider, p.policyNumber ? `Policy ${p.policyNumber}` : null].filter(Boolean).join(' · ') }}</p>
        <p class="mt-0.5 inline-flex items-center gap-1 text-xs text-fg-muted"><CalendarRange :size="12" aria-hidden="true" />Policy {{ formatDate(p.coverageStartsOn) }} – {{ formatDate(p.coverageEndsOn) }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <AppBadge v-if="p.mandatory" tone="info">Provided to everyone</AppBadge>
        <AppBadge v-if="p.window" tone="success" dot>{{ windowLabel }} until {{ formatDate(p.window.closesOn) }}</AppBadge>
        <AppBadge v-if="p.current" :tone="enrollmentTone[p.current.status]" dot>{{ ENROLLMENT_STATUS_LABELS[p.current.status] }}</AppBadge>
        <AppBadge v-else-if="p.waived" dot>Waived</AppBadge>
        <AppBadge v-else-if="!p.ineligible" tone="warning" dot>Not enrolled</AppBadge>
      </div>
    </header>

    <div class="space-y-5 p-5">
      <p v-if="p.description" class="text-sm whitespace-pre-line text-fg-muted">{{ p.description }}</p>
      <AppAlert v-if="p.ineligible" tone="warning">{{ p.ineligible }}.</AppAlert>

      <template v-if="p.current">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="rounded-xl bg-surface-muted/50 p-4 ring-1 ring-line ring-inset">
            <p class="text-2xs font-semibold tracking-wide text-fg-muted uppercase">Your cover</p>
            <p class="mt-1 text-lg font-semibold text-fg">{{ p.current.option?.name }}</p>
            <template v-if="p.current.coverageAmount">
              <p class="mt-3 text-xs text-fg-muted">Sum insured</p>
              <p class="text-2xl font-semibold tracking-tight text-fg tabular-nums">{{ inr(p.current.coverageAmount) }}</p>
            </template>
            <p class="mt-3 text-xs text-fg-muted">From {{ formatDate(p.current.effectiveFrom!) }}{{ p.current.effectiveTo ? ` until ${formatDate(p.current.effectiveTo)}` : '' }}</p>
          </div>
          <div v-if="cost" class="rounded-xl p-4 ring-1 ring-line ring-inset">
            <p class="text-2xs font-semibold tracking-wide text-fg-muted uppercase">Monthly cost</p>
            <p class="mt-1 text-lg font-semibold text-fg tabular-nums">{{ inr(cost.total) }}<span class="text-sm font-normal text-fg-muted"> / month</span></p>
            <div class="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
              <div class="h-full bg-brand-500" :style="{ width: `${cost.youPct}%` }" />
              <div class="h-full bg-violet-400 dark:bg-violet-500" :style="{ width: `${cost.total ? 100 - cost.youPct : 0}%` }" />
            </div>
            <dl class="mt-3 space-y-1.5 text-sm">
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                <dt class="flex-1 text-fg-muted">You pay <span class="text-2xs text-fg-subtle">· from your salary</span></dt>
                <dd class="font-medium text-fg tabular-nums">{{ cost.you ? inr(cost.you) : 'No cost to you' }}</dd>
              </div>
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 shrink-0 rounded-full bg-violet-400 dark:bg-violet-500" aria-hidden="true" />
                <dt class="flex-1 text-fg-muted">Your employer pays</dt>
                <dd class="font-medium text-fg tabular-nums">{{ inr(cost.employer) }}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div>
          <p class="mb-2 text-2xs font-semibold tracking-wide text-fg-muted uppercase">Who's covered · {{ 1 + p.current.dependents.length }}</p>
          <ul class="flex flex-wrap gap-2">
            <li class="inline-flex items-center gap-2 rounded-full bg-surface-muted/70 py-1 ps-1 pe-3 text-sm ring-1 ring-line ring-inset">
              <AppAvatar :name="you" size="xs" /><span class="font-medium text-fg">{{ you }}</span><span class="text-xs text-fg-muted">You</span>
            </li>
            <li v-for="d in p.current.dependents" :key="d.id" class="inline-flex items-center gap-2 rounded-full bg-surface-muted/70 py-1 ps-1 pe-3 text-sm ring-1 ring-line ring-inset">
              <AppAvatar :name="d.name" size="xs" /><span class="font-medium text-fg">{{ d.name }}</span><span class="text-xs text-fg-muted">{{ RELATION_LABELS[d.relationship] }}</span>
            </li>
          </ul>
        </div>
      </template>
      <div v-else-if="p.waived" class="flex items-center gap-3 rounded-xl bg-surface-muted/50 p-4 ring-1 ring-line ring-inset">
        <ShieldOff :size="18" class="shrink-0 text-fg-subtle" aria-hidden="true" />
        <p class="text-sm text-fg-muted">You waived this plan, so you aren't covered by it.</p>
      </div>
      <div v-else-if="!p.ineligible" class="flex items-center gap-3 rounded-xl border-2 border-dashed border-line p-4">
        <ShieldPlus :size="18" class="shrink-0 text-accent-fg" aria-hidden="true" />
        <p class="text-sm text-fg-muted">Not enrolled. <template v-if="canChange">Pick one of the options below to get covered.</template></p>
      </div>

      <div v-if="p.pending" class="rounded-xl bg-warning-soft p-4 ring-1 ring-warning/35 ring-inset">
        <div class="flex flex-wrap items-start gap-3">
          <Hourglass :size="16" class="mt-0.5 shrink-0 text-warning-fg" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <p class="text-2xs font-semibold tracking-wide text-warning-fg uppercase">Waiting for HR</p>
            <p class="font-medium text-fg">{{ p.pending.option?.name }}</p>
            <p class="text-sm text-fg-muted">
              From {{ formatDate(p.pending.effectiveFrom!) }}<template v-if="p.pending.lifeEvent"> · {{ LIFE_EVENT_LABELS[p.pending.lifeEvent] }} on {{ formatDate(p.pending.lifeEventDate!) }}</template>
            </p>
            <ul v-if="p.pending.dependents.length" class="mt-2 flex flex-wrap gap-1.5">
              <li v-for="d in p.pending.dependents" :key="d.id" class="rounded-full bg-surface/70 px-2.5 py-0.5 text-xs text-fg ring-1 ring-line ring-inset">{{ d.name }} <span class="text-fg-muted">· {{ RELATION_LABELS[d.relationship] }}</span></li>
            </ul>
          </div>
          <AppButton size="sm" variant="secondary" :icon="Undo2" @click="emit('withdraw', p.pending)">Withdraw request</AppButton>
        </div>
      </div>

      <div v-if="p.options.length && !p.ineligible">
        <p class="mb-2 text-2xs font-semibold tracking-wide text-fg-muted uppercase">Options in this plan</p>
        <ul class="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          <li
            v-for="o in p.options"
            :key="o.id"
            :class="['rounded-lg p-3 ring-1 ring-inset', p.current?.option?.id === o.id ? 'bg-accent-soft/60 ring-brand-500/40' : 'ring-line']"
          >
            <p class="flex items-center justify-between gap-2 text-sm font-medium text-fg">
              {{ o.name }}
              <AppBadge v-if="p.current?.option?.id === o.id" size="sm" tone="brand">Your choice</AppBadge>
              <AppBadge v-else-if="p.pending?.option?.id === o.id" size="sm" tone="warning">Requested</AppBadge>
            </p>
            <p v-if="o.coverageAmount" class="mt-0.5 text-sm font-semibold text-fg tabular-nums">{{ inr(o.coverageAmount) }} <span class="text-xs font-normal text-fg-muted">cover</span></p>
            <p class="mt-0.5 text-xs text-fg-muted tabular-nums">{{ o.employeeMonthly ? `You pay ${inr(o.employeeMonthly)}/month` : 'No cost to you' }} · employer {{ inr(o.employerMonthly) }}</p>
            <p class="text-2xs text-fg-subtle">{{ allowed(o) }}</p>
          </li>
        </ul>
      </div>
    </div>

    <footer v-if="canChange" class="flex flex-wrap items-center gap-3 border-t border-line/70 bg-surface-muted/50 px-5 py-3">
      <AppButton :icon="Pencil" @click="emit('enrol')">{{ p.current ? 'Change cover' : 'Enrol' }}</AppButton>
      <AppButton v-if="p.canWaive && !p.waived" variant="secondary" :icon="ShieldOff" @click="emit('waive')">Waive</AppButton>
      <span v-if="!p.window" class="text-xs text-fg-muted">Enrolment is closed — changes are possible within 30 days of a life event.</span>
      <span v-else-if="daysLeft !== null" class="ms-auto text-xs font-medium text-success-fg tabular-nums">{{ windowLabel }} · {{ left(daysLeft) }}</span>
    </footer>
  </article>
</template>
