<script setup lang="ts">
import { computed, type Component } from 'vue';
import { Ban, Check, Hourglass, Plane, Send, X, XCircle } from '@lucide/vue';
import LeaveDateBlock from '@/modules/leave/components/LeaveDateBlock.vue';
import type { LeaveRequest } from '@/modules/leave/types';
import { LEAVE_STATUS_LABELS, formatLeaveRange, leaveStatusTone, todayIso } from '@/modules/leave/utils/leave-format';
import { AppBadge, AppButton } from '@/shared/components';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** One of your own leave requests in the grid: the leave, its dates and days, and how far it has got from applied to taken. */
const props = defineProps<{ request: LeaveRequest; cancellable: boolean; startsIn: string }>();
const emit = defineEmits<{ cancel: [] }>();

type StepState = 'done' | 'current' | 'now' | 'failed' | 'upcoming';
interface Step {
  key: string;
  label: string;
  sub: string;
  state: StepState;
  icon: Component;
}

const today = todayIso();
const r = computed(() => props.request);
const color = computed(() => r.value.leaveType?.color);
const tint = (c: string | undefined, amount: number) => (c ? `color-mix(in srgb, ${c} ${amount}%, transparent)` : undefined);
const onLeaveNow = computed(() => r.value.status === 'APPROVED' && r.value.startDate <= today && r.value.endDate >= today);
const upcoming = computed(() => r.value.startDate > today && (r.value.status === 'APPROVED' || r.value.status === 'PENDING'));

const steps = computed<Step[]>(() => {
  const s = r.value;
  const applied: Step = { key: 'applied', label: 'Applied', sub: formatDate(s.createdAt), state: 'done', icon: Send };
  if (s.status === 'REJECTED') return [applied, { key: 'decision', label: 'Rejected', sub: s.reviewedBy ?? 'Not approved', state: 'failed', icon: X }];
  if (s.status === 'CANCELLED') return [applied, { key: 'decision', label: 'Cancelled', sub: s.cancelledBy ?? 'Withdrawn', state: 'failed', icon: Ban }];
  const decision: Step =
    s.status === 'PENDING'
      ? { key: 'decision', label: 'Pending', sub: 'With your manager', state: 'current', icon: Hourglass }
      : { key: 'decision', label: 'Approved', sub: s.reviewedBy ?? 'Approved', state: 'done', icon: Check };
  const leave: Step =
    s.status === 'PENDING'
      ? { key: 'leave', label: 'Time off', sub: props.startsIn, state: 'upcoming', icon: Plane }
      : onLeaveNow.value
        ? { key: 'leave', label: 'On leave', sub: `Back after ${formatDate(s.endDate)}`, state: 'now', icon: Plane }
        : s.endDate < today
          ? { key: 'leave', label: 'Taken', sub: formatDate(s.endDate), state: 'done', icon: Check }
          : { key: 'leave', label: 'Time off', sub: props.startsIn, state: 'upcoming', icon: Plane };
  return [applied, decision, leave];
});
const DOT: Record<StepState, string> = {
  done: 'bg-success-soft text-success-fg',
  current: 'bg-warning-soft text-warning-fg ring-2 ring-warning/30',
  now: 'bg-info-soft text-info-fg ring-2 ring-info/30',
  failed: 'bg-danger-soft text-danger-fg',
  upcoming: 'bg-surface-muted text-fg-subtle',
};
const progress = computed(() => steps.value.map((s) => `${s.label}: ${s.sub}`).join(', '));
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl" :style="{ backgroundColor: tint(color, 14), color }" aria-hidden="true"><Plane :size="18" /></span>
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm font-semibold text-fg">{{ r.leaveType?.name ?? 'Leave' }}</h3>
        <p class="truncate text-xs text-fg-muted">
          <template v-if="onLeaveNow"><span class="font-medium text-info-fg">On leave now</span> · </template>
          <template v-else-if="upcoming"><span class="font-medium text-fg">Starts {{ startsIn }}</span> · </template>
          <span :title="formatDate(r.createdAt)">Applied {{ timeAgo(r.createdAt) }}</span>
        </p>
      </div>
      <AppBadge class="shrink-0" :tone="leaveStatusTone[r.status]" size="sm" dot>{{ LEAVE_STATUS_LABELS[r.status] }}</AppBadge>
    </div>

    <LeaveDateBlock :start-date="r.startDate" :end-date="r.endDate" :start-session="r.startSession" :end-session="r.endSession" :days="r.days" :color="color" />

    <p v-if="r.reason" class="line-clamp-2 border-s-2 border-line ps-2.5 text-xs leading-relaxed text-fg-muted" :title="r.reason">{{ r.reason }}</p>
    <p v-if="r.status === 'REJECTED' && r.reviewNote" class="line-clamp-2 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs text-danger-fg" :title="r.reviewNote">“{{ r.reviewNote }}”</p>

    <ol class="grid" :style="{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }" aria-hidden="true">
      <li v-for="(s, i) in steps" :key="s.key" class="relative flex flex-col items-center px-1 text-center">
        <span v-if="i" :class="['absolute end-1/2 top-3 h-0.5 w-full -translate-y-1/2', s.state === 'upcoming' ? 'bg-line' : s.state === 'failed' ? 'bg-danger/40' : 'bg-success/50']" />
        <span class="relative rounded-full bg-surface">
          <span :class="['grid h-6 w-6 place-items-center rounded-full', DOT[s.state]]"><component :is="s.icon" :size="12" /></span>
        </span>
        <span :class="['mt-1.5 text-2xs font-semibold', s.state === 'upcoming' ? 'text-fg-muted' : 'text-fg']">{{ s.label }}</span>
        <span class="w-full truncate text-2xs text-fg-subtle" :title="s.sub">{{ s.sub }}</span>
      </li>
    </ol>
    <p class="sr-only">{{ progress }}</p>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <p class="min-w-0 flex-1 truncate text-2xs text-fg-subtle">{{ formatLeaveRange(r) }}</p>
      <AppButton v-if="cancellable" size="xs" variant="ghost" :icon="XCircle" :aria-label="`Cancel ${r.leaveType?.name ?? 'leave'} ${formatLeaveRange(r)}`" @click.stop="emit('cancel')">Cancel</AppButton>
    </div>
  </div>
</template>
