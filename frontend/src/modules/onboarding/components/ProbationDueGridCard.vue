<script setup lang="ts">
import { computed } from 'vue';
import { BadgeCheck, ClipboardCheck, Gavel, Hourglass, IdCard, Users } from '@lucide/vue';
import type { ProbationDue } from '@/modules/onboarding/types';
import { RECOMMENDATION_LABELS, daysFromToday, probationCountdown, probationCountdownTone, tenure } from '@/modules/onboarding/utils/onboarding-format';
import { AppAvatar, AppButton } from '@/shared/components';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** A probation ending soon, in the grid: who, how far through probation they are, and whether a recommendation is in. */
const props = defineProps<{ due: ProbationDue; canRecommend: boolean; canDecide: boolean }>();
const emit = defineEmits<{ review: []; decide: [] }>();

const d = computed(() => props.due);
const role = computed(() => [d.value.employee.designation?.name, d.value.employee.department?.name].filter(Boolean).join(' · ') || 'No role on file');
const elapsed = computed(() => Math.max(0, -daysFromToday(d.value.employee.dateOfJoining)));
const length = computed(() => elapsed.value + d.value.daysLeft);
const pct = computed(() => (length.value > 0 ? Math.min(100, Math.round((elapsed.value / length.value) * 100)) : 100));
const bar = computed(() => (d.value.daysLeft < 0 ? 'bg-danger' : d.value.daysLeft <= 14 ? 'bg-warning' : 'bg-brand-500'));
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <AppAvatar :name="d.employee.name" size="md" />
      <div class="min-w-0 flex-1">
        <RouterLink :to="`/hr/employees/${d.employee.id}`" class="block truncate text-sm font-semibold text-fg hover:underline" @click.stop>{{ d.employee.name }}</RouterLink>
        <p class="mt-0.5 truncate text-xs text-fg-muted" :title="role">{{ role }}</p>
      </div>
      <span :class="['shrink-0 rounded-full px-2 py-px text-2xs font-semibold whitespace-nowrap ring-1 ring-inset tabular-nums', probationCountdownTone(d.daysLeft)]">{{ probationCountdown(d.daysLeft) }}</span>
    </div>

    <ul class="flex flex-wrap gap-1.5 text-xs" aria-label="Employee details">
      <li v-if="d.isDirectReport" class="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-1 font-medium text-accent-fg"><Users :size="12" aria-hidden="true" />Your team</li>
      <li class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-fg-muted"><Hourglass :size="12" aria-hidden="true" />{{ tenure(d.employee.dateOfJoining) }}</li>
      <li class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 font-mono text-fg-muted"><IdCard :size="12" aria-hidden="true" />{{ d.employee.employeeCode }}</li>
    </ul>

    <div class="rounded-lg bg-surface-muted/50 px-3 py-2.5">
      <div class="mb-1.5 flex items-baseline justify-between text-xs">
        <span class="font-medium text-fg-muted">Probation</span>
        <span class="text-fg-subtle tabular-nums"><span class="font-semibold text-fg">{{ pct }}%</span> through</span>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-line/70" aria-hidden="true">
        <div :class="['h-full rounded-full', bar]" :style="{ width: `${pct}%` }" />
      </div>
      <span class="sr-only">{{ pct }}% of probation served, {{ probationCountdown(d.daysLeft) }}</span>
      <div class="mt-1.5 flex justify-between gap-2 text-2xs text-fg-subtle tabular-nums">
        <span>Joined <span class="font-medium text-fg-muted">{{ formatDate(d.employee.dateOfJoining) }}</span></span>
        <span>Ends <span class="font-medium text-fg-muted">{{ formatDate(d.probationEndDate) }}</span></span>
      </div>
    </div>

    <div class="mt-auto flex items-center gap-2.5 border-t border-line/60 pt-3">
      <span :class="['grid h-7 w-7 shrink-0 place-items-center rounded-lg', d.pendingReview ? 'bg-special-soft text-special-fg' : 'bg-surface-muted text-fg-subtle']" aria-hidden="true">
        <Gavel :size="14" />
      </span>
      <div class="min-w-0 flex-1">
        <template v-if="d.pendingReview">
          <p class="truncate text-xs font-medium text-fg">{{ RECOMMENDATION_LABELS[d.pendingReview.recommendation] }} · awaiting decision</p>
          <p class="truncate text-2xs text-fg-subtle">Submitted {{ timeAgo(d.pendingReview.submittedAt) }}</p>
        </template>
        <template v-else>
          <p class="truncate text-xs font-medium text-fg-muted">Not reviewed</p>
          <p class="truncate text-2xs text-fg-subtle">No recommendation yet</p>
        </template>
      </div>
      <AppButton v-if="!d.pendingReview && (canRecommend || d.isDirectReport)" size="xs" variant="secondary" :icon="ClipboardCheck" @click.stop="emit('review')">Review</AppButton>
      <AppButton v-else-if="d.pendingReview && canDecide" size="xs" variant="outline" :icon="BadgeCheck" @click.stop="emit('decide')">Decide</AppButton>
    </div>
  </div>
</template>
