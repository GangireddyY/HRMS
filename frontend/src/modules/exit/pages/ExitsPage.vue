<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { AlertTriangle, ArrowRight, CalendarClock, ClipboardCheck, GraduationCap, Inbox, ListFilter, Plus, Wallet } from '@lucide/vue';
import { EXIT_STATUSES, type ExitStatus } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { exitApi } from '@/modules/exit/api/exit.api';
import ExitStageMeter from '@/modules/exit/components/ExitStageMeter.vue';
import InitiateExitModal from '@/modules/exit/components/InitiateExitModal.vue';
import type { ExitDetail, ExitSummary } from '@/modules/exit/types';
import { REASON_LABELS, SETTLEMENT_LABELS, STATUS_LABELS, TYPE_LABELS, daysUntil, inr, relativeDays, settlementTone } from '@/modules/exit/utils/exit-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, AppStatStrip, AppTabs, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate } from '@/shared/utils/format';

/** HR's exits pipeline: resignations to accept, people serving notice with their last-day countdown, clearance and settlement. */
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canApprove = auth.can('exit.approve') || auth.can('exit.manage');
const table = useTable((q) => exitApi.list(q), { filters: { view: (canApprove ? 'approve' : 'all') as 'all' | 'approve', status: undefined as ExitStatus | 'OPEN' | undefined } });
const view = computed({ get: () => table.filters.view, set: (v: string) => (table.filters.view = v as 'all' | 'approve') });
const statusOptions = [{ value: 'OPEN', label: 'Open' }, ...EXIT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))];
const recording = ref(false);
async function onRecorded(e: ExitDetail) {
  recording.value = false;
  feedback.success('Exit recorded', 'Clearance has started.');
  await router.push(`/hr/exits/${e.id}`);
}

// Pipeline counts and the attention list: every open and completed exit, and the size of the approval queue.
const summary = useAsync(() =>
  Promise.all([
    fetchAllPages((page, pageSize) => exitApi.list({ view: 'all', status: 'OPEN', page, pageSize })),
    fetchAllPages((page, pageSize) => exitApi.list({ view: 'all', status: 'COMPLETED', page, pageSize })),
    canApprove ? exitApi.list({ view: 'approve', page: 1, pageSize: 1 }) : Promise.resolve(null),
  ]),
);
const openExits = computed(() => summary.data.value?.[0] ?? []);
const completed = computed(() => summary.data.value?.[1] ?? []);
const serving = computed(() => openExits.value.filter((e) => e.status === 'APPROVED'));
const nextLeaver = computed(() => [...serving.value].filter((e) => e.lastWorkingDay && daysUntil(e.lastWorkingDay) >= 0).sort((a, b) => a.lastWorkingDay!.localeCompare(b.lastWorkingDay!))[0] ?? null);
const tabs = computed(() => [
  ...(canApprove ? [{ key: 'approve', label: 'Waiting for me', icon: Inbox, count: summary.data.value?.[2]?.meta.total ?? null }] : []),
  { key: 'all', label: 'All exits', icon: ListFilter },
]);

const strip = computed<StripItem[]>(() => {
  const submitted = openExits.value.filter((e) => e.status === 'SUBMITTED').length;
  const leavingSoon = serving.value.filter((e) => e.lastWorkingDay && daysUntil(e.lastWorkingDay) <= 14).length;
  const unpaid = completed.value.filter((e) => e.settlement?.status !== 'PAID').length;
  return [
    { key: 'SUBMITTED', label: 'Waiting for acceptance', value: submitted, tone: 'warning', hint: submitted ? 'Accept and confirm the last day' : 'Nothing to accept' },
    {
      key: 'APPROVED',
      label: 'Serving notice',
      value: serving.value.length,
      tone: 'info',
      hint: nextLeaver.value ? `Next: ${nextLeaver.value.employee?.name.split(' ')[0]}, ${relativeDays(nextLeaver.value.lastWorkingDay!)}` : leavingSoon ? `${leavingSoon} leaving in 14 days` : 'No one leaving soon',
    },
    { key: 'COMPLETED', label: 'Exited', value: summary.data.value?.[1].length ?? null, tone: 'neutral', hint: unpaid ? `${unpaid} without a paid settlement` : 'All settlements paid' },
  ];
});
const selected = computed(() => (table.filters.view === 'all' && typeof table.filters.status === 'string' && ['SUBMITTED', 'APPROVED', 'COMPLETED'].includes(table.filters.status) ? table.filters.status : null));
function selectStage(k: string | null) {
  table.filters.view = 'all';
  table.filters.status = (k ?? undefined) as ExitStatus | undefined;
}

/** What needs someone's attention first, most urgent on top. */
const attention = computed(() => {
  const out: { id: string; name: string; text: string; tone: 'danger' | 'warning'; icon: typeof AlertTriangle; order: number }[] = [];
  for (const e of openExits.value) {
    const name = e.employee?.name ?? 'Former employee';
    if (e.status === 'SUBMITTED') out.push({ id: e.id, name, text: `${TYPE_LABELS[e.type]} waiting for acceptance since ${formatDate(e.submittedOn)}`, tone: 'warning', icon: Inbox, order: 2 });
    if (e.status === 'APPROVED' && e.lastWorkingDay) {
      const d = daysUntil(e.lastWorkingDay);
      const pending = e.clearance.total - e.clearance.done;
      if (d < 0) out.push({ id: e.id, name, text: `Last day was ${formatDate(e.lastWorkingDay)} — complete the exit`, tone: 'danger', icon: AlertTriangle, order: 0 });
      else if (d <= 14 && pending) out.push({ id: e.id, name, text: `Leaves ${relativeDays(e.lastWorkingDay)} · ${pending} clearance step${pending === 1 ? '' : 's'} pending`, tone: 'warning', icon: ClipboardCheck, order: 1 });
    }
  }
  for (const e of [...openExits.value, ...completed.value])
    if (e.settlement?.overdue) out.push({ id: e.id, name: e.employee?.name ?? 'Former employee', text: `Settlement of ${inr(e.settlement.netPayable)} overdue since ${formatDate(e.settlement.dueOn)}`, tone: 'danger', icon: Wallet, order: 0 });
  return out.sort((a, b) => a.order - b.order).slice(0, 6);
});

const columns: TableColumn<ExitSummary>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'type', label: 'Exit' },
  { key: 'stage', label: 'Stage' },
  { key: 'dates', label: 'Last working day' },
  { key: 'clearance', label: 'Clearance' },
  { key: 'settlement', label: 'Settlement' },
];
const lastDay = (e: ExitSummary) => e.lastWorkingDay ?? e.requestedLastDay ?? null;
function countdown(e: ExitSummary): { text: string; cls: string } | null {
  const iso = lastDay(e);
  if (!iso || e.status === 'WITHDRAWN' || e.status === 'CANCELLED') return null;
  if (e.status === 'COMPLETED') return { text: `Left ${relativeDays(iso)}`, cls: 'bg-surface-muted text-fg-muted ring-line' };
  const d = daysUntil(iso);
  if (d < 0) return { text: `${-d} day${d === -1 ? '' : 's'} past`, cls: 'bg-danger-soft text-danger-fg ring-danger/20' };
  if (d === 0) return { text: 'Last day today', cls: 'bg-warning-soft text-warning-fg ring-warning/25' };
  return { text: `${d} day${d === 1 ? '' : 's'} to go`, cls: d <= 14 ? 'bg-warning-soft text-warning-fg ring-warning/25' : 'bg-info-soft text-info-fg ring-info/20' };
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Exits" description="Resignations, notice periods, clearance and full & final settlements.">
      <template #actions>
        <AppButton v-if="auth.can('exit.manage') || auth.can('exit.view')" variant="secondary" :icon="GraduationCap" to="/hr/alumni">Alumni</AppButton>
        <AppButton v-if="auth.can('exit.manage')" :icon="Plus" @click="recording = true">Record exit</AppButton>
      </template>
    </AppPageHeader>

    <AppStatStrip :items="strip" :loading="summary.loading.value && !summary.data.value" selectable :selected="selected" label="Exits pipeline" @select="selectStage" />

    <section v-if="attention.length" class="card overflow-hidden" aria-labelledby="exits-attention">
      <header class="flex items-center gap-3 border-b border-line/70 px-4 py-2.5">
        <span class="flex h-7 w-7 items-center justify-center rounded-md bg-warning-soft text-warning-fg" aria-hidden="true"><AlertTriangle :size="14" /></span>
        <h2 id="exits-attention" class="text-sm font-semibold text-fg">Needs attention</h2>
        <span class="rounded-full bg-surface-muted px-2 text-2xs font-semibold text-fg-muted tabular-nums">{{ attention.length }}</span>
      </header>
      <ul class="divide-y divide-line/60">
        <li v-for="a in attention" :key="`${a.id}-${a.text}`">
          <RouterLink :to="`/hr/exits/${a.id}`" class="group flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-muted/50">
            <AppAvatar :name="a.name" size="sm" />
            <span class="min-w-0 flex-1 truncate text-sm">
              <span class="font-medium text-fg">{{ a.name }}</span>
              <span :class="['ms-2', a.tone === 'danger' ? 'text-danger-fg' : 'text-warning-fg']"><component :is="a.icon" :size="12" class="me-1 inline -translate-y-px" aria-hidden="true" />{{ a.text }}</span>
            </span>
            <ArrowRight :size="15" class="shrink-0 text-fg-subtle transition group-hover:translate-x-0.5" aria-hidden="true" />
          </RouterLink>
        </li>
      </ul>
    </section>

    <AppTabs v-model="view" :tabs="tabs">
      <AppCard :padded="false">
        <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_220px]">
          <AppSearchInput v-model="table.search.value" placeholder="Search by name or code" aria-label="Search exits" />
          <AppSelect v-if="view === 'all'" v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          clickable
          caption="Exits"
          layout-key="hr-exits"
          :empty-title="view === 'approve' ? 'No resignations waiting' : 'No exits'"
          :empty-description="view === 'approve' ? 'Resignations you can accept appear here. Exits already accepted are under All exits.' : undefined"
          @page="table.setPage"
          @retry="table.load"
          @row-click="(e: ExitSummary) => router.push(`/hr/exits/${e.id}`)"
          :filtered="table.isFiltered.value"
          @clear="table.clearFilters()"
        >
          <template #empty>
            <AppButton v-if="view === 'approve'" variant="secondary" size="sm" :icon="ListFilter" @click="view = 'all'">See all exits</AppButton>
          </template>
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee?.name ?? '?'" size="md" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee?.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ [row.employee?.designation, row.employee?.department].filter(Boolean).join(' · ') || row.employee?.employeeCode }}</p>
              </div>
            </div>
          </template>
          <template #cell-type="{ row }">
            <p class="text-fg">{{ TYPE_LABELS[row.type] }}</p>
            <p class="text-xs whitespace-nowrap text-fg-muted">{{ REASON_LABELS[row.reason] }}</p>
          </template>
          <template #cell-stage="{ row }"><ExitStageMeter :exit="row" /></template>
          <template #cell-dates="{ row }">
            <div class="flex flex-wrap items-center gap-2 max-md:justify-end">
              <span class="whitespace-nowrap text-fg tabular-nums">{{ lastDay(row) ? formatDate(lastDay(row)) : '—' }}</span>
              <span v-if="countdown(row)" :class="['rounded-full px-2 py-px text-2xs font-semibold whitespace-nowrap ring-1 ring-inset tabular-nums', countdown(row)!.cls]">{{ countdown(row)!.text }}</span>
            </div>
            <p class="text-xs text-fg-muted">
              <template v-if="!row.lastWorkingDay && row.requestedLastDay">Asked for · </template>notice ends {{ formatDate(row.noticeEndsOn) }}<template v-if="row.shortfallDays && !row.noticeWaived"> · <span class="text-warning-fg">{{ row.shortfallDays }} days short</span></template><template v-if="row.noticeWaived"> · waived</template>
            </p>
          </template>
          <template #cell-clearance="{ row }">
            <div v-if="row.clearance.total" class="flex min-w-28 items-center gap-2">
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="row.clearance.done" aria-valuemin="0" :aria-valuemax="row.clearance.total" :aria-label="`${row.employee?.name}: clearance`">
                <div :class="['h-full rounded-full', row.clearance.done === row.clearance.total ? 'bg-success' : 'bg-brand-500']" :style="{ width: `${(row.clearance.done / row.clearance.total) * 100}%` }" />
              </div>
              <span class="text-xs text-fg-muted tabular-nums">{{ row.clearance.done }}/{{ row.clearance.total }}</span>
            </div>
            <span v-else class="text-xs text-fg-subtle">Not started</span>
          </template>
          <template #cell-settlement="{ row }">
            <template v-if="row.settlement">
              <AppBadge :tone="row.settlement.overdue ? 'danger' : settlementTone[row.settlement.status]" size="sm" dot>{{ SETTLEMENT_LABELS[row.settlement.status] }}{{ row.settlement.overdue ? ' · overdue' : '' }}</AppBadge>
              <p class="mt-0.5 text-xs text-fg-muted tabular-nums">{{ inr(row.settlement.netPayable) }}<template v-if="row.settlement.status !== 'PAID'"> · due {{ formatDate(row.settlement.dueOn) }}</template></p>
            </template>
            <span v-else class="inline-flex items-center gap-1 text-xs whitespace-nowrap text-fg-subtle"><CalendarClock :size="12" aria-hidden="true" />{{ row.status === 'APPROVED' || row.status === 'COMPLETED' ? 'Not worked out' : '—' }}</span>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>
    <InitiateExitModal :open="recording" @close="recording = false" @saved="onRecorded" />
  </div>
</template>
