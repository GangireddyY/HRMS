<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, ClipboardCheck, X } from '@lucide/vue';
import type { ProbationReviewStatus } from '@contracts';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import RecommendModal from '@/modules/onboarding/components/RecommendModal.vue';
import type { ProbationDue, ProbationReview } from '@/modules/onboarding/types';
import { RECOMMENDATION_LABELS, REVIEW_STATUS_LABELS, reviewStatusTone } from '@/modules/onboarding/utils/onboarding-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppSelect, AppTabs, AppTextarea, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const canDecide = computed(() => auth.can('onboarding.confirmation.approve'));
const canRecommend = computed(() => auth.can('onboarding.manage'));
const tab = ref(canDecide.value ? 'decisions' : 'due');
const tabs = computed(() => [...(canDecide.value ? [{ key: 'decisions', label: 'Decisions' }] : []), { key: 'due', label: 'Ending soon' }]);

const days = ref(60);
const due = useAsync(() => onboardingApi.probationDue(days.value));
watch(days, () => void due.run());
const windowOptions = [30, 60, 90, 180].map((d) => ({ value: d, label: `Ending within ${d} days` }));
const reviews = useTable((q) => onboardingApi.reviews({ ...q, view: 'approve' }), { filters: { status: 'PENDING' as ProbationReviewStatus | undefined }, immediate: canDecide.value });
const statusOptions = (['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((s) => ({ value: s, label: REVIEW_STATUS_LABELS[s] }));

const recommendFor = ref<ProbationDue | null>(null);
async function onSubmitted() {
  recommendFor.value = null;
  feedback.success('Recommendation submitted', 'It now waits for a decision.');
  await due.run();
}

const deciding = ref<{ review: ProbationReview; action: 'approve' | 'reject' } | null>(null);
const note = ref('');
const busy = ref(false);
async function decide() {
  const d = deciding.value!;
  busy.value = true;
  try {
    if (d.action === 'approve') await onboardingApi.approveReview(d.review.id, note.value || null);
    else await onboardingApi.rejectReview(d.review.id, note.value);
    feedback.success(d.action === 'approve' ? (d.review.recommendation === 'CONFIRM' ? 'Employee confirmed' : 'Probation extended') : 'Recommendation rejected');
    deciding.value = null;
    await Promise.all([reviews.load(), due.run()]);
  } catch (e) {
    feedback.error('Could not record the decision', e);
  } finally {
    busy.value = false;
  }
}

const dueColumns: TableColumn<ProbationDue>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'end', label: 'Probation ends' },
  { key: 'review', label: 'Review' },
  { key: 'actions', label: '', align: 'right' },
];
const reviewColumns: TableColumn<ProbationReview>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'recommendation', label: 'Recommendation' },
  { key: 'comments', label: 'Assessment' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Probation" description="Confirm employees or extend probation. A manager or HR recommends; someone else with approval rights decides." />
    <AppTabs v-model="tab" :tabs="tabs">
      <AppCard v-if="tab === 'decisions'" :padded="false">
        <div class="flex items-center justify-end gap-2 border-b border-line/70 px-4 py-2">
          <AppSelect size="sm" v-model="reviews.filters.status" class="w-52" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable
          :columns="reviewColumns"
          :rows="reviews.rows.value"
          :loading="reviews.loading.value"
          :error="reviews.error.value"
          :meta="reviews.meta.value"
          caption="Probation reviews"
          :empty-title="reviews.filters.status === 'PENDING' ? 'Nothing to decide' : 'No reviews'"
          @page="reviews.setPage"
          @retry="reviews.load"
          :filtered="reviews.isFiltered.value"
          @clear="reviews.clearFilters()">
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee?.name }}</p>
                <p class="truncate text-xs text-fg-muted">Probation ends {{ formatDate(row.probationEndDate) }}</p>
              </div>
            </div>
          </template>
          <template #cell-recommendation="{ row }">
            <AppBadge :tone="row.recommendation === 'CONFIRM' ? 'success' : 'warning'">{{ RECOMMENDATION_LABELS[row.recommendation] }}</AppBadge>
            <p v-if="row.extendTo" class="mt-0.5 text-xs text-fg-muted">until {{ formatDate(row.extendTo) }}</p>
          </template>
          <template #cell-comments="{ row }">
            <p class="max-w-md text-sm text-fg-muted" :title="row.comments">{{ row.comments }}</p>
            <p class="text-xs text-fg-subtle">{{ row.submittedBy }} · {{ timeAgo(row.submittedAt) }}</p>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :tone="reviewStatusTone[row.status]" dot>{{ REVIEW_STATUS_LABELS[row.status] }}</AppBadge>
            <p v-if="row.reviewedBy" class="mt-0.5 text-xs text-fg-subtle">by {{ row.reviewedBy }}</p>
          </template>
          <template #cell-actions="{ row }">
            <div v-if="row.status === 'PENDING'" class="flex justify-end gap-2">
              <AppButton size="sm" variant="secondary" :icon="X" @click="deciding = { review: row, action: 'reject' }; note = ''">Reject</AppButton>
              <AppButton size="sm" :icon="Check" @click="deciding = { review: row, action: 'approve' }; note = ''">Approve</AppButton>
            </div>
          </template>
        </AppDataTable>
      </AppCard>

      <AppCard v-else :padded="false">
        <div class="flex items-center justify-end gap-2 border-b border-line/70 px-4 py-2">
          <AppSelect size="sm" v-model="days" class="w-56" :options="windowOptions" :clearable="false" aria-label="Window" />
        </div>
        <AppDataTable :columns="dueColumns" :rows="due.data.value ?? []" :loading="due.loading.value" :error="due.error.value" caption="Probations ending soon" empty-title="No probations ending soon" @retry="due.run">
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee.name" size="sm" />
              <div class="min-w-0">
                <RouterLink :to="`/hr/employees/${row.employee.id}`" class="block truncate font-medium text-fg hover:underline">{{ row.employee.name }}</RouterLink>
                <p class="truncate text-xs text-fg-muted">{{ [row.employee.designation?.name, `joined ${formatDate(row.employee.dateOfJoining)}`].filter(Boolean).join(' · ') }}</p>
              </div>
            </div>
          </template>
          <template #cell-end="{ row }">
            <span>{{ formatDate(row.probationEndDate) }}</span>
            <p class="text-xs" :class="row.daysLeft < 0 ? 'font-medium text-danger-fg' : 'text-fg-muted'">{{ row.daysLeft < 0 ? `${-row.daysLeft} days overdue` : row.daysLeft === 0 ? 'Today' : `in ${row.daysLeft} days` }}</p>
          </template>
          <template #cell-review="{ row }">
            <AppBadge v-if="row.pendingReview" tone="warning" size="sm">{{ RECOMMENDATION_LABELS[row.pendingReview.recommendation] }} · awaiting decision</AppBadge>
            <span v-else class="text-xs text-fg-subtle">Not reviewed</span>
          </template>
          <template #cell-actions="{ row }">
            <AppButton v-if="!row.pendingReview && (canRecommend || row.isDirectReport)" size="sm" variant="secondary" :icon="ClipboardCheck" @click="recommendFor = row">Review</AppButton>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>

    <RecommendModal :open="!!recommendFor" :due="recommendFor" @close="recommendFor = null" @submitted="onSubmitted" />
    <AppModal
      :open="!!deciding"
      :title="deciding?.action === 'approve' ? (deciding.review.recommendation === 'CONFIRM' ? 'Confirm employee' : 'Extend probation') : 'Reject recommendation'"
      :description="deciding?.review.employee?.name"
      size="sm"
      @close="deciding = null"
    >
      <p class="mb-3 rounded-lg bg-surface-muted/60 px-3 py-2 text-sm text-fg-muted">“{{ deciding?.review.comments }}”</p>
      <AppTextarea v-model="note" :label="deciding?.action === 'approve' ? 'Note' : 'Reason'" :required="deciding?.action === 'reject'" :rows="2" :maxlength="500" :placeholder="deciding?.action === 'approve' ? 'Optional' : 'Shared with the person who recommended it'" />
      <template #footer>
        <AppButton variant="secondary" @click="deciding = null">Cancel</AppButton>
        <AppButton :variant="deciding?.action === 'approve' ? 'primary' : 'danger'" :loading="busy" :disabled="deciding?.action === 'reject' && note.trim().length < 3" @click="decide">{{ deciding?.action === 'approve' ? 'Approve' : 'Reject' }}</AppButton>
      </template>
    </AppModal>
  </div>
</template>
