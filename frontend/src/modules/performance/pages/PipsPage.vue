<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { AlertCircle, CalendarClock, CheckCircle2, ChevronRight, EyeOff, LifeBuoy, ListChecks, MessageSquareText, Plus } from '@lucide/vue';
import type { PipStatus } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import PipFormModal from '@/modules/performance/components/PipFormModal.vue';
import PipGridCard from '@/modules/performance/components/PipGridCard.vue';
import type { PipDetail, PipRow } from '@/modules/performance/types';
import { PIP_STATUS_LABELS, pipTone } from '@/modules/performance/utils/performance-format';
import { daysBetween, daysFromToday, pct, plural, relativeDay, todayIso } from '@/modules/performance/utils/performance-ops';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppEmptyState, AppPageHeader, AppSkeleton, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate } from '@/shared/utils/format';

/** Improvement plans you manage: outcomes at a glance, plans that need attention first, and every plan's timeline. */
const router = useRouter();
const feedback = useFeedbackStore();
const table = useTable((q) => performanceApi.pips({ ...q, view: 'managed' }), { filters: { status: 'ACTIVE' as PipStatus | undefined } });
/** Counts and the attention list; the list itself stays paginated. */
const summary = useAsync(() => fetchAllPages((page, pageSize) => performanceApi.pips({ view: 'managed', page, pageSize })));
const formOpen = ref(false);
async function onSaved(p: PipDetail) {
  formOpen.value = false;
  feedback.success('Improvement plan opened', `${p.employee.name} has been notified.`);
  await router.push(`/hr/performance/pips/${p.id}`);
}
const today = todayIso();

const all = computed(() => summary.data.value ?? []);
const ofStatus = (s: PipStatus) => all.value.filter((p) => p.status === s);
const strip = computed<StripItem[]>(() => {
  const active = ofStatus('ACTIVE');
  const late = active.filter((p) => p.overdue).length;
  const unacked = active.filter((p) => !p.acknowledged).length;
  const closed = all.value.length - active.length;
  return [
    { key: 'ACTIVE', label: 'Active', value: active.length, tone: 'warning', hint: [late && `${late} past end date`, unacked && `${unacked} not acknowledged`].filter(Boolean).join(' · ') || (active.length ? 'All on schedule' : 'None running') },
    { key: 'SUCCESSFUL', label: 'Completed successfully', value: ofStatus('SUCCESSFUL').length, tone: 'success', hint: closed ? `${pct(ofStatus('SUCCESSFUL').length, closed)}% of closed plans` : 'None closed yet' },
    { key: 'UNSUCCESSFUL', label: 'Not met', value: ofStatus('UNSUCCESSFUL').length, tone: 'danger', hint: ofStatus('UNSUCCESSFUL').length ? 'Objectives not met' : 'None' },
    { key: 'CANCELLED', label: 'Cancelled', value: ofStatus('CANCELLED').length, tone: 'neutral', hint: ofStatus('CANCELLED').length ? 'Closed early' : 'None' },
    { key: 'all', label: 'All plans', value: all.value.length, tone: 'brand', hint: all.value.length ? `Since ${formatDate([...all.value].sort((a, b) => a.startDate.localeCompare(b.startDate))[0]!.startDate)}` : 'None yet' },
  ];
});
const selectStatus = (k: string | null) => (table.filters.status = !k || k === 'all' ? undefined : (k as PipStatus));

/** Active plans to look at first: past their end date, not acknowledged, or ending within two weeks. */
const attention = computed(() =>
  ofStatus('ACTIVE')
    .map((p) => {
      const left = daysFromToday(p.endDate);
      const reason = p.overdue ? { text: `Ended ${relativeDay(p.endDate)}: record the outcome`, tone: 'danger' as const, icon: AlertCircle } : !p.acknowledged ? { text: 'Not acknowledged by the employee', tone: 'warning' as const, icon: EyeOff } : left <= 14 ? { text: `Ends ${relativeDay(p.endDate)}`, tone: 'info' as const, icon: CalendarClock } : null;
      return reason ? { p, ...reason } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => ({ danger: 0, warning: 1, info: 2 })[a.tone] - ({ danger: 0, warning: 1, info: 2 })[b.tone]),
);

/** Share of the plan's period that has passed. */
const elapsed = (p: PipRow) => Math.min(100, Math.max(0, pct(daysBetween(p.startDate, today), Math.max(1, daysBetween(p.startDate, p.endDate)))));
function timing(p: PipRow) {
  if (p.status !== 'ACTIVE') return null;
  if (p.overdue) return { text: `Ended ${relativeDay(p.endDate)}`, late: true };
  if (p.startDate > today) return { text: `Starts ${relativeDay(p.startDate)}`, late: false };
  return { text: `Day ${daysBetween(p.startDate, today) + 1} of ${daysBetween(p.startDate, p.endDate) + 1} · ends ${relativeDay(p.endDate)}`, late: false };
}

const columns: TableColumn<PipRow>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'period', label: 'Plan period' },
  { key: 'objectives', label: 'Objectives' },
  { key: 'owner', label: 'Owner' },
  { key: 'status', label: 'Status' },
];
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Improvement plans" description="Structured support for people not meeting expectations: objectives, regular check-ins and a recorded outcome.">
      <template #actions><AppButton :icon="Plus" @click="formOpen = true">New plan</AppButton></template>
    </AppPageHeader>

    <AppStatStrip :items="strip" selectable :selected="table.filters.status ?? 'all'" :loading="summary.loading.value && !summary.data.value" label="Plans by outcome" @select="selectStatus" />

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section class="card min-w-0 overflow-hidden" aria-labelledby="pips-title">
        <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
          <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><LifeBuoy :size="16" /></span>
          <div class="min-w-0 flex-1">
            <h2 id="pips-title" class="flex items-center gap-2 text-sm font-semibold text-fg">
              {{ table.filters.status ? `${PIP_STATUS_LABELS[table.filters.status]} plans` : 'All plans' }}
              <AppBadge v-if="table.meta.value" size="sm">{{ table.meta.value.total }}</AppBadge>
            </h2>
            <p class="text-xs text-fg-muted">Pick a figure above to see other outcomes</p>
          </div>
        </header>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          clickable
          caption="Improvement plans"
          :empty-title="table.filters.status === 'ACTIVE' ? 'No active improvement plans' : 'No improvement plans'"
          empty-description="Open a plan when someone needs structured support: agree objectives, check in regularly and record the outcome."
          :filtered="table.isFiltered.value"
          @page="table.setPage"
          @retry="table.load"
          @row-click="(row) => router.push(`/hr/performance/pips/${row.id}`)"
          @clear="table.clearFilters()"
        >
          <template #empty><AppButton :icon="Plus" @click="formOpen = true">New plan</AppButton></template>
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee.name" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ row.employee.department ?? row.employee.employeeCode }}</p>
              </div>
            </div>
          </template>
          <template #cell-period="{ row }">
            <p class="whitespace-nowrap text-fg tabular-nums">{{ formatDate(row.startDate) }} – {{ formatDate(row.endDate) }}</p>
            <template v-if="timing(row)">
              <div class="mt-1 h-1 w-40 overflow-hidden rounded-full bg-surface-muted max-md:ms-auto" role="img" :aria-label="`${elapsed(row)}% of the plan period has passed`">
                <div :class="['h-full rounded-full', timing(row)!.late ? 'bg-danger' : 'bg-warning']" :style="{ width: `${elapsed(row)}%` }" />
              </div>
              <p :class="['mt-0.5 text-2xs', timing(row)!.late ? 'font-medium text-danger-fg' : 'text-fg-muted']">{{ timing(row)!.text }}</p>
            </template>
          </template>
          <template #cell-objectives="{ row }">
            <span class="inline-flex items-center gap-1.5 text-fg-muted"><ListChecks :size="14" aria-hidden="true" /><span class="tabular-nums">{{ row.objectivesCount }}</span></span>
          </template>
          <template #cell-owner="{ row }">
            <span v-if="row.owner" class="inline-flex items-center gap-2 text-fg-muted"><AppAvatar :name="row.owner.name" size="xs" />{{ row.owner.name }}</span>
            <span v-else class="text-fg-subtle">—</span>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :tone="pipTone[row.status]" dot>{{ PIP_STATUS_LABELS[row.status] }}</AppBadge>
            <p v-if="row.overdue" class="mt-0.5 text-xs font-medium text-danger-fg">Past its end date</p>
            <p v-else-if="!row.acknowledged && row.status === 'ACTIVE'" class="mt-0.5 text-xs text-warning-fg">Not acknowledged yet</p>
          </template>
          <template #card="{ row }"><PipGridCard :pip="row" /></template>
        </AppDataTable>
      </section>

      <aside class="space-y-4">
        <AppCard title="Needs attention" :icon="CalendarClock" description="Active plans to look at first" :padded="false">
          <template v-if="attention.length" #actions><span class="rounded-full bg-brand-600 px-2 py-0.5 text-2xs font-semibold text-white tabular-nums">{{ attention.length }}</span></template>
          <AppSkeleton v-if="summary.loading.value && !summary.data.value" class="p-4" :lines="3" />
          <AppEmptyState v-else-if="!attention.length" compact :icon="CheckCircle2" title="Nothing needs attention" description="Plans past their end date, not acknowledged or ending soon show up here." />
          <ul v-else class="divide-y divide-line/60">
            <li v-for="a in attention.slice(0, 6)" :key="a.p.id">
              <RouterLink :to="`/hr/performance/pips/${a.p.id}`" class="group relative flex items-center gap-3 px-4 py-3 transition hover:bg-surface-muted/50">
                <span :class="['absolute inset-y-0 start-0 w-0.5', a.tone === 'danger' ? 'bg-danger' : a.tone === 'warning' ? 'bg-warning' : 'bg-info']" aria-hidden="true" />
                <AppAvatar :name="a.p.employee.name" size="sm" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-fg">{{ a.p.employee.name }}</p>
                  <p :class="['flex items-center gap-1 truncate text-xs', a.tone === 'danger' ? 'text-danger-fg' : 'text-fg-muted']"><component :is="a.icon" :size="12" class="shrink-0" aria-hidden="true" />{{ a.text }}</p>
                </div>
                <ChevronRight :size="16" class="shrink-0 text-fg-subtle transition group-hover:translate-x-0.5" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
        </AppCard>
        <AppCard title="Running a good plan" :icon="MessageSquareText">
          <ol class="space-y-3 text-sm">
            <li v-for="(s, i) in ['Agree specific, measurable objectives and a realistic end date.', 'Check in regularly and record progress, evidence and next steps.', `Close with an outcome: completed, not met, or cancelled.`]" :key="i" class="flex gap-2.5">
              <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-2xs font-semibold text-fg-muted tabular-nums" aria-hidden="true">{{ i + 1 }}</span>
              <span class="text-fg-muted">{{ s }}</span>
            </li>
          </ol>
          <p class="mt-3 text-xs text-fg-subtle">{{ plural(ofStatus('ACTIVE').length, 'plan') }} running now.</p>
        </AppCard>
      </aside>
    </div>
    <PipFormModal :open="formOpen" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
