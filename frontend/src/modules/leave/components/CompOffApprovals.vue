<script setup lang="ts">
import { computed, ref } from 'vue';
import { CalendarHeart, Check, X } from '@lucide/vue';
import type { LeaveRequestStatus } from '@contracts';
import { leaveApi } from '@/modules/leave/api/leave.api';
import type { CompOffRequest } from '@/modules/leave/types';
import { LEAVE_STATUS_LABELS, formatDays, leaveStatusTone } from '@/modules/leave/utils/leave-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppSegmented, AppTextarea, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Comp-off requests from people the approver can approve leave for: approving credits their comp-off balance. */
const emit = defineEmits<{ changed: [] }>();
const feedback = useFeedbackStore();
const table = useTable((q) => leaveApi.compOffs({ ...q, view: 'team' }), { filters: { status: 'PENDING' as LeaveRequestStatus | undefined } });

type StatusFilter = LeaveRequestStatus | 'ALL';
const status = computed<StatusFilter>({
  get: () => table.filters.status ?? 'ALL',
  set: (v) => (table.filters.status = v === 'ALL' ? undefined : v),
});
const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'ALL', label: 'All' },
];
const columns: TableColumn<CompOffRequest>[] = [
  { key: 'employee', label: 'Employee', exportValue: (r) => r.employee?.name ?? '' },
  { key: 'day', label: 'Day worked', exportValue: (r) => `${r.workDate} ${r.dayLabel ?? (r.dayKind === 'HOLIDAY' ? 'Holiday' : 'Weekly off')}` },
  { key: 'days', label: 'Comp-off', align: 'right', exportValue: (r) => r.days },
  { key: 'status', label: 'Status', exportValue: (r) => LEAVE_STATUS_LABELS[r.status] },
  { key: 'actions', label: '', align: 'right', noExport: true },
];
const hours = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
const dayName = (r: CompOffRequest) => (r.dayKind === 'HOLIDAY' ? (r.dayLabel ?? 'Holiday') : 'Weekly off');

const acting = ref<{ request: CompOffRequest; action: 'approve' | 'reject' } | null>(null);
const note = ref('');
const busy = ref(false);
function open(request: CompOffRequest, action: 'approve' | 'reject') {
  acting.value = { request, action };
  note.value = '';
}
async function submit() {
  if (!acting.value) return;
  const { request, action } = acting.value;
  busy.value = true;
  try {
    if (action === 'approve') await leaveApi.approveCompOff(request.id, note.value || undefined);
    else await leaveApi.rejectCompOff(request.id, note.value);
    feedback.success(action === 'approve' ? `${formatDays(request.days)} of comp-off credited to ${request.employee?.name}` : 'Comp-off rejected');
    acting.value = null;
    await table.load();
    emit('changed');
  } catch (e) {
    feedback.error(`Could not ${action} the comp-off`, e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppCard title="Comp-off requests" description="Days off people worked. Approving credits their comp-off balance; it expires after the validity period." :icon="CalendarHeart" :padded="false">
    <template #actions><AppSegmented v-model="status" size="sm" :options="statusOptions" label="Filter by status" /></template>
    <AppDataTable
      :columns="columns"
      :rows="table.rows.value"
      :loading="table.loading.value"
      :error="table.error.value"
      :meta="table.meta.value"
      caption="Comp-off requests"
      export-file="comp-off-requests"
      :empty-title="table.filters.status === 'PENDING' ? 'No comp-off waiting for you' : 'No comp-off requests'"
      empty-description="Requests appear when someone in your team asks for a day back for working on a holiday or weekly off."
      @page="table.setPage"
      @retry="table.load"
    >
      <template #cell-employee="{ row }">
        <div class="flex items-center gap-3">
          <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
          <div class="min-w-0">
            <p class="truncate font-medium text-fg">{{ row.employee?.name }}</p>
            <p class="max-w-56 truncate text-xs text-fg-muted" :title="row.reason">{{ row.reason }}</p>
          </div>
        </div>
      </template>
      <template #cell-day="{ row }">
        <span class="block whitespace-nowrap text-fg">{{ formatDate(row.workDate) }}</span>
        <span class="block text-xs whitespace-nowrap text-fg-subtle">{{ dayName(row) }} · worked {{ hours(row.workedMinutes) }} · asked {{ timeAgo(row.createdAt) }}</span>
      </template>
      <template #cell-days="{ row }"><span class="font-medium whitespace-nowrap tabular-nums">{{ formatDays(row.days) }}</span></template>
      <template #cell-status="{ row }">
        <AppBadge :tone="leaveStatusTone[row.status]" dot>{{ LEAVE_STATUS_LABELS[row.status] }}</AppBadge>
        <p v-if="row.status === 'APPROVED' && row.expiresOn" class="mt-0.5 text-xs text-fg-subtle">use by {{ formatDate(row.expiresOn) }}</p>
        <p v-else-if="row.status === 'REJECTED' && row.reviewNote" class="mt-0.5 max-w-48 truncate text-xs text-danger-fg" :title="row.reviewNote">“{{ row.reviewNote }}”</p>
      </template>
      <template #cell-actions="{ row }">
        <div v-if="row.permissions.review" class="flex justify-end gap-2">
          <AppButton size="sm" variant="secondary" :icon="X" :aria-label="`Reject ${row.employee?.name}'s comp-off`" title="Reject" @click="open(row, 'reject')" />
          <AppButton size="sm" :icon="Check" :aria-label="`Approve ${row.employee?.name}'s comp-off`" @click="open(row, 'approve')">Approve</AppButton>
        </div>
      </template>
    </AppDataTable>

    <AppModal
      :open="!!acting"
      :title="acting?.action === 'approve' ? 'Approve comp-off' : 'Reject comp-off'"
      :description="acting ? `${acting.request.employee?.name} · ${formatDate(acting.request.workDate)} (${dayName(acting.request)}) · ${formatDays(acting.request.days)}` : undefined"
      size="sm"
      dialog
      :guide="false"
      @close="acting = null"
    >
      <p v-if="acting?.request.reason" class="mb-3 rounded-lg bg-surface-muted/60 px-3 py-2 text-sm text-fg-muted">“{{ acting.request.reason }}”</p>
      <AppTextarea
        v-model="note"
        :label="acting?.action === 'approve' ? 'Note to the employee' : 'Reason'"
        :required="acting?.action === 'reject'"
        :rows="2"
        :maxlength="500"
        :placeholder="acting?.action === 'approve' ? 'Optional' : 'Why is it rejected?'"
      />
      <template #footer>
        <AppButton variant="secondary" @click="acting = null">Cancel</AppButton>
        <AppButton :variant="acting?.action === 'approve' ? 'primary' : 'danger'" :loading="busy" :disabled="acting?.action === 'reject' && note.trim().length < 3" @click="submit">
          {{ acting?.action === 'approve' ? 'Approve' : 'Reject' }}
        </AppButton>
      </template>
    </AppModal>
  </AppCard>
</template>
