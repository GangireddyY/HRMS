<script setup lang="ts">
import { computed, type Component } from 'vue';
import { CheckCircle2, ChevronRight, ListTodo } from '@lucide/vue';
import { AppEmptyState } from '@/shared/components';

export type PrioritySeverity = 'urgent' | 'soon' | 'normal';
export interface Priority {
  key: string;
  label: string;
  /** One line under the label, e.g. "2 overdue · 3 in the next 7 days". */
  detail: string;
  count: number;
  to: string;
  icon: Component;
  severity: PrioritySeverity;
  group: 'decide' | 'follow';
}

/**
 * The HR work queue: decisions waiting for the user and deadlines to follow up, most urgent first. Only rows with
 * something to do are shown; severity is spelled out for screen readers, not only coloured.
 */
const props = defineProps<{ items: Priority[]; loading?: boolean; /** Follow-up sources still loading. */ followLoading?: boolean }>();

const RANK: Record<PrioritySeverity, number> = { urgent: 0, soon: 1, normal: 2 };
const sorted = (group: Priority['group']) => props.items.filter((i) => i.group === group && i.count > 0).sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count);
const decide = computed(() => sorted('decide'));
const follow = computed(() => sorted('follow'));
const urgent = computed(() => props.items.filter((i) => i.count > 0 && i.severity === 'urgent').length);
const decisions = computed(() => decide.value.reduce((n, i) => n + i.count, 0));

const TILE: Record<PrioritySeverity, string> = {
  urgent: 'bg-danger-soft text-danger-fg',
  soon: 'bg-warning-soft text-warning-fg',
  normal: 'bg-surface-muted text-fg-muted',
};
const PILL: Record<PrioritySeverity, string> = {
  urgent: 'bg-danger-soft text-danger-fg ring-danger/25',
  soon: 'bg-warning-soft text-warning-fg ring-warning/30',
  normal: 'bg-surface-muted text-fg-muted ring-line',
};
const SEVERITY_TEXT: Record<PrioritySeverity, string> = { urgent: 'Urgent', soon: 'Due soon', normal: 'To do' };
</script>

<template>
  <section class="card flex h-full flex-col overflow-hidden" aria-labelledby="priorities-title">
    <header class="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-line/70 px-4 py-2">
      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><ListTodo :size="16" /></span>
      <div class="min-w-0 flex-1">
        <h2 id="priorities-title" class="text-sm font-semibold text-fg">Today's priorities</h2>
        <p class="text-xs text-fg-muted">Decisions and deadlines across HR, most urgent first</p>
      </div>
      <div v-if="!loading && (urgent || decisions)" class="flex items-center gap-1.5 max-sm:w-full max-sm:ps-11">
        <span v-if="urgent" class="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2 py-0.5 text-2xs font-semibold text-danger-fg tabular-nums">
          <span class="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />{{ urgent }} urgent
        </span>
        <span v-if="decisions" class="rounded-full bg-brand-600 px-2 py-0.5 text-2xs font-semibold text-white tabular-nums">{{ decisions }} to decide</span>
      </div>
    </header>

    <div v-if="loading" class="grid gap-3 p-4 md:grid-cols-2">
      <div v-for="i in 6" :key="i" class="skeleton h-12 rounded-md" />
    </div>
    <AppEmptyState
      v-else-if="!decide.length && !follow.length && !followLoading"
      class="flex-1"
      compact
      :icon="CheckCircle2"
      title="You're all caught up"
      description="Approvals, probation reviews, expiring documents and other follow-ups show up here."
    />
    <div v-else class="grid flex-1 md:grid-cols-2 md:divide-x md:divide-line/70 max-md:divide-y max-md:divide-line/70">
      <div v-for="g in [{ key: 'decide', title: 'Waiting for your decision', rows: decide }, { key: 'follow', title: 'Deadlines and follow-ups', rows: follow }]" :key="g.key" class="min-w-0">
        <h3 class="px-4 pt-3 pb-1 text-2xs font-semibold tracking-wider text-fg-subtle uppercase">{{ g.title }}</h3>
        <div v-if="g.key === 'follow' && followLoading && !g.rows.length" class="space-y-2 px-4 py-2" aria-busy="true">
          <div v-for="i in 3" :key="i" class="skeleton h-10 rounded-md" />
        </div>
        <p v-else-if="!g.rows.length" class="flex items-center gap-2 px-4 py-3 text-sm text-fg-muted"><CheckCircle2 :size="15" class="text-success-fg" aria-hidden="true" />Nothing here right now</p>
        <ul v-else class="pb-2">
          <li v-for="i in g.rows" :key="i.key">
            <RouterLink :to="i.to" class="group relative flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-muted/50">
              <span v-if="i.severity === 'urgent'" class="absolute inset-y-2 start-0 w-0.5 rounded-full bg-danger" aria-hidden="true" />
              <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-md', TILE[i.severity]]" aria-hidden="true"><component :is="i.icon" :size="16" /></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-fg">{{ i.label }}<span class="sr-only"> ({{ SEVERITY_TEXT[i.severity] }})</span></span>
                <span :class="['block truncate text-xs', i.severity === 'urgent' ? 'text-danger-fg' : 'text-fg-muted']">{{ i.detail }}</span>
              </span>
              <span :class="['rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset', PILL[i.severity]]">{{ i.count }}</span>
              <ChevronRight :size="16" class="shrink-0 text-fg-subtle transition group-hover:translate-x-0.5" aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
