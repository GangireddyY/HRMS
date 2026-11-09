<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { BarChart3, ChevronRight, ClipboardList, Clock, FileClock, Globe, ListChecks, Lock, Pencil, Plus, Rocket, ShieldCheck, Target, Trash2, UserRound } from '@lucide/vue';
import { SURVEY_STATUSES, type SurveyStatus } from '@contracts';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import SurveyFormModal from '@/modules/engagement/components/SurveyFormModal.vue';
import type { SurveyDetail, SurveyResults, SurveySummary } from '@/modules/engagement/types';
import { SURVEY_STATUS_LABELS, surveyTone } from '@/modules/engagement/utils/engagement-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSelect, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

/** Surveys for HR: status summary, response rates, what needs following up, and every survey with its actions. */
const router = useRouter();
const feedback = useFeedbackStore();
const table = useTable((q) => engagementApi.surveys({ ...q, manage: true }), { filters: { status: undefined as SurveyStatus | undefined } });
const statusOptions = SURVEY_STATUSES.map((s) => ({ value: s, label: SURVEY_STATUS_LABELS[s] }));
const formOpen = ref(false);
const editing = ref<SurveyDetail | null>(null);
async function openForm(s: SurveySummary | null) {
  editing.value = s ? await engagementApi.survey(s.id).catch(() => null) : null;
  formOpen.value = true;
}
async function reload() {
  rates.value = {};
  await Promise.all([table.load(), summary.run()]);
}
async function onSaved() {
  formOpen.value = false;
  feedback.success('Survey saved');
  await reload();
}
async function act(fn: () => Promise<unknown>, success: string, description?: string) {
  try {
    await fn();
    feedback.success(success, description);
    await reload();
  } catch (e) {
    feedback.error('Could not complete the action', e);
  }
}
async function open(s: SurveySummary) {
  if (!(await feedback.confirm({ title: `Open "${s.title}"?`, message: 'Everyone in the audience is notified. Questions and anonymity can no longer change.', confirmLabel: 'Open survey' }))) return;
  await act(() => engagementApi.openSurvey(s.id), 'Survey opened', 'Employees have been asked to respond.');
}
async function close(s: SurveySummary) {
  if (!(await feedback.confirm({ title: `Close "${s.title}"?`, message: 'No more answers are accepted.', confirmLabel: 'Close survey' }))) return;
  await act(() => engagementApi.closeSurvey(s.id), 'Survey closed');
}
async function remove(s: SurveySummary) {
  if (!(await feedback.confirm({ title: `Delete "${s.title}"?`, message: 'The draft is deleted.', confirmLabel: 'Delete', danger: true }))) return;
  await act(() => engagementApi.removeSurvey(s.id), 'Draft deleted');
}
const columns: TableColumn<SurveySummary>[] = [
  { key: 'title', label: 'Survey' },
  { key: 'status', label: 'Status' },
  { key: 'responses', label: 'Response rate', class: 'w-52' },
  { key: 'actions', label: '', align: 'right' },
];
const onRow = (s: SurveySummary) => (s.status === 'DRAFT' ? void openForm(s) : void router.push(`/hr/engagement/surveys/${s.id}`));

// ---- Summary -------------------------------------------------------------------------------------------------------
const summary = useAsync(() => fetchAllPages((page, pageSize) => engagementApi.surveys({ manage: true, page, pageSize })));
const everything = computed(() => summary.data.value ?? []);
const ofStatus = (s: SurveyStatus) => everything.value.filter((x) => x.status === s);
const pastClosing = computed(() => ofStatus('OPEN').filter((s) => !s.open));
const stripItems = computed<StripItem[]>(() => [
  { key: 'OPEN', label: 'Open', value: ofStatus('OPEN').length, tone: 'success', hint: pastClosing.value.length ? `${pastClosing.value.length} past closing time` : 'Collecting answers' },
  { key: 'DRAFT', label: 'Drafts', value: ofStatus('DRAFT').length, tone: 'neutral', hint: ofStatus('DRAFT').length ? 'Not sent yet' : 'Nothing waiting' },
  { key: 'CLOSED', label: 'Closed', value: ofStatus('CLOSED').length, tone: 'warning', hint: 'Results final' },
  { key: 'rate', label: 'Avg. response rate', value: avgRate.value === null ? '—' : `${avgRate.value}%`, tone: 'info', hint: openRates.value.length ? `Across ${openRates.value.length} open survey${openRates.value.length === 1 ? '' : 's'}` : 'No open surveys' },
]);
const selectStrip = (key: string | null) => {
  if (key === 'rate') return;
  table.filters.status = (key ?? undefined) as SurveyStatus | undefined;
};

// ---- Response rates (the existing results read, cached per survey) -----------------------------------------------------
const rates = ref<Record<string, Pick<SurveyResults, 'audience' | 'responseRate' | 'hidden' | 'threshold'>>>({});
const pending = new Set<string>();
async function loadRates(list: SurveySummary[]) {
  const todo = list.filter((s) => s.status !== 'DRAFT' && !rates.value[s.id] && !pending.has(s.id));
  todo.forEach((s) => pending.add(s.id));
  await Promise.all(
    todo.map(async (s) => {
      try {
        const r = await engagementApi.results(s.id);
        rates.value = { ...rates.value, [s.id]: { audience: r.audience, responseRate: r.responseRate, hidden: r.hidden, threshold: r.threshold } };
      } catch {
        // The row shows the plain response count.
      } finally {
        pending.delete(s.id);
      }
    }),
  );
}
watch(() => table.rows.value, (rows) => void loadRates(rows), { immediate: true });
watch(() => ofStatus('OPEN'), (open) => void loadRates(open));
const openRates = computed(() => ofStatus('OPEN').filter((s) => rates.value[s.id]?.responseRate != null));
const avgRate = computed(() => (openRates.value.length ? Math.round(openRates.value.reduce((n, s) => n + rates.value[s.id]!.responseRate!, 0) / openRates.value.length) : null));
const rateTone = (r: number) => (r >= 70 ? 'stroke-success' : r >= 40 ? 'stroke-brand-500' : 'stroke-warning');
const R = 15;
const CIRC = 2 * Math.PI * R;
const daysLeft = (s: SurveySummary) => (s.closesAt ? Math.ceil((new Date(s.closesAt).getTime() - Date.now()) / 86_400_000) : null);

// ---- Needs attention ---------------------------------------------------------------------------------------------------
const attention = computed(() => {
  const out: { id: string; icon: typeof Lock; tone: string; title: string; text: string; action: string; run: () => void }[] = [];
  for (const s of pastClosing.value) out.push({ id: `pc${s.id}`, icon: Clock, tone: 'bg-warning-soft text-warning-fg', title: s.title, text: `Past its closing time (${formatDateTime(s.closesAt)}) but still open`, action: 'Close', run: () => void close(s) });
  for (const s of ofStatus('OPEN').filter((x) => x.open)) {
    const r = rates.value[s.id];
    const left = daysLeft(s);
    if (r?.hidden) out.push({ id: `h${s.id}`, icon: ShieldCheck, tone: 'bg-info-soft text-info-fg', title: s.title, text: `Results unlock at ${r.threshold} responses (${s.responses ?? 0} so far)`, action: 'Results', run: () => void router.push(`/hr/engagement/surveys/${s.id}`) });
    else if (r?.responseRate != null && r.responseRate < 50)
      out.push({ id: `r${s.id}`, icon: BarChart3, tone: r.responseRate < 25 ? 'bg-danger-soft text-danger-fg' : 'bg-warning-soft text-warning-fg', title: s.title, text: `Low response: ${r.responseRate}% · ${Math.max(0, r.audience - (s.responses ?? 0))} yet to answer${left !== null && left <= 7 ? ` · closes in ${left} day${left === 1 ? '' : 's'}` : ''}`, action: 'Results', run: () => void router.push(`/hr/engagement/surveys/${s.id}`) });
  }
  const drafts = ofStatus('DRAFT').length;
  if (drafts) out.push({ id: 'drafts', icon: FileClock, tone: 'bg-surface-muted text-fg-muted', title: `${drafts} draft${drafts === 1 ? '' : 's'} not sent`, text: 'Open a draft to notify its audience', action: 'Show drafts', run: () => (table.filters.status = 'DRAFT') });
  return out;
});
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Surveys" description="Pulse checks and engagement surveys, anonymous by default.">
      <template #actions><AppButton :icon="Plus" @click="openForm(null)">New survey</AppButton></template>
    </AppPageHeader>

    <AppStatStrip :items="stripItems" :loading="summary.loading.value && !summary.data.value" selectable :selected="table.filters.status ?? null" label="Surveys by status — select to filter" @select="selectStrip" />

    <AppCard v-if="attention.length" title="Needs follow-up" :icon="ListChecks" :description="`${attention.length} thing${attention.length === 1 ? '' : 's'} to check on`" :padded="false">
      <ul class="grid gap-px bg-line/70 md:grid-cols-2">
        <li v-for="it in attention" :key="it.id" class="flex items-center gap-3 bg-surface px-4 py-3 md:last:odd:col-span-2">
          <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', it.tone]" aria-hidden="true"><component :is="it.icon" :size="16" /></span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-fg">{{ it.title }}</p>
            <p class="truncate text-xs text-fg-muted">{{ it.text }}</p>
          </div>
          <AppButton size="sm" variant="secondary" :icon-right="ChevronRight" @click="it.run">{{ it.action }}</AppButton>
        </li>
      </ul>
    </AppCard>

    <AppCard :padded="false">
      <div class="flex items-center justify-end gap-2 border-b border-line/70 px-4 py-2">
        <AppSelect size="sm" v-model="table.filters.status" class="w-52" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </div>
      <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Surveys" empty-title="No surveys yet" empty-description="Run a quick pulse check or a full engagement survey — rating, eNPS, choice and free-text questions." @page="table.setPage" @retry="table.load" @row-click="onRow" :filtered="table.isFiltered.value" @clear="table.clearFilters()">
        <template #empty><AppButton :icon="Plus" @click="openForm(null)">New survey</AppButton></template>
        <template #cell-title="{ row }">
          <div class="flex min-w-0 items-center gap-3">
            <span :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', row.status === 'OPEN' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' : row.status === 'DRAFT' ? 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300' : 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300']" aria-hidden="true">
              <ClipboardList :size="18" />
            </span>
            <div class="min-w-0">
              <p class="flex flex-wrap items-center gap-1.5 font-medium text-fg">
                <span class="truncate">{{ row.title }}</span>
                <span :class="['inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-medium', row.anonymous ? 'bg-special-soft text-special-fg' : 'bg-surface-muted text-fg-muted']">
                  <component :is="row.anonymous ? Lock : UserRound" :size="10" aria-hidden="true" />{{ row.anonymous ? 'Anonymous' : 'Named' }}
                </span>
              </p>
              <p class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
                <span>{{ row.questions }} question{{ row.questions === 1 ? '' : 's' }}</span>
                <span aria-hidden="true">·</span>
                <span class="inline-flex items-center gap-0.5"><component :is="row.departmentIds?.length ? Target : Globe" :size="11" aria-hidden="true" />{{ row.departmentIds?.length ? 'targeted' : 'everyone' }}</span>
                <template v-if="row.openedAt"><span aria-hidden="true">·</span><span>opened {{ timeAgo(row.openedAt) }}</span></template>
                <template v-if="row.closedAt"><span aria-hidden="true">·</span><span>closed {{ timeAgo(row.closedAt) }}</span></template>
                <template v-else-if="row.closesAt"><span aria-hidden="true">·</span><span :class="row.status === 'OPEN' && daysLeft(row) !== null && daysLeft(row)! <= 3 ? 'font-medium text-warning-fg' : ''">closes {{ formatDateTime(row.closesAt) }}</span></template>
              </p>
            </div>
          </div>
        </template>
        <template #cell-status="{ row }"><AppBadge :tone="row.status === 'OPEN' && !row.open ? 'warning' : surveyTone[row.status]" dot>{{ row.status === 'OPEN' && !row.open ? 'Past closing time' : SURVEY_STATUS_LABELS[row.status] }}</AppBadge></template>
        <template #cell-responses="{ row }">
          <span v-if="row.status === 'DRAFT'" class="text-xs text-fg-subtle">—</span>
          <div v-else class="flex items-center gap-3">
            <div class="relative h-10 w-10 shrink-0">
              <svg class="h-full w-full -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" :r="R" fill="none" stroke-width="4" class="stroke-surface-muted" />
                <circle v-if="rates[row.id]?.responseRate != null" cx="18" cy="18" :r="R" fill="none" stroke-width="4" stroke-linecap="round" :class="rateTone(rates[row.id]!.responseRate!)" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - Math.min(100, rates[row.id]!.responseRate!) / 100)" />
              </svg>
              <span class="absolute inset-0 flex items-center justify-center text-2xs font-semibold text-fg tabular-nums">{{ rates[row.id]?.responseRate != null ? `${rates[row.id]!.responseRate}%` : '' }}</span>
            </div>
            <div class="min-w-0 text-xs">
              <p class="text-fg"><span class="font-semibold tabular-nums">{{ row.responses }}</span> response{{ row.responses === 1 ? '' : 's' }}</p>
              <p v-if="rates[row.id]" class="text-fg-muted">of {{ rates[row.id]!.audience }} invited</p>
              <p v-if="rates[row.id]?.hidden" class="text-2xs text-info-fg">Hidden until {{ rates[row.id]!.threshold }}</p>
            </div>
          </div>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-1" @click.stop>
            <AppButton v-if="row.status !== 'DRAFT'" size="sm" variant="secondary" :icon="BarChart3" @click="router.push(`/hr/engagement/surveys/${row.id}`)">Results</AppButton>
            <AppButton v-if="row.status !== 'CLOSED'" size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${row.title}`" @click="openForm(row)" />
            <AppButton v-if="row.status === 'DRAFT'" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${row.title}`" @click="remove(row)" />
            <AppButton v-if="row.status === 'OPEN'" size="sm" variant="ghost" :icon="Lock" :aria-label="`Close ${row.title}`" @click="close(row)" />
            <AppButton v-if="row.status === 'DRAFT'" size="sm" :icon="Rocket" @click="open(row)">Open</AppButton>
          </div>
        </template>
      </AppDataTable>
    </AppCard>
    <SurveyFormModal :open="formOpen" :survey="editing" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
