<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { AlertTriangle, CalendarClock, CheckCircle2, FileBarChart, Inbox, Layers, Lock, ShieldCheck, UserCheck, UserX, Users } from '@lucide/vue';
import { GRIEVANCE_CATEGORIES, GRIEVANCE_STATUSES, type GrievanceCategory, type GrievanceStatus } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { grievanceApi } from '@/modules/grievance/api/grievance.api';
import type { CaseRow, GrievanceView } from '@/modules/grievance/types';
import { CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS, priorityTone, statusTone } from '@/modules/grievance/utils/grievance-format';
import { CATEGORY_VISUALS, DUE_SOON_DAYS, SLA_BAR, SLA_TEXT, caseSla, daysBetween, isOpenCase, plural, todayIso } from '@/modules/grievance/utils/case-sla';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, AppStatStrip, AppSwitch, AppTabs, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate } from '@/shared/utils/format';

/** The grievance case queue: what needs attention first (past target, unassigned, due soon), then every case in the chosen list. */
const router = useRouter();
const auth = useAuthStore();
const stats = useAsync(() => grievanceApi.stats());
const tabs = computed(() =>
  [
    { key: 'assigned', label: 'Assigned to me', icon: UserCheck, show: auth.can('grievance.view') || auth.can('grievance.manage') || auth.can('grievance.posh.access') },
    { key: 'all', label: 'All grievances', icon: Layers, show: auth.can('grievance.manage') },
    { key: 'posh', label: 'POSH complaints', icon: ShieldCheck, show: auth.can('grievance.posh.access') },
  ]
    .filter((t) => t.show)
    .map(({ key, label, icon }) => ({ key, label, icon, count: stats.data.value?.[key as GrievanceView]?.open ?? null })),
);
const table = useTable((q) => grievanceApi.list(q), {
  filters: {
    view: (auth.can('grievance.manage') ? 'all' : auth.can('grievance.posh.access') && !auth.can('grievance.view') ? 'posh' : 'assigned') as GrievanceView,
    status: 'OPEN' as GrievanceStatus | 'OPEN' | undefined,
    category: undefined as GrievanceCategory | undefined,
    overdue: undefined as boolean | undefined,
    unassigned: undefined as boolean | undefined,
  },
});
const view = computed({ get: () => table.filters.view, set: (v: string) => (table.filters.view = v as GrievanceView) });
/** Every open case of the current list, for the attention panel and the breakdowns. */
const queue = useAsync(() => fetchAllPages((page, pageSize) => grievanceApi.list({ view: table.filters.view, status: 'OPEN', page, pageSize })));
watch(view, (v) => {
  if (v === 'posh') table.filters.category = undefined;
  if (v === 'assigned') table.filters.unassigned = undefined;
  void queue.run();
});
const current = computed(() => stats.data.value?.[table.filters.view]);
const overdueOnly = computed({ get: () => !!table.filters.overdue, set: (v: boolean) => (table.filters.overdue = v || undefined) });
const statusOptions = [{ value: 'OPEN', label: 'Open' }, ...GRIEVANCE_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))];
const categoryOptions = GRIEVANCE_CATEGORIES.filter((c) => c !== 'POSH').map((c) => ({ value: c, label: CATEGORY_LABELS[c] }));
const columns: TableColumn<CaseRow>[] = [
  { key: 'case', label: 'Case' },
  { key: 'complainant', label: 'Raised by' },
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Handled by' },
  { key: 'due', label: 'Target' },
];
const today = todayIso();
const slas = computed(() => new Map(table.rows.value.map((r) => [r.id, caseSla(r, today)])));
const ago = (iso: string) => {
  const d = daysBetween(iso, today);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${plural(d, 'day')} ago`;
};

// ---- Summary strip (doubles as quick filters) ------------------------------------------------------------------
type StripKey = 'open' | 'overdue' | 'unassigned';
const strip = computed<StripItem[]>(() => {
  const s = current.value;
  return [
    { key: 'open', label: 'Open cases', value: s?.open, hint: s?.open ? 'Submitted, in review or investigating' : 'Nothing open right now', tone: 'info' },
    { key: 'overdue', label: 'Past target date', value: s?.overdue, hint: s?.overdue ? 'Act on these first' : 'All within their target', tone: 'danger' },
    ...(table.filters.view !== 'assigned'
      ? [{ key: 'unassigned', label: 'Unassigned', value: s?.unassigned, hint: s?.unassigned ? 'Waiting for a handler' : 'Every case has a handler', tone: 'warning' }]
      : []),
  ];
});
const stripSelected = computed<StripKey | null>(() => (table.filters.unassigned ? 'unassigned' : table.filters.overdue ? 'overdue' : table.filters.status === 'OPEN' ? 'open' : null));
function selectStrip(key: string | null) {
  const f = table.filters;
  if (key === null) {
    // Leaving "past target" or "unassigned" goes back to all open cases; leaving "open" shows every status.
    if (stripSelected.value === 'open') f.status = undefined;
    f.overdue = undefined;
    f.unassigned = undefined;
    return;
  }
  f.status = 'OPEN';
  f.overdue = key === 'overdue' || undefined;
  f.unassigned = key === 'unassigned' || undefined;
}

// ---- Needs attention -------------------------------------------------------------------------------------------
const open = computed(() => queue.data.value ?? []);
interface Attention {
  row: CaseRow;
  reason: string;
  tone: 'danger' | 'warning';
  rank: number;
}
const attention = computed<Attention[]>(() =>
  open.value
    .map((row): Attention | null => {
      const sla = caseSla(row, today);
      if (sla.state === 'overdue') return { row, reason: `${sla.text}${row.assignee ? '' : ' · no handler'}`, tone: 'danger', rank: sla.left / 1000 };
      if (!row.assignee) return { row, reason: `No handler yet · ${sla.text.toLowerCase()}`, tone: 'warning', rank: 1 + sla.left / 1000 };
      if (sla.state === 'today' || sla.state === 'soon') return { row, reason: sla.state === 'today' ? sla.text : `Target in ${plural(sla.left, 'day')}`, tone: 'warning', rank: 2 + sla.left / 1000 };
      if (row.priority === 'URGENT') return { row, reason: 'Urgent priority', tone: 'warning', rank: 3 };
      return null;
    })
    .filter((a): a is Attention => !!a)
    .sort((a, b) => a.rank - b.rank),
);
const ATTENTION_SHOWN = 4;
const dueSoon = computed(() => open.value.filter((r) => ['today', 'soon'].includes(caseSla(r, today).state)).length);

// ---- Breakdowns ------------------------------------------------------------------------------------------------
const byCategory = computed(() => {
  const counts = new Map<GrievanceCategory, number>();
  for (const r of open.value) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const total = Math.max(1, open.value.length);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count, pct: Math.max(4, Math.round((count / total) * 100)) }));
});
const byHandler = computed(() => {
  const counts = new Map<string, { name: string; count: number; overdue: number }>();
  for (const r of open.value) {
    if (!r.assignee) continue;
    const e = counts.get(r.assignee.id) ?? { name: r.assignee.name, count: 0, overdue: 0 };
    e.count += 1;
    if (r.overdue) e.overdue += 1;
    counts.set(r.assignee.id, e);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
});
const unassignedOpen = computed(() => open.value.filter((r) => !r.assignee).length);
const showCategories = computed(() => table.filters.view !== 'posh' && byCategory.value.length > 0);
const showWorkload = computed(() => table.filters.view !== 'assigned' && (byHandler.value.length > 0 || unassignedOpen.value > 0));
function filterCategory(c: GrievanceCategory) {
  table.filters.category = table.filters.category === c ? undefined : c;
}

const emptyText = computed(() =>
  table.filters.view === 'assigned'
    ? { title: 'Nothing assigned to you', description: 'Cases you are asked to handle appear here with their target date.' }
    : table.filters.view === 'posh'
      ? { title: 'No POSH complaints', description: 'Complaints of sexual harassment go only to the Internal Committee and appear here.' }
      : { title: 'No grievances', description: 'When an employee raises a concern it appears here, ready to be assigned.' },
);
const openCase = (r: CaseRow) => router.push(`/hr/grievances/${r.id}`);
</script>

<template>
  <div>
    <AppPageHeader title="Grievances" description="Confidential employee concerns. Only the people handling a case can read it.">
      <template v-if="auth.can('grievance.posh.access')" #actions>
        <AppButton variant="secondary" :icon="FileBarChart" to="/hr/grievances/posh-report">POSH annual report</AppButton>
      </template>
    </AppPageHeader>
    <AppTabs v-model="view" :tabs="tabs">
      <div class="space-y-4">
        <AppStatStrip :items="strip" selectable :selected="stripSelected" :loading="stats.loading.value && !stats.data.value" label="Case summary" @select="selectStrip" />

        <!-- Insights over every open case of this list, independent of the queue's filters. -->
        <div
          v-if="(queue.loading.value && !queue.data.value) || open.length"
          :class="['grid items-stretch gap-4', showCategories && showWorkload ? 'lg:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]' : showCategories || showWorkload ? 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]' : '']"
        >
          <AppCard title="Needs attention" :icon="AlertTriangle" :description="attention.length ? 'Past target, unassigned or due soon — most urgent first' : 'Open cases at risk show up here'" :padded="false" fill :class="showCategories && showWorkload && 'lg:col-span-2 xl:col-span-1'">
            <div v-if="queue.loading.value && !queue.data.value" class="space-y-3 p-4">
              <div v-for="i in 3" :key="i" class="skeleton h-9 rounded-md" />
            </div>
            <div v-else-if="!attention.length" class="flex flex-1 items-start gap-3 px-4 py-4">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-fg" aria-hidden="true"><CheckCircle2 :size="16" /></span>
              <p class="text-sm text-fg-muted">Nothing urgent. Every open case has a handler and is more than {{ DUE_SOON_DAYS }} days from its target date.</p>
            </div>
            <ul v-else class="flex-1 divide-y divide-line/70">
              <li v-for="a in attention.slice(0, ATTENTION_SHOWN)" :key="a.row.id" class="relative">
                <span :class="['absolute inset-y-0 start-0 w-0.5', a.tone === 'danger' ? 'bg-danger' : 'bg-warning']" aria-hidden="true" />
                <RouterLink :to="`/hr/grievances/${a.row.id}`" class="group flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-muted/50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none focus-visible:ring-inset">
                  <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1 ring-inset', CATEGORY_VISUALS[a.row.category].tile]" aria-hidden="true">
                    <component :is="CATEGORY_VISUALS[a.row.category].icon" :size="15" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium text-fg group-hover:underline">{{ a.row.subject }}</span>
                    <span :class="['flex items-center gap-1 truncate text-xs font-medium', a.tone === 'danger' ? 'text-danger-fg' : 'text-warning-fg']">
                      <component :is="a.tone === 'danger' ? AlertTriangle : a.row.assignee ? CalendarClock : UserX" :size="12" class="shrink-0" aria-hidden="true" />{{ a.reason }}
                    </span>
                  </span>
                  <span class="shrink-0 font-mono text-2xs text-fg-subtle">{{ a.row.reference }}</span>
                </RouterLink>
              </li>
            </ul>
            <template v-if="queue.data.value && open.length" #footer>
              <p class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
                <span class="inline-flex items-center gap-1.5"><CalendarClock :size="13" aria-hidden="true" /><span class="font-medium text-fg tabular-nums">{{ dueSoon }}</span> due within {{ DUE_SOON_DAYS }} days</span>
                <span v-if="attention.length > ATTENTION_SHOWN">and {{ attention.length - ATTENTION_SHOWN }} more need attention</span>
              </p>
            </template>
          </AppCard>

          <AppCard v-if="showCategories" title="Open by category" :icon="Layers" description="Select one to filter the queue" fill>
            <ul class="-mx-2 -my-1.5 space-y-1">
              <li v-for="c in byCategory.slice(0, 5)" :key="c.category">
                <button
                  type="button"
                  :aria-pressed="table.filters.category === c.category"
                  :class="['block w-full rounded-md px-2 py-1.5 text-start transition hover:bg-surface-muted/60 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none', table.filters.category === c.category && 'bg-accent-soft']"
                  @click="filterCategory(c.category)"
                >
                  <span class="flex items-center gap-2 text-sm">
                    <component :is="CATEGORY_VISUALS[c.category].icon" :size="14" class="shrink-0 text-fg-muted" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate text-fg">{{ CATEGORY_LABELS[c.category] }}</span>
                    <span class="font-medium text-fg tabular-nums">{{ c.count }}</span>
                  </span>
                  <span class="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                    <span class="block h-full rounded-full bg-brand-500/70" :style="{ width: `${c.pct}%` }" />
                  </span>
                </button>
              </li>
            </ul>
          </AppCard>

          <AppCard v-if="showWorkload" title="Handler workload" :icon="Users" description="Open cases per handler" fill>
            <ul class="space-y-3">
              <li v-for="h in byHandler.slice(0, 4)" :key="h.name" class="flex items-center gap-3">
                <AppAvatar :name="h.name" size="sm" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-fg">{{ h.name }}</span>
                  <span :class="['block text-xs', h.overdue ? 'text-danger-fg' : 'text-fg-muted']">{{ h.overdue ? `${h.overdue} past target` : 'All within target' }}</span>
                </span>
                <span class="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-fg tabular-nums" :aria-label="`${h.count} open`">{{ h.count }}</span>
              </li>
              <li v-if="unassignedOpen" class="flex items-center gap-3">
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-warning/60 text-warning-fg" aria-hidden="true"><UserX :size="13" /></span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium text-fg">Unassigned</span>
                  <span class="block text-xs text-fg-muted">Choose a handler on the case</span>
                </span>
                <span class="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-fg tabular-nums">{{ unassignedOpen }}</span>
              </li>
            </ul>
          </AppCard>
        </div>

        <section class="card overflow-hidden" aria-labelledby="queue-title">
          <header class="flex items-center gap-3 border-b border-line/70 px-4 py-3">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><Inbox :size="16" /></span>
            <div class="min-w-0 flex-1">
              <h2 id="queue-title" class="text-sm font-semibold text-fg">Case queue</h2>
              <p class="text-xs text-fg-muted">Newest first. Open a case to read it, reply or move it forward.</p>
            </div>
            <span class="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-2xs font-medium text-fg-muted max-sm:hidden"><Lock :size="12" aria-hidden="true" />Confidential</span>
          </header>
          <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_180px_240px_auto] sm:items-center">
            <AppSearchInput v-model="table.search.value" placeholder="Search by reference or subject" aria-label="Search cases" />
            <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
            <AppSelect v-if="table.filters.view !== 'posh'" v-model="table.filters.category" :options="categoryOptions" placeholder="All categories" aria-label="Filter by category" />
            <span v-else class="max-sm:hidden" />
            <AppSwitch v-model="overdueOnly" label="Past target only" />
          </div>
          <AppDataTable
            :columns="columns"
            :rows="table.rows.value"
            :loading="table.loading.value"
            :error="table.error.value"
            :meta="table.meta.value"
            clickable
            caption="Grievance cases"
            :empty-title="emptyText.title"
            :empty-description="emptyText.description"
            :filtered="table.isFiltered.value"
            @page="table.setPage"
            @retry="table.load"
            @row-click="openCase"
            @clear="table.clearFilters()"
          >
            <template #cell-case="{ row }">
              <div class="flex min-w-0 items-center gap-3 py-1">
                <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', CATEGORY_VISUALS[row.category].tile]" aria-hidden="true">
                  <component :is="CATEGORY_VISUALS[row.category].icon" :size="16" />
                </span>
                <div class="min-w-0">
                  <p class="flex min-w-0 items-center gap-2">
                    <span class="truncate font-medium text-fg">{{ row.subject }}</span>
                    <AppBadge v-if="row.posh" tone="violet" size="sm">POSH</AppBadge>
                  </p>
                  <p class="truncate text-xs text-fg-muted">
                    <span class="font-mono text-2xs text-fg-subtle">{{ row.reference }}</span> · {{ CATEGORY_LABELS[row.category] }} · <span :title="formatDate(row.submittedOn)">{{ ago(row.submittedOn) }}</span>
                  </p>
                </div>
              </div>
            </template>
            <template #cell-complainant="{ row }">
              <div v-if="row.complainant" class="flex min-w-0 items-center gap-2.5 max-md:justify-end">
                <AppAvatar :name="row.complainant.name" size="sm" />
                <div class="min-w-0 text-start">
                  <p class="truncate text-fg">{{ row.complainant.name }}</p>
                  <p class="truncate text-xs text-fg-muted">{{ row.complainant.department ?? '—' }}</p>
                </div>
              </div>
              <span v-else class="text-fg-muted">—</span>
            </template>
            <template #cell-status="{ row }">
              <div class="flex flex-wrap gap-1.5 max-md:justify-end">
                <AppBadge :tone="statusTone[row.status]" dot>{{ STATUS_LABELS[row.status] }}</AppBadge>
                <AppBadge v-if="row.priority && row.priority !== 'MEDIUM'" :tone="priorityTone[row.priority]" size="sm">{{ PRIORITY_LABELS[row.priority] }}</AppBadge>
              </div>
            </template>
            <template #cell-assignee="{ row }">
              <span v-if="row.assignee" class="inline-flex min-w-0 items-center gap-2">
                <AppAvatar :name="row.assignee.name" size="xs" />
                <span class="truncate text-fg">{{ row.assignee.name }}</span>
              </span>
              <span v-else-if="isOpenCase(row)" class="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-fg ring-1 ring-warning/20 ring-inset">
                <UserX :size="12" aria-hidden="true" />Unassigned
              </span>
              <span v-else class="text-fg-muted">Unassigned</span>
            </template>
            <template #cell-due="{ row }">
              <span v-if="row.resolvedOn" class="inline-flex items-center gap-1.5 text-xs text-success-fg"><CheckCircle2 :size="13" aria-hidden="true" />Resolved {{ formatDate(row.resolvedOn) }}</span>
              <div v-else-if="slas.get(row.id)!.state !== 'done'" class="w-36 max-md:ms-auto">
                <p :class="['flex items-center gap-1 text-xs font-medium tabular-nums', SLA_TEXT[slas.get(row.id)!.state]]">
                  <AlertTriangle v-if="slas.get(row.id)!.state === 'overdue'" :size="12" aria-hidden="true" />{{ slas.get(row.id)!.text }}
                </p>
                <span class="mt-1 block h-1 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                  <span :class="['block h-full rounded-full', SLA_BAR[slas.get(row.id)!.state]]" :style="{ width: `${slas.get(row.id)!.used}%` }" />
                </span>
                <p class="mt-0.5 text-2xs text-fg-subtle tabular-nums">by {{ formatDate(row.dueOn) }}</p>
              </div>
              <span v-else class="text-xs text-fg-muted">{{ formatDate(row.dueOn) }}</span>
            </template>
          </AppDataTable>
        </section>
      </div>
    </AppTabs>
  </div>
</template>
