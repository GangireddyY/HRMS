<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { BadgeCheck, CalendarClock, Check, ClipboardCheck, FilterX, Gavel, Quote, X } from '@lucide/vue';
import type { ProbationReviewStatus } from '@contracts';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import RecommendModal from '@/modules/onboarding/components/RecommendModal.vue';
import type { ProbationDue, ProbationReview } from '@/modules/onboarding/types';
import { RECOMMENDATION_LABELS, REVIEW_STATUS_LABELS, reviewStatusTone } from '@/modules/onboarding/utils/onboarding-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppSelect, AppStatStrip, AppTabs, AppTextarea, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Probation confirmations: who is ending probation soon, recommendations to make, and decisions waiting. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canDecide = computed(() => auth.can('onboarding.confirmation.approve'));
const canRecommend = computed(() => auth.can('onboarding.manage'));
const tab = ref(canDecide.value ? 'decisions' : 'due');

const days = ref(60);
const due = useAsync(() => onboardingApi.probationDue(days.value));
watch(days, () => void due.run());
const windowOptions = [30, 60, 90, 180].map((d) => ({ value: d, label: `Ending within ${d} days` }));
const reviews = useTable((q) => onboardingApi.reviews({ ...q, view: 'approve' }), { filters: { status: 'PENDING' as ProbationReviewStatus | undefined }, immediate: canDecide.value });
const statusOptions = (['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((s) => ({ value: s, label: REVIEW_STATUS_LABELS[s] }));
// Pending decisions, whatever the table's status filter shows.
const pending = useAsync(() => (canDecide.value ? onboardingApi.reviews({ view: 'approve', status: 'PENDING', page: 1, pageSize: 1 }).then((p) => p.meta.total) : Promise.resolve(0)));

const tabs = computed(() => [
  ...(canDecide.value ? [{ key: 'decisions', label: 'Decisions', icon: Gavel, count: pending.data.value ?? null }] : []),
  { key: 'due', label: 'Ending soon', icon: CalendarClock, count: due.data.value?.length ?? null },
]);

type Bucket = 'overdue' | 'soon' | 'later' | 'unreviewed' | 'awaiting';
const BUCKETS: Record<Bucket, { label: string; test: (d: ProbationDue) => boolean }> = {
  overdue: { label: 'Past the end date', test: (d) => d.daysLeft < 0 },
  soon: { label: 'Ending in 14 days', test: (d) => d.daysLeft >= 0 && d.daysLeft <= 14 },
  later: { label: 'Ending later', test: (d) => d.daysLeft > 14 },
  unreviewed: { label: 'No recommendation yet', test: (d) => !d.pendingReview },
  awaiting: { label: 'Awaiting decision', test: (d) => !!d.pendingReview },
};
const bucket = ref<Bucket | null>(null);
watch(days, () => (bucket.value = null));
const dueList = computed(() => [...(due.data.value ?? [])].sort((a, b) => a.daysLeft - b.daysLeft));
const dueRows = computed(() => (bucket.value ? dueList.value.filter(BUCKETS[bucket.value].test) : dueList.value));
const n = (b: Bucket) => dueList.value.filter(BUCKETS[b].test).length;
const strip = computed<StripItem[]>(() => [
  { key: 'overdue', label: BUCKETS.overdue.label, value: n('overdue'), tone: 'danger', hint: n('overdue') ? 'Confirm or extend now' : 'None overdue' },
  { key: 'soon', label: BUCKETS.soon.label, value: n('soon'), tone: 'warning', hint: 'Review this fortnight' },
  { key: 'later', label: BUCKETS.later.label, value: n('later'), tone: 'info', hint: `Within ${days.value} days` },
  { key: 'unreviewed', label: BUCKETS.unreviewed.label, value: n('unreviewed'), tone: 'brand', hint: 'Manager or HR to recommend' },
  { key: 'awaiting', label: BUCKETS.awaiting.label, value: n('awaiting'), tone: 'violet', hint: 'Recommended, not decided' },
]);
function selectBucket(k: string | null) {
  bucket.value = k as Bucket | null;
  if (k) tab.value = 'due';
}

const recommendFor = ref<ProbationDue | null>(null);
async function onSubmitted() {
  recommendFor.value = null;
  feedback.success('Recommendation submitted', 'It now waits for a decision.');
  await Promise.all([due.run(), pending.run()]);
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
    await Promise.all([reviews.load(), due.run(), pending.run()]);
  } catch (e) {
    feedback.error('Could not record the decision', e);
  } finally {
    busy.value = false;
  }
}

const dueColumns: TableColumn<ProbationDue>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'end', label: 'Probation ends' },
  { key: 'tenure', label: 'Joined' },
  { key: 'review', label: 'Recommendation' },
  { key: 'actions', label: '', align: 'right' },
];
const reviewColumns: TableColumn<ProbationReview>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'recommendation', label: 'Recommendation' },
  { key: 'comments', label: 'Assessment' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
const countdown = (days: number) => (days < 0 ? `${-days} day${days === -1 ? '' : 's'} overdue` : days === 0 ? 'Ends today' : days === 1 ? 'Ends tomorrow' : `in ${days} days`);
const countdownTone = (days: number) => (days < 0 ? 'bg-danger-soft text-danger-fg ring-danger/20' : days <= 14 ? 'bg-warning-soft text-warning-fg ring-warning/25' : 'bg-surface-muted text-fg-muted ring-line');
/** "4 months in" from the joining date. */
function tenure(iso: string) {
  const months = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / (30.44 * 86_400_000)));
  return months < 1 ? 'Less than a month in' : `${months} month${months === 1 ? '' : 's'} in`;
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Probation" description="Confirm employees or extend probation. A manager or HR recommends; someone else with approval rights decides." />

    <AppStatStrip :items="strip" :loading="due.loading.value && !due.data.value" selectable :selected="bucket" label="Probations ending soon" @select="selectBucket" />

    <AppTabs v-model="tab" :tabs="tabs">
      <AppCard v-if="tab === 'decisions'" :padded="false">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-4 py-2.5">
          <p class="text-xs text-fg-muted">Recommendations from managers and HR. Approving confirms the employee or extends their probation.</p>
          <AppSelect size="sm" v-model="reviews.filters.status" class="w-52" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable
          :columns="reviewColumns"
          :rows="reviews.rows.value"
          :loading="reviews.loading.value"
          :error="reviews.error.value"
          :meta="reviews.meta.value"
          caption="Probation reviews"
          layout-key="hr-probation-reviews"
          :empty-title="reviews.filters.status === 'PENDING' ? 'Nothing to decide' : 'No reviews'"
          :empty-description="reviews.filters.status === 'PENDING' ? 'Recommendations appear here when a manager or HR reviews someone whose probation is ending.' : undefined"
          :filtered="reviews.isFiltered.value"
          @page="reviews.setPage"
          @retry="reviews.load"
          @clear="reviews.clearFilters()"
        >
          <template #empty>
            <AppButton v-if="reviews.filters.status === 'PENDING' && dueList.length" variant="secondary" size="sm" :icon="CalendarClock" @click="tab = 'due'">See who is ending probation</AppButton>
          </template>
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee?.name ?? '?'" size="md" />
              <div class="min-w-0">
                <RouterLink v-if="row.employee" :to="`/hr/employees/${row.employee.id}`" class="block truncate font-medium text-fg hover:underline">{{ row.employee.name }}</RouterLink>
                <p class="truncate text-xs text-fg-muted">{{ [row.employee?.designation?.name, `ends ${formatDate(row.probationEndDate)}`].filter(Boolean).join(' · ') }}</p>
              </div>
            </div>
          </template>
          <template #cell-recommendation="{ row }">
            <AppBadge :tone="row.recommendation === 'CONFIRM' ? 'success' : 'warning'" dot>{{ RECOMMENDATION_LABELS[row.recommendation] }}</AppBadge>
            <p v-if="row.extendTo" class="mt-0.5 text-xs text-fg-muted">until {{ formatDate(row.extendTo) }}</p>
          </template>
          <template #cell-comments="{ row }">
            <p class="flex max-w-md gap-1.5 text-sm text-fg" :title="row.comments">
              <Quote :size="12" class="mt-1 shrink-0 text-fg-subtle" aria-hidden="true" /><span class="line-clamp-2">{{ row.comments }}</span>
            </p>
            <p class="mt-0.5 text-xs text-fg-subtle">{{ row.submittedBy }} · {{ timeAgo(row.submittedAt) }}</p>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :tone="reviewStatusTone[row.status]" dot>{{ REVIEW_STATUS_LABELS[row.status] }}</AppBadge>
            <p v-if="row.reviewedBy" class="mt-0.5 text-xs text-fg-subtle">by {{ row.reviewedBy }}<template v-if="row.reviewedAt"> · {{ timeAgo(row.reviewedAt) }}</template></p>
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
        <div class="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-2.5">
          <p v-if="bucket" class="inline-flex items-center gap-2 rounded-full bg-accent-soft py-1 ps-3 pe-1 text-xs font-medium text-accent-fg">
            {{ BUCKETS[bucket].label }}
            <button type="button" class="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-brand-500/15" :aria-label="`Clear the ${BUCKETS[bucket].label} filter`" @click="bucket = null"><FilterX :size="12" aria-hidden="true" /></button>
          </p>
          <p v-else class="text-xs text-fg-muted">Soonest first. Recommend confirming or extending before the end date.</p>
          <AppSelect size="sm" v-model="days" class="ms-auto w-56" :options="windowOptions" :clearable="false" aria-label="Window" />
        </div>
        <AppDataTable
          :columns="dueColumns"
          :rows="dueRows"
          :loading="due.loading.value"
          :error="due.error.value"
          caption="Probations ending soon"
          layout-key="hr-probation-due"
          empty-title="No probations ending soon"
          :empty-description="`Nobody's probation ends in the next ${days} days.`"
          :filtered="!!bucket"
          :row-key="(r) => r.employee.id"
          @retry="due.run"
          @clear="bucket = null"
        >
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee.name" size="md" />
              <div class="min-w-0">
                <p class="flex items-center gap-2">
                  <RouterLink :to="`/hr/employees/${row.employee.id}`" class="truncate font-medium text-fg hover:underline">{{ row.employee.name }}</RouterLink>
                  <AppBadge v-if="row.isDirectReport" tone="brand" size="sm">Your team</AppBadge>
                </p>
                <p class="truncate text-xs text-fg-muted">{{ [row.employee.designation?.name, row.employee.department?.name].filter(Boolean).join(' · ') || row.employee.employeeCode }}</p>
              </div>
            </div>
          </template>
          <template #cell-end="{ row }">
            <div class="flex flex-wrap items-center gap-2 max-md:justify-end">
              <span class="text-fg tabular-nums">{{ formatDate(row.probationEndDate) }}</span>
              <span :class="['rounded-full px-2 py-px text-2xs font-semibold whitespace-nowrap ring-1 ring-inset tabular-nums', countdownTone(row.daysLeft)]">{{ countdown(row.daysLeft) }}</span>
            </div>
          </template>
          <template #cell-tenure="{ row }">
            <p class="text-fg tabular-nums">{{ formatDate(row.employee.dateOfJoining) }}</p>
            <p class="text-xs text-fg-muted">{{ tenure(row.employee.dateOfJoining) }}</p>
          </template>
          <template #cell-review="{ row }">
            <template v-if="row.pendingReview">
              <AppBadge tone="violet" size="sm" dot>{{ RECOMMENDATION_LABELS[row.pendingReview.recommendation] }} · awaiting decision</AppBadge>
              <p class="mt-0.5 text-xs text-fg-subtle">Submitted {{ timeAgo(row.pendingReview.submittedAt) }}</p>
            </template>
            <span v-else class="inline-flex items-center gap-1.5 text-xs text-fg-muted"><span class="h-1.5 w-1.5 rounded-full bg-fg-subtle" aria-hidden="true" />Not reviewed</span>
          </template>
          <template #cell-actions="{ row }">
            <AppButton v-if="!row.pendingReview && (canRecommend || row.isDirectReport)" size="sm" variant="secondary" :icon="ClipboardCheck" @click="recommendFor = row">Review</AppButton>
            <AppButton v-else-if="row.pendingReview && canDecide" size="sm" variant="ghost" :icon="BadgeCheck" @click="tab = 'decisions'">Decide</AppButton>
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
