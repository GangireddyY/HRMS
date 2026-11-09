<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CalendarClock, CircleCheckBig, ClipboardCheck, FilterX, ListChecks, Rocket, UserPlus, XCircle } from '@lucide/vue';
import type { OnboardingCaseStatus } from '@contracts';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import StartOnboardingModal from '@/modules/onboarding/components/StartOnboardingModal.vue';
import type { CaseDetail, CaseSummary, JoinerRef } from '@/modules/onboarding/types';
import { STAGE_LABELS, caseStage, daysFromToday, joinRelative, stageTone } from '@/modules/onboarding/utils/onboarding-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppStatStrip, AppTabs, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate } from '@/shared/utils/format';

/** HR's joiners pipeline: who joins soon, who is mid-onboarding, what is overdue or waiting for a check. */
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('onboarding.manage'));
const status = ref<OnboardingCaseStatus>('IN_PROGRESS');
const table = useTable((q) => onboardingApi.cases({ ...q, status: status.value }));
watch(status, () => void table.load());
const joiners = useAsync(() => (canManage.value ? onboardingApi.joiners() : Promise.resolve([])));
const templates = useAsync(() => onboardingApi.templates());

// Every open case for the pipeline counts and stage filters; the other tabs only need totals.
const summary = useAsync(() =>
  Promise.all([
    fetchAllPages((page, pageSize) => onboardingApi.cases({ status: 'IN_PROGRESS', page, pageSize })),
    onboardingApi.cases({ status: 'COMPLETED', page: 1, pageSize: 1 }),
    onboardingApi.cases({ status: 'CANCELLED', page: 1, pageSize: 1 }),
  ]),
);
const open = computed(() => summary.data.value?.[0] ?? []);
const tabs = computed(() => [
  { key: 'IN_PROGRESS', label: 'In progress', icon: Rocket, count: summary.data.value?.[0].length ?? null },
  { key: 'COMPLETED', label: 'Completed', icon: CircleCheckBig, count: summary.data.value?.[1].meta.total ?? null },
  { key: 'CANCELLED', label: 'Cancelled', icon: XCircle, count: summary.data.value?.[2].meta.total ?? null },
]);

type Lane = 'soon' | 'started' | 'overdue' | 'verify' | 'ready';
const LANES: Record<Lane, { label: string; test: (c: CaseSummary) => boolean }> = {
  soon: { label: 'Joining soon', test: (c) => caseStage(c) === 'preboarding' },
  started: { label: 'Onboarding now', test: (c) => ['first-week', 'settling'].includes(caseStage(c)) },
  overdue: { label: 'With overdue tasks', test: (c) => c.progress.overdue > 0 },
  verify: { label: 'Documents to verify', test: (c) => c.progress.awaitingVerification > 0 },
  ready: { label: 'Ready to complete', test: (c) => caseStage(c) === 'ready' },
};
const lane = ref<Lane | null>(null);
watch(status, () => (lane.value = null));
const count = (l: Lane) => open.value.filter(LANES[l].test).length;
const nextJoiner = computed(() => open.value.filter((c) => daysFromToday(c.joiningDate) > 0).sort((a, b) => a.joiningDate.localeCompare(b.joiningDate))[0] ?? null);
const strip = computed<StripItem[]>(() => {
  const overdueTasks = open.value.reduce((s, c) => s + c.progress.overdue, 0);
  const toVerify = open.value.reduce((s, c) => s + c.progress.awaitingVerification, 0);
  return [
    { key: 'soon', label: LANES.soon.label, value: count('soon'), tone: 'info', hint: nextJoiner.value ? `Next: ${nextJoiner.value.employee.name.split(' ')[0]}, ${formatDate(nextJoiner.value.joiningDate)}` : 'No one due to join' },
    { key: 'started', label: LANES.started.label, value: count('started'), tone: 'brand', hint: 'Joined, checklist open' },
    { key: 'overdue', label: LANES.overdue.label, value: count('overdue'), tone: 'danger', hint: overdueTasks ? `${overdueTasks} task${overdueTasks === 1 ? '' : 's'} past due` : 'Nothing overdue' },
    { key: 'verify', label: LANES.verify.label, value: count('verify'), tone: 'warning', hint: toVerify ? `${toVerify} upload${toVerify === 1 ? '' : 's'} to check` : 'Nothing to check' },
    { key: 'ready', label: LANES.ready.label, value: count('ready'), tone: 'success', hint: 'All required tasks done' },
  ];
});

/** A lane filters the open cases on this page; otherwise the server-paged list is shown. */
const laneRows = computed(() => {
  if (!lane.value) return null;
  const q = table.search.value.trim().toLowerCase();
  return open.value.filter(LANES[lane.value].test).filter((c) => !q || c.employee.name.toLowerCase().includes(q) || c.employee.employeeCode.toLowerCase().includes(q));
});

const startFor = ref<JoinerRef | null>(null);
async function onStarted(detail: CaseDetail) {
  startFor.value = null;
  feedback.success('Onboarding started', `${detail.employee.name} and their manager have been notified.`);
  await router.push(`/hr/onboarding/${detail.id}`);
}
function startOnboarding() {
  const list = joiners.data.value ?? [];
  if (list.length === 1) startFor.value = list[0]!;
  else document.getElementById('joiners-waiting')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const columns: TableColumn<CaseSummary>[] = [
  { key: 'employee', label: 'Joiner' },
  { key: 'joiningDate', label: 'Joining' },
  { key: 'stage', label: 'Stage' },
  { key: 'progress', label: 'Checklist' },
  { key: 'attention', label: '' },
];
const pct = (c: CaseSummary) => (c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0);
const joinTone = (c: CaseSummary) => (c.status !== 'IN_PROGRESS' ? 'text-fg-muted' : daysFromToday(c.joiningDate) > 0 ? 'text-info-fg' : 'text-fg-muted');
const joinerHint = (iso: string) => {
  const d = daysFromToday(iso);
  return d > 0 ? joinRelative(iso) : d === 0 ? 'Joined today' : `Joined ${-d} day${d === -1 ? '' : 's'} ago`;
};
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Onboarding" description="Joining checklists for new employees: documents, accounts, introductions and first-month check-ins.">
      <template #actions>
        <AppButton variant="secondary" :icon="ClipboardCheck" to="/hr/onboarding/probation">Probation</AppButton>
        <AppButton variant="secondary" :icon="ListChecks" to="/hr/onboarding/checklists">Checklists</AppButton>
        <AppButton v-if="canManage && joiners.data.value?.length" :icon="Rocket" :disabled="!templates.data.value" @click="startOnboarding">Start onboarding</AppButton>
      </template>
    </AppPageHeader>

    <section v-if="canManage && joiners.data.value?.length" id="joiners-waiting" class="card overflow-hidden scroll-mt-4" aria-labelledby="joiners-title">
      <header class="flex flex-wrap items-center gap-3 border-b border-line/70 bg-warning-soft/40 px-4 py-3">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warning-soft text-warning-fg ring-1 ring-warning/30 ring-inset" aria-hidden="true"><UserPlus :size="16" /></span>
        <div class="min-w-0 flex-1">
          <h2 id="joiners-title" class="text-sm font-semibold text-fg">Waiting to start onboarding</h2>
          <p class="text-xs text-fg-muted">{{ joiners.data.value.length }} recent or upcoming joiner{{ joiners.data.value.length === 1 ? '' : 's' }} without a checklist yet. Start one so documents and accounts are ready on day one.</p>
        </div>
      </header>
      <ul class="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        <li v-for="j in joiners.data.value" :key="j.id" class="flex items-center gap-3 rounded-xl p-3 ring-1 ring-line transition hover:ring-line-strong">
          <AppAvatar :name="j.name" size="md" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-fg">{{ j.name }}</p>
            <p class="truncate text-xs text-fg-muted">{{ [j.designation?.name, j.department?.name].filter(Boolean).join(' · ') || j.employeeCode }}</p>
            <p :class="['mt-0.5 inline-flex items-center gap-1 text-xs font-medium', daysFromToday(j.dateOfJoining) >= 0 ? 'text-info-fg' : 'text-warning-fg']">
              <CalendarClock :size="12" aria-hidden="true" />{{ joinerHint(j.dateOfJoining) }} · {{ formatDate(j.dateOfJoining) }}
            </p>
          </div>
          <AppButton size="sm" :icon="Rocket" :disabled="!templates.data.value" :aria-label="`Start onboarding for ${j.name}`" @click="startFor = j">Start</AppButton>
        </li>
      </ul>
    </section>

    <AppTabs v-model="status" :tabs="tabs">
      <div class="space-y-4">
        <AppStatStrip v-if="status === 'IN_PROGRESS'" :items="strip" :loading="summary.loading.value && !summary.data.value" selectable :selected="lane" label="Onboarding pipeline" @select="(k) => (lane = k as Lane | null)" />

        <AppCard :padded="false">
          <div class="flex flex-wrap items-center gap-3 border-b border-line p-4">
            <AppSearchInput v-model="table.search.value" class="min-w-56 flex-1" placeholder="Search name or code" aria-label="Search onboarding" />
            <p v-if="lane" class="inline-flex items-center gap-2 rounded-full bg-accent-soft py-1 ps-3 pe-1 text-xs font-medium text-accent-fg">
              {{ LANES[lane].label }}
              <button type="button" class="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-brand-500/15" :aria-label="`Clear the ${LANES[lane].label} filter`" @click="lane = null"><FilterX :size="12" aria-hidden="true" /></button>
            </p>
          </div>
          <AppDataTable
            :columns="columns"
            :rows="laneRows ?? table.rows.value"
            :loading="laneRows ? summary.loading.value : table.loading.value"
            :error="laneRows ? summary.error.value : table.error.value"
            :meta="laneRows ? null : table.meta.value"
            clickable
            caption="Onboarding cases"
            layout-key="hr-onboarding-cases"
            :empty-title="status === 'IN_PROGRESS' ? 'No onboarding in progress' : status === 'COMPLETED' ? 'No completed onboarding yet' : 'No cancelled onboarding'"
            :empty-description="status === 'IN_PROGRESS' && canManage ? 'New joiners without onboarding appear above with a Start button.' : undefined"
            :filtered="!!lane || table.isFiltered.value"
            @page="table.setPage"
            @retry="laneRows ? summary.run() : table.load()"
            @row-click="(row) => router.push(`/hr/onboarding/${row.id}`)"
            @clear="lane = null; table.clearFilters()"
          >
            <template #cell-employee="{ row }">
              <div class="flex items-center gap-3">
                <AppAvatar :name="row.employee.name" size="md" />
                <div class="min-w-0">
                  <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
                  <p class="truncate text-xs text-fg-muted">{{ [row.employee.designation?.name, row.employee.department?.name].filter(Boolean).join(' · ') || row.employee.employeeCode }}</p>
                </div>
              </div>
            </template>
            <template #cell-joiningDate="{ row }">
              <p class="whitespace-nowrap text-fg tabular-nums">{{ formatDate(row.joiningDate) }}</p>
              <p :class="['text-xs whitespace-nowrap', joinTone(row)]">
                <template v-if="row.status === 'IN_PROGRESS'">{{ joinRelative(row.joiningDate) }}</template>
                <template v-else-if="row.completedAt">Completed {{ formatDate(row.completedAt) }}</template>
                <template v-else-if="row.cancelledAt">Cancelled {{ formatDate(row.cancelledAt) }}</template>
              </p>
            </template>
            <template #cell-stage="{ row }">
              <AppBadge :tone="stageTone[caseStage(row)]" size="sm" dot>{{ STAGE_LABELS[caseStage(row)] }}</AppBadge>
            </template>
            <template #cell-progress="{ row }">
              <div class="flex min-w-44 items-center gap-3">
                <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="pct(row)" aria-valuemin="0" aria-valuemax="100" :aria-label="`${row.employee.name}: checklist progress`">
                  <div :class="['h-full rounded-full', pct(row) === 100 || caseStage(row) === 'ready' ? 'bg-success' : 'bg-brand-500']" :style="{ width: `${pct(row)}%` }" />
                </div>
                <span class="w-16 text-end text-xs text-fg-muted tabular-nums"><span class="font-medium text-fg">{{ pct(row) }}%</span> · {{ row.progress.done }}/{{ row.progress.total }}</span>
              </div>
            </template>
            <template #cell-attention="{ row }">
              <div class="flex flex-wrap justify-end gap-1.5">
                <AppBadge v-if="row.progress.overdue && row.status === 'IN_PROGRESS'" tone="danger" size="sm" dot>{{ row.progress.overdue }} overdue</AppBadge>
                <AppBadge v-if="row.progress.awaitingVerification" tone="warning" size="sm" dot>{{ row.progress.awaitingVerification }} to verify</AppBadge>
                <AppBadge v-if="row.status === 'IN_PROGRESS' && !row.progress.requiredOpen" tone="success" size="sm" dot>Ready to complete</AppBadge>
              </div>
            </template>
          </AppDataTable>
        </AppCard>
      </div>
    </AppTabs>

    <StartOnboardingModal :open="!!startFor" :employee="startFor" :templates="templates.data.value ?? []" @close="startFor = null" @started="onStarted" />
  </div>
</template>
