<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CalendarPlus, History, XCircle } from '@lucide/vue';
import type { LeaveRequestStatus } from '@contracts';
import { leaveApi } from '@/modules/leave/api/leave.api';
import ApplyLeaveModal from '@/modules/leave/components/ApplyLeaveModal.vue';
import LeaveBalanceCards from '@/modules/leave/components/LeaveBalanceCards.vue';
import LeaveLedgerModal from '@/modules/leave/components/LeaveLedgerModal.vue';
import type { LeaveRequest } from '@/modules/leave/types';
import { LEAVE_STATUS_LABELS, formatDays, formatLeaveRange, leaveStatusTone, todayIso } from '@/modules/leave/utils/leave-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppEmptyState, AppErrorState, AppPageHeader, AppSelect, AppSkeleton, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const balances = useAsync(() => leaveApi.balances());
const types = useAsync(() => leaveApi.types());
const table = useTable((q) => leaveApi.requests({ ...q, view: 'mine' }), { filters: { status: undefined as LeaveRequestStatus | undefined } });
const canApply = computed(() => auth.can('leave.apply'));

const applyOpen = ref(false);
const applyType = ref<string | null>(null);
function openApply(typeId: string | null = null) {
  applyType.value = typeId;
  applyOpen.value = true;
}
async function onApplied() {
  applyOpen.value = false;
  feedback.success('Leave requested', 'Your manager has been notified.');
  await Promise.all([balances.run(), table.load()]);
}
onMounted(() => {
  if (route.query.apply !== undefined) {
    openApply();
    void router.replace({ query: {} });
  }
});

const ledgerOpen = ref(false);

const today = todayIso();
const cancellable = (r: LeaveRequest) => r.status === 'PENDING' || (r.status === 'APPROVED' && r.startDate > today);
async function cancel(r: LeaveRequest) {
  const approved = r.status === 'APPROVED';
  if (!(await feedback.confirm({ title: 'Cancel this leave?', message: approved ? 'The days go back to your balance and your manager is notified.' : 'The request is withdrawn.', confirmLabel: 'Cancel leave', danger: true }))) return;
  try {
    await leaveApi.cancel(r.id);
    feedback.success('Leave cancelled');
    await Promise.all([balances.run(), table.load()]);
  } catch (e) {
    feedback.error('Could not cancel the leave', e);
  }
}

const columns: TableColumn<LeaveRequest>[] = [
  { key: 'type', label: 'Leave' },
  { key: 'dates', label: 'Dates' },
  { key: 'days', label: 'Days', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
const statusOptions = (['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((s) => ({ value: s, label: LEAVE_STATUS_LABELS[s] }));
</script>

<template>
  <div>
    <AppPageHeader title="Leave" :description="balances.data.value ? `Leave year ${formatDate(balances.data.value.range.from)} – ${formatDate(balances.data.value.range.to)}.` : 'Your balances and requests.'">
      <template #actions>
        <AppButton variant="secondary" :icon="History" :disabled="!balances.data.value" @click="ledgerOpen = true">Balance history</AppButton>
        <AppButton v-if="canApply" :icon="CalendarPlus" :disabled="!balances.data.value?.balances.length" @click="openApply()">Apply for leave</AppButton>
      </template>
    </AppPageHeader>

    <AppSkeleton v-if="balances.loading.value && !balances.data.value" :lines="4" />
    <AppErrorState v-else-if="balances.error.value" :error="balances.error.value" title="Could not load your balances" @retry="balances.run" />
    <AppCard v-else-if="!balances.data.value?.balances.length">
      <AppEmptyState title="No leave types yet" description="Your HR team hasn't set up leave types for the organization." />
    </AppCard>
    <LeaveBalanceCards v-else :balances="balances.data.value.balances" :can-apply="canApply" @apply="openApply" />

    <AppCard class="mt-4" title="My requests" :padded="false">
      <template #actions>
        <AppSelect v-model="table.filters.status" class="w-44" size="sm" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </template>
      <AppDataTable
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        caption="My leave requests"
        empty-title="No leave requests"
        :empty-description="canApply ? 'Requests you submit appear here with their status.' : undefined"
        @page="table.setPage"
        @retry="table.load"
        :filtered="table.isFiltered.value"
        @clear="table.clearFilters()">
        <template #empty><AppButton v-if="canApply" :icon="CalendarPlus" :disabled="!balances.data.value?.balances.length" @click="openApply()">Apply for leave</AppButton></template>
        <template #cell-type="{ row }">
          <span class="inline-flex items-center gap-2">
            <span class="h-2.5 w-2.5 rounded-full" :style="{ backgroundColor: row.leaveType?.color }" aria-hidden="true" />
            <span class="font-medium text-fg">{{ row.leaveType?.name }}</span>
          </span>
          <p class="mt-0.5 max-w-xs truncate text-xs text-fg-muted" :title="row.reason">{{ row.reason }}</p>
        </template>
        <template #cell-dates="{ row }">
          <span class="text-fg">{{ formatLeaveRange(row) }}</span>
          <p class="text-xs text-fg-subtle">Applied {{ timeAgo(row.createdAt) }}</p>
        </template>
        <template #cell-days="{ row }"><span class="tabular-nums">{{ formatDays(row.days) }}</span></template>
        <template #cell-status="{ row }">
          <AppBadge :tone="leaveStatusTone[row.status]" dot>{{ LEAVE_STATUS_LABELS[row.status] }}</AppBadge>
          <p v-if="row.status === 'REJECTED' && row.reviewNote" class="mt-0.5 max-w-xs text-xs text-danger-fg">“{{ row.reviewNote }}”</p>
          <p v-else-if="row.reviewedBy && row.status === 'APPROVED'" class="mt-0.5 text-xs text-fg-subtle">by {{ row.reviewedBy }}</p>
          <p v-else-if="row.status === 'CANCELLED' && row.cancelledBy" class="mt-0.5 text-xs text-fg-subtle">by {{ row.cancelledBy }}</p>
        </template>
        <template #cell-actions="{ row }">
          <AppButton v-if="cancellable(row)" size="sm" variant="ghost" :icon="XCircle" @click="cancel(row)">Cancel</AppButton>
        </template>
      </AppDataTable>
    </AppCard>

    <ApplyLeaveModal
      v-if="balances.data.value && types.data.value"
      :open="applyOpen"
      :balances="balances.data.value.balances"
      :types="types.data.value"
      :initial-type-id="applyType"
      @close="applyOpen = false"
      @applied="onApplied"
    />
    <LeaveLedgerModal
      v-if="balances.data.value"
      :open="ledgerOpen"
      :year="balances.data.value.year"
      :types="balances.data.value.balances.map((b) => b.leaveType)"
      @close="ledgerOpen = false"
    />
  </div>
</template>
