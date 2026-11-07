<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, CircleSlash, X } from '@lucide/vue';
import { BENEFIT_ENROLLMENT_STATUSES, type BenefitEnrollmentStatus } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { benefitsApi } from '@/modules/benefits/api/benefits.api';
import type { Enrollment } from '@/modules/benefits/types';
import { ENROLLMENT_STATUS_LABELS, LIFE_EVENT_LABELS, REASON_LABELS, RELATION_LABELS, enrollmentTone, inr } from '@/modules/benefits/utils/benefits-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppDatePicker, AppModal, AppSearchInput, AppSelect, AppTextarea, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Enrolments (of one plan, or all), with approval of pending requests and ending coverage (`benefits.manage`). */
const props = defineProps<{ planId?: string; status?: BenefitEnrollmentStatus; showPlan?: boolean }>();
const emit = defineEmits<{ changed: [] }>();

const auth = useAuthStore();
const feedback = useFeedbackStore();
const manage = computed(() => auth.can('benefits.manage', 'ORGANIZATION'));
const table = useTable((q) => benefitsApi.enrollments({ ...q, planId: props.planId }), { filters: { status: props.status as BenefitEnrollmentStatus | undefined } });
watch(
  () => props.planId,
  () => void table.load(),
);
const statusOptions = BENEFIT_ENROLLMENT_STATUSES.map((s) => ({ value: s, label: ENROLLMENT_STATUS_LABELS[s] }));
const columns = computed<TableColumn<Enrollment>[]>(() => [
  { key: 'employee', label: 'Employee' },
  ...(props.showPlan ? [{ key: 'plan', label: 'Plan' }] : []),
  { key: 'cover', label: 'Cover' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' as const },
]);

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
async function act(fn: () => Promise<unknown>, success: string) {
  busy.value = true;
  try {
    await fn();
    feedback.success(success);
    rejecting.value = null;
    ending.value = null;
    await table.load();
    emit('changed');
  } catch (e) {
    feedback.error('Could not complete the action', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppCard :padded="false">
    <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_220px]">
      <AppSearchInput v-model="table.search.value" placeholder="Search by name or code" aria-label="Search enrolments" />
      <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
    </div>
    <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" caption="Benefit enrolments" empty-title="No enrolments" @page="table.setPage" @retry="table.load">
      <template #cell-employee="{ row }">
        <p class="font-medium text-fg">{{ row.employee?.name }}</p>
        <p class="text-xs text-fg-muted">{{ row.employee?.employeeCode }}{{ row.employee?.department ? ` · ${row.employee.department}` : '' }}</p>
      </template>
      <template #cell-plan="{ row }"><span class="text-fg">{{ row.plan.name }}</span></template>
      <template #cell-cover="{ row }">
        <p class="text-fg">{{ row.option?.name ?? '—' }}<span v-if="row.employeeMonthly" class="text-xs text-fg-muted"> · {{ inr(row.employeeMonthly) }}/month</span></p>
        <p v-if="row.dependents.length" class="text-xs text-fg-muted">{{ row.dependents.map((d) => `${d.name} (${RELATION_LABELS[d.relationship].toLowerCase()})`).join(', ') }}</p>
        <p class="text-xs text-fg-muted">
          {{ REASON_LABELS[row.reason] }}<template v-if="row.lifeEvent">: {{ LIFE_EVENT_LABELS[row.lifeEvent] }} on {{ formatDate(row.lifeEventDate!) }}</template>
          <template v-if="row.effectiveFrom"> · from {{ formatDate(row.effectiveFrom) }}</template><template v-if="row.effectiveTo"> to {{ formatDate(row.effectiveTo) }}</template>
        </p>
        <p v-if="row.note" class="text-xs text-fg-muted italic">“{{ row.note }}”</p>
      </template>
      <template #cell-status="{ row }"><AppBadge :tone="enrollmentTone[row.status]" dot>{{ ENROLLMENT_STATUS_LABELS[row.status] }}</AppBadge></template>
      <template #cell-actions="{ row }">
        <div v-if="manage" class="flex justify-end gap-1">
          <template v-if="row.status === 'PENDING'">
            <AppButton size="sm" variant="ghost" :icon="X" :aria-label="`Reject ${row.employee?.name}'s enrolment`" @click="openReject(row)" />
            <AppButton size="sm" :icon="Check" :loading="busy" @click="approve(row)">Approve</AppButton>
          </template>
          <AppButton v-else-if="row.status === 'ACTIVE'" size="sm" variant="ghost" :icon="CircleSlash" @click="openEnd(row)">End cover</AppButton>
        </div>
      </template>
    </AppDataTable>
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
  </AppCard>
</template>
