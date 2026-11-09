<script setup lang="ts">
import { computed } from 'vue';
import { CalendarClock, CalendarDays, ChevronRight, ClipboardCheck, IdCard, Wallet } from '@lucide/vue';
import ExitStageMeter from '@/modules/exit/components/ExitStageMeter.vue';
import type { ExitSummary } from '@/modules/exit/types';
import { REASON_LABELS, SETTLEMENT_LABELS, TYPE_LABELS, inr, settlementTone } from '@/modules/exit/utils/exit-format';
import { AppAvatar, AppBadge } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';
import { profileCover } from '@/shared/utils/profile-cover';

/** An exit in the grid, as a profile card: who is leaving and why, the last-day countdown, notice, workflow stage, clearance and settlement. */
const props = defineProps<{ exit: ExitSummary; countdown: { text: string; cls: string } | null }>();

const e = computed(() => props.exit);
const name = computed(() => e.value.employee?.name ?? 'Former employee');
const role = computed(() => [e.value.employee?.designation, e.value.employee?.department].filter(Boolean).join(' · ') || 'No role on file');
const lastDay = computed(() => e.value.lastWorkingDay ?? e.value.requestedLastDay ?? null);
const cleared = computed(() => e.value.clearance.total > 0 && e.value.clearance.done === e.value.clearance.total);
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="relative -mx-4 -mt-4 h-14 border-b border-line/50" :style="profileCover(e.employee?.id ?? e.id)">
      <span v-if="countdown" :class="['absolute end-2.5 top-2.5 rounded-full px-2 py-0.5 text-2xs font-semibold shadow-xs ring-1 ring-inset tabular-nums', countdown.cls]">{{ countdown.text }}</span>
    </div>
    <div class="relative z-10 -mt-7 flex items-end justify-between gap-2">
      <span class="rounded-full bg-surface p-0.5"><AppAvatar :name="name" size="lg" /></span>
      <AppBadge class="mb-1" size="sm">{{ TYPE_LABELS[e.type] }}</AppBadge>
    </div>

    <h3 class="mt-2 truncate text-sm font-semibold text-fg">{{ name }}</h3>
    <p class="truncate text-xs text-fg-muted" :title="role">{{ role }}</p>

    <ul class="mt-3 flex flex-wrap gap-1.5 text-xs" aria-label="Exit details">
      <li class="rounded-md bg-surface-muted px-2 py-1 text-fg-muted">{{ REASON_LABELS[e.reason] }}</li>
      <li v-if="e.employee" class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 font-mono text-fg-muted"><IdCard :size="12" aria-hidden="true" />{{ e.employee.employeeCode }}</li>
    </ul>

    <dl class="mt-4 grid grid-cols-2 gap-2">
      <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
        <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><CalendarDays :size="11" aria-hidden="true" />{{ !e.lastWorkingDay && e.requestedLastDay ? 'Asked-for last day' : 'Last working day' }}</dt>
        <dd :class="['mt-0.5 truncate text-xs font-medium tabular-nums', lastDay ? 'text-fg' : 'text-fg-subtle']">{{ lastDay ? formatDate(lastDay) : '—' }}</dd>
      </div>
      <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
        <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><CalendarClock :size="11" aria-hidden="true" />Notice ends</dt>
        <dd class="mt-0.5 truncate text-xs font-medium text-fg tabular-nums">{{ formatDate(e.noticeEndsOn) }}</dd>
        <dd v-if="e.noticeWaived" class="truncate text-2xs text-fg-muted">Waived</dd>
        <dd v-else-if="e.shortfallDays" class="truncate text-2xs font-medium text-warning-fg">{{ e.shortfallDays }} days short</dd>
      </div>
    </dl>

    <div class="mt-4 space-y-3">
      <ExitStageMeter :exit="e" />
      <div>
        <div class="mb-1.5 flex items-baseline justify-between text-xs">
          <span class="flex items-center gap-1 font-medium text-fg-muted"><ClipboardCheck :size="12" aria-hidden="true" />Clearance</span>
          <span v-if="e.clearance.total" class="text-fg-subtle tabular-nums"><span class="font-semibold text-fg">{{ e.clearance.done }}</span>/{{ e.clearance.total }} cleared</span>
          <span v-else class="text-fg-subtle">Not started</span>
        </div>
        <div
          class="h-1.5 overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          :aria-valuenow="e.clearance.done"
          aria-valuemin="0"
          :aria-valuemax="e.clearance.total"
          :aria-label="`${name}: clearance`"
        >
          <div :class="['h-full rounded-full', cleared ? 'bg-success' : 'bg-brand-500']" :style="{ width: `${e.clearance.total ? (e.clearance.done / e.clearance.total) * 100 : 0}%` }" />
        </div>
      </div>
    </div>

    <div class="mt-auto pt-3">
      <div class="flex items-center gap-2 border-t border-line/60 pt-3">
        <Wallet :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" />
        <div v-if="e.settlement" class="min-w-0 flex-1">
          <AppBadge :tone="e.settlement.overdue ? 'danger' : settlementTone[e.settlement.status]" size="sm" dot>
            <span class="sr-only">Settlement: </span>{{ SETTLEMENT_LABELS[e.settlement.status] }}{{ e.settlement.overdue ? ' · overdue' : '' }}
          </AppBadge>
          <p class="mt-0.5 truncate text-2xs text-fg-muted tabular-nums">
            {{ inr(e.settlement.netPayable) }}<template v-if="e.settlement.status !== 'PAID'"> · due {{ formatDate(e.settlement.dueOn) }}</template>
          </p>
        </div>
        <p v-else class="min-w-0 flex-1 truncate text-xs text-fg-subtle">
          {{ e.status === 'APPROVED' || e.status === 'COMPLETED' ? 'Settlement not worked out' : 'No settlement' }}
        </p>
        <span class="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-accent-fg opacity-0 transition group-hover/card:opacity-100 group-focus-visible/card:opacity-100" aria-hidden="true">
          Open exit <ChevronRight :size="13" />
        </span>
      </div>
    </div>
  </div>
</template>
