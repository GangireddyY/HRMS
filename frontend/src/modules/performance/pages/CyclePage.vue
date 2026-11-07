<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Eye, Lock, Pencil, Rocket, Trash2, TrendingUp, UserPlus } from '@lucide/vue';
import { REVIEW_STAGES, type ReviewStage } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import ColleaguePicker from '@/modules/performance/components/ColleaguePicker.vue';
import CycleFormModal from '@/modules/performance/components/CycleFormModal.vue';
import type { CycleDetail, ReviewRow } from '@/modules/performance/types';
import { CYCLE_STATUS_LABELS, STAGE_LABELS, STAGE_ORDER, cycleTone, ratingText, stageTone } from '@/modules/performance/utils/performance-format';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppErrorState, AppModal, AppPageHeader, AppSearchInput, AppSelect, AppSkeleton, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canConfigure = computed(() => auth.can('performance.configure'));
const canRevise = computed(() => auth.can('employee.salary.revise'));
const id = computed(() => String(route.params.id));
const cycle = useAsync(() => performanceApi.cycle(id.value));
const c = computed(() => cycle.data.value);
const table = useTable((q) => performanceApi.reviews({ ...q, cycleId: id.value, view: 'all' }), { filters: { stage: undefined as ReviewStage | undefined } });
watch(id, () => {
  void cycle.run();
  void table.load();
});
const stageOptions = REVIEW_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }));

const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<CycleDetail>, success: string, description?: string) {
  busy.value = key;
  try {
    cycle.data.value = await fn();
    feedback.success(success, description);
    await table.load();
  } catch (e) {
    feedback.error('Could not complete the action', e);
  } finally {
    busy.value = null;
  }
}
async function launch() {
  if (!(await feedback.confirm({ title: `Launch ${c.value!.name}?`, message: 'A review is created for every eligible employee and everyone is notified to set goals. Weights, competencies and eligibility can no longer change.', confirmLabel: 'Launch' }))) return;
  await act('launch', () => performanceApi.launch(id.value), 'Cycle launched', 'Employees have been asked to set their goals.');
}
async function release() {
  if (!(await feedback.confirm({ title: 'Release results?', message: 'Employees see their completed reviews: ratings, manager comments and anonymous peer feedback. Ratings can no longer be calibrated.', confirmLabel: 'Release results' }))) return;
  await act('release', () => performanceApi.release(id.value), 'Results released', 'Employees with completed reviews have been notified.');
}
async function closeCycle() {
  if (!(await feedback.confirm({ title: `Close ${c.value!.name}?`, message: 'The cycle becomes read-only; unfinished reviews stay unfinished.', confirmLabel: 'Close cycle', danger: true }))) return;
  await act('close', () => performanceApi.closeCycle(id.value), 'Cycle closed');
}
async function remove() {
  if (!(await feedback.confirm({ title: `Delete ${c.value!.name}?`, message: 'The draft cycle is deleted.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await performanceApi.removeCycle(id.value);
    feedback.success('Cycle deleted');
    await router.replace('/hr/performance/cycles');
  } catch (e) {
    feedback.error('Could not delete the cycle', e);
  }
}
const editOpen = ref(false);
function onEdited(next: CycleDetail) {
  editOpen.value = false;
  cycle.data.value = next;
  feedback.success('Cycle updated');
}
const addOpen = ref(false);
const adding = ref<string[]>([]);
async function addParticipants() {
  addOpen.value = false;
  await act('add', () => performanceApi.addParticipants(id.value, adding.value), 'Participants added');
  adding.value = [];
}

const maxBar = computed(() => Math.max(1, ...Object.values(c.value?.distribution ?? {})));
const columns: TableColumn<ReviewRow>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'stage', label: 'Stage' },
  { key: 'rating', label: 'Rating', align: 'right' },
];
</script>

<template>
  <div>
    <AppSkeleton v-if="cycle.loading.value && !c" :lines="8" />
    <AppErrorState v-else-if="cycle.error.value" :error="cycle.error.value" title="Could not load the cycle" @retry="cycle.run" />
    <template v-else-if="c">
      <AppPageHeader :title="c.name" :description="`${formatDate(c.periodStart)} – ${formatDate(c.periodEnd)}${c.description ? ` · ${c.description}` : ''}`" back="/hr/performance/cycles" back-label="Review cycles">
        <template #badges>
          <AppBadge :tone="cycleTone[c.status]" dot>{{ CYCLE_STATUS_LABELS[c.status] }}</AppBadge>
          <AppBadge v-if="c.resultsReleasedAt" tone="success">Results released</AppBadge>
        </template>
        <template v-if="canConfigure || canRevise" #actions>
          <AppButton v-if="c.status !== 'DRAFT'" variant="secondary" :icon="TrendingUp" :to="`/hr/performance/cycles/${c.id}/hikes`">Salary increases</AppButton>
          <template v-if="canConfigure">
            <AppButton v-if="c.status === 'DRAFT'" variant="ghost" :icon="Trash2" aria-label="Delete cycle" @click="remove" />
            <AppButton v-if="c.status !== 'CLOSED'" variant="secondary" :icon="Pencil" @click="editOpen = true">Edit</AppButton>
            <AppButton v-if="c.status === 'DRAFT'" :icon="Rocket" :loading="busy === 'launch'" @click="launch">Launch</AppButton>
            <template v-if="c.status === 'ACTIVE'">
              <AppButton variant="secondary" :icon="UserPlus" @click="addOpen = true">Add people</AppButton>
              <AppButton v-if="!c.resultsReleasedAt" :icon="Eye" :loading="busy === 'release'" @click="release">Release results</AppButton>
              <AppButton variant="secondary" :icon="Lock" :loading="busy === 'close'" @click="closeCycle">Close</AppButton>
            </template>
          </template>
        </template>
      </AppPageHeader>

      <AppAlert v-if="c.status === 'ACTIVE' && c.withoutReviewer" tone="warning" class="mb-4" :title="`${c.withoutReviewer} review${c.withoutReviewer === 1 ? ' has' : 's have'} no reviewer`">
        Employees without a manager can't submit goals until a reviewer is assigned. Open their review to assign one.
      </AppAlert>

      <div class="mb-4 grid items-start gap-4 lg:grid-cols-3">
        <AppCard title="Setup">
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between gap-3"><dt class="text-fg-muted">Score</dt><dd class="text-end">Goals {{ c.goalsWeight }}%{{ c.goalsWeight < 100 ? ` · competencies ${100 - c.goalsWeight}%` : '' }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-fg-muted">Goals due</dt><dd>{{ c.goalsDue ? formatDate(c.goalsDue) : '—' }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-fg-muted">Self-review due</dt><dd>{{ c.selfReviewDue ? formatDate(c.selfReviewDue) : '—' }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-fg-muted">Manager review due</dt><dd>{{ c.managerReviewDue ? formatDate(c.managerReviewDue) : '—' }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-fg-muted">Who takes part</dt><dd class="text-end">{{ c.departments.length ? c.departments.map((d) => d.name).join(', ') : 'All departments' }}{{ c.eligibilityCutoff ? `, joined by ${formatDate(c.eligibilityCutoff)}` : '' }}</dd></div>
          </dl>
          <div v-if="c.competencies.length" class="mt-4 flex flex-wrap gap-2 border-t border-line/70 pt-3">
            <AppBadge v-for="k in c.competencies" :key="k.key" size="sm" :title="k.description ?? undefined">{{ k.name }}</AppBadge>
          </div>
        </AppCard>
        <AppCard title="Progress">
          <p v-if="!c.participants" class="text-sm text-fg-muted">{{ c.status === 'DRAFT' ? 'Launch the cycle to create reviews.' : 'Nobody is in this cycle.' }}</p>
          <ul v-else class="space-y-2 text-sm">
            <li v-for="s in STAGE_ORDER" :key="s" class="flex items-center justify-between gap-3">
              <AppBadge :tone="stageTone[s]" dot size="sm">{{ STAGE_LABELS[s] }}</AppBadge>
              <span class="tabular-nums text-fg-muted">{{ c.stages[s] }}</span>
            </li>
          </ul>
        </AppCard>
        <AppCard title="Rating distribution" :description="c.calibrated ? `${c.calibrated} calibrated` : 'Final ratings of completed reviews'">
          <ul class="space-y-2">
            <li v-for="n in [5, 4, 3, 2, 1]" :key="n" class="grid grid-cols-[1fr_auto] items-center gap-2 text-xs">
              <div>
                <p class="mb-0.5 text-fg-muted">{{ ratingText(n, c.ratingLabels) }}</p>
                <div class="h-2 rounded-full bg-surface-muted"><div class="h-2 rounded-full bg-brand-500" :style="{ width: `${(c.distribution[n] ?? 0) / maxBar * 100}%` }" /></div>
              </div>
              <span class="w-6 text-end tabular-nums text-fg">{{ c.distribution[n] ?? 0 }}</span>
            </li>
          </ul>
        </AppCard>
      </div>

      <AppCard v-if="c.participants" :padded="false">
        <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_240px]">
          <AppSearchInput v-model="table.search.value" placeholder="Search employees" aria-label="Search reviews" />
          <AppSelect v-model="table.filters.stage" :options="stageOptions" placeholder="All stages" aria-label="Filter by stage" />
        </div>
        <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Reviews" empty-title="No reviews" @page="table.setPage" @retry="table.load" @row-click="(row) => router.push(`/hr/performance/reviews/${row.id}`)">
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee.name" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ [row.employee.designation, row.employee.department].filter(Boolean).join(' · ') || row.employee.employeeCode }}</p>
              </div>
            </div>
          </template>
          <template #cell-reviewer="{ row }"><span :class="row.reviewer ? 'text-fg-muted' : 'text-amber-700 dark:text-amber-300'">{{ row.reviewer?.name ?? 'Not assigned' }}</span></template>
          <template #cell-stage="{ row }"><AppBadge :tone="stageTone[row.stage]" dot>{{ STAGE_LABELS[row.stage] }}</AppBadge></template>
          <template #cell-rating="{ row }">
            <span v-if="row.finalRating" class="font-medium tabular-nums">{{ row.finalRating }}<span v-if="row.calibrated" class="ms-1 text-xs text-fg-muted">(calibrated)</span></span>
            <span v-else class="text-fg-subtle">—</span>
          </template>
        </AppDataTable>
      </AppCard>

      <CycleFormModal :open="editOpen" :cycle="c" @close="editOpen = false" @saved="onEdited" />
      <AppModal :open="addOpen" title="Add people to this cycle" description="For example new joiners. Their manager becomes the reviewer." @close="addOpen = false">
        <ColleaguePicker v-model:values="adding" label="Employees" multiple />
        <template #footer>
          <AppButton variant="secondary" @click="addOpen = false">Cancel</AppButton>
          <AppButton :disabled="!adding.length" :loading="busy === 'add'" @click="addParticipants">Add {{ adding.length || '' }}</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
