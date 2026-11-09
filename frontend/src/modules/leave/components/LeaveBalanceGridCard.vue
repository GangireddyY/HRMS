<script setup lang="ts">
import { computed } from 'vue';
import { History, InfinityIcon, SlidersHorizontal } from '@lucide/vue';
import type { BalanceOverview } from '@/modules/leave/types';
import { formatDays } from '@/modules/leave/utils/leave-format';
import { AppAvatar, AppButton } from '@/shared/components';
import { profileCover } from '@/shared/utils/profile-cover';

type Row = BalanceOverview['items'][number];
type Cell = Row['balances'][number];

/** One person's leave balances in the grid: total available, then per leave type what is left of the days credited. */
const props = defineProps<{ row: Row; types: BalanceOverview['types']; year: number; canAllocate: boolean }>();
const emit = defineEmits<{ history: []; adjust: [] }>();

const round = (n: number) => Math.round(n * 100) / 100;
const lines = computed(() => props.types.map((t) => ({ type: t, b: props.row.balances.find((b) => b.leaveTypeId === t.id) })));
const limited = computed(() => props.row.balances.filter((b) => b.available !== null));
const available = computed(() => round(limited.value.reduce((s, b) => s + (b.available ?? 0), 0)));
const pending = computed(() => round(props.row.balances.reduce((s, b) => s + b.pending, 0)));
const taken = computed(() => round(props.row.balances.reduce((s, b) => s + b.taken, 0)));
const credited = (b: Cell) => round((b.balance ?? 0) + b.taken);
/** Share of the days credited so far that is still available. */
const share = (b: Cell) => {
  const c = credited(b);
  return c > 0 && b.available !== null ? Math.max(0, Math.min(100, (b.available / c) * 100)) : 0;
};
const pct = (days: number, b: Cell) => (credited(b) > 0 ? Math.max(0, Math.min(100, (days / credited(b)) * 100)) : 0);
const tint = (color: string, amount: number) => `color-mix(in srgb, ${color} ${amount}%, transparent)`;
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="-mx-4 -mt-4 h-12 border-b border-line/50" :style="profileCover(row.employee.id)" aria-hidden="true" />
    <div class="relative z-10 -mt-6 flex items-end justify-between gap-3">
      <span class="rounded-full bg-surface p-0.5"><AppAvatar :name="row.employee.name" size="lg" /></span>
      <div class="mb-0.5 text-end">
        <p class="text-2xl leading-7 font-semibold tracking-tight tabular-nums" :class="available < 0 ? 'text-danger-fg' : 'text-fg'">
          <template v-if="limited.length">{{ available }}</template><InfinityIcon v-else :size="22" class="inline" aria-label="No limit" />
        </p>
        <p class="text-2xs text-fg-subtle">{{ limited.length ? (available === 1 || available === 0.5 ? 'day available' : 'days available') : 'no limit' }}</p>
      </div>
    </div>

    <div class="mt-2 flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h3 class="truncate text-sm font-semibold"><RouterLink :to="`/hr/employees/${row.employee.id}`" class="text-fg hover:text-accent-fg" @click.stop>{{ row.employee.name }}</RouterLink></h3>
        <p class="truncate text-xs text-fg-muted">
          <span class="font-mono">{{ row.employee.employeeCode }}</span><template v-if="row.employee.department"> · {{ row.employee.department }}</template>
        </p>
      </div>
      <span v-if="pending" class="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-medium text-warning-fg">
        <span class="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />{{ formatDays(pending) }} pending
      </span>
    </div>

    <ul class="mt-4 space-y-2.5" aria-label="Balances by leave type">
      <li v-for="{ type: t, b } in lines" :key="t.id">
        <div class="flex items-baseline gap-2 text-xs">
          <span class="h-2 w-2 shrink-0 self-center rounded-full" :style="{ backgroundColor: t.color }" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-fg-muted" :title="`${t.name} (${t.code})`">{{ t.name }}</span>
          <template v-if="!b"><span class="text-fg-subtle">—</span><span class="sr-only">no balance</span></template>
          <span v-else-if="b.available === null" class="shrink-0 text-fg-muted tabular-nums">No limit · {{ b.taken }} taken</span>
          <span v-else class="shrink-0 tabular-nums">
            <span :class="['font-semibold', b.available < 0 ? 'text-danger-fg' : 'text-fg']">{{ b.available }}</span><span class="text-fg-subtle"> / {{ credited(b) }}</span>
            <span v-if="b.pending" class="ms-1 font-medium text-warning-fg">+{{ b.pending }}<span class="sr-only"> pending</span></span>
          </span>
        </div>
        <div v-if="b" :class="['ms-4 mt-1 flex h-1.5 overflow-hidden rounded-full', b.available !== null && 'bg-surface-muted']" aria-hidden="true">
          <template v-if="b.available !== null">
            <div class="h-full transition-[width] duration-500" :style="{ width: `${b.available < 0 ? 100 : share(b)}%`, backgroundColor: b.available < 0 ? 'var(--status-danger)' : t.color }" />
            <div v-if="b.pending && b.available >= 0" class="h-full transition-[width] duration-500" :style="{ width: `${pct(b.pending, b)}%`, backgroundColor: tint(t.color, 40) }" />
          </template>
        </div>
      </li>
    </ul>

    <div class="mt-auto flex items-center gap-2 pt-4">
      <div class="flex w-full items-center gap-2 border-t border-line/60 pt-3">
        <p class="min-w-0 flex-1 truncate text-2xs text-fg-subtle">{{ formatDays(taken) }} taken in {{ year }}</p>
        <AppButton size="xs" variant="ghost" :icon="History" :aria-label="`Balance history for ${row.employee.name}`" @click.stop="emit('history')">History</AppButton>
        <AppButton v-if="canAllocate" size="xs" variant="secondary" :icon="SlidersHorizontal" :aria-label="`Adjust balance for ${row.employee.name}`" @click.stop="emit('adjust')">Adjust</AppButton>
      </div>
    </div>
  </div>
</template>
