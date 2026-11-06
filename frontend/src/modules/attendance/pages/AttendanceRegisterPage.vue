<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { DailyRow, DailySummary } from '@/modules/attendance/types';
import { DAY_STATUS_LABELS, dayStatusTone, formatMinutes, formatTime } from '@/modules/attendance/utils/attendance-format';
import { structureApi } from '@/modules/people/api/people.api';
import { AppAvatar, AppBadge, AppCard, AppDataTable, AppDatePicker, AppPageHeader, AppSearchInput, AppSelect, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { formatDate } from '@/shared/utils/format';

const router = useRouter();
const date = ref<string | undefined>(undefined);
const summary = ref<DailySummary | null>(null);
const resolvedDate = ref<string | null>(null);
const departments = useAsync(() => structureApi.departments());

const table = useTable(
  async (q) => {
    const res = await attendanceApi.daily({ ...q, date: date.value });
    summary.value = res.summary;
    resolvedDate.value = res.date;
    return res.page;
  },
  { pageSize: 25, filters: { departmentId: undefined as string | undefined, status: undefined as string | undefined } },
);
watch(date, () => void table.load());

const columns: TableColumn<DailyRow>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'status', label: 'Status' },
  { key: 'in', label: 'In' },
  { key: 'out', label: 'Out' },
  { key: 'worked', label: 'Worked', align: 'right' },
  { key: 'late', label: 'Late', align: 'right' },
];
const departmentOptions = computed(() => (departments.data.value ?? []).map((d) => ({ value: d.id, label: d.name })));
const statusOptions = [
  { value: 'PRESENT', label: 'Present' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'HALF_DAY', label: 'Half day' },
  { value: 'ABSENT', label: 'Absent / not in' },
  { value: 'MISSED_PUNCH', label: 'Missed punch-out' },
  { value: 'LATE', label: 'Late' },
];
const tiles = computed(() => {
  const s = summary.value;
  if (!s) return [];
  return [
    { key: 'PRESENT', label: 'Present', value: s.present, cls: 'text-emerald-600 dark:text-emerald-400' },
    { key: 'IN_PROGRESS', label: 'In now', value: s.inProgress, cls: 'text-sky-600 dark:text-sky-400' },
    { key: 'ABSENT', label: 'Absent / not in', value: s.absent, cls: 'text-red-600 dark:text-red-400' },
    { key: 'LATE', label: 'Late', value: s.late, cls: 'text-orange-600 dark:text-orange-400' },
    { key: 'HALF_DAY', label: 'Half day', value: s.halfDay, cls: 'text-amber-600 dark:text-amber-400' },
    { key: 'MISSED_PUNCH', label: 'Missed punch-out', value: s.missedPunch, cls: 'text-orange-600 dark:text-orange-400' },
  ];
});
const today = new Date().toISOString().slice(0, 10);
const monthOf = (d: string | null) => (d ?? today).slice(0, 7);
</script>

<template>
  <div>
    <AppPageHeader title="Attendance register" :description="resolvedDate ? `${formatDate(resolvedDate)} · ${summary?.total ?? 0} ${summary?.total === 1 ? 'employee' : 'employees'} in your scope${summary?.off ? `, ${summary.off} off today` : ''}.` : 'Daily attendance across your team.'">
      <template #actions>
        <AppDatePicker v-model="date" aria-label="Date" :max="today" placeholder="Today" class="w-48" />
      </template>
    </AppPageHeader>

    <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <button
        v-for="t in tiles"
        :key="t.key"
        type="button"
        :class="['card px-4 py-3 text-left transition hover:ring-brand-400', table.filters.status === t.key && 'ring-2 ring-brand-500']"
        :aria-pressed="table.filters.status === t.key"
        @click="table.filters.status = table.filters.status === t.key ? undefined : t.key"
      >
        <p class="text-xs text-fg-muted">{{ t.label }}</p>
        <p :class="['mt-1 text-2xl font-semibold tabular-nums', t.cls]">{{ t.value }}</p>
      </button>
    </div>

    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line p-4 sm:grid-cols-[1fr_200px_200px]">
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
      >
        <template #cell-employee="{ row }">
          <div class="flex items-center gap-3">
            <AppAvatar :name="row.employee.name" size="sm" />
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
              <p class="truncate text-xs text-fg-muted">{{ row.employee.employeeCode }} · {{ row.employee.department?.name ?? row.shift.name }}</p>
            </div>
          </div>
        </template>
        <template #cell-status="{ row }"><AppBadge :tone="dayStatusTone[row.status]" dot>{{ row.status === 'UPCOMING' ? 'Not in yet' : DAY_STATUS_LABELS[row.status] }}</AppBadge></template>
        <template #cell-in="{ row }">{{ formatTime(row.record?.checkInAt) }}</template>
        <template #cell-out="{ row }">{{ formatTime(row.record?.checkOutAt) }}</template>
        <template #cell-worked="{ row }"><span class="tabular-nums">{{ formatMinutes(row.record?.workedMinutes) }}</span></template>
        <template #cell-late="{ row }">
          <span :class="['tabular-nums', row.record?.lateMinutes ? 'font-medium text-orange-600 dark:text-orange-400' : 'text-fg-subtle']">{{ row.record?.lateMinutes ? formatMinutes(row.record.lateMinutes) : '—' }}</span>
        </template>
      </AppDataTable>
    </AppCard>
  </div>
</template>
