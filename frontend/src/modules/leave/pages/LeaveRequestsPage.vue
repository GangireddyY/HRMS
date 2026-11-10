<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CalendarHeart, CalendarRange, Check, ClipboardList, Hourglass, Inbox, Plane, Scale, TriangleAlert, Users, X, XCircle } from '@lucide/vue';
import type { LeaveRequestStatus } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { leaveApi } from '@/modules/leave/api/leave.api';
import CompOffApprovals from '@/modules/leave/components/CompOffApprovals.vue';
import LeaveRequestGridCard from '@/modules/leave/components/LeaveRequestGridCard.vue';
import type { LeaveRequest } from '@/modules/leave/types';
import { LEAVE_STATUS_LABELS, formatDays, formatLeaveRange, leaveStatusTone, todayIso } from '@/modules/leave/utils/leave-format';
import { AppAlert, AppAvatar, AppBadge, AppBulkDecision, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppStatStrip, AppTabs, AppTextarea, type StripItem, type TableColumn } from '@/shared/components';
import { runBulk } from '@/shared/utils/bulk';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate, timeAgo } from '@/shared/utils/format';

/**
 * Leave approval inbox: pending requests first (earliest start first), with who else in the same department is away
 * on those days, a status strip that filters the list, and approve / reject / cancel with a note.
 */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const today = todayIso();
const canApprove = computed(() => auth.can('leave.approve'));
const actingFor = computed(() => (auth.context?.actingFor ?? []).filter((c) => c.permissions.includes('leave.approve')));
const canViewAll = computed(() => auth.can('leave.view', 'TEAM'));
const route = useRoute();
const view = ref<'team' | 'all' | 'comp-off'>(canApprove.value && route.query.tab === 'comp-off' ? 'comp-off' : canApprove.value ? 'team' : 'all');
/** Leave lists for the leave tabs; the comp-off tab has its own. */
const listView = computed<'team' | 'all'>(() => (view.value === 'all' ? 'all' : 'team'));
const table = useTable((q) => leaveApi.requests({ ...q, view: listView.value }), { filters: { status: (canApprove.value ? 'PENDING' : undefined) as LeaveRequestStatus | undefined } });

// ---- Status counts (one count per status for the current view) ----------------------------------------------------
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
const counts = useAsync(async () => {
  const totals = await Promise.all(STATUSES.map((status) => leaveApi.requests({ view: listView.value, status, page: 1, pageSize: 1 }).then((r) => r.meta.total)));
  return Object.fromEntries(STATUSES.map((s, i) => [s, totals[i]!])) as Record<LeaveRequestStatus, number>;
});
const refresh = () => Promise.all([table.load(), counts.run()]);

watch(listView, (v) => {
  table.filters.status = v === 'team' ? 'PENDING' : undefined;
  void table.load();
  void counts.run();
});
const tabs = computed(() => [
  ...(canApprove.value ? [{ key: 'team', label: 'To approve', icon: Inbox, count: view.value === 'team' ? (counts.data.value?.PENDING ?? null) : null }] : []),
  { key: 'all', label: 'All leave', icon: ClipboardList },
  ...(canApprove.value ? [{ key: 'comp-off', label: 'Comp-off', icon: CalendarHeart }] : []),
]);
const HINTS: Record<LeaveRequestStatus, string> = {
  PENDING: 'Waiting for a decision',
  APPROVED: 'Taken off the balance',
  REJECTED: 'Not approved',
  CANCELLED: 'Withdrawn or cancelled',
};
const strip = computed<StripItem[]>(() =>
  STATUSES.map((s) => ({ key: s, label: LEAVE_STATUS_LABELS[s], value: counts.data.value?.[s], tone: leaveStatusTone[s], hint: s === 'PENDING' && view.value === 'team' ? 'Waiting for you' : HINTS[s] })),
);
const pickStatus = (key: string | null) => (table.filters.status = (key ?? undefined) as LeaveRequestStatus | undefined);

// ---- Dates ------------------------------------------------------------------------------------------------------
const DAY = 86_400_000;
const midnight = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const daysUntil = (iso: string) => Math.round((midnight(iso) - midnight(today)) / DAY);
const rtf = new Intl.RelativeTimeFormat(appLocale(), { numeric: 'auto' });
function relativeDay(iso: string): string {
  const n = daysUntil(iso);
  if (Math.abs(n) < 14) return rtf.format(n, 'day');
  if (Math.abs(n) < 60) return rtf.format(Math.round(n / 7), 'week');
  return rtf.format(Math.round(n / 30), 'month');
}
/** When the leave is, relative to today, and how pressing a decision is. */
function timing(r: LeaveRequest): { text: string; tone: 'urgent' | 'soon' | 'now' | 'muted' } | null {
  if (r.status === 'APPROVED' && r.startDate <= today && r.endDate >= today) return { text: 'On leave now', tone: 'now' };
  if (r.status !== 'PENDING' && r.status !== 'APPROVED') return null;
  if (r.endDate < today) return r.status === 'PENDING' ? { text: `Back-dated · ended ${relativeDay(r.endDate)}`, tone: 'urgent' } : null;
  if (r.startDate <= today) return r.status === 'PENDING' ? { text: 'Already started', tone: 'urgent' } : null;
  const n = daysUntil(r.startDate);
  return { text: `Starts ${relativeDay(r.startDate)}`, tone: r.status === 'PENDING' && n <= 3 ? 'urgent' : r.status === 'PENDING' && n <= 7 ? 'soon' : 'muted' };
}
const TIMING_CLASS = { urgent: 'text-danger-fg', soon: 'text-warning-fg', now: 'text-info-fg', muted: 'text-fg-muted' };

// ---- Overlapping absences ---------------------------------------------------------------------------------------
// Everyone else in the same department with approved or pending leave on any of the days of a pending request.
const pendingRows = computed(() => table.rows.value.filter((r) => r.status === 'PENDING'));
const overlapSource = useAsync(
  async () => {
    const rows = pendingRows.value;
    if (!rows.length) return [] as LeaveRequest[];
    const from = rows.reduce((m, r) => (r.startDate < m ? r.startDate : m), rows[0]!.startDate);
    const to = rows.reduce((m, r) => (r.endDate > m ? r.endDate : m), rows[0]!.endDate);
    const all = await fetchAllPages((page, pageSize) => leaveApi.requests({ view: canViewAll.value ? 'all' : 'team', from, to, page, pageSize }));
    return all.filter((e) => e.status === 'APPROVED' || e.status === 'PENDING');
  },
  { immediate: false },
);
watch(
  () => pendingRows.value.map((r) => r.id).join(),
  () => void overlapSource.run(),
);
function overlaps(r: LeaveRequest): LeaveRequest[] {
  if (r.status !== 'PENDING') return [];
  const seen = new Set<string>();
  return (overlapSource.data.value ?? []).filter(
    (e) =>
      e.id !== r.id &&
      e.employee?.id !== r.employee?.id &&
      e.startDate <= r.endDate &&
      e.endDate >= r.startDate &&
      (!r.employee?.department || e.employee?.department === r.employee.department) &&
      !seen.has(e.employee?.id ?? e.id) &&
      !!seen.add(e.employee?.id ?? e.id),
  );
}
const overlapLabel = (list: LeaveRequest[]) => list.map((e) => `${e.employee?.name} (${e.leaveType?.name}, ${formatLeaveRange(e)}${e.status === 'PENDING' ? ', pending' : ''})`).join('; ');

// ---- Work queue summary -----------------------------------------------------------------------------------------
const queue = computed(() => {
  const rows = pendingRows.value;
  if (view.value !== 'team' || !rows.length) return null;
  const oldest = rows.reduce((m, r) => (r.createdAt < m.createdAt ? r : m), rows[0]!);
  return {
    soon: rows.filter((r) => daysUntil(r.startDate) <= 7).length,
    clashes: rows.filter((r) => overlaps(r).length).length,
    oldest: timeAgo(oldest.createdAt),
  };
});

// ---- Table ------------------------------------------------------------------------------------------------------
const showTeam = computed(() => pendingRows.value.length > 0);
const columns = computed<TableColumn<LeaveRequest>[]>(() => [
  { key: 'employee', label: 'Employee', exportValue: (r) => (r.employee ? `${r.employee.name} (${r.employee.employeeCode})` : '') },
  { key: 'type', label: 'Leave', exportValue: (r) => r.leaveType?.name },
  { key: 'dates', label: 'When', exportValue: (r) => (r.startDate === r.endDate ? r.startDate : `${r.startDate} – ${r.endDate}`) },
  { key: 'days', label: 'Days', align: 'right' },
  ...(showTeam.value ? [{ key: 'team', label: 'Also away', noExport: true }] : []),
  // Every row is pending when the list is filtered to pending, and the strip already says so.
  ...(table.filters.status === 'PENDING' ? [] : [{ key: 'status', label: 'Status', exportValue: (r: LeaveRequest) => LEAVE_STATUS_LABELS[r.status] }]),
  { key: 'actions', label: '', align: 'right' },
]);
/** Everything matching the current view and filters, for the CSV. */
const allRows = () => fetchAllPages((page, pageSize) => leaveApi.requests({ ...table.filters, search: table.search.value || undefined, view: listView.value, page, pageSize }));
const tint = (color: string | undefined, amount: number) => (color ? `color-mix(in srgb, ${color} ${amount}%, transparent)` : undefined);
const listTitle = computed(() => (table.filters.status ? `${LEAVE_STATUS_LABELS[table.filters.status]} requests` : view.value === 'team' ? 'Requests in your team' : 'All leave requests'));
const listDescription = computed(() => {
  const total = table.meta.value?.total;
  if (total === undefined) return undefined;
  const order = table.filters.status ? ' · earliest start first' : ' · pending first, then by start date';
  return `${total} ${total === 1 ? 'request' : 'requests'}${order}`;
});
const empty = computed(() =>
  table.filters.status === 'PENDING'
    ? { title: "You're all caught up", description: 'New requests from your team appear here as soon as they are submitted.' }
    : { title: 'No leave requests', description: 'Requests in your scope appear here once people apply for leave.' },
);

// ---- Decisions --------------------------------------------------------------------------------------------------
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
const actingOverlaps = computed(() => (acting.value ? overlaps(acting.value.request) : []));

// Bulk review of pending requests in the "To approve" view.
const selected = ref<string[]>([]);
const bulkBusy = ref(false);
async function bulk(action: 'approve' | 'reject', reason = '') {
  bulkBusy.value = true;
  const ids = [...selected.value];
  const { done, failed } = await runBulk(ids, (id) => (action === 'approve' ? leaveApi.approve(id) : leaveApi.reject(id, reason)));
  bulkBusy.value = false;
  selected.value = failed;
  const verb = action === 'approve' ? 'approved' : 'rejected';
  if (done) feedback.success(`${done} ${done === 1 ? 'request' : 'requests'} ${verb}`, failed.length ? `${failed.length} could not be ${verb} and stay selected.` : 'Everyone has been notified.');
  else feedback.error(`Could not ${action} the selected requests`);
  await refresh();
}

async function submit() {
  const a = acting.value!;
  busy.value = true;
  try {
    if (a.action === 'approve') await leaveApi.approve(a.request.id, note.value || undefined);
    else if (a.action === 'reject') await leaveApi.reject(a.request.id, note.value);
    else await leaveApi.cancel(a.request.id, note.value);
    feedback.success(a.action === 'approve' ? 'Leave approved' : a.action === 'reject' ? 'Leave rejected' : 'Leave cancelled', `${a.request.employee?.name} has been notified.`);
    acting.value = null;
    await refresh();
  } catch (e) {
    feedback.error('Could not update the leave', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Leave requests" description="Decide on leave in your scope. Approved days come off the balance and show in attendance and on the team calendar.">
      <template #actions>
        <AppButton v-if="canViewAll" variant="secondary" :icon="Scale" to="/hr/leave/balances">Balances</AppButton>
        <AppButton v-if="canViewAll" variant="secondary" :icon="CalendarRange" to="/hr/leave/calendar">Team calendar</AppButton>
      </template>
    </AppPageHeader>

    <AppAlert v-for="c in actingFor" :key="c.name" tone="info" :title="`You're approving for ${c.name}`">
      Until {{ formatDate(c.endsOn) }}: their team's requests are in your inbox, marked “on behalf of”. <RouterLink to="/me/delegation" class="font-medium underline">Approval cover</RouterLink>
    </AppAlert>
    <AppTabs v-model="view" :tabs="tabs">
      <CompOffApprovals v-if="view === 'comp-off'" />
      <div v-else class="space-y-4">
        <AppStatStrip :items="strip" selectable :selected="table.filters.status ?? null" :loading="counts.loading.value && !counts.data.value" label="Requests by status" @select="pickStatus" />

        <AppCard :title="queue ? 'Waiting for your decision' : listTitle" :description="listDescription" :icon="queue ? Hourglass : view === 'team' ? Inbox : ClipboardList" :padded="false">
          <template v-if="queue" #actions>
            <ul class="flex flex-wrap items-center gap-1.5" aria-label="Needs attention">
              <li><AppBadge size="sm">Oldest applied {{ queue.oldest }}</AppBadge></li>
              <li v-if="queue.soon"><AppBadge size="sm" tone="warning" dot>{{ queue.soon }} {{ queue.soon === 1 ? 'starts' : 'start' }} within a week</AppBadge></li>
              <li v-if="queue.clashes"><AppBadge size="sm" tone="warning" dot>{{ queue.clashes }} {{ queue.clashes === 1 ? 'overlaps' : 'overlap' }} with team absences</AppBadge></li>
              <li v-else-if="overlapSource.data.value"><AppBadge size="sm" tone="success" dot>No overlapping absences</AppBadge></li>
            </ul>
          </template>
          <AppDataTable
            :columns="columns"
            :rows="table.rows.value"
            :loading="table.loading.value"
            :error="table.error.value"
            :meta="table.meta.value"
            export-file="leave-requests"
            :export-rows="allRows"
            caption="Leave requests"
            :empty-title="empty.title"
            :empty-description="empty.description"
            @page="table.setPage"
            @retry="table.load"
            :filtered="table.isFiltered.value"
            @clear="table.clearFilters()"
            v-model:selected="selected"
            :selectable="view === 'team'"
            :can-select="(r: LeaveRequest) => r.status === 'PENDING' && r.canApprove !== false"
            :select-label="(r: LeaveRequest) => `Select ${r.employee?.name ?? 'request'}, ${formatLeaveRange(r)}`"
          >
            <template #empty>
              <AppButton v-if="canViewAll" variant="secondary" :icon="CalendarRange" to="/hr/leave/calendar">Open the team calendar</AppButton>
            </template>
            <template #bulk><AppBulkDecision :count="selected.length" noun="leave request" :busy="bulkBusy" @approve="bulk('approve')" @reject="(r) => bulk('reject', r)" /></template>
            <template #cell-employee="{ row }">
              <div class="flex items-center gap-3">
                <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
                <div class="min-w-0">
                  <p class="truncate font-medium text-fg">{{ row.employee?.name }}</p>
                  <p class="truncate text-xs text-fg-muted">{{ [row.employee?.employeeCode, row.employee?.department].filter(Boolean).join(' · ') }}</p>
                  <p v-if="row.onBehalfOf" class="truncate text-2xs font-medium text-info-fg">On behalf of {{ row.onBehalfOf }}</p>
                </div>
              </div>
            </template>
            <template #cell-type="{ row }">
              <span class="flex items-center gap-3">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" :style="{ backgroundColor: tint(row.leaveType?.color, 14), color: row.leaveType?.color }" aria-hidden="true"><Plane :size="15" /></span>
                <span class="min-w-0">
                  <span class="block font-medium text-fg">{{ row.leaveType?.name }}<span v-if="row.leaveType && !row.leaveType.isPaid" class="ms-1.5 text-2xs font-normal text-fg-subtle">unpaid</span></span>
                  <span class="block max-w-44 truncate text-xs text-fg-muted" :title="row.reason">{{ row.reason || 'No reason given' }}</span>
                </span>
              </span>
            </template>
            <template #cell-dates="{ row }">
              <span class="block whitespace-nowrap text-fg">{{ formatLeaveRange(row) }}</span>
              <span class="block text-xs whitespace-nowrap text-fg-subtle">
                <template v-for="t in [timing(row)]" :key="row.id">
                  <span v-if="t" :class="['font-medium', TIMING_CLASS[t.tone]]">{{ t.text }} · </span>
                </template>
                <span :title="formatDate(row.createdAt)">applied {{ timeAgo(row.createdAt) }}</span>
              </span>
            </template>
            <template #cell-days="{ row }"><span class="font-medium whitespace-nowrap tabular-nums">{{ formatDays(row.days) }}</span></template>
            <template #cell-team="{ row }">
              <template v-for="list in [overlaps(row)]" :key="row.id">
                <span v-if="row.status !== 'PENDING'" class="text-fg-subtle">—</span>
                <span v-else-if="overlapSource.loading.value && !overlapSource.data.value" class="skeleton block h-3.5 w-20 rounded-full" aria-hidden="true" />
                <span v-else-if="!list.length" class="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-fg-muted"><Users :size="13" class="text-success-fg" aria-hidden="true" />No one</span>
                <span v-else class="inline-flex items-center gap-2" :title="overlapLabel(list)">
                  <span class="flex -space-x-1.5" aria-hidden="true">
                    <AppAvatar v-for="e in list.slice(0, 3)" :key="e.id" :name="e.employee?.name ?? '?'" size="xs" class="ring-2 ring-surface" />
                  </span>
                  <span class="text-xs font-medium whitespace-nowrap text-warning-fg">
                    <TriangleAlert :size="12" class="me-0.5 inline align-[-1px]" aria-hidden="true" />{{ list.length }} also away
                  </span>
                  <span class="sr-only">: {{ overlapLabel(list) }}</span>
                </span>
              </template>
            </template>
            <template #cell-status="{ row }">
              <AppBadge :tone="leaveStatusTone[row.status]" dot>{{ LEAVE_STATUS_LABELS[row.status] }}</AppBadge>
              <p v-if="row.status === 'PENDING' && row.approval.levels > 1" class="mt-0.5 text-xs whitespace-nowrap text-fg-subtle" :title="row.approval.trail.map((s) => `Approved by ${s.name}`).join('\n')">
                Step {{ row.approval.level }} of {{ row.approval.levels }} · {{ row.approval.awaiting }}<template v-if="row.approval.trail.length"> · approved by {{ row.approval.trail.at(-1)!.name }}</template>
              </p>
              <p v-else-if="row.status === 'REJECTED' && row.reviewNote" class="mt-0.5 max-w-48 truncate text-xs text-danger-fg" :title="row.reviewNote">“{{ row.reviewNote }}”</p>
              <p v-else-if="row.reviewedBy && row.status !== 'CANCELLED'" class="mt-0.5 text-xs text-fg-subtle">by {{ row.reviewedBy }}</p>
              <p v-else-if="row.cancelledBy" class="mt-0.5 text-xs text-fg-subtle">by {{ row.cancelledBy }}</p>
            </template>
            <template #cell-actions="{ row }">
              <div v-if="row.status === 'PENDING' && view === 'team'" class="flex justify-end gap-2">
                <AppButton size="sm" variant="secondary" :icon="X" :aria-label="`Reject ${row.employee?.name}'s leave`" title="Reject" @click="open(row, 'reject')" />
                <AppButton v-if="row.canApprove !== false" size="sm" :icon="Check" :aria-label="`Approve ${row.employee?.name}'s leave`" @click="open(row, 'approve')">Approve</AppButton>
                <span v-else class="self-center text-xs whitespace-nowrap text-fg-muted">With {{ row.approval.awaiting }}</span>
              </div>
              <AppButton v-else-if="row.status === 'APPROVED' && canApprove" size="sm" variant="ghost" :icon="XCircle" :aria-label="`Cancel ${row.employee?.name}'s approved leave`" @click="open(row, 'cancel')">Cancel</AppButton>
            </template>
            <template #card="{ row }">
              <LeaveRequestGridCard
                :request="row"
                :timing="timing(row)"
                :overlaps="overlaps(row)"
                :overlaps-loading="overlapSource.loading.value && !overlapSource.data.value"
                :can-decide="row.status === 'PENDING' && view === 'team' && row.canApprove !== false"
                :can-cancel="row.status === 'APPROVED' && canApprove"
                :selectable="view === 'team' && row.status === 'PENDING'"
                @approve="open(row, 'approve')"
                @reject="open(row, 'reject')"
                @cancel="open(row, 'cancel')"
              />
            </template>
          </AppDataTable>
        </AppCard>
      </div>
    </AppTabs>

    <AppModal
      :open="!!acting"
      :title="acting ? TITLES[acting.action] : ''"
      :description="acting ? `${acting.request.employee?.name} · ${acting.request.leaveType?.name} · ${formatLeaveRange(acting.request)} (${formatDays(acting.request.days)})` : undefined"
      size="sm"
      @close="acting = null"
    >
      <p v-if="acting?.request.reason" class="mb-3 rounded-lg bg-surface-muted/60 px-3 py-2 text-sm text-fg-muted">“{{ acting.request.reason }}”</p>
      <div v-if="acting?.action === 'approve' && actingOverlaps.length" class="mb-3 rounded-lg bg-warning-soft/70 px-3 py-2.5 ring-1 ring-warning/25 ring-inset">
        <p class="flex items-center gap-1.5 text-xs font-semibold text-warning-fg"><TriangleAlert :size="13" aria-hidden="true" />Also away from {{ acting.request.employee?.department ?? 'the team' }} on these days</p>
        <ul class="mt-2 space-y-1.5">
          <li v-for="e in actingOverlaps" :key="e.id" class="flex items-center gap-2 text-sm">
            <AppAvatar :name="e.employee?.name ?? '?'" size="xs" />
            <span class="min-w-0 flex-1 truncate text-fg">{{ e.employee?.name }} <span class="text-xs text-fg-muted">· {{ e.leaveType?.name }}, {{ formatLeaveRange(e) }}</span></span>
            <AppBadge size="sm" :tone="leaveStatusTone[e.status]">{{ LEAVE_STATUS_LABELS[e.status] }}</AppBadge>
          </li>
        </ul>
      </div>
      <AppTextarea
        v-model="note"
        :label="acting?.action === 'approve' ? 'Note to the employee' : 'Reason'"
        :required="noteRequired"
        :rows="2"
        :maxlength="500"
        :placeholder="acting?.action === 'approve' ? 'Optional' : acting?.action === 'reject' ? 'Why is it rejected?' : 'Why is the approved leave cancelled? The days are returned.'"
      />
      <template #footer>
        <AppButton variant="secondary" @click="acting = null">Cancel</AppButton>
        <AppButton :variant="acting?.action === 'approve' ? 'primary' : 'danger'" :loading="busy" :disabled="noteRequired && note.trim().length < 3" @click="submit">
          {{ acting?.action === 'approve' ? 'Approve' : acting?.action === 'reject' ? 'Reject' : 'Cancel leave' }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
