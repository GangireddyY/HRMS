<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { Plus } from '@lucide/vue';
import { BENEFIT_PLAN_STATUSES, type BenefitPlanStatus } from '@contracts';
import { benefitsApi } from '@/modules/benefits/api/benefits.api';
import PlanFormModal from '@/modules/benefits/components/PlanFormModal.vue';
import type { Plan } from '@/modules/benefits/types';
import { PLAN_STATUS_LABELS, TYPE_LABELS, inr, planTone } from '@/modules/benefits/utils/benefits-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

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
const columns: TableColumn<Plan>[] = [
  { key: 'name', label: 'Plan' },
  { key: 'period', label: 'Policy period' },
  { key: 'status', label: 'Status' },
  { key: 'enrolled', label: 'Covered', align: 'right' },
  { key: 'cost', label: 'Monthly cost', align: 'right' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Benefit plans" description="Insurance and other benefits, who is eligible and what employees pay.">
      <template #actions>
        <AppButton variant="secondary" to="/hr/benefits/enrollments">Enrolments</AppButton>
        <AppButton :icon="Plus" @click="formOpen = true">New plan</AppButton>
      </template>
    </AppPageHeader>
    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_200px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search plans" aria-label="Search plans" />
        <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </div>
      <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Benefit plans" empty-title="No plans yet" @page="table.setPage" @retry="table.load" @row-click="(p: Plan) => router.push(`/hr/benefits/plans/${p.id}`)">
        <template #cell-name="{ row }">
          <p class="font-medium text-fg">{{ row.name }}</p>
          <p class="text-xs text-fg-muted">{{ TYPE_LABELS[row.type] }}{{ row.provider ? ` · ${row.provider}` : '' }}{{ row.mandatory ? ' · mandatory' : '' }}</p>
        </template>
        <template #cell-period="{ row }"><span class="text-fg-muted">{{ formatDate(row.coverageStartsOn) }} – {{ formatDate(row.coverageEndsOn) }}</span></template>
        <template #cell-status="{ row }"><AppBadge :tone="planTone[row.status]" dot>{{ PLAN_STATUS_LABELS[row.status] }}</AppBadge></template>
        <template #cell-enrolled="{ row }">
          <span class="tabular-nums">{{ row.stats?.enrolled ?? 0 }}</span>
          <span v-if="row.stats?.pending" class="ms-1 text-xs text-amber-600 dark:text-amber-400">+{{ row.stats.pending }} pending</span>
        </template>
        <template #cell-cost="{ row }">
          <p class="tabular-nums text-fg">{{ inr((row.stats?.employerMonthly ?? 0) + (row.stats?.employeeMonthly ?? 0)) }}</p>
          <p class="text-xs text-fg-muted">employer {{ inr(row.stats?.employerMonthly ?? 0) }}</p>
        </template>
      </AppDataTable>
    </AppCard>
    <PlanFormModal :open="formOpen" :plan="null" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
