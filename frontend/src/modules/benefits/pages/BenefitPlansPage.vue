<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRight, CalendarRange, HeartPulse, Hourglass, Plus, ShieldCheck } from '@lucide/vue';
import { BENEFIT_PLAN_STATUSES, type BenefitPlanStatus } from '@contracts';
import { benefitsApi } from '@/modules/benefits/api/benefits.api';
import BenefitPlanGridCard from '@/modules/benefits/components/BenefitPlanGridCard.vue';
import PlanFormModal from '@/modules/benefits/components/PlanFormModal.vue';
import type { Plan } from '@/modules/benefits/types';
import { BENEFIT_TYPE_VISUALS } from '@/modules/benefits/utils/benefit-visuals';
import { PLAN_STATUS_LABELS, TYPE_LABELS, inr, planTone } from '@/modules/benefits/utils/benefits-format';
import { enrolmentWindow, policyTiming } from '@/modules/benefits/utils/plan-window';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** HR's benefit plans: a status strip that filters, requests waiting for approval, and each plan's window, cover and cost. */
const router = useRouter();
const feedback = useFeedbackStore();
const table = useTable((q) => benefitsApi.plans(q), { filters: { status: undefined as BenefitPlanStatus | undefined } });
const statusOptions = BENEFIT_PLAN_STATUSES.map((s) => ({ value: s, label: PLAN_STATUS_LABELS[s] }));
const formOpen = ref(false);
async function onSaved(p: Plan) {
  formOpen.value = false;
  feedback.success('Plan saved', 'Activate it to open enrolment.');
  await router.push(`/hr/benefits/plans/${p.id}`);
}

const counts = useAsync(async () => {
  const [byStatus, pending] = await Promise.all([
    Promise.all(BENEFIT_PLAN_STATUSES.map((status) => benefitsApi.plans({ status, page: 1, pageSize: 1 }).then((r) => r.meta.total))),
    benefitsApi.enrollments({ status: 'PENDING', page: 1, pageSize: 1 }).then((r) => r.meta.total),
  ]);
  return { status: Object.fromEntries(BENEFIT_PLAN_STATUSES.map((s, i) => [s, byStatus[i]!])) as Record<BenefitPlanStatus, number>, pending };
});
const HINTS: Record<BenefitPlanStatus, string> = { ACTIVE: 'Live for employees', DRAFT: 'Activate to open enrolment', ARCHIVED: 'No longer offered' };
const STRIP_ORDER: BenefitPlanStatus[] = ['ACTIVE', 'DRAFT', 'ARCHIVED'];
const strip = computed<StripItem[]>(() =>
  STRIP_ORDER.map((s) => ({ key: s, label: PLAN_STATUS_LABELS[s], value: counts.data.value?.status[s], tone: planTone[s], hint: HINTS[s] })),
);

const columns: TableColumn<Plan>[] = [
  { key: 'name', label: 'Plan' },
  { key: 'period', label: 'Policy period' },
  { key: 'window', label: 'Enrolment' },
  { key: 'status', label: 'Status' },
  { key: 'enrolled', label: 'Covered', align: 'right' },
  { key: 'cost', label: 'Monthly cost', align: 'right' },
];
const total = (p: Plan) => (p.stats?.employerMonthly ?? 0) + (p.stats?.employeeMonthly ?? 0);
const employerPct = (p: Plan) => (total(p) ? Math.round(((p.stats?.employerMonthly ?? 0) / total(p)) * 100) : 0);
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Benefit plans" description="Insurance and other benefits, who is eligible and what employees pay.">
      <template #actions>
        <AppButton variant="secondary" :icon="ShieldCheck" to="/hr/benefits/enrollments">
          Enrolments
          <span v-if="counts.data.value?.pending" class="ms-0.5 rounded-full bg-warning-soft px-1.5 text-2xs font-semibold text-warning-fg tabular-nums">{{ counts.data.value.pending }}</span>
        </AppButton>
        <AppButton :icon="Plus" @click="formOpen = true">New plan</AppButton>
      </template>
    </AppPageHeader>

    <AppStatStrip
      :items="strip"
      selectable
      :selected="table.filters.status ?? null"
      :loading="counts.loading.value && !counts.data.value"
      label="Plans by status"
      @select="(k) => (table.filters.status = (k ?? undefined) as BenefitPlanStatus | undefined)"
    />

    <RouterLink
      v-if="counts.data.value?.pending"
      to="/hr/benefits/enrollments"
      class="group flex flex-wrap items-center gap-3 rounded-xl bg-warning-soft/60 px-4 py-3 ring-1 ring-warning/25 transition ring-inset hover:bg-warning-soft focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
    >
      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning-fg ring-1 ring-warning/25 ring-inset" aria-hidden="true"><Hourglass :size="16" /></span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-semibold text-fg">{{ counts.data.value.pending }} enrolment {{ counts.data.value.pending === 1 ? 'request is' : 'requests are' }} waiting for approval</span>
        <span class="block text-xs text-fg-muted">Employees aren't covered by the new choice until HR approves it.</span>
      </span>
      <span class="inline-flex items-center gap-1 text-sm font-medium text-accent-fg">Review<ArrowRight :size="14" class="transition group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden="true" /></span>
    </RouterLink>

    <AppCard title="Plans" :icon="HeartPulse" :description="table.meta.value ? `${table.meta.value.total} ${table.meta.value.total === 1 ? 'plan' : 'plans'}` : undefined" :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_200px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search plans" aria-label="Search plans" />
        <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </div>
      <AppDataTable
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        clickable
        caption="Benefit plans"
        empty-title="No plans yet"
        empty-description="Create a plan, add its coverage options and activate it to let employees enrol."
        @page="table.setPage"
        @retry="table.load"
        @row-click="(p: Plan) => router.push(`/hr/benefits/plans/${p.id}`)"
        :filtered="table.isFiltered.value"
        @clear="table.clearFilters()"
      >
        <template #empty><AppButton :icon="Plus" @click="formOpen = true">New plan</AppButton></template>
        <template #cell-name="{ row }">
          <div class="flex items-center gap-3">
            <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', BENEFIT_TYPE_VISUALS[row.type].tile]" aria-hidden="true">
              <component :is="BENEFIT_TYPE_VISUALS[row.type].icon" :size="17" />
            </span>
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.name }}</p>
              <p class="truncate text-xs text-fg-muted">{{ [TYPE_LABELS[row.type], row.provider].filter(Boolean).join(' · ') }}</p>
              <p v-if="row.mandatory || row.requiresApproval" class="mt-1 flex flex-wrap gap-1">
                <AppBadge v-if="row.mandatory" size="sm" tone="info">Mandatory</AppBadge>
                <AppBadge v-if="row.requiresApproval" size="sm">HR approves</AppBadge>
              </p>
            </div>
          </div>
        </template>
        <template #cell-period="{ row }">
          <p class="whitespace-nowrap text-fg">{{ formatDate(row.coverageStartsOn) }} – {{ formatDate(row.coverageEndsOn) }}</p>
          <p class="inline-flex items-center gap-1 text-xs text-fg-muted"><CalendarRange :size="12" aria-hidden="true" />{{ policyTiming(row) }}</p>
        </template>
        <template #cell-window="{ row }">
          <template v-for="w in [enrolmentWindow(row)]" :key="row.id">
            <AppBadge :tone="w.tone" :dot="w.state === 'open'">{{ w.label }}</AppBadge>
            <p class="mt-0.5 text-xs whitespace-nowrap" :class="w.state === 'open' && (w.daysLeft ?? 99) <= 7 ? 'font-medium text-warning-fg' : 'text-fg-subtle'">{{ w.detail }}</p>
          </template>
        </template>
        <template #cell-status="{ row }"><AppBadge :tone="planTone[row.status]" dot>{{ PLAN_STATUS_LABELS[row.status] }}</AppBadge></template>
        <template #cell-enrolled="{ row }">
          <p class="text-base font-semibold text-fg tabular-nums">{{ row.stats?.enrolled ?? 0 }}</p>
          <p v-if="row.stats?.pending" class="text-xs font-medium whitespace-nowrap text-warning-fg">+{{ row.stats.pending }} waiting</p>
          <p v-else-if="row.stats?.waived" class="text-xs whitespace-nowrap text-fg-subtle">{{ row.stats.waived }} waived</p>
        </template>
        <template #cell-cost="{ row }">
          <p class="font-medium whitespace-nowrap text-fg tabular-nums">{{ inr(total(row)) }}</p>
          <div class="ms-auto mt-1 flex h-1.5 w-24 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            <div class="h-full bg-brand-500" :style="{ width: `${total(row) ? 100 - employerPct(row) : 0}%` }" />
            <div class="h-full bg-violet-400 dark:bg-violet-500" :style="{ width: `${employerPct(row)}%` }" />
          </div>
          <p class="mt-0.5 text-2xs whitespace-nowrap text-fg-muted tabular-nums">employer {{ inr(row.stats?.employerMonthly ?? 0) }} · {{ employerPct(row) }}%</p>
        </template>
        <template #card="{ row }"><BenefitPlanGridCard :plan="row" /></template>
      </AppDataTable>
    </AppCard>
    <PlanFormModal :open="formOpen" :plan="null" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
