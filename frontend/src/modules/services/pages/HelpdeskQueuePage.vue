<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { Clock } from '@lucide/vue';
import { HELPDESK_CATEGORIES, HELPDESK_CATEGORY_LABELS, HELPDESK_STATUSES, type HelpdeskCategory, type HelpdeskStatus } from '@contracts';
import { helpdeskApi } from '@/modules/services/api/services.api';
import type { Ticket } from '@/modules/services/types';
import { dueIn, HELPDESK_PRIORITY_LABELS, HELPDESK_STATUS_AGENT_LABELS, helpdeskPriorityTone, helpdeskStatusTone } from '@/modules/services/utils/services-format';
import { AppAvatar, AppBadge, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSegmented, AppSelect, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { timeAgo } from '@/shared/utils/format';

/** The HR helpdesk queue: open tickets by resolution target, with who is handling each. */
const router = useRouter();
const stats = useAsync(() => helpdeskApi.stats());
const table = useTable((q) => helpdeskApi.list({ ...q, view: 'queue' }), {
  filters: { status: 'ACTIVE' as HelpdeskStatus | 'ACTIVE' | undefined, assignee: undefined as 'me' | 'unassigned' | undefined, category: undefined as HelpdeskCategory | undefined },
});
type Slice = 'active' | 'me' | 'unassigned' | 'all';
const slice = computed<Slice>({
  get: () => (table.filters.status !== 'ACTIVE' ? 'all' : (table.filters.assignee ?? 'active')),
  set: (v) => {
    table.filters.status = v === 'all' ? undefined : 'ACTIVE';
    table.filters.assignee = v === 'me' || v === 'unassigned' ? v : undefined;
  },
});
const slices = computed(() => [
  { value: 'active' as const, label: 'Open' },
  { value: 'me' as const, label: `Mine${stats.data.value?.mine ? ` (${stats.data.value.mine})` : ''}` },
  { value: 'unassigned' as const, label: `Unassigned${stats.data.value?.unassigned ? ` (${stats.data.value.unassigned})` : ''}` },
  { value: 'all' as const, label: 'All' },
]);
const statusOptions = HELPDESK_STATUSES.map((s) => ({ value: s, label: HELPDESK_STATUS_AGENT_LABELS[s] }));
const categoryOptions = HELPDESK_CATEGORIES.map((c) => ({ value: c, label: HELPDESK_CATEGORY_LABELS[c] }));
const strip = computed<StripItem[]>(() => {
  const s = stats.data.value;
  return [
    { key: 'active', label: 'Open tickets', value: s?.active, tone: 'info', hint: s ? `${s.unassigned} not picked up` : undefined },
    { key: 'overdue', label: 'Past target', value: s?.overdue, tone: s?.overdue ? 'danger' : 'success', hint: s?.overdue ? 'Answer these first' : 'All within target' },
    { key: 'response', label: 'First reply', value: s?.avgFirstResponseHours == null ? '—' : `${s.avgFirstResponseHours}h`, tone: 'brand', hint: 'Average, last 30 days' },
    { key: 'target', label: 'Within target', value: s?.withinTargetPercent == null ? '—' : `${s.withinTargetPercent}%`, tone: 'violet', hint: s ? `${s.resolvedLast30Days} resolved in 30 days${s.avgRating ? ` · ★ ${s.avgRating}` : ''}` : undefined },
  ];
});
const columns: TableColumn<Ticket>[] = [
  { key: 'ticket', label: 'Ticket' },
  { key: 'employee', label: 'From' },
  { key: 'priority', label: 'Priority' },
  { key: 'due', label: 'Target' },
  { key: 'status', label: 'Status' },
];
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Helpdesk" description="Questions from employees. Answer the ones past their target first; internal notes stay between agents." />

    <AppStatStrip :items="strip" :loading="stats.loading.value && !stats.data.value" label="Helpdesk queue" />

    <AppCard :padded="false">
      <div class="flex flex-wrap items-center gap-3 border-b border-line/70 px-3 py-3">
        <AppSegmented v-model="slice" :options="slices" label="Show" size="sm" />
        <div class="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_170px_170px]">
          <AppSearchInput v-model="table.search.value" placeholder="Search reference, subject or person" aria-label="Search tickets" />
          <AppSelect v-if="slice === 'all'" v-model="table.filters.status" :options="statusOptions" placeholder="Any status" aria-label="Filter by status" />
          <span v-else class="hidden sm:block" />
          <AppSelect v-model="table.filters.category" :options="categoryOptions" placeholder="Any topic" aria-label="Filter by topic" />
        </div>
      </div>
      <AppDataTable
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        clickable
        caption="Helpdesk tickets"
        :empty-title="slice === 'me' ? 'Nothing assigned to you' : 'No open tickets'"
        empty-description="New questions from employees appear here."
        :filtered="table.isFiltered.value"
        @page="table.setPage"
        @retry="table.load"
        @row-click="(t: Ticket) => router.push(`/hr/helpdesk/${t.id}`)"
        @clear="table.clearFilters()"
      >
        <template #cell-ticket="{ row }">
          <p class="max-w-80 truncate font-medium text-fg">{{ row.subject }}</p>
          <p class="truncate text-xs text-fg-muted"><span class="font-mono">{{ row.reference }}</span> · {{ HELPDESK_CATEGORY_LABELS[row.category] }} · {{ timeAgo(row.lastActivityAt) }}</p>
        </template>
        <template #cell-employee="{ row }">
          <div class="flex items-center gap-2">
            <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
            <div class="min-w-0">
              <p class="truncate text-sm text-fg">{{ row.employee?.name }}</p>
              <p class="truncate text-2xs text-fg-muted">{{ row.assignee ? `with ${row.assignee.name}` : 'Unassigned' }}</p>
            </div>
          </div>
        </template>
        <template #cell-priority="{ row }">
          <AppBadge :tone="helpdeskPriorityTone[row.priority]" size="sm">{{ HELPDESK_PRIORITY_LABELS[row.priority] }}</AppBadge>
        </template>
        <template #cell-due="{ row }">
          <span v-if="['OPEN', 'IN_PROGRESS', 'WAITING'].includes(row.status)" :class="['inline-flex items-center gap-1 text-xs', row.overdue ? 'font-semibold text-danger-fg' : 'text-fg-muted']">
            <Clock :size="12" aria-hidden="true" />{{ dueIn(row.dueAt) }}
          </span>
          <span v-else class="text-xs text-fg-subtle">{{ row.rating ? `★ ${row.rating}` : '—' }}</span>
        </template>
        <template #cell-status="{ row }">
          <AppBadge :tone="helpdeskStatusTone[row.status]" size="sm" dot>{{ HELPDESK_STATUS_AGENT_LABELS[row.status] }}</AppBadge>
        </template>
      </AppDataTable>
    </AppCard>
  </div>
</template>
