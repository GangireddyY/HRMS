<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Check, X } from '@lucide/vue';
import type { OvertimeStatus, RegularizationStatus } from '@contracts';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { Overtime, Regularization, WorkFromHome } from '@/modules/attendance/types';
import { OVERTIME_LABELS, REGULARIZATION_LABELS, dateRange, formatMinutes, formatTime, overtimeTone, regularizationTone } from '@/modules/attendance/utils/attendance-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppInput, AppModal, AppPageHeader, AppSelect, AppTabs, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Attendance approvals for people in scope: regularizations, work from home and overtime. */
const route = useRoute();
const router = useRouter();
const feedback = useFeedbackStore();
const tabs = [
  { key: 'regularizations', label: 'Regularizations' },
  { key: 'wfh', label: 'Work from home' },
  { key: 'overtime', label: 'Overtime' },
];
const tab = computed({
  get: () => (tabs.some((t) => t.key === route.query.tab) ? String(route.query.tab) : 'regularizations'),
  set: (v: string) => void router.replace({ query: { ...route.query, tab: v } }),
});

const table = useTable((q) => attendanceApi.regularizations({ ...q, view: 'team' }), { filters: { status: 'PENDING' as RegularizationStatus | undefined } });
const wfhTable = useTable((q) => attendanceApi.workFromHome({ ...q, view: 'team' }), { filters: { status: 'PENDING' as RegularizationStatus | undefined } });
const otTable = useTable((q) => attendanceApi.overtime({ ...q, view: 'team' }), { filters: { status: 'PENDING' as OvertimeStatus | undefined } });
watch(tab, (t) => void (t === 'wfh' ? wfhTable.load() : t === 'overtime' ? otTable.load() : table.load()));

const columns: TableColumn<Regularization>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'workDate', label: 'Day' },
  { key: 'times', label: 'Requested times' },
  { key: 'reason', label: 'Reason' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
const wfhColumns: TableColumn<WorkFromHome>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'days', label: 'Days' },
  { key: 'reason', label: 'Reason' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
const otColumns: TableColumn<Overtime>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'workDate', label: 'Day' },
  { key: 'worked', label: 'Worked' },
  { key: 'minutes', label: 'Overtime', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
const statusOptions = (['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((s) => ({ value: s, label: REGULARIZATION_LABELS[s] }));
const otStatusOptions = (['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => ({ value: s, label: OVERTIME_LABELS[s] }));
const duration = (r: Regularization) => formatMinutes(Math.round((new Date(r.checkOutAt).getTime() - new Date(r.checkInAt).getTime()) / 60_000));

type Reviewing =
  | { kind: 'regularization'; item: Regularization; action: 'approve' | 'reject' }
  | { kind: 'wfh'; item: WorkFromHome; action: 'approve' | 'reject' }
  | { kind: 'overtime'; item: Overtime; action: 'approve' | 'reject' };
const reviewing = ref<Reviewing | null>(null);
const note = ref('');
const minutes = ref<string | number>('');
const busy = ref(false);

function open(r: Reviewing) {
  reviewing.value = r;
  note.value = '';
  minutes.value = r.kind === 'overtime' ? r.item.minutes : '';
}
const title = computed(() => {
  const r = reviewing.value;
  if (!r) return '';
  const what = r.kind === 'regularization' ? 'request' : r.kind === 'wfh' ? 'work from home' : 'overtime';
  return `${r.action === 'approve' ? 'Approve' : 'Reject'} ${what}`;
});
const description = computed(() => {
  const r = reviewing.value;
  if (!r) return undefined;
  if (r.kind === 'regularization') return `${r.item.employee?.name} · ${formatDate(r.item.workDate)} · ${formatTime(r.item.checkInAt)}–${formatTime(r.item.checkOutAt)}`;
  if (r.kind === 'wfh') return `${r.item.employee?.name} · ${dateRange(r.item.startDate, r.item.endDate)}`;
  return `${r.item.employee?.name} · ${formatDate(r.item.workDate)} · ${formatMinutes(r.item.minutes)} overtime`;
});
const needsNote = computed(() => reviewing.value?.action === 'reject' && reviewing.value.kind !== 'regularization');

async function submit() {
  const r = reviewing.value!;
  busy.value = true;
  try {
    if (r.kind === 'regularization') {
      if (r.action === 'approve') await attendanceApi.approve(r.item.id, note.value || undefined);
      else await attendanceApi.reject(r.item.id, note.value || undefined);
      await table.load();
    } else if (r.kind === 'wfh') {
      if (r.action === 'approve') await attendanceApi.approveWorkFromHome(r.item.id, note.value || null);
      else await attendanceApi.rejectWorkFromHome(r.item.id, note.value);
      await wfhTable.load();
    } else {
      if (r.action === 'approve') await attendanceApi.approveOvertime(r.item.id, { minutes: Number(minutes.value) || undefined, note: note.value || null });
      else await attendanceApi.rejectOvertime(r.item.id, note.value);
      await otTable.load();
    }
    feedback.success(r.action === 'approve' ? 'Approved' : 'Rejected', `${r.item.employee?.name} has been notified.`);
    reviewing.value = null;
  } catch (e) {
    feedback.error('Could not update it', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Attendance approvals" description="Corrections, work-from-home days and overtime of the people in your scope." />
    <AppTabs v-model="tab" :tabs="tabs">
      <AppCard v-if="tab === 'regularizations'" :padded="false">
        <div class="flex items-center justify-end gap-2 border-b border-line/70 px-4 py-2">
          <AppSelect size="sm" v-model="table.filters.status" class="w-48" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
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
            <div v-if="row.status === 'PENDING'" class="flex justify-end gap-2">
              <AppButton size="sm" variant="secondary" :icon="X" @click="open({ kind: 'regularization', item: row, action: 'reject' })">Reject</AppButton>
              <AppButton size="sm" :icon="Check" @click="open({ kind: 'regularization', item: row, action: 'approve' })">Approve</AppButton>
            </div>
          </template>
        </AppDataTable>
      </AppCard>

      <AppCard v-else-if="tab === 'wfh'" :padded="false">
        <div class="flex items-center justify-end gap-2 border-b border-line/70 px-4 py-2">
          <AppSelect size="sm" v-model="wfhTable.filters.status" class="w-48" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable
          :columns="wfhColumns"
          :rows="wfhTable.rows.value"
          :loading="wfhTable.loading.value"
          :error="wfhTable.error.value"
          :meta="wfhTable.meta.value"
          caption="Work-from-home requests"
          :empty-title="wfhTable.filters.status === 'PENDING' ? 'Nothing to review' : 'No requests'"
          @page="wfhTable.setPage"
          @retry="wfhTable.load"
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
          <template #cell-days="{ row }">{{ dateRange(row.startDate, row.endDate) }}</template>
          <template #cell-reason="{ row }"><p class="max-w-xs truncate text-fg-muted" :title="row.reason">{{ row.reason }}</p></template>
          <template #cell-status="{ row }">
            <AppBadge :tone="regularizationTone[row.status]" dot>{{ REGULARIZATION_LABELS[row.status] }}</AppBadge>
            <p v-if="row.reviewedBy" class="mt-0.5 text-xs text-fg-subtle">by {{ row.reviewedBy }}</p>
          </template>
          <template #cell-actions="{ row }">
            <div v-if="row.permissions.review" class="flex justify-end gap-2">
              <AppButton size="sm" variant="secondary" :icon="X" @click="open({ kind: 'wfh', item: row, action: 'reject' })">Reject</AppButton>
              <AppButton size="sm" :icon="Check" @click="open({ kind: 'wfh', item: row, action: 'approve' })">Approve</AppButton>
            </div>
          </template>
        </AppDataTable>
      </AppCard>

      <AppCard v-else :padded="false">
        <div class="flex items-center justify-end gap-2 border-b border-line/70 px-4 py-2">
          <AppSelect size="sm" v-model="otTable.filters.status" class="w-56" :options="otStatusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable
          :columns="otColumns"
          :rows="otTable.rows.value"
          :loading="otTable.loading.value"
          :error="otTable.error.value"
          :meta="otTable.meta.value"
          caption="Overtime"
          :empty-title="otTable.filters.status === 'PENDING' ? 'Nothing to review' : 'No overtime'"
          empty-description="Overtime is counted on shifts that have it switched on."
          @page="otTable.setPage"
          @retry="otTable.load"
        >
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee?.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ row.employee?.employeeCode }}</p>
              </div>
            </div>
          </template>
          <template #cell-workDate="{ row }">{{ formatDate(row.workDate) }}</template>
          <template #cell-worked="{ row }">
            <span class="tabular-nums">{{ formatTime(row.record?.checkInAt) }}–{{ formatTime(row.record?.checkOutAt) }}</span>
            <span class="text-xs text-fg-muted"> ({{ formatMinutes(row.record?.workedMinutes) }})</span>
          </template>
          <template #cell-minutes="{ row }">
            <span class="font-medium tabular-nums">{{ formatMinutes(row.approvedMinutes ?? row.minutes) }}</span>
            <p v-if="row.approvedMinutes !== null && row.approvedMinutes !== row.minutes" class="text-xs text-fg-muted">of {{ formatMinutes(row.minutes) }}</p>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :tone="overtimeTone[row.status]" dot>{{ OVERTIME_LABELS[row.status] }}</AppBadge>
            <p v-if="row.paidIn" class="mt-0.5 text-xs text-fg-subtle">paid in {{ row.paidIn }}</p>
            <p v-else-if="row.reviewedBy" class="mt-0.5 text-xs text-fg-subtle">by {{ row.reviewedBy }}</p>
          </template>
          <template #cell-actions="{ row }">
            <div v-if="row.permissions.review" class="flex justify-end gap-2">
              <AppButton size="sm" variant="secondary" :icon="X" @click="open({ kind: 'overtime', item: row, action: 'reject' })">Reject</AppButton>
              <AppButton size="sm" :icon="Check" @click="open({ kind: 'overtime', item: row, action: 'approve' })">Approve</AppButton>
            </div>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>

    <AppModal :open="!!reviewing" :title="title" :description="description" size="sm" @close="reviewing = null">
      <div class="space-y-4">
        <AppInput v-if="reviewing?.kind === 'overtime' && reviewing.action === 'approve'" v-model="minutes" label="Minutes to approve" type="number" :min="1" :max="reviewing.item.minutes" suffix="min" :help="`Up to ${formatMinutes(reviewing.item.minutes)} worked`" />
        <AppInput v-model="note" label="Note to the employee" :placeholder="reviewing?.action === 'reject' ? 'Why is it rejected?' : 'Optional'" :required="needsNote" :maxlength="500" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="reviewing = null">Cancel</AppButton>
        <AppButton :variant="reviewing?.action === 'reject' ? 'danger' : 'primary'" :loading="busy" :disabled="needsNote && note.trim().length < 3" @click="submit">{{ reviewing?.action === 'approve' ? 'Approve' : 'Reject' }}</AppButton>
      </template>
    </AppModal>
  </div>
</template>
