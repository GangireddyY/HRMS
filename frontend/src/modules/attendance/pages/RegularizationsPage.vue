<script setup lang="ts">
import { ref } from 'vue';
import { Check, X } from '@lucide/vue';
import type { RegularizationStatus } from '@contracts';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { Regularization } from '@/modules/attendance/types';
import { REGULARIZATION_LABELS, formatMinutes, formatTime, regularizationTone } from '@/modules/attendance/utils/attendance-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppInput, AppModal, AppPageHeader, AppSelect, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

const feedback = useFeedbackStore();
const table = useTable((q) => attendanceApi.regularizations({ ...q, view: 'team' }), { filters: { status: 'PENDING' as RegularizationStatus | undefined } });

const columns: TableColumn<Regularization>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'workDate', label: 'Day' },
  { key: 'times', label: 'Requested times' },
  { key: 'reason', label: 'Reason' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
const statusOptions = (['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((s) => ({ value: s, label: REGULARIZATION_LABELS[s] }));
const duration = (r: Regularization) => formatMinutes(Math.round((new Date(r.checkOutAt).getTime() - new Date(r.checkInAt).getTime()) / 60_000));

const reviewing = ref<{ request: Regularization; action: 'approve' | 'reject' } | null>(null);
const note = ref('');
const busy = ref(false);

function open(request: Regularization, action: 'approve' | 'reject') {
  reviewing.value = { request, action };
  note.value = '';
}

async function submit() {
  const r = reviewing.value!;
  busy.value = true;
  try {
    if (r.action === 'approve') await attendanceApi.approve(r.request.id, note.value || undefined);
    else await attendanceApi.reject(r.request.id, note.value || undefined);
    feedback.success(r.action === 'approve' ? 'Request approved' : 'Request rejected', `${r.request.employee?.name} has been notified.`);
    reviewing.value = null;
    await table.load();
  } catch (e) {
    feedback.error('Could not update the request', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Regularization requests" description="Corrections requested by people in your scope. Approving updates their attendance for that day." />
    <AppCard :padded="false">
      <div class="flex justify-end border-b border-line p-4">
        <AppSelect v-model="table.filters.status" class="w-48" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </div>
      <AppDataTable
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        caption="Regularization requests"
        :empty-title="table.filters.status === 'PENDING' ? 'Nothing to review' : 'No requests'"
        :empty-description="table.filters.status === 'PENDING' ? 'New requests from your team will appear here.' : undefined"
        @page="table.setPage"
        @retry="table.load"
      >
        <template #cell-employee="{ row }">
          <div class="flex items-center gap-3">
            <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.employee?.name }}</p>
              <p class="truncate text-xs text-fg-muted">{{ row.employee?.employeeCode }} · {{ timeAgo(row.createdAt) }}</p>
            </div>
          </div>
        </template>
        <template #cell-workDate="{ row }">{{ formatDate(row.workDate) }}</template>
        <template #cell-times="{ row }"><span class="tabular-nums">{{ formatTime(row.checkInAt) }}–{{ formatTime(row.checkOutAt) }}</span> <span class="text-xs text-fg-muted">({{ duration(row) }})</span></template>
        <template #cell-reason="{ row }"><p class="max-w-xs truncate text-fg-muted" :title="row.reason">{{ row.reason }}</p></template>
        <template #cell-status="{ row }">
          <AppBadge :tone="regularizationTone[row.status]" dot>{{ REGULARIZATION_LABELS[row.status] }}</AppBadge>
          <p v-if="row.reviewedBy" class="mt-0.5 text-xs text-fg-subtle">by {{ row.reviewedBy }}</p>
        </template>
        <template #cell-actions="{ row }">
          <div v-if="row.status === 'PENDING'" class="flex justify-end gap-1.5">
            <AppButton size="sm" variant="secondary" :icon="X" @click="open(row, 'reject')">Reject</AppButton>
            <AppButton size="sm" :icon="Check" @click="open(row, 'approve')">Approve</AppButton>
          </div>
        </template>
      </AppDataTable>
    </AppCard>

    <AppModal
      :open="!!reviewing"
      :title="reviewing?.action === 'approve' ? 'Approve request' : 'Reject request'"
      :description="reviewing ? `${reviewing.request.employee?.name} · ${formatDate(reviewing.request.workDate)} · ${formatTime(reviewing.request.checkInAt)}–${formatTime(reviewing.request.checkOutAt)}` : undefined"
      size="sm"
      @close="reviewing = null"
    >
      <AppInput v-model="note" label="Note to the employee" :placeholder="reviewing?.action === 'reject' ? 'Why is it rejected?' : 'Optional'" :maxlength="500" />
      <template #footer>
        <AppButton variant="secondary" @click="reviewing = null">Cancel</AppButton>
        <AppButton :variant="reviewing?.action === 'reject' ? 'danger' : 'primary'" :loading="busy" @click="submit">{{ reviewing?.action === 'approve' ? 'Approve' : 'Reject' }}</AppButton>
      </template>
    </AppModal>
  </div>
</template>
