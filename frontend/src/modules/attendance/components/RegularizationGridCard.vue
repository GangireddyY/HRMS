<script setup lang="ts">
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { Check, Hourglass, Lock, X } from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import type { Regularization } from '@/modules/attendance/types';
import { REGULARIZATION_LABELS, formatMinutes, formatTime, monthLabel, regularizationTone } from '@/modules/attendance/utils/attendance-format';
import { dateTile, longDay, relativeDay, waiting } from '@/modules/attendance/utils/attendance-ops';
import { AppAvatar, AppBadge, AppButton } from '@/shared/components';
import { timeAgo } from '@/shared/utils/format';

/** A missed-punch correction in the approvals grid: the day, the punches asked for, why, and who is waiting on it. */
const props = defineProps<{ regularization: Regularization; today: string; blocksClose: boolean; to?: RouteLocationRaw; selectable?: boolean }>();
const emit = defineEmits<{ approve: []; reject: [] }>();

const r = computed(() => props.regularization);
const tile = computed(() => dateTile(r.value.workDate));
const pending = computed(() => r.value.status === 'PENDING');
const wait = computed(() => waiting(r.value.createdAt));
const worked = computed(() => formatMinutes(Math.round((new Date(r.value.checkOutAt).getTime() - new Date(r.value.checkInAt).getTime()) / 60_000)));
const shortDay = (d: string) => new Intl.DateTimeFormat(appLocale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const WAIT_TONE = { neutral: 'text-fg-subtle', warning: 'text-warning-fg', danger: 'font-medium text-danger-fg' };
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div :class="['flex items-start gap-3', selectable && 'ps-7']">
      <span class="flex w-11 shrink-0 flex-col items-center rounded-xl bg-surface-muted py-1 ring-1 ring-line/60" aria-hidden="true">
        <span class="text-2xs leading-3 font-semibold text-fg-muted uppercase">{{ tile.month }}</span>
        <span class="text-lg leading-6 font-semibold text-fg tabular-nums">{{ tile.day }}</span>
      </span>
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm leading-snug font-semibold text-fg" :title="longDay(r.workDate)">{{ shortDay(r.workDate) }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted first-letter:uppercase">{{ relativeDay(r.workDate, today) }}</p>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-1">
        <AppBadge :tone="regularizationTone[r.status]" size="sm" dot>{{ REGULARIZATION_LABELS[r.status] }}</AppBadge>
        <span v-if="pending" :class="['inline-flex items-center gap-1 text-2xs', WAIT_TONE[wait.tone]]"><Hourglass :size="10" aria-hidden="true" />Sent {{ wait.label }}</span>
        <span v-else-if="r.reviewedBy" class="max-w-32 truncate text-2xs text-fg-subtle">by {{ r.reviewedBy }}</span>
      </div>
    </div>

    <div class="rounded-lg bg-surface-muted/50 px-3 py-2.5">
      <p class="text-2xs text-fg-subtle">Requested punches</p>
      <div class="mt-1 flex items-center gap-3">
        <p class="text-lg leading-6 font-semibold text-fg tabular-nums"><span class="sr-only">In </span>{{ formatTime(r.checkInAt) }}</p>
        <div class="flex min-w-0 flex-1 items-center">
          <span class="h-px flex-1 bg-line-strong" aria-hidden="true" />
          <span class="shrink-0 rounded-full bg-surface px-2 py-0.5 text-2xs font-medium text-fg-muted tabular-nums ring-1 ring-line">{{ worked }}<span class="sr-only"> worked</span></span>
          <span class="h-px flex-1 bg-line-strong" aria-hidden="true" />
        </div>
        <p class="text-lg leading-6 font-semibold text-fg tabular-nums"><span class="sr-only">Out </span>{{ formatTime(r.checkOutAt) }}</p>
      </div>
    </div>

    <blockquote class="line-clamp-2 border-s-2 border-line ps-3 text-xs leading-relaxed text-fg-muted" :title="r.reason">{{ r.reason }}</blockquote>

    <p v-if="pending && blocksClose" class="-mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-warning-soft px-2 py-1 text-xs text-warning-fg" :title="`Blocks closing ${monthLabel(r.workDate.slice(0, 7))}`">
      <Lock :size="12" aria-hidden="true" />Holding up the {{ tile.month }} close
    </p>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <AppAvatar :name="r.employee?.name ?? '?'" size="sm" />
      <div class="min-w-0 flex-1">
        <RouterLink v-if="r.employee && to" :to="to" class="block truncate text-xs font-medium text-fg hover:text-accent-fg hover:underline" @click.stop>{{ r.employee.name }}</RouterLink>
        <p v-else class="truncate text-xs font-medium text-fg">{{ r.employee?.name ?? 'Unknown employee' }}</p>
        <p class="truncate text-2xs text-fg-subtle">{{ r.employee?.employeeCode }}<template v-if="!pending"> · asked {{ timeAgo(r.createdAt) }}</template></p>
      </div>
      <template v-if="pending">
        <AppButton size="xs" variant="secondary" :icon="X" @click.stop="emit('reject')">Reject</AppButton>
        <AppButton size="xs" :icon="Check" @click.stop="emit('approve')">Approve</AppButton>
      </template>
    </div>
  </div>
</template>
