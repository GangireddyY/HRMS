<script setup lang="ts">
import { computed } from 'vue';
import { Check, Clock, Plane, TriangleAlert, Users, X, XCircle } from '@lucide/vue';
import LeaveDateBlock from '@/modules/leave/components/LeaveDateBlock.vue';
import type { LeaveRequest } from '@/modules/leave/types';
import { LEAVE_STATUS_LABELS, formatLeaveRange, leaveStatusTone } from '@/modules/leave/utils/leave-format';
import { AppAvatar, AppBadge, AppButton } from '@/shared/components';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** A leave request in the approvals grid: who, which leave and when, why, who else is away then, and the decision. */
const props = defineProps<{
  request: LeaveRequest;
  timing: { text: string; tone: 'urgent' | 'soon' | 'now' | 'muted' } | null;
  overlaps: LeaveRequest[];
  overlapsLoading: boolean;
  canDecide: boolean;
  canCancel: boolean;
  /** The bulk-select checkbox sits over the top-start corner. */
  selectable: boolean;
}>();
const emit = defineEmits<{ approve: []; reject: []; cancel: [] }>();

const r = computed(() => props.request);
const name = computed(() => r.value.employee?.name ?? 'Unknown employee');
const color = computed(() => r.value.leaveType?.color);
const tint = (c: string | undefined, amount: number) => (c ? `color-mix(in srgb, ${c} ${amount}%, transparent)` : undefined);
const TIMING_CLASS = { urgent: 'text-danger-fg', soon: 'text-warning-fg', now: 'text-info-fg', muted: 'text-fg-muted' };
const reviewer = computed(() => (r.value.status === 'CANCELLED' ? r.value.cancelledBy : r.value.reviewedBy));
const decidedBy = computed(() => (reviewer.value ? `${LEAVE_STATUS_LABELS[r.value.status]} by ${reviewer.value}` : null));
const overlapText = computed(() =>
  props.overlaps.map((e) => `${e.employee?.name} (${e.leaveType?.name}, ${formatLeaveRange(e)}${e.status === 'PENDING' ? ', pending' : ''})`).join('; '),
);
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div :class="['-mt-2 flex min-h-7 items-center gap-2', selectable && 'ps-8']">
      <span class="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-fg" :style="{ backgroundColor: tint(color, 14) }">
        <Plane :size="12" class="shrink-0" :style="{ color }" aria-hidden="true" /><span class="truncate">{{ r.leaveType?.name ?? 'Leave' }}</span>
      </span>
      <span v-if="r.leaveType && !r.leaveType.isPaid" class="shrink-0 text-2xs text-fg-subtle">Unpaid</span>
      <AppBadge class="ms-auto shrink-0" :tone="leaveStatusTone[r.status]" size="sm" dot>{{ LEAVE_STATUS_LABELS[r.status] }}</AppBadge>
    </div>

    <div class="flex items-center gap-3">
      <AppAvatar :name="name" size="md" />
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm font-semibold text-fg">{{ name }}</h3>
        <p class="truncate text-xs text-fg-muted">
          <span class="font-mono">{{ r.employee?.employeeCode }}</span><template v-if="r.employee?.department"> · {{ r.employee.department }}</template>
        </p>
      </div>
    </div>

    <LeaveDateBlock :start-date="r.startDate" :end-date="r.endDate" :start-session="r.startSession" :end-session="r.endSession" :days="r.days" :color="color" />

    <p v-if="r.reason" class="line-clamp-2 border-s-2 border-line ps-2.5 text-xs leading-relaxed text-fg-muted" :title="r.reason">{{ r.reason }}</p>
    <p v-else class="border-s-2 border-line ps-2.5 text-xs text-fg-subtle italic">No reason given</p>

    <p v-if="r.status === 'REJECTED' && r.reviewNote" class="line-clamp-2 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs text-danger-fg" :title="r.reviewNote">“{{ r.reviewNote }}”</p>

    <template v-if="r.status === 'PENDING'">
      <span v-if="overlapsLoading" class="skeleton block h-8 rounded-lg" aria-hidden="true" />
      <p v-else-if="!overlaps.length" class="flex items-center gap-2 rounded-lg bg-surface-muted/60 px-2.5 py-1.5 text-xs text-fg-muted">
        <Users :size="13" class="shrink-0 text-success-fg" aria-hidden="true" />No one else{{ r.employee?.department ? ` in ${r.employee.department}` : '' }} is away
      </p>
      <div v-else class="flex items-center gap-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-xs" :title="overlapText">
        <TriangleAlert :size="13" class="shrink-0 text-warning-fg" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate font-medium text-warning-fg">{{ overlaps.length }} also away on these days</span>
        <span class="flex shrink-0 -space-x-1.5" aria-hidden="true">
          <AppAvatar v-for="e in overlaps.slice(0, 3)" :key="e.id" :name="e.employee?.name ?? '?'" size="xs" class="ring-2 ring-surface" />
        </span>
        <span class="sr-only">: {{ overlapText }}</span>
      </div>
    </template>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <div class="min-w-0 flex-1">
        <p v-if="timing" :class="['flex items-center gap-1 truncate text-xs font-medium', TIMING_CLASS[timing.tone]]"><Clock :size="12" class="shrink-0" aria-hidden="true" />{{ timing.text }}</p>
        <p v-else-if="decidedBy" class="truncate text-xs font-medium text-fg-muted">{{ decidedBy }}</p>
        <p class="truncate text-2xs text-fg-subtle">
          <span :title="formatDate(r.createdAt)">Applied {{ timeAgo(r.createdAt) }}</span><template v-if="timing && reviewer"> · by {{ reviewer }}</template>
        </p>
      </div>
      <template v-if="canDecide">
        <AppButton size="xs" variant="secondary" :icon="X" :aria-label="`Reject ${name}'s leave`" @click.stop="emit('reject')">Reject</AppButton>
        <AppButton size="xs" :icon="Check" :aria-label="`Approve ${name}'s leave`" @click.stop="emit('approve')">Approve</AppButton>
      </template>
      <AppButton v-else-if="canCancel" size="xs" variant="ghost" :icon="XCircle" :aria-label="`Cancel ${name}'s approved leave`" @click.stop="emit('cancel')">Cancel</AppButton>
    </div>
  </div>
</template>
