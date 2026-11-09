<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { AlertCircle, ArrowRight, CalendarClock, CheckCircle2, FilterX, Plus, Repeat, Rocket } from '@lucide/vue';
import type { CycleStatus } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import CycleFormModal from '@/modules/performance/components/CycleFormModal.vue';
import type { Cycle, CycleDetail } from '@/modules/performance/types';
import { CYCLE_STATUS_LABELS, STAGE_LABELS, STAGE_ORDER, cycleTone } from '@/modules/performance/utils/performance-format';
import { STAGE_FILL, STAGE_SHORT, daysBetween, pct, plural, relativeDay, todayIso } from '@/modules/performance/utils/performance-ops';
import { AppBadge, AppButton, AppDataTable, AppPageHeader, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate } from '@/shared/utils/format';

/** Review cycles: what's running now and how far along it is, drafts to launch, and the history of past cycles. */
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canConfigure = computed(() => auth.can('performance.configure'));
const table = useTable((q) => performanceApi.cycles(q), { filters: { status: undefined as CycleStatus | undefined } });
/** Strip counts and the in-progress spotlight; the list itself stays paginated. */
const summary = useAsync(() => fetchAllPages((page, pageSize) => performanceApi.cycles({ page, pageSize })));
const formOpen = ref(false);
async function onSaved(c: CycleDetail) {
  formOpen.value = false;
  feedback.success('Review cycle created', 'Launch it when it is ready.');
  await router.push(`/hr/performance/cycles/${c.id}`);
}
const total = (c: Cycle) => Object.values(c.stages).reduce((a, b) => a + b, 0);
const done = (c: Cycle) => c.stages.COMPLETED + c.stages.ACKNOWLEDGED;
const today = todayIso();

const all = computed(() => summary.data.value ?? []);
const count = (s: CycleStatus) => all.value.filter((c) => c.status === s).length;
const strip = computed<StripItem[]>(() => {
  const active = all.value.filter((c) => c.status === 'ACTIVE');
  const inActive = active.reduce((n, c) => n + total(c), 0);
  const last = all.value.find((c) => c.status === 'CLOSED');
  return [
    { key: 'all', label: 'All cycles', value: all.value.length, tone: 'brand', hint: all.value.length ? `Since ${formatDate(all.value.at(-1)!.periodStart)}` : 'None yet' },
    { key: 'ACTIVE', label: 'In progress', value: active.length, tone: 'info', hint: active.length ? `${plural(inActive, 'review')} under way` : 'Nothing running' },
    { key: 'DRAFT', label: 'Drafts', value: count('DRAFT'), tone: 'neutral', hint: count('DRAFT') ? 'Ready to launch' : 'None' },
    { key: 'CLOSED', label: 'Closed', value: count('CLOSED'), tone: 'success', hint: last ? `Last: ${last.name}` : 'None' },
  ];
});
const selectStatus = (k: string | null) => (table.filters.status = !k || k === 'all' ? undefined : (k as CycleStatus));

/** The next deadline of an active cycle (or the latest one already missed). */
function deadline(c: Cycle) {
  const dates = [
    { label: 'Goals', date: c.goalsDue, open: c.stages.GOAL_SETTING + c.stages.GOAL_APPROVAL },
    { label: 'Self-reviews', date: c.selfReviewDue, open: c.stages.GOAL_SETTING + c.stages.GOAL_APPROVAL + c.stages.SELF_REVIEW },
    { label: 'Manager reviews', date: c.managerReviewDue, open: total(c) - done(c) },
  ].filter((d): d is { label: string; date: string; open: number } => !!d.date);
  const missed = dates.filter((d) => d.date < today && d.open > 0).at(-1);
  if (missed) return { ...missed, late: true };
  const upcoming = dates.find((d) => d.date >= today);
  return upcoming ? { ...upcoming, late: false } : null;
}
const spotlight = computed(() => all.value.filter((c) => c.status === 'ACTIVE' || c.status === 'DRAFT').slice(0, 3));
/** How far through the review period a cycle is, for the period column. */
const elapsed = (c: Cycle) => Math.min(100, Math.max(0, pct(daysBetween(c.periodStart, today), daysBetween(c.periodStart, c.periodEnd))));

const columns: TableColumn<Cycle>[] = [
  { key: 'name', label: 'Cycle' },
  { key: 'period', label: 'Review period' },
  { key: 'status', label: 'Status' },
  { key: 'progress', label: 'Completion' },
];
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Review cycles" description="Set goals, self and manager reviews, 360 feedback and calibration, one cycle at a time.">
      <template v-if="canConfigure" #actions><AppButton :icon="Plus" @click="formOpen = true">New cycle</AppButton></template>
    </AppPageHeader>

    <AppStatStrip :items="strip" selectable :selected="table.filters.status ?? null" :loading="summary.loading.value && !summary.data.value" label="Cycles by status" @select="selectStatus" />

    <!-- Running and draft cycles first: they are where the work is. -->
    <div v-if="spotlight.length" class="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      <RouterLink v-for="c in spotlight" :key="c.id" :to="`/hr/performance/cycles/${c.id}`" class="card card-interactive group flex flex-col overflow-hidden focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:outline-none">
        <div class="flex items-start gap-3 px-4 pt-4">
          <span :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', c.status === 'ACTIVE' ? 'bg-info-soft text-info-fg' : 'bg-surface-muted text-fg-muted']" aria-hidden="true">
            <component :is="c.status === 'ACTIVE' ? Repeat : Rocket" :size="18" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate font-semibold text-fg">{{ c.name }}</p>
            <p class="text-xs text-fg-muted">{{ formatDate(c.periodStart) }} – {{ formatDate(c.periodEnd) }}</p>
          </div>
          <AppBadge :tone="cycleTone[c.status]" dot>{{ CYCLE_STATUS_LABELS[c.status] }}</AppBadge>
        </div>
        <div v-if="c.status === 'ACTIVE' && total(c)" class="px-4 pt-4">
          <div class="mb-1.5 flex items-baseline justify-between text-xs text-fg-muted">
            <span><span class="text-xl font-semibold text-fg tabular-nums">{{ pct(done(c), total(c)) }}%</span> complete</span>
            <span class="tabular-nums">{{ done(c) }} of {{ plural(total(c), 'review') }}</span>
          </div>
          <div class="flex h-2 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="STAGE_ORDER.map((s) => `${STAGE_LABELS[s]}: ${c.stages[s]}`).join(', ')">
            <span v-for="s in STAGE_ORDER" v-show="c.stages[s]" :key="s" :class="['h-full border-e border-surface last:border-0', STAGE_FILL[s]]" :style="{ width: `${(c.stages[s] / total(c)) * 100}%` }" />
          </div>
          <ul class="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-muted">
            <li v-for="s in STAGE_ORDER.filter((x) => c.stages[x])" :key="s" class="flex items-center gap-1.5"><span :class="['h-2 w-2 rounded-full', STAGE_FILL[s]]" aria-hidden="true" />{{ STAGE_SHORT[s] }} <span class="font-semibold text-fg tabular-nums">{{ c.stages[s] }}</span></li>
          </ul>
        </div>
        <p v-else class="px-4 pt-3 text-sm text-fg-muted">{{ c.status === 'DRAFT' ? 'Not launched yet. Check the setup, then launch it to create a review for everyone eligible.' : 'Nobody is in this cycle yet.' }}</p>
        <div class="min-h-4 flex-1" aria-hidden="true" />
        <div class="flex items-center gap-2 border-t border-line/70 bg-surface-muted/40 px-4 py-2.5 text-xs">
          <span class="sr-only">Status:</span>
          <template v-if="c.status === 'ACTIVE' && deadline(c)">
            <component :is="deadline(c)!.late ? AlertCircle : CalendarClock" :size="14" :class="deadline(c)!.late ? 'text-danger-fg' : 'text-fg-muted'" aria-hidden="true" />
            <span :class="deadline(c)!.late ? 'font-medium text-danger-fg' : 'text-fg-muted'">
              {{ deadline(c)!.label }} {{ deadline(c)!.late ? 'were due' : 'due' }} {{ relativeDay(deadline(c)!.date) }}<template v-if="deadline(c)!.late"> · {{ deadline(c)!.open }} open</template>
            </span>
          </template>
          <template v-else-if="c.resultsReleasedAt"><CheckCircle2 :size="14" class="text-success-fg" aria-hidden="true" /><span class="text-fg-muted">Results released {{ formatDate(c.resultsReleasedAt) }}</span></template>
          <span v-else class="text-fg-muted">{{ c.status === 'DRAFT' ? `Created ${formatDate(c.createdAt)}` : 'No deadlines set' }}</span>
          <span class="ms-auto inline-flex items-center gap-1 font-medium text-accent-fg">Open<ArrowRight :size="13" class="transition group-hover:translate-x-0.5" aria-hidden="true" /></span>
        </div>
      </RouterLink>
    </div>

    <section class="card overflow-hidden" aria-labelledby="cycles-title">
      <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
        <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><Repeat :size="16" /></span>
        <div class="min-w-0 flex-1">
          <h2 id="cycles-title" class="flex items-center gap-2 text-sm font-semibold text-fg">
            {{ table.filters.status ? `${CYCLE_STATUS_LABELS[table.filters.status]} cycles` : 'All cycles' }}
            <AppBadge v-if="table.meta.value" size="sm">{{ table.meta.value.total }}</AppBadge>
          </h2>
          <p class="text-xs text-fg-muted">Newest review period first</p>
        </div>
        <AppButton v-if="table.filters.status" size="sm" variant="ghost" :icon="FilterX" @click="selectStatus(null)">Show all</AppButton>
      </header>
      <AppDataTable
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        clickable
        caption="Review cycles"
        empty-title="No review cycles yet"
        :empty-description="canConfigure ? 'Create a cycle with its review period, deadlines and competencies, then launch it.' : 'Cycles HR sets up appear here.'"
        :filtered="table.isFiltered.value"
        @page="table.setPage"
        @retry="table.load"
        @row-click="(row) => router.push(`/hr/performance/cycles/${row.id}`)"
        @clear="table.clearFilters()"
      >
        <template #empty><AppButton v-if="canConfigure" :icon="Plus" @click="formOpen = true">New cycle</AppButton></template>
        <template #cell-name="{ row }">
          <div class="flex items-center gap-3">
            <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', row.status === 'ACTIVE' ? 'bg-info-soft text-info-fg ring-info/15' : row.status === 'CLOSED' ? 'bg-success-soft text-success-fg ring-success/15' : 'bg-surface-muted text-fg-muted ring-line']" aria-hidden="true">
              <component :is="row.status === 'DRAFT' ? Rocket : row.status === 'CLOSED' ? CheckCircle2 : Repeat" :size="16" />
            </span>
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.name }}</p>
              <p class="truncate text-xs text-fg-muted">{{ row.resultsReleasedAt ? `Results released ${formatDate(row.resultsReleasedAt)}` : row.description || `Goals ${row.goalsWeight}% · ${plural(row.competencies.length, 'competency', 'competencies')}` }}</p>
            </div>
          </div>
        </template>
        <template #cell-period="{ row }">
          <p class="whitespace-nowrap text-fg tabular-nums">{{ formatDate(row.periodStart) }} – {{ formatDate(row.periodEnd) }}</p>
          <div v-if="row.status === 'ACTIVE'" class="mt-1 flex items-center gap-2">
            <div class="h-1 w-24 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`${elapsed(row)}% of the review period has passed`"><div class="h-full rounded-full bg-fg-subtle" :style="{ width: `${elapsed(row)}%` }" /></div>
            <span class="text-2xs text-fg-muted">ends {{ relativeDay(row.periodEnd) }}</span>
          </div>
        </template>
        <template #cell-status="{ row }"><AppBadge :tone="cycleTone[row.status]" dot>{{ CYCLE_STATUS_LABELS[row.status] }}</AppBadge></template>
        <template #cell-progress="{ row }">
          <div v-if="total(row)" class="w-44 max-md:ms-auto">
            <div class="mb-1 flex justify-between text-xs"><span class="font-semibold text-fg tabular-nums">{{ pct(done(row), total(row)) }}%</span><span class="text-fg-muted tabular-nums">{{ done(row) }}/{{ total(row) }}</span></div>
            <div class="flex h-1.5 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="STAGE_ORDER.map((s) => `${STAGE_LABELS[s]}: ${row.stages[s]}`).join(', ')">
              <span v-for="s in STAGE_ORDER" v-show="row.stages[s]" :key="s" :class="['h-full', STAGE_FILL[s]]" :style="{ width: `${(row.stages[s] / total(row)) * 100}%` }" />
            </div>
          </div>
          <span v-else class="text-xs text-fg-subtle">{{ row.status === 'DRAFT' ? 'Not launched' : '—' }}</span>
        </template>
      </AppDataTable>
    </section>
    <CycleFormModal :open="formOpen" :cycle="null" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
