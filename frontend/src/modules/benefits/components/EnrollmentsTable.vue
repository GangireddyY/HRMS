<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, CircleSlash, ShieldCheck, X } from '@lucide/vue';
import { BENEFIT_ENROLLMENT_STATUSES, type BenefitEnrollmentStatus } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { benefitsApi } from '@/modules/benefits/api/benefits.api';
import EnrollmentGridCard from '@/modules/benefits/components/EnrollmentGridCard.vue';
import type { Enrollment } from '@/modules/benefits/types';
import { BENEFIT_TYPE_VISUALS } from '@/modules/benefits/utils/benefit-visuals';
import { ENROLLMENT_STATUS_LABELS, LIFE_EVENT_LABELS, REASON_LABELS, RELATION_LABELS, enrollmentTone, inr } from '@/modules/benefits/utils/benefits-format';
import {
  AppAvatar,
  AppBadge,
  AppBulkDecision,
  AppButton,
  AppCard,
  AppDataTable,
  AppDatePicker,
  AppModal,
  AppSearchInput,
  AppSelect,
  AppStatStrip,
  AppTextarea,
  type StripItem,
  type TableColumn,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { runBulk } from '@/shared/utils/bulk';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

/**
 * Enrolments (of one plan, or all), with approval of pending requests and ending coverage (`benefits.manage`).
 * `summary` adds a status strip with counts that filters the list; without a `planId` the list can be narrowed to a plan.
 */
const props = defineProps<{ planId?: string; status?: BenefitEnrollmentStatus; showPlan?: boolean; summary?: boolean; title?: string; /** Icon-only row actions, for narrow columns. */ compact?: boolean }>();
const emit = defineEmits<{ changed: [] }>();

const auth = useAuthStore();
const feedback = useFeedbackStore();
const manage = computed(() => auth.can('benefits.manage', 'ORGANIZATION'));
const table = useTable((q) => benefitsApi.enrollments({ ...q, planId: props.planId ?? q.planId }), {
  filters: { status: props.status as BenefitEnrollmentStatus | undefined, planId: undefined as string | undefined },
});
watch(
  () => props.planId,
  () => void table.load(),
);
const statusOptions = BENEFIT_ENROLLMENT_STATUSES.map((s) => ({ value: s, label: ENROLLMENT_STATUS_LABELS[s] }));
const plans = useAsync(() => (props.planId ? Promise.resolve(null) : benefitsApi.plans({ page: 1, pageSize: 100 })));
const planOptions = computed(() => (plans.data.value?.items ?? []).map((p) => ({ value: p.id, label: p.name })));

// ---- Status strip -------------------------------------------------------------------------------------------------
const STRIP = ['PENDING', 'ACTIVE', 'WAIVED', 'ENDED'] as const;
const HINTS: Record<(typeof STRIP)[number], string> = { PENDING: 'Waiting for HR', ACTIVE: 'Currently covered', WAIVED: 'Chose not to enrol', ENDED: 'Cover has ended' };
const counts = useAsync(
  async () => {
    const planId = props.planId ?? table.filters.planId;
    const totals = await Promise.all(STRIP.map((status) => benefitsApi.enrollments({ planId, status, page: 1, pageSize: 1 }).then((r) => r.meta.total)));
    return Object.fromEntries(STRIP.map((s, i) => [s, totals[i]!])) as Record<(typeof STRIP)[number], number>;
  },
  { immediate: !!props.summary },
);
watch(
  () => [props.planId, table.filters.planId],
  () => props.summary && void counts.run(),
);
const strip = computed<StripItem[]>(() => STRIP.map((s) => ({ key: s, label: ENROLLMENT_STATUS_LABELS[s], value: counts.data.value?.[s], tone: enrollmentTone[s], hint: HINTS[s] })));
const refresh = async () => {
  await Promise.all([table.load(), props.summary ? counts.run() : Promise.resolve()]);
  emit('changed');
};

const columns = computed<TableColumn<Enrollment>[]>(() => [
  { key: 'employee', label: 'Employee' },
  ...(props.showPlan ? [{ key: 'plan', label: 'Plan' }] : []),
  { key: 'cover', label: 'Cover' },
  { key: 'cost', label: 'Monthly cost', align: 'right' as const },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' as const },
]);
const visual = (e: Enrollment) => BENEFIT_TYPE_VISUALS[e.plan.type ?? 'OTHER'];

const busy = ref(false);
async function approve(e: Enrollment) {
  if (!(await feedback.confirm({ title: `Approve ${e.employee?.name}'s enrolment?`, message: `${e.option?.name} from ${formatDate(e.effectiveFrom!)}. Any earlier choice for this plan ends.`, confirmLabel: 'Approve' }))) return;
  await act(() => benefitsApi.approve(e.id, null), 'Enrolment approved');
}
const rejecting = ref<Enrollment | null>(null);
const ending = ref<Enrollment | null>(null);
const note = ref('');
const endOn = ref<string | undefined>(undefined);
function openReject(e: Enrollment) {
  note.value = '';
  rejecting.value = e;
}
function openEnd(e: Enrollment) {
  note.value = '';
  endOn.value = undefined;
  ending.value = e;
}
const selected = ref<string[]>([]);
const bulkBusy = ref(false);
async function bulk(action: 'approve' | 'reject', reason = '') {
  bulkBusy.value = true;
  const { done, failed } = await runBulk([...selected.value], (id) => (action === 'approve' ? benefitsApi.approve(id, null) : benefitsApi.reject(id, reason)));
  bulkBusy.value = false;
  selected.value = failed;
  const verb = action === 'approve' ? 'approved' : 'rejected';
  if (done) feedback.success(`${done} ${done === 1 ? 'enrolment' : 'enrolments'} ${verb}`, failed.length ? `${failed.length} could not be ${verb} and stay selected.` : undefined);
  else feedback.error(`Could not ${action} the selected enrolments`);
  await refresh();
}

async function act(fn: () => Promise<unknown>, success: string) {
  busy.value = true;
  try {
    await fn();
    feedback.success(success);
    rejecting.value = null;
    ending.value = null;
    await refresh();
  } catch (e) {
    feedback.error('Could not complete the action', e);
  } finally {
    busy.value = false;
  }
}

const empty = computed(() =>
  table.filters.status === 'PENDING'
    ? { title: 'No requests waiting', description: 'Enrolment requests that need HR approval appear here.' }
    : { title: 'No enrolments', description: 'Employees appear here once they enrol in or waive a plan.' },
);
const listTitle = computed(() => props.title ?? (table.filters.status ? ENROLLMENT_STATUS_LABELS[table.filters.status] : 'All enrolments'));
</script>

<template>
  <div class="space-y-4">
    <AppStatStrip
      v-if="summary"
      :items="strip"
      selectable
      :selected="table.filters.status ?? null"
      :loading="counts.loading.value && !counts.data.value"
      label="Enrolments by status"
      @select="(k) => (table.filters.status = (k ?? undefined) as BenefitEnrollmentStatus | undefined)"
    />
    <AppCard :title="listTitle" :icon="ShieldCheck" :description="table.meta.value ? `${table.meta.value.total} ${table.meta.value.total === 1 ? 'enrolment' : 'enrolments'} · newest first` : undefined" :padded="false">
      <div :class="['grid gap-3 border-b border-line/70 px-4 py-3', planId ? 'sm:grid-cols-[1fr_220px]' : 'sm:grid-cols-[1fr_220px_220px]']">
        <AppSearchInput v-model="table.search.value" placeholder="Search by name or code" aria-label="Search enrolments" />
        <AppSelect v-if="!planId" v-model="table.filters.planId" :options="planOptions" placeholder="All plans" aria-label="Filter by plan" />
        <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </div>
      <AppDataTable
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        caption="Benefit enrolments"
        :empty-title="empty.title"
        :empty-description="empty.description"
        @page="table.setPage"
        @retry="table.load"
        :filtered="table.isFiltered.value"
        @clear="table.clearFilters()"
        v-model:selected="selected"
        :selectable="manage"
        :can-select="(r: Enrollment) => r.status === 'PENDING'"
        :select-label="(r: Enrollment) => `Select ${r.employee?.name ?? 'enrolment'}`"
      >
        <template #bulk><AppBulkDecision :count="selected.length" noun="enrolment" :busy="bulkBusy" @approve="bulk('approve')" @reject="(r) => bulk('reject', r)" /></template>
        <template #cell-employee="{ row }">
          <div class="flex items-center gap-3">
            <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.employee?.name }}</p>
              <p class="truncate text-xs text-fg-muted">{{ [row.employee?.employeeCode, row.employee?.department].filter(Boolean).join(' · ') }}</p>
            </div>
          </div>
        </template>
        <template #cell-plan="{ row }">
          <RouterLink :to="`/hr/benefits/plans/${row.plan.id}`" class="group flex items-center gap-2.5">
            <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', visual(row).tile]" aria-hidden="true"><component :is="visual(row).icon" :size="15" /></span>
            <span class="min-w-0">
              <span class="block truncate font-medium text-fg group-hover:text-accent-fg">{{ row.plan.name }}</span>
              <span v-if="row.plan.provider" class="block truncate text-xs text-fg-muted">{{ row.plan.provider }}</span>
            </span>
          </RouterLink>
        </template>
        <template #cell-cover="{ row }">
          <p class="text-fg">
            <span class="font-medium">{{ row.option?.name ?? (row.status === 'WAIVED' ? 'Waived' : '—') }}</span>
            <span v-if="row.coverageAmount" class="text-xs text-fg-muted tabular-nums"> · {{ inr(row.coverageAmount) }} cover</span>
          </p>
          <ul v-if="row.dependents.length" class="mt-1 flex flex-wrap gap-1" :aria-label="`Dependants of ${row.employee?.name}`">
            <li v-for="d in row.dependents" :key="d.id" class="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-px text-2xs text-fg ring-1 ring-line ring-inset">
              {{ d.name }}<span class="text-fg-muted">· {{ RELATION_LABELS[d.relationship] }}</span>
            </li>
          </ul>
          <p v-else-if="row.option" class="text-xs text-fg-subtle">Employee only</p>
          <p class="mt-0.5 text-xs text-fg-muted">
            {{ REASON_LABELS[row.reason] }}<template v-if="row.lifeEvent">: {{ LIFE_EVENT_LABELS[row.lifeEvent] }} on {{ formatDate(row.lifeEventDate!) }}</template>
            <template v-if="row.effectiveFrom"> · from {{ formatDate(row.effectiveFrom) }}</template><template v-if="row.effectiveTo"> to {{ formatDate(row.effectiveTo) }}</template>
          </p>
          <p v-if="row.note" class="max-w-sm truncate text-xs text-fg-muted italic" :title="row.note">“{{ row.note }}”</p>
        </template>
        <template #cell-cost="{ row }">
          <template v-if="row.employeeMonthly || row.employerMonthly">
            <p class="font-medium whitespace-nowrap text-fg tabular-nums">{{ inr(row.employeeMonthly + row.employerMonthly) }}</p>
            <p class="text-2xs whitespace-nowrap text-fg-muted tabular-nums">{{ row.employeeMonthly ? `${inr(row.employeeMonthly)} employee` : 'No cost to employee' }}</p>
          </template>
          <span v-else class="text-fg-subtle">—</span>
        </template>
        <template #cell-status="{ row }">
          <AppBadge :tone="enrollmentTone[row.status]" dot>{{ ENROLLMENT_STATUS_LABELS[row.status] }}</AppBadge>
          <p v-if="row.status === 'PENDING'" class="mt-0.5 text-xs whitespace-nowrap text-fg-subtle" :title="formatDate(row.createdAt)">Requested {{ timeAgo(row.createdAt) }}</p>
          <p v-else-if="row.status === 'REJECTED' && row.decisionNote" class="mt-0.5 max-w-48 truncate text-xs text-danger-fg" :title="row.decisionNote">“{{ row.decisionNote }}”</p>
          <p v-else-if="row.decidedBy" class="mt-0.5 text-xs text-fg-subtle">by {{ row.decidedBy }}</p>
        </template>
        <template #cell-actions="{ row }">
          <div v-if="manage" class="flex justify-end gap-1">
            <template v-if="row.status === 'PENDING'">
              <AppButton size="sm" variant="secondary" :icon="X" :aria-label="`Reject ${row.employee?.name}'s enrolment`" title="Reject" @click="openReject(row)" />
              <AppButton size="sm" :icon="Check" :loading="busy" @click="approve(row)">Approve</AppButton>
            </template>
            <AppButton v-else-if="row.status === 'ACTIVE' && compact" size="sm" variant="ghost" :icon="CircleSlash" :aria-label="`End ${row.employee?.name}'s cover`" title="End cover" @click="openEnd(row)" />
            <AppButton v-else-if="row.status === 'ACTIVE'" size="sm" variant="ghost" :icon="CircleSlash" @click="openEnd(row)">End cover</AppButton>
          </div>
        </template>
        <template #card="{ row }">
          <EnrollmentGridCard :enrollment="row" :show-plan="showPlan" :can-manage="manage" :busy="busy" :selectable="manage && row.status === 'PENDING'" @approve="approve(row)" @reject="openReject(row)" @end="openEnd(row)" />
        </template>
      </AppDataTable>
    </AppCard>
    <AppModal :open="!!rejecting" :title="`Reject ${rejecting?.employee?.name ?? ''}'s request?`" size="sm" @close="rejecting = null">
      <AppTextarea v-model="note" label="Reason (shown to the employee)" required :rows="3" :maxlength="1000" />
      <template #footer>
        <AppButton variant="secondary" @click="rejecting = null">Cancel</AppButton>
        <AppButton variant="danger" :loading="busy" :disabled="note.trim().length < 3" @click="act(() => benefitsApi.reject(rejecting!.id, note), 'Request rejected')">Reject</AppButton>
      </template>
    </AppModal>
    <AppModal :open="!!ending" :title="`End ${ending?.employee?.name ?? ''}'s cover?`" description="For example after a divorce, or when they leave. The employee is told." size="sm" @close="ending = null">
      <div class="space-y-4">
        <AppDatePicker v-model="endOn" label="Last day of cover" required />
        <AppTextarea v-model="note" label="Note" :rows="2" :maxlength="1000" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="ending = null">Cancel</AppButton>
        <AppButton :loading="busy" :disabled="!endOn" @click="act(() => benefitsApi.end(ending!.id, endOn!, note || null), 'Cover ended')">End cover</AppButton>
      </template>
    </AppModal>
  </div>
</template>
