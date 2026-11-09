<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { AlertCircle, CalendarClock, CheckCircle2, ChevronRight, ClipboardCheck, FilterX, ListChecks, PenLine, Repeat, UserX } from '@lucide/vue';
import type { ReviewStage } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import StageTrack from '@/modules/performance/components/StageTrack.vue';
import type { ReviewRow } from '@/modules/performance/types';
import { STAGE_LABELS, STAGE_ORDER, stageTone } from '@/modules/performance/utils/performance-format';
import { RATING_FILL, STAGE_FILL, STAGE_SHORT, STAGE_STRIP_TONE, pct, plural, relativeDay, todayIso } from '@/modules/performance/utils/performance-ops';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppEmptyState, AppPageHeader, AppSearchInput, AppSkeleton, AppStatStrip, AppTabs, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate } from '@/shared/utils/format';

/** Reviews you conduct as reviewer, and all reviews within your `performance.view` scope: stage funnel, work queue and list. */
const router = useRouter();
const auth = useAuthStore();
const canSeeAll = computed(() => auth.can('performance.view', 'TEAM') || auth.can('performance.configure'));
const canConfigure = computed(() => auth.can('performance.configure'));
const view = ref<'team' | 'all'>('team');
const table = useTable((q) => performanceApi.reviews({ ...q, view: view.value }), { filters: { stage: undefined as ReviewStage | undefined } });

/** Funnel and work queue for each view; the list itself stays paginated and searchable. */
const mine = useAsync(() => fetchAllPages((page, pageSize) => performanceApi.reviews({ view: 'team', page, pageSize })));
const everyone = useAsync(() => fetchAllPages((page, pageSize) => performanceApi.reviews({ view: 'all', page, pageSize })), { immediate: false });
watch(view, (v) => {
  void table.load();
  if (v === 'all' && !everyone.data.value) void everyone.run();
});
const summary = computed(() => (view.value === 'team' ? mine : everyone));
const all = computed(() => summary.value.data.value ?? []);
const summaryLoading = computed(() => summary.value.loading.value && !summary.value.data.value);
const today = todayIso();
const isOverdue = (r: ReviewRow) => !!r.due && r.due < today;
const isDone = (r: ReviewRow) => r.stage === 'COMPLETED' || r.stage === 'ACKNOWLEDGED';

const tabs = computed(() => [
  { key: 'team', label: 'I review', icon: PenLine, count: mine.data.value?.length ?? null },
  ...(canSeeAll.value ? [{ key: 'all', label: 'All reviews', icon: ListChecks, count: everyone.data.value?.length ?? null }] : []),
]);

const strip = computed<StripItem[]>(() =>
  STAGE_ORDER.map((s) => {
    const at = all.value.filter((r) => r.stage === s);
    const late = at.filter(isOverdue).length;
    return { key: s, label: STAGE_LABELS[s], value: at.length, tone: STAGE_STRIP_TONE[s], hint: late ? `${late} overdue` : at.length ? `${pct(at.length, all.value.length)}% of reviews` : 'None' };
  }),
);
const selectStage = (k: string | null) => (table.filters.stage = (k as ReviewStage | null) ?? undefined);

/** What to act on first: overdue reviews, then work waiting on you (team) or on HR (all). */
const queue = computed(() => {
  const items: { row: ReviewRow; action: string; icon: typeof AlertCircle; tone: 'danger' | 'warning' | 'info' }[] = [];
  for (const r of all.value) {
    if (view.value === 'all' && !r.reviewer && !isDone(r)) items.push({ row: r, action: 'Assign a reviewer', icon: UserX, tone: 'warning' });
    else if (isOverdue(r)) items.push({ row: r, action: `${STAGE_LABELS[r.stage]} overdue`, icon: AlertCircle, tone: 'danger' });
    else if (view.value === 'team' && r.stage === 'GOAL_APPROVAL') items.push({ row: r, action: 'Approve goals', icon: ClipboardCheck, tone: 'warning' });
    else if (view.value === 'team' && r.stage === 'MANAGER_REVIEW') items.push({ row: r, action: 'Write the review', icon: PenLine, tone: 'info' });
  }
  const rank = { danger: 0, warning: 1, info: 2 };
  return items.sort((a, b) => rank[a.tone] - rank[b.tone] || (a.row.due ?? '9').localeCompare(b.row.due ?? '9'));
});

/** Completion per cycle in the current view. */
const byCycle = computed(() => {
  const map = new Map<string, { id: string; name: string; total: number; done: number; stages: Record<ReviewStage, number> }>();
  for (const r of all.value) {
    const e = map.get(r.cycle.id) ?? { id: r.cycle.id, name: r.cycle.name, total: 0, done: 0, stages: Object.fromEntries(STAGE_ORDER.map((s) => [s, 0])) as Record<ReviewStage, number> };
    e.total++;
    if (isDone(r)) e.done++;
    e.stages[r.stage]++;
    map.set(r.cycle.id, e);
  }
  return [...map.values()];
});
const doneCount = computed(() => all.value.filter(isDone).length);

const columns = computed<TableColumn<ReviewRow>[]>(() => [
  { key: 'employee', label: 'Employee' },
  { key: 'cycle', label: view.value === 'all' ? 'Cycle & reviewer' : 'Cycle' },
  { key: 'stage', label: 'Stage' },
  { key: 'due', label: 'Due' },
  { key: 'rating', label: 'Rating', align: 'right' },
]);
const open = (r: ReviewRow) => router.push(`/hr/performance/reviews/${r.id}`);
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Reviews" description="Approve goals, write reviews for your team and follow progress across the cycle.">
      <template v-if="canConfigure" #actions><AppButton variant="secondary" :icon="Repeat" to="/hr/performance/cycles">Review cycles</AppButton></template>
    </AppPageHeader>

    <AppTabs v-model="view" :tabs="tabs">
      <div class="space-y-4">
        <AppStatStrip :items="strip" selectable :selected="table.filters.stage ?? null" :loading="summaryLoading" label="Reviews by stage" @select="selectStage" />

        <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section class="card min-w-0 overflow-hidden" aria-labelledby="reviews-title">
            <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
              <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><ListChecks :size="16" /></span>
              <div class="min-w-0 flex-1">
                <h2 id="reviews-title" class="flex items-center gap-2 text-sm font-semibold text-fg">
                  {{ table.filters.stage ? STAGE_LABELS[table.filters.stage] : view === 'team' ? 'People you review' : 'All reviews' }}
                  <AppBadge v-if="table.meta.value" size="sm">{{ table.meta.value.total }}</AppBadge>
                </h2>
                <p class="text-xs text-fg-muted">{{ table.filters.stage ? 'Filtered by stage' : 'Pick a stage above to filter' }}</p>
              </div>
              <AppButton v-if="table.filters.stage" size="sm" variant="ghost" :icon="FilterX" @click="selectStage(null)">All stages</AppButton>
              <AppSearchInput v-model="table.search.value" class="w-full sm:w-64" size="sm" placeholder="Search employees" aria-label="Search reviews" />
            </header>
            <AppDataTable
              :columns="columns"
              :rows="table.rows.value"
              :loading="table.loading.value"
              :error="table.error.value"
              :meta="table.meta.value"
              clickable
              caption="Reviews"
              :empty-title="view === 'team' ? 'Nobody to review' : 'No reviews'"
              :empty-description="view === 'team' ? 'When a review cycle is launched, the people you manage appear here.' : 'Reviews appear once HR launches a review cycle.'"
              :filtered="table.isFiltered.value"
              @page="table.setPage"
              @retry="table.load"
              @row-click="open"
              @clear="table.clearFilters()"
            >
              <template #cell-employee="{ row }">
                <div class="flex items-center gap-3">
                  <AppAvatar :name="row.employee.name" size="sm" />
                  <div class="min-w-0">
                    <p class="flex items-center gap-1.5 truncate font-medium text-fg">
                      {{ row.employee.name }}
                      <AlertCircle v-if="isOverdue(row)" :size="14" class="shrink-0 text-danger-fg" aria-label="Overdue" />
                    </p>
                    <p class="truncate text-xs text-fg-muted">{{ [row.employee.designation, row.employee.department].filter(Boolean).join(' · ') || row.employee.employeeCode }}</p>
                  </div>
                </div>
              </template>
              <template #cell-cycle="{ row }">
                <p class="truncate text-fg">{{ row.cycle.name }}</p>
                <p v-if="view === 'all'" class="truncate text-xs" :class="row.reviewer ? 'text-fg-muted' : 'font-medium text-warning-fg'">{{ row.reviewer ? `Reviewer: ${row.reviewer.name}` : 'No reviewer assigned' }}</p>
                <p v-else class="text-xs text-fg-muted">{{ plural(row.goals, 'goal') }}</p>
              </template>
              <template #cell-stage="{ row }">
                <div class="space-y-1.5 max-md:flex max-md:flex-col max-md:items-end">
                  <AppBadge :tone="stageTone[row.stage]" dot>{{ STAGE_LABELS[row.stage] }}</AppBadge>
                  <StageTrack :stage="row.stage" :overdue="isOverdue(row)" />
                </div>
              </template>
              <template #cell-due="{ row }">
                <template v-if="row.due">
                  <p :class="['whitespace-nowrap tabular-nums', isOverdue(row) ? 'font-medium text-danger-fg' : 'text-fg']">{{ formatDate(row.due) }}</p>
                  <p :class="['text-xs', isOverdue(row) ? 'text-danger-fg' : 'text-fg-muted']">{{ isOverdue(row) ? `Overdue · ${relativeDay(row.due)}` : relativeDay(row.due) }}</p>
                </template>
                <span v-else-if="isDone(row)" class="inline-flex items-center gap-1 text-xs text-success-fg"><CheckCircle2 :size="13" aria-hidden="true" />Done</span>
                <span v-else class="text-xs text-fg-subtle">No deadline</span>
              </template>
              <template #cell-rating="{ row }">
                <span v-if="row.finalRating" class="inline-flex items-center gap-2">
                  <span v-if="row.calibrated" class="text-2xs text-fg-muted">calibrated</span>
                  <span class="inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-1.5 py-0.5 ring-1 ring-line ring-inset">
                    <span :class="['h-2 w-2 rounded-full', RATING_FILL[row.finalRating]]" aria-hidden="true" />
                    <span class="font-semibold text-fg tabular-nums">{{ row.finalRating }}</span><span class="text-xs text-fg-subtle">/5</span>
                  </span>
                </span>
                <span v-else class="text-fg-subtle">—</span>
              </template>
            </AppDataTable>
          </section>

          <aside class="space-y-4">
            <AppCard :title="view === 'team' ? 'Needs your attention' : 'Needs attention'" :icon="CalendarClock" :description="view === 'team' ? 'Goals to approve, reviews to write, deadlines passed' : 'Overdue stages and reviews without a reviewer'" :padded="false">
              <template v-if="queue.length" #actions><span class="rounded-full bg-brand-600 px-2 py-0.5 text-2xs font-semibold text-white tabular-nums">{{ queue.length }}</span></template>
              <AppSkeleton v-if="summaryLoading" class="p-4" :lines="3" />
              <AppEmptyState v-else-if="!queue.length" compact :icon="CheckCircle2" title="You're all caught up" :description="view === 'team' ? 'Nothing is waiting on you right now.' : 'No overdue reviews or missing reviewers.'" />
              <ul v-else class="divide-y divide-line/60">
                <li v-for="q in queue.slice(0, 6)" :key="q.row.id">
                  <RouterLink :to="`/hr/performance/reviews/${q.row.id}`" class="group relative flex items-center gap-3 px-4 py-3 transition hover:bg-surface-muted/50">
                    <span :class="['absolute inset-y-0 start-0 w-0.5', q.tone === 'danger' ? 'bg-danger' : q.tone === 'warning' ? 'bg-warning' : 'bg-info']" aria-hidden="true" />
                    <AppAvatar :name="q.row.employee.name" size="sm" />
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-medium text-fg">{{ q.row.employee.name }}</p>
                      <p :class="['flex items-center gap-1 truncate text-xs', q.tone === 'danger' ? 'text-danger-fg' : 'text-fg-muted']">
                        <component :is="q.icon" :size="12" class="shrink-0" aria-hidden="true" />{{ q.action }}<template v-if="q.row.due"> · {{ relativeDay(q.row.due) }}</template>
                      </p>
                    </div>
                    <ChevronRight :size="16" class="shrink-0 text-fg-subtle transition group-hover:translate-x-0.5" aria-hidden="true" />
                  </RouterLink>
                </li>
              </ul>
              <p v-if="queue.length > 6" class="border-t border-line/70 bg-surface-muted/40 px-4 py-2 text-xs text-fg-muted">and {{ queue.length - 6 }} more in the list</p>
            </AppCard>

            <AppCard title="Completion" :description="all.length ? `${doneCount} of ${plural(all.length, 'review')} completed` : 'Completed and acknowledged reviews'">
              <AppSkeleton v-if="summaryLoading" :lines="3" />
              <p v-else-if="!byCycle.length" class="text-sm text-fg-muted">No reviews yet.</p>
              <ul v-else class="space-y-4">
                <li v-for="c in byCycle" :key="c.id">
                  <div class="mb-1.5 flex items-baseline justify-between gap-2">
                    <RouterLink v-if="canSeeAll" :to="`/hr/performance/cycles/${c.id}`" class="truncate text-sm font-medium text-fg hover:text-accent-fg hover:underline">{{ c.name }}</RouterLink>
                    <p v-else class="truncate text-sm font-medium text-fg">{{ c.name }}</p>
                    <span class="shrink-0 text-xs text-fg-muted tabular-nums"><span class="font-semibold text-fg">{{ pct(c.done, c.total) }}%</span> · {{ c.done }}/{{ c.total }}</span>
                  </div>
                  <div class="flex h-2 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="STAGE_ORDER.map((s) => `${STAGE_LABELS[s]}: ${c.stages[s]}`).join(', ')">
                    <span v-for="s in STAGE_ORDER" v-show="c.stages[s]" :key="s" :class="['h-full border-e border-surface last:border-0', STAGE_FILL[s]]" :style="{ width: `${(c.stages[s] / c.total) * 100}%` }" />
                  </div>
                </li>
              </ul>
              <ul v-if="byCycle.length" class="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line/70 pt-3 text-2xs text-fg-muted">
                <li v-for="s in STAGE_ORDER" :key="s" class="flex items-center gap-1.5"><span :class="['h-2 w-2 rounded-full', STAGE_FILL[s]]" aria-hidden="true" />{{ STAGE_SHORT[s] }}</li>
              </ul>
            </AppCard>
          </aside>
        </div>
      </div>
    </AppTabs>
  </div>
</template>
