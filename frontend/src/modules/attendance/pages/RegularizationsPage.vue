<script setup lang="ts">
import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Check, CircleAlert, FilePen, Hourglass, House, Lock, Timer, X } from '@lucide/vue';
import type { OvertimeStatus, RegularizationStatus } from '@contracts';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { Overtime, Regularization, WorkFromHome } from '@/modules/attendance/types';
import { OVERTIME_LABELS, REGULARIZATION_LABELS, dateRange, formatMinutes, formatTime, monthLabel, overtimeTone, regularizationTone } from '@/modules/attendance/utils/attendance-format';
import { dateTile, daysBetween, localToday, plural, relativeDay, waiting } from '@/modules/attendance/utils/attendance-ops';
import { AppAvatar, AppBadge, AppBulkDecision, AppButton, AppCard, AppDataTable, AppInput, AppModal, AppPageHeader, AppSelect, AppTabs, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable, type TableQuery } from '@/shared/composables/use-table';
import type { Page } from '@/core/http/http-client';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate } from '@/shared/utils/format';
import { runBulk } from '@/shared/utils/bulk';

/** Attendance approvals for people in scope: regularizations, work from home and overtime, oldest first. */
const route = useRoute();
const router = useRouter();
const feedback = useFeedbackStore();
const today = localToday();

/**
 * The server lists newest first; a review queue reads oldest first. While a table shows pending items, its whole
 * queue is loaded, sorted oldest first and paged here; `queue` keeps every pending row for the queue figures.
 */
function oldestFirst<Row, Q extends TableQuery & { status?: string }>(fetch: (q: Q) => Promise<Page<Row>>, key: (r: Row) => string, queue: Ref<Row[]>) {
  let latest = 0;
  return async (q: Q): Promise<Page<Row>> => {
    const call = ++latest;
    if (q.status !== 'PENDING') {
      queue.value = [];
      return fetch(q);
    }
    const all = (await fetchAllPages((page, pageSize) => fetch({ ...q, page, pageSize }))).sort((a, b) => key(a).localeCompare(key(b)));
    if (call === latest) queue.value = all;
    return { items: all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), meta: { page: q.page, pageSize: q.pageSize, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / q.pageSize)) } };
  };
}
const regPending = shallowRef<Regularization[]>([]);
const wfhPending = shallowRef<WorkFromHome[]>([]);
const otPending = shallowRef<Overtime[]>([]);
const QUEUE_PAGE = 100;
const table = useTable(oldestFirst((q: TableQuery & { status?: RegularizationStatus }) => attendanceApi.regularizations({ ...q, view: 'team' }), (r) => r.createdAt, regPending), { pageSize: QUEUE_PAGE, filters: { status: 'PENDING' as RegularizationStatus | undefined } });
const wfhTable = useTable(oldestFirst((q: TableQuery & { status?: RegularizationStatus }) => attendanceApi.workFromHome({ ...q, view: 'team' }), (r) => r.createdAt, wfhPending), { pageSize: QUEUE_PAGE, filters: { status: 'PENDING' as RegularizationStatus | undefined }, url: 'wfh' });
const otTable = useTable(oldestFirst((q: TableQuery & { status?: OvertimeStatus }) => attendanceApi.overtime({ ...q, view: 'team' }), (r) => r.workDate, otPending), { pageSize: QUEUE_PAGE, filters: { status: 'PENDING' as OvertimeStatus | undefined }, url: 'ot' });

/** Pending totals for the tab counts, whatever status each tab is filtered to. */
const pending = useAsync(async () => {
  const [r, w, o] = await Promise.all([
    attendanceApi.regularizations({ view: 'team', status: 'PENDING', pageSize: 1 }),
    attendanceApi.workFromHome({ view: 'team', status: 'PENDING', pageSize: 1 }),
    attendanceApi.overtime({ view: 'team', status: 'PENDING', pageSize: 1 }),
  ]);
  return { regularizations: r.meta.total, wfh: w.meta.total, overtime: o.meta.total };
});
const totalPending = computed(() => (pending.data.value ? pending.data.value.regularizations + pending.data.value.wfh + pending.data.value.overtime : 0));

const tabs = computed(() => [
  { key: 'regularizations', label: 'Corrections', icon: FilePen, count: pending.data.value?.regularizations ?? null },
  { key: 'wfh', label: 'Work from home', icon: House, count: pending.data.value?.wfh ?? null },
  { key: 'overtime', label: 'Overtime', icon: Timer, count: pending.data.value?.overtime ?? null },
]);
const tab = computed({
  get: () => (tabs.value.some((t) => t.key === route.query.tab) ? String(route.query.tab) : 'regularizations'),
  set: (v: string) => void router.replace({ query: { ...route.query, tab: v } }),
});
watch(tab, (t) => void (t === 'wfh' ? wfhTable.load() : t === 'overtime' ? otTable.load() : table.load()));
/** Another tab with requests waiting, offered when this one is empty. */
const elsewhere = computed(() => tabs.value.filter((t) => t.key !== tab.value && (t.count ?? 0) > 0).sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0] ?? null);

/** Pending items from a month that has ended keep that month from being closed. */
const blocksClose = (workDate: string) => workDate.slice(0, 7) < today.slice(0, 7);
const queueInfo = (rows: { status: string; createdAt?: string; workDate?: string }[], total: number | undefined) => {
  const open = rows.filter((r) => r.status === 'PENDING');
  return {
    open: total ?? open.length,
    overdue: open.filter((r) => (r.createdAt ? waiting(r.createdAt).overdue : r.workDate ? daysBetween(r.workDate, today) > 2 : false)).length,
    blocking: open.filter((r) => r.workDate && blocksClose(r.workDate)).length,
  };
};
const regQueue = computed(() => queueInfo(regPending.value, table.meta.value?.total));
const wfhQueue = computed(() => queueInfo(wfhPending.value, wfhTable.meta.value?.total));
const otQueue = computed(() => queueInfo(otPending.value, otTable.meta.value?.total));

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
const span = (r: WorkFromHome) => daysBetween(r.startDate, r.endDate) + 1;
const whenWfh = (r: WorkFromHome) => (r.startDate > today ? `starts ${relativeDay(r.startDate, today)}` : r.endDate < today ? `ended ${relativeDay(r.endDate, today)}` : 'under way');
const personLink = (employeeId: string | undefined, day: string) => (employeeId ? { path: `/hr/attendance/employees/${employeeId}`, query: { month: day.slice(0, 7) } } : undefined);

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
const reviewReason = computed(() => (reviewing.value && reviewing.value.kind !== 'overtime' ? reviewing.value.item.reason : null));
const needsNote = computed(() => reviewing.value?.action === 'reject' && reviewing.value.kind !== 'regularization');

// Bulk review: one selection per tab; rejecting work from home or overtime needs the shared reason.
type Kind = 'regularization' | 'wfh' | 'overtime';
const selected = ref<Record<Kind, string[]>>({ regularization: [], wfh: [], overtime: [] });
const bulkBusy = ref(false);
const BULK: Record<Kind, { approve: (id: string) => Promise<unknown>; reject: (id: string, reason: string) => Promise<unknown>; reload: () => Promise<void> }> = {
  regularization: { approve: (id) => attendanceApi.approve(id), reject: (id, r) => attendanceApi.reject(id, r || undefined), reload: () => table.load() },
  wfh: { approve: (id) => attendanceApi.approveWorkFromHome(id, null), reject: (id, r) => attendanceApi.rejectWorkFromHome(id, r), reload: () => wfhTable.load() },
  overtime: { approve: (id) => attendanceApi.approveOvertime(id, {}), reject: (id, r) => attendanceApi.rejectOvertime(id, r), reload: () => otTable.load() },
};
async function bulk(kind: Kind, action: 'approve' | 'reject', reason = '') {
  bulkBusy.value = true;
  const ops = BULK[kind];
  const { done, failed } = await runBulk([...selected.value[kind]], (id) => (action === 'approve' ? ops.approve(id) : ops.reject(id, reason)));
  bulkBusy.value = false;
  selected.value[kind] = failed;
  const verb = action === 'approve' ? 'approved' : 'rejected';
  if (done) feedback.success(`${done} ${verb}`, failed.length ? `${failed.length} could not be ${verb} and stay selected.` : 'Everyone has been notified.');
  else feedback.error(`Could not ${action} the selection`);
  await Promise.all([ops.reload(), pending.run()]);
}

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
    void pending.run();
  } catch (e) {
    feedback.error('Could not update it', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Attendance approvals" description="Corrections, work-from-home days and overtime of the people in your scope, oldest first.">
      <template #badges>
        <AppBadge v-if="totalPending" tone="warning" dot>{{ totalPending }} waiting</AppBadge>
        <AppBadge v-else-if="pending.data.value" tone="success" dot>All caught up</AppBadge>
      </template>
    </AppPageHeader>
    <AppTabs v-model="tab" :tabs="tabs">
      <!-- Corrections -->
      <AppCard v-if="tab === 'regularizations'" :padded="false">
        <div class="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-2">
          <p v-if="table.filters.status === 'PENDING' && regQueue.open" class="me-auto flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span class="font-medium text-fg">{{ plural(regQueue.open, 'correction') }} to review</span>
            <AppBadge v-if="regQueue.overdue" size="sm" tone="danger" dot>{{ regQueue.overdue }} waiting over 2 days</AppBadge>
            <AppBadge v-if="regQueue.blocking" size="sm" tone="warning"><Lock :size="10" class="-ms-0.5" aria-hidden="true" />{{ regQueue.blocking }} holding up month close</AppBadge>
          </p>
          <AppSelect size="sm" v-model="table.filters.status" class="ms-auto w-48" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          caption="Regularization requests"
          :empty-title="table.filters.status === 'PENDING' ? 'Nothing to review' : 'No requests'"
          :empty-description="table.filters.status === 'PENDING' ? 'Missed-punch corrections from your team will appear here.' : undefined"
          @page="table.setPage"
          @retry="table.load"
          :filtered="table.isFiltered.value"
          @clear="table.clearFilters()"
          v-model:selected="selected.regularization"
          selectable
          :can-select="(r: Regularization) => r.status === 'PENDING'"
          :select-label="(r: Regularization) => `Select `+ (r.employee?.name ?? 'request')"
        >
          <template #empty><AppButton v-if="elsewhere && table.filters.status === 'PENDING'" size="sm" variant="secondary" :icon="elsewhere.icon" @click="tab = elsewhere.key">{{ elsewhere.label }}: {{ elsewhere.count }} waiting</AppButton></template>
          <template #bulk><AppBulkDecision :count="selected.regularization.length" noun="correction" :busy="bulkBusy" :reason-required="false" @approve="bulk('regularization', 'approve')" @reject="(r) => bulk('regularization', 'reject', r)" /></template>
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
              <div class="min-w-0">
                <RouterLink v-if="row.employee" :to="personLink(row.employee.id, row.workDate)!" class="block truncate font-medium text-fg hover:text-accent-fg hover:underline">{{ row.employee.name }}</RouterLink>
                <p class="truncate text-xs text-fg-muted">{{ row.employee?.employeeCode }}</p>
              </div>
            </div>
          </template>
          <template #cell-workDate="{ row }">
            <div class="flex items-center gap-2.5 max-md:justify-end">
              <span class="flex w-9 shrink-0 flex-col items-center rounded-md bg-surface-muted py-0.5 max-md:hidden" aria-hidden="true">
                <span class="text-2xs leading-3 font-semibold text-fg-muted uppercase">{{ dateTile(row.workDate).month }}</span>
                <span class="text-sm leading-5 font-semibold text-fg tabular-nums">{{ dateTile(row.workDate).day }}</span>
              </span>
              <div>
                <p class="whitespace-nowrap text-fg">{{ formatDate(row.workDate) }}</p>
                <p class="text-xs text-fg-muted">{{ relativeDay(row.workDate, today) }}</p>
              </div>
            </div>
          </template>
          <template #cell-times="{ row }">
            <p class="font-medium whitespace-nowrap text-fg tabular-nums">{{ formatTime(row.checkInAt) }}–{{ formatTime(row.checkOutAt) }}</p>
            <p class="text-xs text-fg-muted tabular-nums">{{ duration(row) }} worked</p>
          </template>
          <template #cell-reason="{ row }"><p class="line-clamp-2 max-w-xs text-fg-muted" :title="row.reason">{{ row.reason }}</p></template>
          <template #cell-status="{ row }">
            <AppBadge :tone="regularizationTone[row.status]" dot>{{ REGULARIZATION_LABELS[row.status] }}</AppBadge>
            <template v-if="row.status === 'PENDING'">
              <p :class="['mt-0.5 flex items-center gap-1 text-xs whitespace-nowrap', { neutral: 'text-fg-subtle', warning: 'text-warning-fg', danger: 'font-medium text-danger-fg' }[waiting(row.createdAt).tone]]">
                <Hourglass :size="11" aria-hidden="true" />Sent {{ waiting(row.createdAt).label }}
              </p>
              <p v-if="blocksClose(row.workDate)" class="mt-0.5 flex items-center gap-1 text-xs whitespace-nowrap text-warning-fg" :title="`Blocks closing ${monthLabel(row.workDate.slice(0, 7))}`">
                <Lock :size="11" aria-hidden="true" />Blocks {{ dateTile(row.workDate).month }} close
              </p>
            </template>
            <p v-else-if="row.reviewedBy" class="mt-0.5 text-xs text-fg-subtle">by {{ row.reviewedBy }}</p>
          </template>
          <template #cell-actions="{ row }">
            <div v-if="row.status === 'PENDING'" class="flex justify-end gap-2">
              <AppButton size="sm" variant="secondary" :icon="X" @click="open({ kind: 'regularization', item: row, action: 'reject' })">Reject</AppButton>
              <AppButton size="sm" :icon="Check" @click="open({ kind: 'regularization', item: row, action: 'approve' })">Approve</AppButton>
            </div>
          </template>
        </AppDataTable>
      </AppCard>

      <!-- Work from home -->
      <AppCard v-else-if="tab === 'wfh'" :padded="false">
        <div class="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-2">
          <p v-if="wfhTable.filters.status === 'PENDING' && wfhQueue.open" class="me-auto flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span class="font-medium text-fg">{{ plural(wfhQueue.open, 'request') }} to review</span>
            <AppBadge v-if="wfhQueue.overdue" size="sm" tone="danger" dot>{{ wfhQueue.overdue }} waiting over 2 days</AppBadge>
          </p>
          <AppSelect size="sm" v-model="wfhTable.filters.status" class="ms-auto w-48" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable
          :columns="wfhColumns"
          :rows="wfhTable.rows.value"
          :loading="wfhTable.loading.value"
          :error="wfhTable.error.value"
          :meta="wfhTable.meta.value"
          caption="Work-from-home requests"
          :empty-title="wfhTable.filters.status === 'PENDING' ? 'Nothing to review' : 'No requests'"
          :empty-description="wfhTable.filters.status === 'PENDING' ? 'Requests to work remotely will appear here.' : undefined"
          @page="wfhTable.setPage"
          @retry="wfhTable.load"
          :filtered="wfhTable.isFiltered.value"
          @clear="wfhTable.clearFilters()"
          v-model:selected="selected.wfh"
          selectable
          :can-select="(r: WorkFromHome) => r.status === 'PENDING'"
          :select-label="(r: WorkFromHome) => `Select `+ (r.employee?.name ?? 'request')"
        >
          <template #empty><AppButton v-if="elsewhere && wfhTable.filters.status === 'PENDING'" size="sm" variant="secondary" :icon="elsewhere.icon" @click="tab = elsewhere.key">{{ elsewhere.label }}: {{ elsewhere.count }} waiting</AppButton></template>
          <template #bulk><AppBulkDecision :count="selected.wfh.length" noun="request" :busy="bulkBusy" @approve="bulk('wfh', 'approve')" @reject="(r) => bulk('wfh', 'reject', r)" /></template>
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
              <div class="min-w-0">
                <RouterLink v-if="row.employee" :to="personLink(row.employee.id, row.startDate)!" class="block truncate font-medium text-fg hover:text-accent-fg hover:underline">{{ row.employee.name }}</RouterLink>
                <p class="truncate text-xs text-fg-muted">{{ row.employee?.employeeCode }}</p>
              </div>
            </div>
          </template>
          <template #cell-days="{ row }">
            <div class="flex items-center gap-2.5 max-md:justify-end">
              <span class="flex w-9 shrink-0 flex-col items-center rounded-md bg-accent-soft py-0.5 text-accent-fg max-md:hidden" aria-hidden="true">
                <span class="text-2xs leading-3 font-semibold uppercase">{{ dateTile(row.startDate).month }}</span>
                <span class="text-sm leading-5 font-semibold tabular-nums">{{ dateTile(row.startDate).day }}</span>
              </span>
              <div>
                <p class="text-fg">{{ dateRange(row.startDate, row.endDate) }} <span class="text-xs text-fg-muted">· {{ plural(span(row), 'day') }}</span></p>
                <p class="text-xs text-fg-muted">{{ whenWfh(row) }}</p>
              </div>
            </div>
          </template>
          <template #cell-reason="{ row }"><p class="line-clamp-2 max-w-xs text-fg-muted" :title="row.reason">{{ row.reason }}</p></template>
          <template #cell-status="{ row }">
            <AppBadge :tone="regularizationTone[row.status]" dot>{{ REGULARIZATION_LABELS[row.status] }}</AppBadge>
            <p v-if="row.status === 'PENDING'" :class="['mt-0.5 flex items-center gap-1 text-xs', { neutral: 'text-fg-subtle', warning: 'text-warning-fg', danger: 'font-medium text-danger-fg' }[waiting(row.createdAt).tone]]">
              <Hourglass :size="11" aria-hidden="true" />Sent {{ waiting(row.createdAt).label }}
            </p>
            <p v-else-if="row.reviewedBy" class="mt-0.5 text-xs text-fg-subtle">by {{ row.reviewedBy }}</p>
          </template>
          <template #cell-actions="{ row }">
            <div v-if="row.permissions.review" class="flex justify-end gap-2">
              <AppButton size="sm" variant="secondary" :icon="X" @click="open({ kind: 'wfh', item: row, action: 'reject' })">Reject</AppButton>
              <AppButton size="sm" :icon="Check" @click="open({ kind: 'wfh', item: row, action: 'approve' })">Approve</AppButton>
            </div>
          </template>
        </AppDataTable>
      </AppCard>

      <!-- Overtime -->
      <AppCard v-else :padded="false">
        <div class="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-2">
          <p v-if="otTable.filters.status === 'PENDING' && otQueue.open" class="me-auto flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span class="font-medium text-fg">{{ plural(otQueue.open, 'overtime claim') }} to review</span>
            <AppBadge v-if="otQueue.blocking" size="sm" tone="warning"><Lock :size="10" class="-ms-0.5" aria-hidden="true" />{{ otQueue.blocking }} holding up month close</AppBadge>
          </p>
          <AppSelect size="sm" v-model="otTable.filters.status" class="ms-auto w-56" :options="otStatusOptions" placeholder="All statuses" aria-label="Filter by status" />
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
          :filtered="otTable.isFiltered.value"
          @clear="otTable.clearFilters()"
          v-model:selected="selected.overtime"
          selectable
          :can-select="(r: Overtime) => r.status === 'PENDING'"
          :select-label="(r: Overtime) => `Select `+ (r.employee?.name ?? 'overtime')"
        >
          <template #empty><AppButton v-if="elsewhere && otTable.filters.status === 'PENDING'" size="sm" variant="secondary" :icon="elsewhere.icon" @click="tab = elsewhere.key">{{ elsewhere.label }}: {{ elsewhere.count }} waiting</AppButton></template>
          <template #bulk><AppBulkDecision :count="selected.overtime.length" noun="overtime claim" :busy="bulkBusy" @approve="bulk('overtime', 'approve')" @reject="(r) => bulk('overtime', 'reject', r)" /></template>
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
              <div class="min-w-0">
                <RouterLink v-if="row.employee" :to="personLink(row.employee.id, row.workDate)!" class="block truncate font-medium text-fg hover:text-accent-fg hover:underline">{{ row.employee.name }}</RouterLink>
                <p class="truncate text-xs text-fg-muted">{{ row.employee?.employeeCode }}</p>
              </div>
            </div>
          </template>
          <template #cell-workDate="{ row }">
            <div class="flex items-center gap-2.5 max-md:justify-end">
              <span class="flex w-9 shrink-0 flex-col items-center rounded-md bg-special-soft py-0.5 text-special-fg max-md:hidden" aria-hidden="true">
                <span class="text-2xs leading-3 font-semibold uppercase">{{ dateTile(row.workDate).month }}</span>
                <span class="text-sm leading-5 font-semibold tabular-nums">{{ dateTile(row.workDate).day }}</span>
              </span>
              <div>
                <p class="whitespace-nowrap text-fg">{{ formatDate(row.workDate) }}</p>
                <p class="text-xs text-fg-muted">{{ relativeDay(row.workDate, today) }}</p>
              </div>
            </div>
          </template>
          <template #cell-worked="{ row }">
            <p class="whitespace-nowrap text-fg tabular-nums">{{ formatTime(row.record?.checkInAt) }}–{{ formatTime(row.record?.checkOutAt) }}</p>
            <p class="text-xs text-fg-muted tabular-nums">{{ formatMinutes(row.record?.workedMinutes) }} worked</p>
          </template>
          <template #cell-minutes="{ row }">
            <span class="font-semibold text-fg tabular-nums">{{ formatMinutes(row.approvedMinutes ?? row.minutes) }}</span>
            <p v-if="row.approvedMinutes !== null && row.approvedMinutes !== row.minutes" class="text-xs text-fg-muted">of {{ formatMinutes(row.minutes) }}</p>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :tone="overtimeTone[row.status]" dot>{{ OVERTIME_LABELS[row.status] }}</AppBadge>
            <p v-if="row.status === 'PENDING' && blocksClose(row.workDate)" class="mt-0.5 flex items-center gap-1 text-xs whitespace-nowrap text-warning-fg" :title="`Blocks closing ${monthLabel(row.workDate.slice(0, 7))}`">
              <Lock :size="11" aria-hidden="true" />Blocks {{ dateTile(row.workDate).month }} close
            </p>
            <p v-else-if="row.paidIn" class="mt-0.5 text-xs text-fg-subtle">paid in {{ row.paidIn }}</p>
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

    <AppModal :open="!!reviewing" :title="title" :description="description" size="sm" dialog @close="reviewing = null">
      <div class="space-y-4">
        <div v-if="reviewing" class="flex items-start gap-3 rounded-lg bg-surface-muted/70 p-3 ring-1 ring-line/70">
          <AppAvatar :name="reviewing.item.employee?.name ?? '?'" size="sm" />
          <div class="min-w-0 text-sm">
            <p class="font-medium text-fg">{{ reviewing.item.employee?.name }}</p>
            <p v-if="reviewReason" class="mt-0.5 text-fg-muted">“{{ reviewReason }}”</p>
            <p v-else-if="reviewing.kind === 'overtime'" class="mt-0.5 text-fg-muted tabular-nums">
              {{ formatTime(reviewing.item.record?.checkInAt) }}–{{ formatTime(reviewing.item.record?.checkOutAt) }} · {{ formatMinutes(reviewing.item.record?.workedMinutes) }} worked
            </p>
          </div>
        </div>
        <p v-if="reviewing?.kind === 'regularization' && reviewing.action === 'approve'" class="flex items-start gap-2 text-xs text-fg-muted">
          <CircleAlert :size="14" class="mt-px shrink-0 text-info-fg" aria-hidden="true" />The requested times replace the punches recorded for that day.
        </p>
        <AppInput v-if="reviewing?.kind === 'overtime' && reviewing.action === 'approve'" v-model="minutes" label="Minutes to approve" type="number" :min="1" :max="reviewing.item.minutes" suffix="min" :help="`Up to ${formatMinutes(reviewing.item.minutes)} worked`" />
        <AppInput v-model="note" label="Note to the employee" :placeholder="reviewing?.action === 'reject' ? 'Why is it rejected?' : 'Optional'" :required="needsNote" :maxlength="500" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="reviewing = null">Cancel</AppButton>
        <AppButton :variant="reviewing?.action === 'reject' ? 'danger' : 'primary'" :icon="reviewing?.action === 'reject' ? X : Check" :loading="busy" :disabled="needsNote && note.trim().length < 3" @click="submit">{{ reviewing?.action === 'approve' ? 'Approve' : 'Reject' }}</AppButton>
      </template>
    </AppModal>
  </div>
</template>
