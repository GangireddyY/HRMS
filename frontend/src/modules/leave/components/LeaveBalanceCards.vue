<script setup lang="ts">
import { Plus } from '@lucide/vue';
import type { Balance } from '@/modules/leave/types';
import { formatDays } from '@/modules/leave/utils/leave-format';

/** One card per leave type: a ring of what is left of what was credited, the figure, and how it adds up. */
defineProps<{ balances: Balance[]; canApply?: boolean }>();
const emit = defineEmits<{ apply: [leaveTypeId: string] }>();

const entitled = (b: Balance) => Math.round((b.opening + b.accrued + b.granted + b.adjusted) * 100) / 100;
const share = (b: Balance) => (b.available === null || entitled(b) <= 0 ? 0 : Math.max(0, Math.min(1, b.available / entitled(b))));
const R = 22;
const C = 2 * Math.PI * R;
</script>

<template>
  <ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <li v-for="b in balances" :key="b.leaveType.id" class="card flex flex-col p-4">
      <div class="flex items-center gap-2">
        <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: b.leaveType.color }" aria-hidden="true" />
        <p class="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{{ b.leaveType.name }}</p>
        <span class="shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-2xs text-fg-muted">{{ b.leaveType.code }}</span>
        <button
          v-if="canApply"
          type="button"
          class="-me-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition hover:bg-surface-muted hover:text-fg"
          :aria-label="`Apply for ${b.leaveType.name}`"
          @click="emit('apply', b.leaveType.id)"
        >
          <Plus :size="16" aria-hidden="true" />
        </button>
      </div>

      <div class="mt-3 flex items-center gap-4">
        <svg viewBox="0 0 56 56" class="h-14 w-14 shrink-0 -rotate-90" aria-hidden="true">
          <circle cx="28" cy="28" :r="R" fill="none" stroke="var(--app-surface-muted)" stroke-width="6" />
          <circle
            v-if="b.available !== null"
            cx="28"
            cy="28"
            :r="R"
            fill="none"
            :stroke="b.leaveType.color"
            stroke-width="6"
            stroke-linecap="round"
            :stroke-dasharray="`${share(b) * C} ${C}`"
            class="transition-[stroke-dasharray] duration-500"
          />
          <circle v-else cx="28" cy="28" :r="R" fill="none" :stroke="b.leaveType.color" stroke-width="6" opacity="0.3" />
        </svg>
        <div class="min-w-0">
          <template v-if="b.available !== null">
            <p class="text-3xl leading-9 font-semibold tracking-tight text-fg tabular-nums">{{ b.available }}</p>
            <p class="text-xs text-fg-muted">of {{ formatDays(entitled(b)) }} left{{ b.leaveType.isPaid ? '' : ' · unpaid' }}</p>
          </template>
          <template v-else>
            <p class="text-xl leading-9 font-semibold text-fg">No limit</p>
            <p class="text-xs text-fg-muted">{{ b.leaveType.isPaid ? 'Paid' : 'Unpaid' }} · {{ formatDays(b.taken) }} taken</p>
          </template>
        </div>
      </div>

      <dl class="mt-4 grid grid-cols-3 gap-2 border-t border-line/70 pt-3 text-xs">
        <div><dt class="text-fg-subtle">Credited</dt><dd class="font-semibold text-fg tabular-nums">{{ b.available === null ? '—' : entitled(b) }}</dd></div>
        <div><dt class="text-fg-subtle">Taken</dt><dd class="font-semibold text-fg tabular-nums">{{ b.taken }}</dd></div>
        <div><dt class="text-fg-subtle">Pending</dt><dd class="font-semibold tabular-nums" :class="b.pending ? 'text-amber-600 dark:text-amber-400' : 'text-fg'">{{ b.pending }}</dd></div>
      </dl>
      <p v-if="b.opening || b.encashed || b.lapsed" class="mt-2 text-2xs text-fg-subtle">
        <template v-if="b.opening">{{ formatDays(b.opening) }} carried forward. </template>
        <template v-if="b.encashed">{{ formatDays(b.encashed) }} encashed. </template>
        <template v-if="b.lapsed">{{ formatDays(b.lapsed) }} lapsed.</template>
      </p>
    </li>
  </ul>
</template>
