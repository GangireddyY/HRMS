<script setup lang="ts">
import { computed, type Component } from 'vue';
import { BellRing, CheckCheck, Hourglass, LogOut, UserPlus } from '@lucide/vue';
import type { Employee } from '@/modules/people/types';
import { employeeSignal, SIGNAL_WINDOW_DAYS, type EmployeeSignal, type SignalKind } from '@/modules/people/utils/employee-signals';
import { AppAvatar, AppCard, AppEmptyState } from '@/shared/components';

/**
 * The directory's work queue: probation reviews due or overdue, people leaving and people joining in the next
 * month, most urgent first. Each person links to their profile.
 */
const props = defineProps<{ employees: Employee[]; loading?: boolean; probationLink?: string | null }>();

interface Group {
  key: string;
  title: string;
  icon: Component;
  tile: string;
  kinds: SignalKind[];
  /** Date the group is ordered by. */
  date: (e: Employee) => string;
}
const GROUPS: Group[] = [
  { key: 'probation', title: 'Probation reviews', icon: Hourglass, tile: 'bg-warning-soft text-warning-fg', kinds: ['probation-overdue', 'probation-due'], date: (e) => e.probationEndDate ?? '' },
  { key: 'leaving', title: 'Leaving soon', icon: LogOut, tile: 'bg-danger-soft text-danger-fg', kinds: ['leaving'], date: (e) => e.exitDate ?? '9999' },
  { key: 'joining', title: 'Joining & new joiners', icon: UserPlus, tile: 'bg-info-soft text-info-fg', kinds: ['joining', 'new'], date: (e) => e.dateOfJoining },
];
const LIMIT = 4;
const DOT: Record<EmployeeSignal['tone'], string> = { danger: 'bg-danger', warning: 'bg-warning', info: 'bg-info', violet: 'bg-special', brand: 'bg-brand-500' };

const groups = computed(() =>
  GROUPS.map((g) => {
    const rows = props.employees
      .map((e) => ({ e, s: employeeSignal(e) }))
      .filter((r): r is { e: Employee; s: EmployeeSignal } => !!r.s && g.kinds.includes(r.s.kind) && (r.s.kind !== 'leaving' || r.s.urgent))
      .sort((a, b) => g.date(a.e).localeCompare(g.date(b.e)));
    return { ...g, rows };
  }).filter((g) => g.rows.length),
);
const total = computed(() => groups.value.reduce((n, g) => n + g.rows.length, 0));
</script>

<template>
  <AppCard title="Needs attention" :description="`Next ${SIGNAL_WINDOW_DAYS} days`" :icon="BellRing" :padded="false">
    <template v-if="total" #actions>
      <span class="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-fg tabular-nums">{{ total }}</span>
    </template>
    <div v-if="loading && !employees.length" class="space-y-3 p-4" aria-hidden="true">
      <div v-for="i in 3" :key="i" class="flex items-center gap-3">
        <div class="skeleton h-8 w-8 rounded-full" />
        <div class="flex-1 space-y-1.5"><div class="skeleton h-3 w-2/3 rounded-full" /><div class="skeleton h-2.5 w-1/2 rounded-full" /></div>
      </div>
    </div>
    <AppEmptyState v-else-if="!groups.length" compact :icon="CheckCheck" title="All clear" :description="`No probation reviews, exits or joiners in the next ${SIGNAL_WINDOW_DAYS} days.`" />
    <div v-else class="divide-y divide-line/70">
      <section v-for="g in groups" :key="g.key" class="px-4 py-3" :aria-label="g.title">
        <h3 class="mb-1.5 flex items-center gap-2 text-xs font-semibold text-fg-muted">
          <span :class="['flex h-5 w-5 items-center justify-center rounded', g.tile]" aria-hidden="true"><component :is="g.icon" :size="12" /></span>
          {{ g.title }}
          <span class="ms-auto font-medium text-fg-subtle tabular-nums">{{ g.rows.length }}</span>
        </h3>
        <ul class="-mx-2">
          <li v-for="r in g.rows.slice(0, LIMIT)" :key="r.e.id">
            <RouterLink :to="`/hr/employees/${r.e.id}`" class="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-muted">
              <AppAvatar :name="r.e.fullName" :src="r.e.avatarUrl" size="sm" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-fg">{{ r.e.fullName }}</span>
                <span class="flex items-center gap-1.5 text-xs text-fg-muted">
                  <span :class="['h-1.5 w-1.5 shrink-0 rounded-full', DOT[r.s.tone]]" aria-hidden="true" />
                  <span :class="['truncate', r.s.kind === 'probation-overdue' && 'font-medium text-danger-fg']">{{ r.s.label }}</span>
                </span>
              </span>
            </RouterLink>
          </li>
        </ul>
        <p v-if="g.rows.length > LIMIT" class="mt-1 text-xs text-fg-subtle">+{{ g.rows.length - LIMIT }} more</p>
      </section>
    </div>
    <template v-if="probationLink && groups.some((g) => g.key === 'probation')">
      <RouterLink :to="probationLink" class="flex items-center justify-between border-t border-line/70 px-4 py-2.5 text-xs font-medium text-accent-fg hover:bg-surface-muted">
        Open probation reviews <span aria-hidden="true">→</span>
      </RouterLink>
    </template>
  </AppCard>
</template>
