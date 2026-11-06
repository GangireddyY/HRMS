<script setup lang="ts">
import { Plus } from '@lucide/vue';
import type { Balance } from '@/modules/leave/types';
import { formatDays } from '@/modules/leave/utils/leave-format';

/** One card per leave type: what is available now, and how it adds up. */
defineProps<{ balances: Balance[]; canApply?: boolean }>();
const emit = defineEmits<{ apply: [leaveTypeId: string] }>();

const entitled = (b: Balance) => Math.round((b.opening + b.accrued + b.granted + b.adjusted) * 100) / 100;
</script>

<template>
  <ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <li v-for="b in balances" :key="b.leaveType.id" class="relative overflow-hidden rounded-2xl bg-surface p-4 ring-1 ring-line">
      <span class="absolute inset-y-0 left-0 w-1" :style="{ backgroundColor: b.leaveType.color }" aria-hidden="true" />
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-fg">{{ b.leaveType.name }}</p>
          <p class="text-xs text-fg-subtle">{{ b.leaveType.code }}{{ b.leaveType.isPaid ? '' : ' · unpaid' }}</p>
        </div>
        <button
          v-if="canApply"
          type="button"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle ring-1 ring-line transition hover:bg-surface-muted hover:text-fg"
          :aria-label="`Apply for ${b.leaveType.name}`"
          @click="emit('apply', b.leaveType.id)"
        >
          <Plus :size="15" aria-hidden="true" />
        </button>
      </div>
      <template v-if="b.available !== null">
        <p class="mt-3 text-3xl font-semibold tracking-tight text-fg tabular-nums">{{ b.available }}<span class="ml-1 text-sm font-normal text-fg-muted">available</span></p>
        <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
          <div class="h-full rounded-full" :style="{ width: `${entitled(b) > 0 ? Math.max(0, Math.min(100, (b.available / entitled(b)) * 100)) : 0}%`, backgroundColor: b.leaveType.color }" />
        </div>
        <dl class="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div><dt class="text-fg-subtle">Credited</dt><dd class="font-medium text-fg tabular-nums">{{ entitled(b) }}</dd></div>
          <div><dt class="text-fg-subtle">Taken</dt><dd class="font-medium text-fg tabular-nums">{{ b.taken }}</dd></div>
          <div><dt class="text-fg-subtle">Pending</dt><dd class="font-medium tabular-nums" :class="b.pending ? 'text-amber-600 dark:text-amber-400' : 'text-fg'">{{ b.pending }}</dd></div>
        </dl>
        <p v-if="b.opening || b.encashed || b.lapsed" class="mt-2 text-[11px] text-fg-subtle">
          <template v-if="b.opening">{{ formatDays(b.opening) }} carried forward. </template>
          <template v-if="b.encashed">{{ formatDays(b.encashed) }} encashed. </template>
          <template v-if="b.lapsed">{{ formatDays(b.lapsed) }} lapsed.</template>
        </p>
      </template>
      <template v-else>
        <p class="mt-3 text-lg font-semibold text-fg">No limit</p>
        <p class="mt-1 text-xs text-fg-muted">{{ formatDays(b.taken) }} taken this year{{ b.pending ? `, ${formatDays(b.pending)} pending` : '' }}</p>
      </template>
    </li>
  </ul>
</template>
