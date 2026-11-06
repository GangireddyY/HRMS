<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, X, XCircle } from '@lucide/vue';
import type { LeaveRequestStatus } from '@contracts';
import { leaveApi } from '@/modules/leave/api/leave.api';
import type { LeaveRequest } from '@/modules/leave/types';
import { LEAVE_STATUS_LABELS, formatDays, formatLeaveRange, leaveStatusTone } from '@/modules/leave/utils/leave-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppSelect, AppTabs, AppTextarea, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const canApprove = computed(() => auth.can('leave.approve'));
const view = ref<'team' | 'all'>(canApprove.value ? 'team' : 'all');
const tabs = computed(() => [...(canApprove.value ? [{ key: 'team', label: 'To approve' }] : []), { key: 'all', label: 'All leave' }]);
const table = useTable((q) => leaveApi.requests({ ...q, view: view.value }), { filters: { status: (canApprove.value ? 'PENDING' : undefined) as LeaveRequestStatus | undefined } });
watch(view, (v) => {
  table.filters.status = v === 'team' ? 'PENDING' : undefined;
  void table.load();
});

const columns: TableColumn<LeaveRequest>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'type', label: 'Leave' },
  { key: 'dates', label: 'Dates' },
  { key: 'days', label: 'Days', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
const statusOptions = (['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((s) => ({ value: s, label: LEAVE_STATUS_LABELS[s] }));

type Action = 'approve' | 'reject' | 'cancel';
const acting = ref<{ request: LeaveRequest; action: Action } | null>(null);
const note = ref('');
const busy = ref(false);
function open(request: LeaveRequest, action: Action) {
  acting.value = { request, action };
  note.value = '';
}
const noteRequired = computed(() => acting.value?.action !== 'approve');
const TITLES: Record<Action, string> = { approve: 'Approve leave', reject: 'Reject leave', cancel: 'Cancel approved leave' };

async function submit() {
  const a = acting.value!;
  busy.value = true;
  try {
    if (a.action === 'approve') await leaveApi.approve(a.request.id, note.value || undefined);
    else if (a.action === 'reject') await leaveApi.reject(a.request.id, note.value);
    else await leaveApi.cancel(a.request.id, note.value);
    feedback.success(a.action === 'approve' ? 'Leave approved' : a.action === 'reject' ? 'Leave rejected' : 'Leave cancelled', `${a.request.employee?.name} has been notified.`);
    acting.value = null;
    await table.load();
  } catch (e) {
    feedback.error('Could not update the leave', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Leave requests" description="Approve or reject leave for people in your scope. Approved leave is deducted from their balance and shown in attendance." />
    <AppTabs v-model="view" :tabs="tabs">
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
          caption="Leave requests"
          :empty-title="table.filters.status === 'PENDING' ? 'Nothing to review' : 'No leave requests'"
          :empty-description="table.filters.status === 'PENDING' ? 'New requests from your team appear here.' : undefined"
          @page="table.setPage"
          @retry="table.load"
        >
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee?.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ [row.employee?.employeeCode, row.employee?.department].filter(Boolean).join(' · ') }}</p>
              </div>
            </div>
          </template>
          <template #cell-type="{ row }">
            <span class="inline-flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full" :style="{ backgroundColor: row.leaveType?.color }" aria-hidden="true" />{{ row.leaveType?.name }}</span>
            <p class="mt-0.5 max-w-xs truncate text-xs text-fg-muted" :title="row.reason">{{ row.reason }}</p>
          </template>
          <template #cell-dates="{ row }">
            <span>{{ formatLeaveRange(row) }}</span>
            <p class="text-xs text-fg-subtle">Applied {{ timeAgo(row.createdAt) }}</p>
          </template>
          <template #cell-days="{ row }"><span class="tabular-nums">{{ formatDays(row.days) }}</span></template>
          <template #cell-status="{ row }">
            <AppBadge :tone="leaveStatusTone[row.status]" dot>{{ LEAVE_STATUS_LABELS[row.status] }}</AppBadge>
            <p v-if="row.reviewedBy && row.status !== 'CANCELLED'" class="mt-0.5 text-xs text-fg-subtle">by {{ row.reviewedBy }}</p>
            <p v-else-if="row.cancelledBy" class="mt-0.5 text-xs text-fg-subtle">by {{ row.cancelledBy }}</p>
          </template>
          <template #cell-actions="{ row }">
            <div v-if="row.status === 'PENDING' && view === 'team'" class="flex justify-end gap-1.5">
              <AppButton size="sm" variant="secondary" :icon="X" @click="open(row, 'reject')">Reject</AppButton>
              <AppButton size="sm" :icon="Check" @click="open(row, 'approve')">Approve</AppButton>
            </div>
            <AppButton v-else-if="row.status === 'APPROVED' && canApprove" size="sm" variant="ghost" :icon="XCircle" @click="open(row, 'cancel')">Cancel</AppButton>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>

    <AppModal
      :open="!!acting"
      :title="acting ? TITLES[acting.action] : ''"
      :description="acting ? `${acting.request.employee?.name} · ${acting.request.leaveType?.name} · ${formatLeaveRange(acting.request)} (${formatDays(acting.request.days)})` : undefined"
      size="sm"
      @close="acting = null"
    >
      <p v-if="acting?.request.reason" class="mb-3 rounded-lg bg-surface-muted/60 px-3 py-2 text-sm text-fg-muted">“{{ acting.request.reason }}”</p>
      <AppTextarea
        v-model="note"
        :label="acting?.action === 'approve' ? 'Note to the employee' : 'Reason'"
        :required="noteRequired"
        :rows="2"
        :maxlength="500"
        :placeholder="acting?.action === 'approve' ? 'Optional' : acting?.action === 'reject' ? 'Why is it rejected?' : 'Why is the approved leave cancelled? The days are returned.'"
      />
      <template #footer>
        <AppButton variant="secondary" @click="acting = null">Back</AppButton>
        <AppButton :variant="acting?.action === 'approve' ? 'primary' : 'danger'" :loading="busy" :disabled="noteRequired && note.trim().length < 3" @click="submit">
          {{ acting?.action === 'approve' ? 'Approve' : acting?.action === 'reject' ? 'Reject' : 'Cancel leave' }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
