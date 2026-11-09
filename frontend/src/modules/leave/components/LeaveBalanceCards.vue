<script setup lang="ts">
import { CalendarPlus, InfinityIcon } from '@lucide/vue';
import type { Balance } from '@/modules/leave/types';
import { formatDays } from '@/modules/leave/utils/leave-format';

/** One card per leave type: what is available, a bar of how the credited days are used, and how it adds up. */
defineProps<{ balances: Balance[]; canApply?: boolean }>();
const emit = defineEmits<{ apply: [leaveTypeId: string] }>();

const round = (n: number) => Math.round(n * 100) / 100;
const entitled = (b: Balance) => round(b.opening + b.accrued + b.granted + b.adjusted);
const pct = (part: number, b: Balance) => (entitled(b) <= 0 ? 0 : Math.max(0, Math.min(100, (part / entitled(b)) * 100)));
const tint = (color: string, amount: number) => `color-mix(in srgb, ${color} ${amount}%, transparent)`;
const low = (b: Balance) => b.available !== null && entitled(b) > 0 && b.available / entitled(b) <= 0.2;
</script>

<template>
  <ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <li v-for="b in balances" :key="b.leaveType.id" class="card relative flex flex-col overflow-hidden">
      <span class="absolute inset-x-0 top-0 h-1" :style="{ backgroundColor: b.leaveType.color }" aria-hidden="true" />
      <div class="flex flex-1 flex-col p-4 pt-5">
        <div class="flex items-start gap-3">
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-2xs font-semibold"
            :style="{ backgroundColor: tint(b.leaveType.color, 14), color: b.leaveType.color }"
            aria-hidden="true"
          >
            {{ b.leaveType.code }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-fg">{{ b.leaveType.name }}</p>
            <p class="text-2xs text-fg-muted">{{ b.leaveType.isPaid ? 'Paid' : 'Unpaid' }}{{ b.leaveType.allowHalfDay ? ' · half days allowed' : '' }}</p>
          </div>
        </div>

        <div class="mt-4 flex items-baseline gap-1.5">
          <template v-if="b.available !== null">
            <span :class="['text-3xl leading-9 font-semibold tracking-tight tabular-nums', low(b) ? 'text-warning-fg' : 'text-fg']">{{ round(b.available) }}</span>
            <span class="text-sm text-fg-muted">of {{ entitled(b) }} {{ entitled(b) === 1 ? 'day' : 'days' }} available</span>
          </template>
          <template v-else>
            <span class="flex items-center gap-1.5 text-xl leading-9 font-semibold text-fg"><InfinityIcon :size="22" aria-hidden="true" />No limit</span>
          </template>
        </div>

        <div class="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
          <template v-if="b.available !== null">
            <div class="h-full transition-[width] duration-500" :style="{ width: `${pct(b.taken, b)}%`, backgroundColor: b.leaveType.color }" />
            <div class="h-full transition-[width] duration-500" :style="{ width: `${pct(b.pending, b)}%`, backgroundColor: tint(b.leaveType.color, 45) }" />
          </template>
        </div>
        <p class="sr-only">{{ b.available === null ? `${formatDays(b.taken)} taken, ${formatDays(b.pending)} pending` : `${formatDays(b.available)} available of ${formatDays(entitled(b))}: ${formatDays(b.taken)} taken, ${formatDays(b.pending)} pending` }}</p>

        <dl class="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt class="flex items-center gap-1 text-fg-subtle"><span class="h-1.5 w-1.5 rounded-full bg-line-strong" aria-hidden="true" />Credited</dt>
            <dd class="mt-0.5 font-semibold text-fg tabular-nums">{{ b.available === null ? '—' : entitled(b) }}</dd>
          </div>
          <div>
            <dt class="flex items-center gap-1 text-fg-subtle"><span class="h-1.5 w-1.5 rounded-full" :style="{ backgroundColor: b.leaveType.color }" aria-hidden="true" />Taken</dt>
            <dd class="mt-0.5 font-semibold text-fg tabular-nums">{{ b.taken }}</dd>
          </div>
          <div>
            <dt class="flex items-center gap-1 text-fg-subtle"><span class="h-1.5 w-1.5 rounded-full" :style="{ backgroundColor: tint(b.leaveType.color, 45) }" aria-hidden="true" />Pending</dt>
            <dd class="mt-0.5 font-semibold tabular-nums" :class="b.pending ? 'text-warning-fg' : 'text-fg'">{{ b.pending }}</dd>
          </div>
        </dl>
        <p v-if="b.opening || b.encashed || b.lapsed" class="mt-2 text-2xs text-fg-subtle">
          <template v-if="b.opening">{{ formatDays(b.opening) }} carried forward. </template>
          <template v-if="b.encashed">{{ formatDays(b.encashed) }} encashed. </template>
          <template v-if="b.lapsed">{{ formatDays(b.lapsed) }} lapsed.</template>
        </p>
      </div>
      <button
        v-if="canApply"
        type="button"
        class="flex items-center justify-center gap-1.5 border-t border-line/70 px-4 py-2.5 text-xs font-medium text-accent-fg transition hover:bg-accent-soft/60 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none focus-visible:ring-inset"
        :aria-label="`Apply for ${b.leaveType.name}`"
        @click="emit('apply', b.leaveType.id)"
      >
        <CalendarPlus :size="14" aria-hidden="true" />Request {{ b.leaveType.name.toLowerCase() }}
      </button>
    </li>
  </ul>
</template>
