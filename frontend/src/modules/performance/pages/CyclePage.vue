<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AlertCircle, BarChart3, CalendarDays, Check, Circle, Eye, FilterX, Grid3x3, Lock, Pencil, Rocket, Settings2, Trash2, TrendingUp, UserPlus, UsersRound } from '@lucide/vue';
import type { ReviewStage } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import ColleaguePicker from '@/modules/performance/components/ColleaguePicker.vue';
import CycleFormModal from '@/modules/performance/components/CycleFormModal.vue';
import RatingChip from '@/modules/performance/components/RatingChip.vue';
import ReviewGridCard from '@/modules/performance/components/ReviewGridCard.vue';
import StageTrack from '@/modules/performance/components/StageTrack.vue';
import type { CycleDetail, ReviewRow } from '@/modules/performance/types';
import { CYCLE_STATUS_LABELS, STAGE_LABELS, STAGE_ORDER, cycleTone, stageTone } from '@/modules/performance/utils/performance-format';
import { RATING_FILL, STAGE_STRIP_TONE, pct, plural, relativeDay, todayIso } from '@/modules/performance/utils/performance-ops';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppEmptyState, AppErrorState, AppModal, AppPageHeader, AppSearchInput, AppSkeleton, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** One review cycle: its health (completion funnel, deadlines, rating distribution), setup and every participant's review. */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canConfigure = computed(() => auth.can('performance.configure'));
const canRevise = computed(() => auth.can('employee.salary.revise'));
const id = computed(() => String(route.params.id));
const cycle = useAsync(() => performanceApi.cycle(id.value));
const c = computed(() => cycle.data.value);
const table = useTable((q) => performanceApi.reviews({ ...q, cycleId: id.value, view: 'all' }), { filters: { stage: undefined as ReviewStage | undefined } });
watch(id, () => {
  void cycle.run();
  void table.load();
});

const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<CycleDetail>, success: string, description?: string) {
  busy.value = key;
  try {
    cycle.data.value = await fn();
    feedback.success(success, description);
    await table.load();
  } catch (e) {
    feedback.error('Could not complete the action', e);
  } finally {
    busy.value = null;
  }
}
async function launch() {
  if (!(await feedback.confirm({ title: `Launch ${c.value!.name}?`, message: 'A review is created for every eligible employee and everyone is notified to set goals. Weights, competencies and eligibility can no longer change.', confirmLabel: 'Launch' }))) return;
  await act('launch', () => performanceApi.launch(id.value), 'Cycle launched', 'Employees have been asked to set their goals.');
}
async function release() {
  if (!(await feedback.confirm({ title: 'Release results?', message: 'Employees see their completed reviews: ratings, manager comments and anonymous peer feedback. Ratings can no longer be calibrated.', confirmLabel: 'Release results' }))) return;
  await act('release', () => performanceApi.release(id.value), 'Results released', 'Employees with completed reviews have been notified.');
}
async function closeCycle() {
  if (!(await feedback.confirm({ title: `Close ${c.value!.name}?`, message: 'The cycle becomes read-only; unfinished reviews stay unfinished.', confirmLabel: 'Close cycle', danger: true }))) return;
  await act('close', () => performanceApi.closeCycle(id.value), 'Cycle closed');
}
async function remove() {
  if (!(await feedback.confirm({ title: `Delete ${c.value!.name}?`, message: 'The draft cycle is deleted.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await performanceApi.removeCycle(id.value);
    feedback.success('Cycle deleted');
    await router.replace('/hr/performance/cycles');
  } catch (e) {
    feedback.error('Could not delete the cycle', e);
  }
}
const editOpen = ref(false);
function onEdited(next: CycleDetail) {
  editOpen.value = false;
  cycle.data.value = next;
  feedback.success('Cycle updated');
}
const addOpen = ref(false);
const adding = ref<string[]>([]);
async function addParticipants() {
  addOpen.value = false;
  await act('add', () => performanceApi.addParticipants(id.value, adding.value), 'Participants added');
  adding.value = [];
}

// ---- Health ----------------------------------------------------------------------------------------------------
const today = todayIso();
const done = computed(() => (c.value ? c.value.stages.COMPLETED + c.value.stages.ACKNOWLEDGED : 0));
const strip = computed<StripItem[]>(() => {
  const d = c.value;
  if (!d) return [];
  return STAGE_ORDER.map((s) => ({ key: s, label: STAGE_LABELS[s], value: d.stages[s], tone: STAGE_STRIP_TONE[s], hint: d.stages[s] ? `${pct(d.stages[s], d.participants)}% of participants` : 'None' }));
});
const selectStage = (k: string | null) => (table.filters.stage = (k as ReviewStage | null) ?? undefined);

/** How many reviews have got at least as far as each milestone. */
const funnel = computed(() => {
  const d = c.value;
  if (!d) return [];
  const atLeast = (s: ReviewStage) => STAGE_ORDER.slice(STAGE_ORDER.indexOf(s)).reduce((n, x) => n + d.stages[x], 0);
  return [
    { key: 'launched', label: 'In the cycle', value: d.participants, fill: 'bg-fg-subtle' },
    { key: 'submitted', label: 'Goals submitted', value: atLeast('GOAL_APPROVAL'), fill: 'bg-warning' },
    { key: 'approved', label: 'Goals approved', value: atLeast('SELF_REVIEW'), fill: 'bg-info' },
    { key: 'self', label: 'Self-reviews in', value: atLeast('MANAGER_REVIEW'), fill: 'bg-special' },
    { key: 'manager', label: 'Manager reviews in', value: atLeast('COMPLETED'), fill: 'bg-brand-500' },
    { key: 'ack', label: 'Acknowledged', value: d.stages.ACKNOWLEDGED, fill: 'bg-success' },
  ];
});
const CIRC = 2 * Math.PI * 42;

const keyDates = computed(() => {
  const d = c.value;
  if (!d) return [];
  const s = d.stages;
  return [
    { label: 'Review period starts', date: d.periodStart, tone: 'bg-brand-500', open: 0 },
    { label: 'Goals due', date: d.goalsDue, tone: 'bg-warning', open: s.GOAL_SETTING + s.GOAL_APPROVAL },
    { label: 'Self-reviews due', date: d.selfReviewDue, tone: 'bg-info', open: s.GOAL_SETTING + s.GOAL_APPROVAL + s.SELF_REVIEW },
    { label: 'Manager reviews due', date: d.managerReviewDue, tone: 'bg-special', open: d.participants - done.value },
    { label: 'Review period ends', date: d.periodEnd, tone: 'bg-fg-subtle', open: 0 },
  ]
    .filter((k): k is { label: string; date: string; tone: string; open: number } => !!k.date)
    .map((k) => ({ ...k, late: d.status === 'ACTIVE' && k.open > 0 && k.date < today }));
});
const missingDeadlines = computed(() => (c.value ? [c.value.goalsDue, c.value.selfReviewDue, c.value.managerReviewDue].filter((x) => !x).length : 0));

const rated = computed(() => Object.values(c.value?.distribution ?? {}).reduce((a, b) => a + b, 0));
const maxBar = computed(() => Math.max(1, ...Object.values(c.value?.distribution ?? {})));
const average = computed(() => {
  const d = c.value?.distribution ?? {};
  return rated.value ? Math.round((Object.entries(d).reduce((n, [k, v]) => n + Number(k) * v, 0) / rated.value) * 10) / 10 : null;
});

/** Launch readiness for a draft: what's set up, what's optional and still missing. */
const checklist = computed(() => {
  const d = c.value;
  if (!d) return [];
  return [
    { label: 'Review period', ok: true, text: `${formatDate(d.periodStart)} – ${formatDate(d.periodEnd)}` },
    { label: 'Deadlines', ok: !missingDeadlines.value, text: missingDeadlines.value ? `${missingDeadlines.value} of 3 not set (optional)` : 'Goals, self and manager reviews' },
    { label: 'Competencies', ok: d.competencies.length > 0, text: d.competencies.length ? d.competencies.map((k) => k.name).join(', ') : 'None: scored on goals only' },
    { label: 'Who takes part', ok: true, text: `${d.departments.length ? d.departments.map((x) => x.name).join(', ') : 'All departments'}${d.eligibilityCutoff ? `, joined by ${formatDate(d.eligibilityCutoff)}` : ''}` },
  ];
});

const columns: TableColumn<ReviewRow>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'stage', label: 'Stage' },
  { key: 'rating', label: 'Rating', align: 'right' },
];
const isOverdue = (r: ReviewRow) => !!r.due && r.due < today;
</script>

<template>
  <div>
    <AppSkeleton v-if="cycle.loading.value && !c" :lines="8" />
    <AppErrorState v-else-if="cycle.error.value" :error="cycle.error.value" title="Could not load the cycle" @retry="cycle.run" />
    <template v-else-if="c">
      <AppPageHeader :title="c.name" :description="`${formatDate(c.periodStart)} – ${formatDate(c.periodEnd)}${c.description ? ` · ${c.description}` : ''}`" back="/hr/performance/cycles" back-label="Review cycles">
        <template #badges>
          <AppBadge :tone="cycleTone[c.status]" dot>{{ CYCLE_STATUS_LABELS[c.status] }}</AppBadge>
          <AppBadge v-if="c.resultsReleasedAt" tone="success">Results released</AppBadge>
        </template>
        <template v-if="canConfigure || canRevise" #actions>
          <AppButton v-if="c.status !== 'DRAFT'" variant="secondary" :icon="TrendingUp" :to="`/hr/performance/cycles/${c.id}/hikes`">Salary increases</AppButton>
          <template v-if="canConfigure">
            <AppButton v-if="c.status === 'DRAFT'" variant="ghost" :icon="Trash2" aria-label="Delete cycle" @click="remove" />
            <AppButton v-if="c.status !== 'CLOSED'" variant="secondary" :icon="Pencil" @click="editOpen = true">Edit</AppButton>
            <AppButton v-if="c.status === 'DRAFT'" :icon="Rocket" :loading="busy === 'launch'" @click="launch">Launch</AppButton>
            <template v-if="c.status === 'ACTIVE'">
              <AppButton variant="secondary" :icon="UserPlus" @click="addOpen = true">Add people</AppButton>
              <AppButton variant="secondary" :icon="Lock" :loading="busy === 'close'" @click="closeCycle">Close</AppButton>
              <AppButton v-if="!c.resultsReleasedAt" :icon="Eye" :loading="busy === 'release'" @click="release">Release results</AppButton>
            </template>
          </template>
        </template>
      </AppPageHeader>

      <div class="space-y-4">
        <AppAlert v-if="c.status === 'ACTIVE' && c.withoutReviewer" tone="warning" :title="`${c.withoutReviewer} review${c.withoutReviewer === 1 ? ' has' : 's have'} no reviewer`">
          Employees without a manager can't submit goals until a reviewer is assigned. Open their review to assign one.
        </AppAlert>

        <AppStatStrip v-if="c.participants" :items="strip" selectable :selected="table.filters.stage ?? null" label="Reviews by stage" @select="selectStage" />

        <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div class="min-w-0 space-y-4">
            <!-- Draft: launch readiness -->
            <AppCard v-if="c.status === 'DRAFT'" title="Ready to launch?" :icon="Rocket" description="Launching creates a review for everyone eligible and asks them to set goals.">
              <ul class="divide-y divide-line/60">
                <li v-for="i in checklist" :key="i.label" class="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span :class="['mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full', i.ok ? 'bg-success text-white' : 'bg-surface-muted text-fg-subtle ring-1 ring-line']" aria-hidden="true">
                    <component :is="i.ok ? Check : Circle" :size="i.ok ? 12 : 8" :stroke-width="3" />
                  </span>
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-fg">{{ i.label }}<span class="sr-only">{{ i.ok ? ' (done)' : ' (not set)' }}</span></p>
                    <p class="text-xs text-fg-muted">{{ i.text }}</p>
                  </div>
                </li>
              </ul>
              <div v-if="canConfigure" class="mt-4 flex flex-wrap justify-end gap-2 border-t border-line/70 pt-4">
                <AppButton variant="secondary" :icon="Pencil" @click="editOpen = true">Edit setup</AppButton>
                <AppButton :icon="Rocket" :loading="busy === 'launch'" @click="launch">Launch cycle</AppButton>
              </div>
            </AppCard>

            <!-- Completion funnel -->
            <section v-else class="card overflow-hidden" aria-labelledby="health-title">
              <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-2.5">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><BarChart3 :size="16" /></span>
                <div class="min-w-0 flex-1">
                  <h2 id="health-title" class="text-sm font-semibold text-fg">Cycle health</h2>
                  <p class="text-xs text-fg-muted">How many reviews have reached each milestone</p>
                </div>
                <AppBadge v-if="keyDates.some((k) => k.late)" tone="danger" dot>Deadlines missed</AppBadge>
              </header>
              <div v-if="!c.participants" class="p-4"><AppEmptyState compact :icon="UsersRound" title="Nobody is in this cycle" description="Add people to create their reviews." /></div>
              <div v-else class="flex flex-wrap items-center gap-6 p-4 sm:p-5">
                <div class="relative mx-auto h-32 w-32 shrink-0">
                  <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                    <circle cx="50" cy="50" r="42" fill="none" stroke-width="10" class="stroke-surface-muted" />
                    <circle cx="50" cy="50" r="42" fill="none" stroke-width="10" stroke-linecap="round" class="stroke-brand-500 transition-[stroke-dashoffset] duration-700" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - done / c.participants)" />
                  </svg>
                  <div class="absolute inset-0 flex flex-col items-center justify-center">
                    <span class="text-2xl font-semibold text-fg tabular-nums">{{ pct(done, c.participants) }}%</span>
                    <span class="text-2xs text-fg-muted">complete</span>
                  </div>
                </div>
                <ol class="min-w-0 flex-1 basis-80 space-y-2.5">
                  <li v-for="f in funnel" :key="f.key" class="grid grid-cols-[8.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm">
                    <span class="truncate text-fg-muted">{{ f.label }}</span>
                    <div class="h-2.5 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`${f.label}: ${f.value} of ${c.participants}`">
                      <div :class="['h-full rounded-full transition-[width] duration-500', f.fill]" :style="{ width: `${(f.value / c.participants) * 100}%` }" />
                    </div>
                    <span class="text-end tabular-nums"><span class="font-semibold text-fg">{{ f.value }}</span> <span class="text-xs text-fg-subtle">{{ pct(f.value, c.participants) }}%</span></span>
                  </li>
                </ol>
              </div>
            </section>

            <!-- Participants -->
            <section v-if="c.participants" class="card overflow-hidden" aria-labelledby="participants-title">
              <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
                <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><UsersRound :size="16" /></span>
                <div class="min-w-0 flex-1">
                  <h2 id="participants-title" class="flex items-center gap-2 text-sm font-semibold text-fg">
                    {{ table.filters.stage ? STAGE_LABELS[table.filters.stage] : 'Participants' }}
                    <AppBadge v-if="table.meta.value" size="sm">{{ table.meta.value.total }}</AppBadge>
                  </h2>
                  <p class="text-xs text-fg-muted">{{ table.filters.stage ? 'Filtered by stage' : 'Pick a stage above to filter' }}</p>
                </div>
                <AppButton v-if="table.filters.stage" size="sm" variant="ghost" :icon="FilterX" @click="selectStage(null)">All stages</AppButton>
                <AppSearchInput v-model="table.search.value" class="w-full sm:w-64" size="sm" placeholder="Search employees" aria-label="Search reviews" />
              </header>
              <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Reviews" empty-title="No reviews" @page="table.setPage" @retry="table.load" @row-click="(row) => router.push(`/hr/performance/reviews/${row.id}`)" :filtered="table.isFiltered.value" @clear="table.clearFilters()">
                <template #empty><AppButton v-if="canConfigure && c.status === 'ACTIVE'" variant="secondary" :icon="UserPlus" @click="addOpen = true">Add people</AppButton></template>
                <template #cell-employee="{ row }">
                  <div class="flex items-center gap-3">
                    <AppAvatar :name="row.employee.name" size="sm" />
                    <div class="min-w-0">
                      <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
                      <p class="truncate text-xs text-fg-muted">{{ [row.employee.designation, row.employee.department].filter(Boolean).join(' · ') || row.employee.employeeCode }}</p>
                    </div>
                  </div>
                </template>
                <template #cell-reviewer="{ row }">
                  <span v-if="row.reviewer" class="inline-flex items-center gap-2 text-fg-muted"><AppAvatar :name="row.reviewer.name" size="xs" />{{ row.reviewer.name }}</span>
                  <span v-else class="inline-flex items-center gap-1.5 text-xs font-medium text-warning-fg"><AlertCircle :size="14" aria-hidden="true" />Not assigned</span>
                </template>
                <template #cell-stage="{ row }">
                  <div class="space-y-1.5 max-md:flex max-md:flex-col max-md:items-end">
                    <AppBadge :tone="stageTone[row.stage]" dot>{{ STAGE_LABELS[row.stage] }}</AppBadge>
                    <div class="flex items-center gap-2">
                      <StageTrack :stage="row.stage" :overdue="isOverdue(row)" />
                      <span v-if="isOverdue(row)" class="text-2xs font-medium text-danger-fg">Overdue</span>
                    </div>
                  </div>
                </template>
                <template #cell-rating="{ row }">
                  <span v-if="row.finalRating" class="inline-flex items-center gap-2">
                    <span v-if="row.calibrated" class="text-2xs text-fg-muted">calibrated</span>
                    <RatingChip :rating="row.finalRating" :labels="c.ratingLabels" />
                  </span>
                  <span v-else class="text-fg-subtle">—</span>
                </template>
                <template #card="{ row }"><ReviewGridCard :review="row" :labels="c.ratingLabels" /></template>
              </AppDataTable>
            </section>
            <AppCard v-else-if="c.status !== 'DRAFT'" title="Participants" :icon="UsersRound">
              <AppEmptyState compact :icon="UsersRound" title="Nobody is in this cycle" description="Add people, for example new joiners, to create their reviews.">
                <AppButton v-if="canConfigure && c.status === 'ACTIVE'" size="sm" variant="secondary" :icon="UserPlus" @click="addOpen = true">Add people</AppButton>
              </AppEmptyState>
            </AppCard>
          </div>

          <aside class="space-y-4">
            <AppCard title="Rating distribution" :icon="BarChart3" :description="rated ? `${plural(rated, 'final rating')}${c.calibrated ? ` · ${c.calibrated} calibrated` : ''}` : 'Final ratings of completed reviews'">
              <template v-if="average" #actions><span class="text-xs text-fg-muted">avg <span class="text-sm font-semibold text-fg tabular-nums">{{ average }}</span></span></template>
              <ul class="space-y-2.5">
                <li v-for="n in [5, 4, 3, 2, 1]" :key="n" class="grid grid-cols-[1.5rem_minmax(0,1fr)_3.5rem] items-center gap-2.5 text-xs">
                  <span :class="['flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold text-white tabular-nums', RATING_FILL[n]]" aria-hidden="true">{{ n }}</span>
                  <div class="min-w-0">
                    <p class="mb-1 truncate text-fg-muted">{{ c.ratingLabels[n - 1] }}</p>
                    <div class="h-2 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`${n} – ${c.ratingLabels[n - 1]}: ${c.distribution[n] ?? 0}`">
                      <div :class="['h-full rounded-full transition-[width] duration-500', RATING_FILL[n]]" :style="{ width: `${((c.distribution[n] ?? 0) / maxBar) * 100}%` }" />
                    </div>
                  </div>
                  <span class="text-end tabular-nums"><span class="font-semibold text-fg">{{ c.distribution[n] ?? 0 }}</span><span v-if="rated" class="ms-1 text-fg-subtle">{{ pct(c.distribution[n] ?? 0, rated) }}%</span></span>
                </li>
              </ul>
              <p v-if="!rated" class="mt-3 rounded-md bg-surface-muted/70 px-3 py-2 text-xs text-fg-muted">Ratings appear here as managers complete their reviews.</p>
              <AppButton v-if="canConfigure && c.status !== 'DRAFT'" class="mt-3 w-full" size="sm" variant="secondary" :icon="Grid3x3" :to="`/hr/performance/cycles/${c.id}/calibration`">Calibration & 9-box</AppButton>
            </AppCard>

            <AppCard title="Key dates" :icon="CalendarDays">
              <ol class="relative space-y-4 border-s border-line ps-5">
                <li v-for="k in keyDates" :key="k.label" class="relative">
                  <span :class="['absolute -start-[25.5px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-surface', k.late ? 'bg-danger' : k.tone]" aria-hidden="true" />
                  <p class="text-sm font-medium" :class="k.late ? 'text-danger-fg' : 'text-fg'">{{ k.label }}</p>
                  <p class="text-xs" :class="k.late ? 'text-danger-fg' : k.date < today ? 'text-fg-subtle' : 'text-fg-muted'">
                    {{ formatDate(k.date) }} · {{ relativeDay(k.date) }}<template v-if="k.late"> · {{ k.open }} still open</template>
                  </p>
                </li>
              </ol>
              <p v-if="missingDeadlines" class="mt-4 rounded-md bg-surface-muted/70 px-3 py-2 text-xs text-fg-muted">
                {{ missingDeadlines === 3 ? 'No stage deadlines set.' : `${missingDeadlines} stage deadline${missingDeadlines === 1 ? '' : 's'} not set.` }}<template v-if="canConfigure && c.status !== 'CLOSED'"> Deadlines drive reminders and overdue flags; add them with Edit.</template>
              </p>
            </AppCard>

            <AppCard title="Setup" :icon="Settings2">
              <div>
                <p class="mb-1.5 flex justify-between text-xs text-fg-muted"><span>Goals {{ c.goalsWeight }}%</span><span v-if="c.goalsWeight < 100">Competencies {{ 100 - c.goalsWeight }}%</span></p>
                <div class="flex h-2 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`Score: goals ${c.goalsWeight}%, competencies ${100 - c.goalsWeight}%`">
                  <span class="h-full bg-brand-500" :style="{ width: `${c.goalsWeight}%` }" />
                  <span class="h-full bg-special" :style="{ width: `${100 - c.goalsWeight}%` }" />
                </div>
              </div>
              <dl class="mt-4 space-y-2 text-sm">
                <div class="flex justify-between gap-3"><dt class="text-fg-muted">Who takes part</dt><dd class="text-end text-fg">{{ c.departments.length ? c.departments.map((d) => d.name).join(', ') : 'All departments' }}{{ c.eligibilityCutoff ? `, joined by ${formatDate(c.eligibilityCutoff)}` : '' }}</dd></div>
                <div v-if="c.participants" class="flex justify-between gap-3"><dt class="text-fg-muted">Participants</dt><dd class="text-fg tabular-nums">{{ c.participants }}</dd></div>
                <div v-if="c.launchedAt" class="flex justify-between gap-3"><dt class="text-fg-muted">Launched</dt><dd class="text-fg">{{ formatDate(c.launchedAt) }}</dd></div>
                <div v-if="c.resultsReleasedAt" class="flex justify-between gap-3"><dt class="text-fg-muted">Results released</dt><dd class="text-fg">{{ formatDate(c.resultsReleasedAt) }}</dd></div>
                <div v-if="c.closedAt" class="flex justify-between gap-3"><dt class="text-fg-muted">Closed</dt><dd class="text-fg">{{ formatDate(c.closedAt) }}</dd></div>
              </dl>
              <div v-if="c.competencies.length" class="mt-4 border-t border-line/70 pt-3">
                <p class="mb-2 text-2xs font-semibold tracking-wide text-fg-muted uppercase">Competencies</p>
                <div class="flex flex-wrap gap-1.5">
                  <AppBadge v-for="k in c.competencies" :key="k.key" size="sm" :title="k.description ?? undefined">{{ k.name }}</AppBadge>
                </div>
              </div>
            </AppCard>
          </aside>
        </div>
      </div>

      <CycleFormModal :open="editOpen" :cycle="c" @close="editOpen = false" @saved="onEdited" />
      <AppModal :open="addOpen" title="Add people to this cycle" description="For example new joiners. Their manager becomes the reviewer." @close="addOpen = false">
        <ColleaguePicker v-model:values="adding" label="Employees" multiple />
        <template #footer>
          <AppButton variant="secondary" @click="addOpen = false">Cancel</AppButton>
          <AppButton :disabled="!adding.length" :loading="busy === 'add'" @click="addParticipants">Add {{ adding.length || '' }}</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
