<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { useRouter } from 'vue-router';
import { AlarmClock, CalendarDays, ChevronLeft, ChevronRight, CircleCheck, FilePen, Fingerprint, House, MonitorSmartphone, Pencil, Timer, TimerOff, UserX } from '@lucide/vue';
import type { AttendanceSource } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import RegisterDayCard from '@/modules/attendance/components/RegisterDayCard.vue';
import type { DailyRow, DailySummary } from '@/modules/attendance/types';
import { DAY_STATUS_LABELS, addDays, dayStatusTone, formatMinutes, formatTime } from '@/modules/attendance/utils/attendance-format';
import { localToday, longDay, plural, relativeDay } from '@/modules/attendance/utils/attendance-ops';
import { structureApi } from '@/modules/people/api/people.api';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppDatePicker, AppPageHeader, AppSearchInput, AppSelect, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';

/** Daily attendance of everyone in scope: a live board for today (or any past day) that filters the register below. */
const router = useRouter();
const date = ref<string | undefined>(undefined);
const summary = ref<DailySummary | null>(null);
const resolvedDate = ref<string | null>(null);
const loadedAt = ref<Date | null>(null);
const departments = useAsync(() => structureApi.departments());

const table = useTable(
  async (q) => {
    const res = await attendanceApi.daily({ ...q, date: date.value });
    summary.value = res.summary;
    resolvedDate.value = res.date;
    loadedAt.value = new Date();
    return res.page;
  },
  { pageSize: 25, filters: { departmentId: undefined as string | undefined, status: undefined as string | undefined } },
);
watch(date, () => void table.load());

const today = localToday();
const day = computed(() => resolvedDate.value ?? date.value ?? today);
const isToday = computed(() => day.value >= today);
const step = (n: number) => (date.value = addDays(day.value, n) >= today ? undefined : addDays(day.value, n));
const monthOf = (d: string | null) => (d ?? today).slice(0, 7);

const columns: TableColumn<DailyRow>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'status', label: 'Status' },
  { key: 'shift', label: 'Shift' },
  { key: 'in', label: 'In' },
  { key: 'out', label: 'Out' },
  { key: 'worked', label: 'Worked', align: 'right' },
  { key: 'late', label: 'Late', align: 'right' },
];
const departmentOptions = computed(() => (departments.data.value ?? []).map((d) => ({ value: d.id, label: d.name })));
const notInLabel = computed(() => (isToday.value ? 'Not in yet' : 'Absent'));
const statusOptions = computed(() => [
  { value: 'PRESENT', label: 'Present' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'HALF_DAY', label: 'Half day' },
  { value: 'ABSENT', label: 'Absent / not in' },
  { value: 'MISSED_PUNCH', label: 'Missed punch-out' },
  { value: 'ON_LEAVE', label: 'On leave' },
  { value: 'LATE', label: 'Late' },
  { value: 'REMOTE', label: 'Working from home' },
]);

// ---- Live board --------------------------------------------------------------------------------------------------
/** People expected at work: everyone except those on a weekly off, a holiday or leave. */
const expected = computed(() => (summary.value ? summary.value.total - summary.value.off - summary.value.onLeave : 0));
const arrived = computed(() => (summary.value ? summary.value.present + summary.value.inProgress + summary.value.halfDay + summary.value.missedPunch : 0));
const rate = computed(() => (expected.value > 0 ? Math.round((arrived.value / expected.value) * 100) : null));
const rateTone = computed(() => (rate.value === null ? 'text-fg-subtle' : rate.value >= 90 ? 'text-success' : rate.value >= 70 ? 'text-warning' : isToday.value ? 'text-info' : 'text-danger'));
const CIRC = 2 * Math.PI * 40;

const strip = computed<StripItem[]>(() => {
  const s = summary.value;
  if (!s) return [];
  const share = (n: number) => (s.total ? `${Math.round((n / s.total) * 100)}% of ${s.total}` : undefined);
  return [
    ...(isToday.value ? [{ key: 'IN_PROGRESS', label: 'In now', value: s.inProgress, tone: 'info', hint: 'Punched in' }] : []),
    { key: 'PRESENT', label: 'Present', value: s.present, tone: 'success', hint: isToday.value ? 'Full day done' : share(s.present) },
    { key: 'LATE', label: 'Late', value: s.late, tone: 'orange', hint: arrived.value ? `${Math.round((s.late / arrived.value) * 100)}% of arrivals` : undefined },
    { key: 'ABSENT', label: notInLabel.value, value: s.absent, tone: 'danger', hint: share(s.absent) },
    { key: 'ON_LEAVE', label: 'On leave', value: s.onLeave, tone: 'cyan', hint: 'Approved leave' },
    { key: 'REMOTE', label: 'From home', value: s.remote, tone: 'brand', hint: 'Approved WFH' },
    { key: 'HALF_DAY', label: 'Half day', value: s.halfDay, tone: 'warning' },
    { key: 'MISSED_PUNCH', label: 'No punch-out', value: s.missedPunch, tone: 'violet', hint: s.missedPunch ? 'Needs a correction' : undefined },
    ...(!isToday.value && s.inProgress ? [{ key: 'IN_PROGRESS', label: 'In progress', value: s.inProgress, tone: 'info' }] : []),
  ];
});

/** The day's make-up, in the order a manager reads it; the segments add up to everyone in scope. */
const segments = computed(() => {
  const s = summary.value;
  if (!s || !s.total) return [];
  return [
    { key: 'PRESENT', label: 'Present', value: s.present, color: 'var(--status-success)' },
    { key: 'IN_PROGRESS', label: isToday.value ? 'In now' : 'In progress', value: s.inProgress, color: 'var(--status-info)' },
    { key: 'HALF_DAY', label: 'Half day', value: s.halfDay, color: 'var(--status-warning)' },
    { key: 'MISSED_PUNCH', label: 'Missed punch-out', value: s.missedPunch, color: 'var(--status-special)' },
    { key: 'ABSENT', label: notInLabel.value, value: s.absent, color: 'var(--status-danger)' },
    { key: 'ON_LEAVE', label: 'On leave', value: s.onLeave, color: 'var(--status-away)' },
    { key: 'OFF', label: 'Off today', value: s.off, color: 'var(--status-neutral)' },
  ].filter((x) => x.value > 0);
});

const attention = computed<{ key: string; label: string; count: number; icon: Component; tone: string }[]>(() => {
  const s = summary.value;
  if (!s) return [];
  return [
    { key: 'MISSED_PUNCH', label: plural(s.missedPunch, 'missed punch-out'), count: s.missedPunch, icon: TimerOff, tone: 'bg-special-soft text-special-fg ring-special/20' },
    { key: 'ABSENT', label: `${s.absent} ${isToday.value ? 'not in yet' : 'absent'}`, count: s.absent, icon: UserX, tone: 'bg-danger-soft text-danger-fg ring-danger/20' },
    { key: 'LATE', label: plural(s.late, 'late arrival'), count: s.late, icon: AlarmClock, tone: 'bg-caution-soft text-caution-fg ring-caution/20' },
  ].filter((a) => a.count > 0);
});
const filterTo = (key: string) => (table.filters.status = table.filters.status === key ? undefined : key);
const asOf = computed(() => (loadedAt.value ? new Intl.DateTimeFormat(appLocale(), { hour: '2-digit', minute: '2-digit' }).format(loadedAt.value) : ''));

const SOURCE: Record<AttendanceSource, { icon: Component; label: string }> = {
  WEB: { icon: MonitorSmartphone, label: 'Punched in the app' },
  DEVICE: { icon: Fingerprint, label: 'Attendance device' },
  MANUAL: { icon: Pencil, label: 'Corrected by HR' },
  REGULARIZED: { icon: FilePen, label: 'Regularized' },
};
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader
      title="Attendance register"
      :description="resolvedDate ? `${longDay(resolvedDate)} · ${plural(summary?.total ?? 0, 'employee')} in your scope${summary?.off ? `, ${summary.off} off` : ''}.` : 'Daily attendance across your team.'"
    >
      <template #badges>
        <span v-if="resolvedDate && isToday" class="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success-fg ring-1 ring-success/15 ring-inset">
          <span class="relative flex h-1.5 w-1.5" aria-hidden="true"><span class="absolute inset-0 animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" /><span class="relative h-1.5 w-1.5 rounded-full bg-success" /></span>
          Live
        </span>
        <AppBadge v-else-if="resolvedDate">{{ relativeDay(resolvedDate, today) }}</AppBadge>
      </template>
      <template #actions>
        <div class="flex items-center gap-1">
          <AppButton size="sm" variant="ghost" :icon="ChevronLeft" aria-label="Previous day" @click="step(-1)" />
          <AppDatePicker v-model="date" aria-label="Date" :max="today" placeholder="Today" class="w-44" />
          <AppButton size="sm" variant="ghost" :icon="ChevronRight" aria-label="Next day" :disabled="isToday" @click="step(1)" />
        </div>
        <AppButton v-if="!isToday" variant="secondary" :icon="CalendarDays" @click="date = undefined">Today</AppButton>
      </template>
    </AppPageHeader>

    <!-- Who is in: turnout ring, the day's make-up and what needs a look -->
    <section v-if="summary" class="card overflow-hidden" aria-labelledby="board-title">
      <div class="grid gap-px bg-line/70 lg:grid-cols-[250px_minmax(0,1fr)]">
        <div class="flex items-center gap-4 bg-surface px-5 py-4">
          <div class="relative h-22 w-22 shrink-0">
            <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="40" fill="none" stroke-width="10" class="stroke-surface-muted" />
              <circle cx="50" cy="50" r="40" fill="none" stroke-width="10" stroke-linecap="round" :class="['stroke-current transition-[stroke-dashoffset] duration-700', rateTone]" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - (rate ?? 0) / 100)" />
            </svg>
            <span class="absolute inset-0 flex items-center justify-center text-lg font-semibold text-fg tabular-nums">{{ rate === null ? '—' : `${rate}%` }}</span>
          </div>
          <div class="min-w-0">
            <h2 id="board-title" class="text-sm font-semibold text-fg">{{ isToday ? 'Turnout so far' : 'Attendance' }}</h2>
            <p class="text-xs text-fg-muted tabular-nums">{{ expected ? `${arrived} of ${expected} expected ${isToday ? 'are in' : 'came in'}` : 'Nobody was expected' }}</p>
            <p v-if="isToday && asOf" class="mt-1 text-2xs text-fg-subtle">As of {{ asOf }}</p>
          </div>
        </div>
        <div class="flex min-w-0 flex-col justify-center gap-3 bg-surface px-5 py-4">
          <div class="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="segments.map((s) => `${s.label} ${s.value}`).join(', ')">
            <span v-for="s in segments" :key="s.key" class="h-full border-e-2 border-surface last:border-e-0" :style="{ width: `${(s.value / summary.total) * 100}%`, backgroundColor: s.color }" />
          </div>
          <ul class="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-muted" aria-hidden="true">
            <li v-for="s in segments" :key="s.key" class="inline-flex items-center gap-1.5">
              <span class="h-2 w-2 rounded-full" :style="{ backgroundColor: s.color }" />{{ s.label }} <span class="font-semibold text-fg tabular-nums">{{ s.value }}</span>
            </li>
          </ul>
          <div class="flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
            <span class="me-1 text-xs font-medium text-fg-muted">Needs a look</span>
            <button
              v-for="a in attention"
              :key="a.key"
              type="button"
              :aria-pressed="table.filters.status === a.key"
              :class="['inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition ring-inset hover:brightness-95 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none', a.tone, table.filters.status === a.key && 'ring-2 ring-current']"
              @click="filterTo(a.key)"
            >
              <component :is="a.icon" :size="13" aria-hidden="true" />{{ a.label }}
            </button>
            <span v-if="!attention.length" class="inline-flex items-center gap-1.5 text-xs font-medium text-success-fg"><CircleCheck :size="14" aria-hidden="true" />Nothing needs attention</span>
          </div>
        </div>
      </div>
    </section>

    <AppStatStrip
      :label="isToday ? 'Today by status' : 'The day by status'"
      :items="strip"
      :loading="!summary && table.loading.value"
      selectable
      :selected="table.filters.status ?? null"
      @select="(k) => (table.filters.status = k ?? undefined)"
    />

    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_200px_200px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search name or code" aria-label="Search employees" />
        <AppSelect v-model="table.filters.departmentId" :options="departmentOptions" placeholder="All departments" aria-label="Filter by department" />
        <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </div>
      <AppDataTable
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        :row-key="(r: DailyRow) => r.employee.id"
        clickable
        caption="Attendance register"
        empty-title="No employees"
        empty-description="Nobody in your scope matches these filters."
        @page="table.setPage"
        @retry="table.load"
        @row-click="(row: DailyRow) => router.push({ path: `/hr/attendance/employees/${row.employee.id}`, query: { month: monthOf(resolvedDate) } })"
        :filtered="table.isFiltered.value"
        @clear="table.clearFilters()"
      >
        <template #cell-employee="{ row }">
          <div class="flex items-center gap-3">
            <AppAvatar :name="row.employee.name" size="sm" />
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
              <p class="truncate text-xs text-fg-muted">{{ [row.employee.employeeCode, row.employee.designation, row.employee.department?.name].filter(Boolean).join(' · ') }}</p>
            </div>
          </div>
        </template>
        <template #cell-status="{ row }">
          <div class="flex flex-wrap items-center gap-1 max-md:justify-end">
            <AppBadge :tone="dayStatusTone[row.status]" dot>{{ row.status === 'UPCOMING' ? 'Not in yet' : DAY_STATUS_LABELS[row.status] }}</AppBadge>
            <AppBadge v-if="row.workFromHome" tone="brand" size="sm"><House :size="11" class="-ms-0.5" aria-hidden="true" />From home</AppBadge>
            <AppBadge v-if="row.record?.overtimeMinutes" tone="violet" size="sm"><Timer :size="11" class="-ms-0.5" aria-hidden="true" />+{{ formatMinutes(row.record.overtimeMinutes) }}</AppBadge>
          </div>
          <p v-if="row.leave" class="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted max-md:justify-end">
            <span class="h-1.5 w-1.5 shrink-0 rounded-full" :style="{ backgroundColor: row.leave.color }" aria-hidden="true" />{{ row.leave.name }}{{ row.leave.session !== 'FULL' ? ' · half day' : '' }}
          </p>
        </template>
        <template #cell-shift="{ row }">
          <p class="text-fg">{{ row.shift.name }} <AppBadge v-if="row.shift.rostered" size="sm" tone="info">Rostered</AppBadge></p>
          <p class="text-xs text-fg-muted tabular-nums">{{ row.shift.startTime }}–{{ row.shift.endTime }}</p>
        </template>
        <template #cell-in="{ row }">
          <span v-if="row.record?.checkInAt" class="inline-flex items-center gap-1.5 tabular-nums">
            {{ formatTime(row.record.checkInAt) }}
            <component :is="SOURCE[row.record.source].icon" :size="12" class="text-fg-subtle" :aria-label="SOURCE[row.record.source].label" role="img" />
          </span>
          <span v-else-if="row.status === 'UPCOMING'" class="text-xs text-fg-subtle tabular-nums">Due {{ row.shift.startTime }}</span>
          <span v-else class="text-fg-subtle">—</span>
        </template>
        <template #cell-out="{ row }">
          <span v-if="row.record?.checkOutAt" class="tabular-nums">{{ formatTime(row.record.checkOutAt) }}</span>
          <span v-else-if="row.status === 'IN_PROGRESS'" class="text-xs font-medium text-info-fg">Still in</span>
          <span v-else-if="row.status === 'MISSED_PUNCH'" class="text-xs font-medium text-special-fg">No punch-out</span>
          <span v-else class="text-fg-subtle">—</span>
        </template>
        <template #cell-worked="{ row }"><span :class="['tabular-nums', !row.record?.workedMinutes && 'text-fg-subtle']">{{ formatMinutes(row.record?.workedMinutes) }}</span></template>
        <template #cell-late="{ row }">
          <span :class="['tabular-nums', row.record?.lateMinutes ? 'font-medium text-caution-fg' : 'text-fg-subtle']">{{ row.record?.lateMinutes ? formatMinutes(row.record.lateMinutes) : '—' }}</span>
        </template>
        <template #card="{ row }"><RegisterDayCard :row="row" :source="row.record ? SOURCE[row.record.source] : null" /></template>
      </AppDataTable>
    </AppCard>
  </div>
</template>
