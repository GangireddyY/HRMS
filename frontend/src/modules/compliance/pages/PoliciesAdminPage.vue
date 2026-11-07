<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { CalendarClock, Plus } from '@lucide/vue';
import { POLICY_CATEGORIES, POLICY_STATUSES, type PolicyCategory, type PolicyStatus } from '@contracts';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import PolicyFormModal from '@/modules/compliance/components/PolicyFormModal.vue';
import type { PolicyDetail, PolicySummary } from '@/modules/compliance/types';
import { POLICY_CATEGORY_LABELS, POLICY_STATUS_LABELS, policyTone } from '@/modules/compliance/utils/compliance-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const router = useRouter();
const feedback = useFeedbackStore();
const table = useTable((q) => complianceApi.policies(q), { filters: { status: undefined as PolicyStatus | undefined, category: undefined as PolicyCategory | undefined } });
const statusOptions = POLICY_STATUSES.map((s) => ({ value: s, label: POLICY_STATUS_LABELS[s] }));
const categoryOptions = POLICY_CATEGORIES.map((c) => ({ value: c, label: POLICY_CATEGORY_LABELS[c] }));
const formOpen = ref(false);
async function onSaved(p: PolicyDetail) {
  formOpen.value = false;
  feedback.success('Policy drafted', 'Review the text, then publish it.');
  await router.push(`/hr/compliance/policies/${p.id}`);
}
const columns: TableColumn<PolicySummary>[] = [
  { key: 'title', label: 'Policy' },
  { key: 'status', label: 'Status' },
  { key: 'acks', label: 'Acknowledged' },
  { key: 'review', label: 'Next review' },
];
const pct = (p: PolicySummary) => (p.stats?.audience ? Math.round((p.stats.acknowledged / p.stats.audience) * 100) : 0);
</script>

<template>
  <div>
    <AppPageHeader title="Policies" description="Company policies, who they apply to and who has acknowledged them.">
      <template #actions>
        <AppButton variant="secondary" :icon="CalendarClock" to="/hr/compliance/calendar">Statutory calendar</AppButton>
        <AppButton :icon="Plus" @click="formOpen = true">New policy</AppButton>
      </template>
    </AppPageHeader>
    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_200px_220px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search policies" aria-label="Search policies" />
        <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        <AppSelect v-model="table.filters.category" :options="categoryOptions" placeholder="All categories" aria-label="Filter by category" />
      </div>
      <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Policies" empty-title="No policies yet" @page="table.setPage" @retry="table.load" @row-click="(p: PolicySummary) => router.push(`/hr/compliance/policies/${p.id}`)">
        <template #cell-title="{ row }">
          <p class="font-medium text-fg">{{ row.title }}</p>
          <p class="text-xs text-fg-muted">{{ POLICY_CATEGORY_LABELS[row.category] }}{{ row.currentVersion ? ` · v${row.currentVersion.version}` : '' }}{{ row.hasDraft && row.currentVersion ? ' · draft changes' : '' }}</p>
        </template>
        <template #cell-status="{ row }"><AppBadge :tone="policyTone[row.status]" dot>{{ POLICY_STATUS_LABELS[row.status] }}</AppBadge></template>
        <template #cell-acks="{ row }">
          <template v-if="row.stats">
            <div class="flex items-center gap-2">
              <span class="h-1.5 w-20 rounded-full bg-surface-muted"><span class="block h-1.5 rounded-full bg-emerald-500" :style="{ width: `${pct(row)}%` }" /></span>
              <span class="text-xs text-fg-muted tabular-nums">{{ row.stats.acknowledged }}/{{ row.stats.audience }}</span>
            </div>
            <p v-if="row.stats.overdue" class="text-xs text-red-600 dark:text-red-400">{{ row.stats.overdue }} overdue</p>
          </template>
          <span v-else class="text-xs text-fg-muted">{{ row.requiresAck ? '—' : 'Not required' }}</span>
        </template>
        <template #cell-review="{ row }">
          <span v-if="row.nextReviewOn" :class="row.reviewDue ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-fg-muted'">{{ formatDate(row.nextReviewOn) }}{{ row.reviewDue ? ' · due' : '' }}</span>
          <span v-else class="text-fg-muted">—</span>
        </template>
      </AppDataTable>
    </AppCard>
    <PolicyFormModal :open="formOpen" :policy="null" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
