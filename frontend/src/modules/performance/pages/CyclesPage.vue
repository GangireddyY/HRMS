<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Plus } from '@lucide/vue';
import { performanceApi } from '@/modules/performance/api/performance.api';
import CycleFormModal from '@/modules/performance/components/CycleFormModal.vue';
import type { Cycle, CycleDetail } from '@/modules/performance/types';
import { CYCLE_STATUS_LABELS, cycleTone } from '@/modules/performance/utils/performance-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canConfigure = computed(() => auth.can('performance.configure'));
const table = useTable((q) => performanceApi.cycles(q));
const formOpen = ref(false);
async function onSaved(c: CycleDetail) {
  formOpen.value = false;
  feedback.success('Review cycle created', 'Launch it when it is ready.');
  await router.push(`/hr/performance/cycles/${c.id}`);
}
const total = (c: Cycle) => Object.values(c.stages).reduce((a, b) => a + b, 0);
const done = (c: Cycle) => c.stages.COMPLETED + c.stages.ACKNOWLEDGED;
const columns: TableColumn<Cycle>[] = [
  { key: 'name', label: 'Cycle' },
  { key: 'period', label: 'Period' },
  { key: 'status', label: 'Status' },
  { key: 'progress', label: 'Completed', align: 'right' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Review cycles" description="Set goals, self and manager reviews, 360 feedback and calibration, one cycle at a time.">
      <template v-if="canConfigure" #actions><AppButton :icon="Plus" @click="formOpen = true">New cycle</AppButton></template>
    </AppPageHeader>
    <AppCard :padded="false">
      <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Review cycles" empty-title="No review cycles yet" @page="table.setPage" @retry="table.load" @row-click="(row) => router.push(`/hr/performance/cycles/${row.id}`)" :filtered="table.isFiltered.value" @clear="table.clearFilters()">
        <template #empty><AppButton :icon="Plus" @click="formOpen = true">New cycle</AppButton></template>
        <template #cell-name="{ row }">
          <p class="font-medium text-fg">{{ row.name }}</p>
          <p v-if="row.resultsReleasedAt" class="text-xs text-fg-muted">Results released {{ formatDate(row.resultsReleasedAt) }}</p>
        </template>
        <template #cell-period="{ row }"><span class="text-fg-muted">{{ formatDate(row.periodStart) }} – {{ formatDate(row.periodEnd) }}</span></template>
        <template #cell-status="{ row }"><AppBadge :tone="cycleTone[row.status]" dot>{{ CYCLE_STATUS_LABELS[row.status] }}</AppBadge></template>
        <template #cell-progress="{ row }">
          <span v-if="total(row)" class="tabular-nums">{{ done(row) }}/{{ total(row) }}</span>
          <span v-else class="text-fg-subtle">—</span>
        </template>
      </AppDataTable>
    </AppCard>
    <CycleFormModal :open="formOpen" :cycle="null" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
