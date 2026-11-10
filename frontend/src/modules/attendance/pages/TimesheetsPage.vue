<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { BellRing, CalendarClock, Check, ChevronLeft, ChevronRight, ClipboardCheck, Eye, Hourglass, Inbox, ListChecks, SlidersHorizontal, X } from '@lucide/vue';
import { weekStartOf, type TimesheetStatus, type TimesheetWeekStatus } from '@contracts';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import TimesheetGridCard from '@/modules/attendance/components/TimesheetGridCard.vue';
import TimesheetReviewModal from '@/modules/attendance/components/TimesheetReviewModal.vue';
import type { Timesheet, TimesheetDetail } from '@/modules/attendance/types';
import { addDays, dateRange } from '@/modules/attendance/utils/attendance-format';
import { localToday, plural, waiting } from '@/modules/attendance/utils/attendance-ops';
import { MISSED_ACTION_LABELS, TIMESHEET_LABELS, WEEKDAY_NAMES, hoursLabel, shortDate, timesheetTone } from '@/modules/attendance/utils/timesheet-format';
import { useAuthStore } from '@/core/auth/auth.store';
import { AppAvatar, AppBadge, AppBulkDecision, AppButton, AppCard, AppDataTable, AppPageHeader, AppPagination, AppSearchInput, AppSelect, AppSkeleton, AppStatStrip, AppTabs, AppErrorState, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable, type TableQuery } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { runBulk } from '@/shared/utils/bulk';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

/** Timesheets of the people in scope: the review queue, who has (not) submitted a given week, and the full history. */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const today = localToday();

const pending = useAsync(() => attendanceApi.timesheets({ view: 'team', status: 'SUBMITTED', pageSize: 1 }));
const tabs = computed(() => [
  { key: 'review', label: 'To review', icon: Inbox, count: pending.data.value?.meta.total ?? null },
  { key: 'week', label: 'Week status', icon: ListChecks },
  { key: 'all', label: 'All timesheets', icon: ClipboardCheck },
]);
const tab = computed({
  get: () => (tabs.value.some((t) => t.key === route.query.tab) ? String(route.query.tab) : 'review'),
  set: (v: string) => void router.replace({ query: { ...route.query, tab: v } }),
});

// ---- Review queue (oldest submission first) ------------------------------------------------------------------------
const queue = useTable(
  async (q: TableQuery) => {
    const page = await attendanceApi.timesheets({ ...q, view: 'team', status: 'SUBMITTED', pageSize: 100, page: 1 });
    const items = [...page.items].sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
    return { items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), meta: { ...page.meta, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(items.length / q.pageSize)), total: items.length } };
  },
  { pageSize: 24, url: 'review' },
);
const overdueReviews = computed(() => queue.rows.value.filter((t) => t.submittedAt && waiting(t.submittedAt).overdue).length);

const columns: TableColumn<Timesheet>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'week', label: 'Week' },
  { key: 'hours', label: 'Hours', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];

// ---- All timesheets ------------------------------------------------------------------------------------------------
const all = useTable((q: TableQuery & { status?: TimesheetStatus }) => attendanceApi.timesheets({ ...q, view: 'team' }), { pageSize: 20, filters: { status: undefined as TimesheetStatus | undefined }, url: 'all', immediate: false });
const statusOptions = (['SUBMITTED', 'APPROVED', 'REJECTED'] as const).map((s) => ({ value: s, label: TIMESHEET_LABELS[s] }));

// ---- Week status board ---------------------------------------------------------------------------------------------
const lastWeek = weekStartOf(addDays(today, -7));
const boardWeek = ref(typeof route.query.week === 'string' ? weekStartOf(route.query.week) : lastWeek);
const boardStatus = ref<TimesheetWeekStatus | null>(null);
const boardSearch = ref('');
const boardPage = ref(1);
const board = useAsync(() => attendanceApi.timesheetBoard({ weekStart: boardWeek.value, status: boardStatus.value ?? undefined, search: boardSearch.value.trim() || undefined, page: boardPage.value, pageSize: 25 }), { immediate: false });
watch([boardWeek, boardStatus], () => {
  boardPage.value = 1;
  void board.run();
});
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(boardSearch, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    boardPage.value = 1;
    void board.run();
  }, 300);
});
const boardStrip = computed<StripItem[]>(() => {
  const s = board.data.value?.summary;
  return (['MISSING', 'DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED'] as const).map((k) => ({ key: k, label: TIMESHEET_LABELS[k], value: s ? s[k] : null, tone: timesheetTone[k] }));
});
const outstanding = computed(() => {
  const s = board.data.value?.summary;
  return s ? s.MISSING + s.DRAFT + s.REJECTED : 0;
});
const submittedShare = computed(() => {
  const s = board.data.value?.summary;
  return s && s.total ? Math.round(((s.SUBMITTED + s.APPROVED) / s.total) * 100) : 0;
});
const shiftBoardWeek = (delta: number) => (boardWeek.value = addDays(boardWeek.value, delta * 7));
const reminding = ref(false);
async function remind() {
  const w = board.data.value;
  if (!w) return;
  const ok = await feedback.confirm({
    title: `Remind ${plural(outstanding.value, 'person', 'people')}?`,
    message: `Everyone whose timesheet for the week of ${dateRange(w.weekStart, w.weekEnd)} is missing, a draft or sent back gets a notification.`,
    confirmLabel: 'Send reminders',
  });
  if (!ok) return;
  reminding.value = true;
  try {
    const { reminded } = await attendanceApi.remindTimesheets(w.weekStart);
    feedback.success(reminded ? `${plural(reminded, 'reminder')} sent` : 'Nobody to remind', reminded ? undefined : 'People without a sign-in account can’t be notified.');
  } catch (e) {
    feedback.error('Could not send the reminders', e);
  } finally {
    reminding.value = false;
  }
}

watch(
  tab,
  (t) => {
    if (t === 'week') void board.run();
    else if (t === 'all') void all.load();
  },
  { immediate: true },
);

// ---- Review ------------------------------------------------------------------------------------------------------
const reviewing = ref<{ id: string; action: 'approve' | 'reject' | null } | null>(null);
const openReview = (id: string, action: 'approve' | 'reject' | null = null) => (reviewing.value = { id, action });
async function onReviewed(_t: TimesheetDetail) {
  reviewing.value = null;
  await Promise.all([queue.load(), pending.run(), tab.value === 'all' ? all.load() : Promise.resolve(), tab.value === 'week' ? board.run() : Promise.resolve()]);
}

const selected = ref<string[]>([]);
const bulkBusy = ref(false);
async function bulk(action: 'approve' | 'reject', reason = '') {
  bulkBusy.value = true;
  const { done, failed } = await runBulk([...selected.value], (id) => (action === 'approve' ? attendanceApi.approveTimesheet(id, null) : attendanceApi.rejectTimesheet(id, reason)));
  bulkBusy.value = false;
  selected.value = failed;
  const verb = action === 'approve' ? 'approved' : 'sent back';
  if (done) feedback.success(`${plural(done, 'timesheet')} ${verb}`, failed.length ? `${failed.length} could not be ${verb} and stay selected.` : 'Everyone has been notified.');
  else feedback.error(`Could not ${action === 'approve' ? 'approve' : 'send back'} the selection`);
  await Promise.all([queue.load(), pending.run()]);
}

const rules = computed(() => board.data.value?.rules ?? null);
</script>

<template>
  <div>
    <AppPageHeader title="Timesheets" description="Weekly timesheets of the people you review. Approved timesheets are what payroll counts.">
      <template #badges>
        <AppBadge v-if="pending.data.value?.meta.total" tone="warning" dot>{{ pending.data.value.meta.total }} waiting</AppBadge>
        <AppBadge v-else-if="pending.data.value" tone="success" dot>All caught up</AppBadge>
      </template>
      <template v-if="auth.can('payroll.configure')" #actions>
        <AppButton variant="secondary" :icon="SlidersHorizontal" to="/hr/payroll/setup?tab=statutory">Timesheet rules</AppButton>
      </template>
    </AppPageHeader>

    <AppTabs v-model="tab" :tabs="tabs">
      <!-- To review -->
      <AppCard v-if="tab === 'review'" :padded="false">
        <div v-if="queue.meta.value?.total" class="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-2 text-xs text-fg-muted">
          <span class="font-medium text-fg">{{ plural(queue.meta.value.total, 'timesheet') }} to review</span>
          <AppBadge v-if="overdueReviews" size="sm" tone="danger" dot>{{ overdueReviews }} waiting over 2 days</AppBadge>
          <span class="ms-auto">Oldest first</span>
        </div>
        <AppDataTable
          :columns="columns"
          :rows="queue.rows.value"
          :loading="queue.loading.value"
          :error="queue.error.value"
          :meta="queue.meta.value"
          caption="Timesheets to review"
          layout-key="hr-timesheets-review"
          empty-title="Nothing to review"
          empty-description="Submitted timesheets from your team appear here."
          v-model:selected="selected"
          selectable
          :can-select="(t: Timesheet) => t.permissions.review"
          :select-label="(t: Timesheet) => `Select ${t.employee?.name ?? 'timesheet'}`"
          clickable
          @row-click="(t: Timesheet) => openReview(t.id)"
          @page="queue.setPage"
          @retry="queue.load"
        >
          <template #empty><AppButton size="sm" variant="secondary" :icon="ListChecks" @click="tab = 'week'">See who hasn’t submitted</AppButton></template>
          <template #bulk><AppBulkDecision :count="selected.length" noun="timesheet" :busy="bulkBusy" @approve="bulk('approve')" @reject="(r) => bulk('reject', r)" /></template>
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee?.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ [row.employee?.employeeCode, row.employee?.department].filter(Boolean).join(' · ') }}</p>
              </div>
            </div>
          </template>
          <template #cell-week="{ row }">
            <p class="text-fg">{{ dateRange(row.weekStart, row.weekEnd) }}</p>
            <p class="text-xs text-fg-muted">{{ plural(row.entries.length, 'activity', 'activities') }}</p>
          </template>
          <template #cell-hours="{ row }"><span class="font-semibold text-fg tabular-nums">{{ hoursLabel(row.totalMinutes) }}</span></template>
          <template #cell-status="{ row }">
            <AppBadge :tone="timesheetTone[row.status]" dot>{{ TIMESHEET_LABELS[row.status] }}</AppBadge>
            <p v-if="row.submittedAt" :class="['mt-0.5 flex items-center gap-1 text-xs', { neutral: 'text-fg-subtle', warning: 'text-warning-fg', danger: 'font-medium text-danger-fg' }[waiting(row.submittedAt).tone]]">
              <Hourglass :size="11" aria-hidden="true" />Sent {{ waiting(row.submittedAt).label }}
            </p>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex justify-end gap-2">
              <AppButton size="sm" variant="secondary" :icon="Eye" @click.stop="openReview(row.id)">Open</AppButton>
              <template v-if="row.permissions.review">
                <AppButton size="sm" variant="secondary" :icon="X" @click.stop="openReview(row.id, 'reject')">Send back</AppButton>
                <AppButton size="sm" :icon="Check" @click.stop="openReview(row.id, 'approve')">Approve</AppButton>
              </template>
            </div>
          </template>
          <template #card="{ row }">
            <TimesheetGridCard :timesheet="row" selectable @open="openReview(row.id)" @approve="openReview(row.id, 'approve')" @reject="openReview(row.id, 'reject')" />
          </template>
        </AppDataTable>
      </AppCard>

      <!-- Week status -->
      <div v-else-if="tab === 'week'" class="space-y-4">
        <div class="card flex flex-wrap items-center gap-3 px-3 py-2.5">
          <div class="flex items-center gap-1">
            <AppButton variant="ghost" size="sm" :icon="ChevronLeft" aria-label="Previous week" @click="shiftBoardWeek(-1)" />
            <AppButton variant="ghost" size="sm" :icon="ChevronRight" aria-label="Next week" :disabled="boardWeek >= weekStartOf(today)" @click="shiftBoardWeek(1)" />
          </div>
          <div class="min-w-0">
            <p class="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{{ boardWeek === lastWeek ? 'Last week' : boardWeek === weekStartOf(today) ? 'This week' : 'Week' }}</p>
            <p class="text-base font-semibold text-fg">{{ dateRange(boardWeek, addDays(boardWeek, 6)) }}</p>
          </div>
          <AppBadge v-if="board.data.value" :tone="board.data.value.overdue ? 'danger' : 'warning'" dot>{{ board.data.value.overdue ? 'Was due' : 'Due' }} {{ shortDate(board.data.value.dueDate) }}</AppBadge>
          <div class="ms-auto flex flex-wrap items-center gap-2">
            <AppButton v-if="boardWeek !== lastWeek" variant="ghost" size="sm" :icon="CalendarClock" @click="boardWeek = lastWeek">Last week</AppButton>
            <AppButton size="sm" :icon="BellRing" :loading="reminding" :disabled="!outstanding" @click="remind">Remind {{ outstanding ? plural(outstanding, 'person', 'people') : 'people' }}</AppButton>
          </div>
        </div>

        <div v-if="rules" :class="['flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-4 py-2.5 text-sm ring-1 ring-inset', rules.required ? 'bg-accent-soft/50 text-fg-muted ring-brand-600/15' : 'bg-surface-muted/60 text-fg-muted ring-line']">
          <span v-if="rules.required"><span class="font-medium text-fg">Required</span> · due {{ WEEKDAY_NAMES[rules.dueWeekday] }} after the week · if missed: <span class="font-medium text-fg">{{ MISSED_ACTION_LABELS[rules.missedAction].label.toLowerCase() }}</span></span>
          <span v-else>Timesheets aren’t required for payroll yet{{ auth.can('payroll.configure') ? ' — switch them on in Payroll setup.' : '.' }}</span>
          <span v-if="board.data.value?.summary.total" class="ms-auto text-xs">
            <span class="font-semibold text-fg tabular-nums">{{ submittedShare }}%</span> submitted
          </span>
        </div>

        <AppStatStrip :items="boardStrip" selectable :selected="boardStatus" :loading="board.loading.value && !board.data.value" label="Timesheets by status" @select="(k) => (boardStatus = k as TimesheetWeekStatus | null)" />

        <AppCard :padded="false">
          <div class="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-2">
            <AppSearchInput v-model="boardSearch" class="w-64 max-sm:w-full" placeholder="Search people" />
            <p v-if="board.data.value" class="ms-auto text-xs text-fg-muted">{{ plural(board.data.value.meta.total, 'person', 'people') }}{{ boardStatus ? ` · ${TIMESHEET_LABELS[boardStatus].toLowerCase()}` : '' }}</p>
          </div>
          <AppSkeleton v-if="board.loading.value && !board.data.value" class="p-4" :lines="6" />
          <AppErrorState v-else-if="board.error.value" :error="board.error.value" @retry="board.run" />
          <p v-else-if="!board.data.value?.items.length" class="px-4 py-10 text-center text-sm text-fg-muted">{{ boardStatus ? 'Nobody with this status.' : 'No one in your scope was employed this week.' }}</p>
          <ul v-else :class="['divide-y divide-line/60 transition-opacity', board.loading.value && 'opacity-60']">
            <li v-for="row in board.data.value.items" :key="row.employee.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
              <AppAvatar :name="row.employee.name" size="sm" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-fg">{{ row.employee.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ [row.employee.employeeCode, row.employee.department].filter(Boolean).join(' · ') }}</p>
              </div>
              <span class="w-20 text-end text-sm font-semibold text-fg tabular-nums max-sm:hidden">{{ hoursLabel(row.totalMinutes) }}</span>
              <div class="w-44 text-end max-sm:w-auto">
                <AppBadge :tone="timesheetTone[row.status]" dot>{{ TIMESHEET_LABELS[row.status] }}</AppBadge>
                <p v-if="row.reviewedAt && row.status !== 'SUBMITTED'" class="mt-0.5 text-2xs text-fg-subtle" :title="formatDateTime(row.reviewedAt)">reviewed {{ timeAgo(row.reviewedAt) }}</p>
                <p v-else-if="row.submittedAt" class="mt-0.5 text-2xs text-fg-subtle" :title="formatDateTime(row.submittedAt)">submitted {{ timeAgo(row.submittedAt) }}</p>
              </div>
              <AppButton v-if="row.timesheetId" size="sm" variant="secondary" :icon="Eye" @click="openReview(row.timesheetId)">Open</AppButton>
              <span v-else class="w-[4.75rem]" aria-hidden="true" />
            </li>
          </ul>
          <AppPagination v-if="board.data.value && board.data.value.meta.total > board.data.value.meta.pageSize" class="border-t border-line" :meta="board.data.value.meta" @change="(p: number) => ((boardPage = p), board.run())" />
        </AppCard>
      </div>

      <!-- All timesheets -->
      <AppCard v-else :padded="false">
        <div class="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-2">
          <AppSearchInput v-model="all.search.value" class="w-64 max-sm:w-full" placeholder="Search people" />
          <AppSelect v-model="all.filters.status" size="sm" class="ms-auto w-48" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable
          :columns="columns"
          :rows="all.rows.value"
          :loading="all.loading.value"
          :error="all.error.value"
          :meta="all.meta.value"
          caption="All timesheets"
          layout-key="hr-timesheets-all"
          empty-title="No timesheets"
          empty-description="Submitted and reviewed timesheets of your team appear here."
          :filtered="all.isFiltered.value"
          clickable
          @row-click="(t: Timesheet) => openReview(t.id)"
          @clear="all.clearFilters()"
          @page="all.setPage"
          @retry="all.load"
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
          <template #cell-week="{ row }">
            <p class="text-fg">{{ dateRange(row.weekStart, row.weekEnd) }}</p>
            <p class="text-xs text-fg-muted">{{ plural(row.entries.length, 'activity', 'activities') }}</p>
          </template>
          <template #cell-hours="{ row }"><span class="font-semibold text-fg tabular-nums">{{ hoursLabel(row.totalMinutes) }}</span></template>
          <template #cell-status="{ row }">
            <AppBadge :tone="timesheetTone[row.status]" dot>{{ TIMESHEET_LABELS[row.status] }}</AppBadge>
            <p v-if="row.reviewedBy && row.status !== 'SUBMITTED'" class="mt-0.5 text-xs text-fg-subtle">by {{ row.reviewedBy }}</p>
          </template>
          <template #cell-actions="{ row }">
            <AppButton size="sm" variant="secondary" :icon="Eye" @click.stop="openReview(row.id)">Open</AppButton>
          </template>
          <template #card="{ row }">
            <TimesheetGridCard :timesheet="row" @open="openReview(row.id)" @approve="openReview(row.id, 'approve')" @reject="openReview(row.id, 'reject')" />
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>

    <TimesheetReviewModal :open="!!reviewing" :timesheet-id="reviewing?.id ?? null" :action="reviewing?.action" @close="reviewing = null" @reviewed="onReviewed" />
  </div>
</template>
