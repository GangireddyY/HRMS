<script setup lang="ts">
import { appLocale } from '@/core/locale/locale';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Download, FilterX, LayoutGrid, Network, Rows3, SearchX, Upload, UserPlus, Users } from '@lucide/vue';
import type { EmployeeStatus, EmploymentType } from '@contracts';
import { employeesApi, structureApi, type EmployeeListQuery } from '@/modules/people/api/people.api';
import type { Employee } from '@/modules/people/types';
import { daysUntil, relativeDays, tenure } from '@/modules/people/utils/dates';
import { employeeSignal, SIGNAL_WINDOW_DAYS } from '@/modules/people/utils/employee-signals';
import { EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, employeeStatusTone, employmentTypeOptions } from '@/modules/people/utils/labels';
import CreateFromUsersModal from '@/modules/people/components/CreateFromUsersModal.vue';
import EmployeeAttentionCard from '@/modules/people/components/EmployeeAttentionCard.vue';
import EmployeeDirectoryCard from '@/modules/people/components/EmployeeDirectoryCard.vue';
import ImportEmployeesModal from '@/modules/people/components/ImportEmployeesModal.vue';
import LeaveMiniCalendar from '@/modules/leave/components/LeaveMiniCalendar.vue';
import {
  AppAlert,
  AppAvatar,
  AppBadge,
  AppButton,
  AppCard,
  AppDataTable,
  AppEmptyState,
  AppErrorState,
  AppPageHeader,
  AppPagination,
  AppSearchInput,
  AppSegmented,
  AppSelect,
  AppSplit,
  AppStatStrip,
  type StripItem,
  type TableColumn,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate } from '@/shared/utils/format';
import { SCOPE_LABELS } from '@/shared/utils/status';

/** The employee directory: headcount by status (doubles as the status filter), a work queue, and a table or card grid. */
const auth = useAuthStore();
const router = useRouter();
const feedback = useFeedbackStore();
const departments = useAsync(() => structureApi.departments());
const table = useTable((q) => employeesApi.list(q), {
  sort: 'name:asc',
  filters: {
    status: 'ACTIVE' as EmployeeStatus | undefined,
    departmentId: undefined as string | undefined,
    employmentType: undefined as EmploymentType | undefined,
  },
});
const scope = computed(() => auth.context?.permissions['employee.view']);
const showCalendar = computed(() => auth.can('leave.view', 'TEAM') && auth.hasFeature('leave'));
const exporting = ref(false);
const linkable = useAsync(() => (auth.can('employee.create') ? employeesApi.linkableMembers() : Promise.resolve([])));
const fromUsersOpen = ref(false);

async function onCreated(count: number) {
  fromUsersOpen.value = false;
  feedback.success(`${count} employee record${count === 1 ? '' : 's'} created`, 'Open each one to add department, designation, manager and shift.');
  await Promise.all([table.load(), linkable.run(), summary.run()]);
}

const importOpen = ref(false);
async function onImported(count: number) {
  importOpen.value = false;
  feedback.success(`${count.toLocaleString(appLocale())} employee${count === 1 ? '' : 's'} imported`);
  await Promise.all([table.load(), summary.run()]);
}

// ---- Headcount summary and work queue ------------------------------------------------------------------------
/** Active and on-notice people are read in full so the work queue sees every probation and exit date. */
async function everyone(q: EmployeeListQuery) {
  const items = await fetchAllPages((page, pageSize) => employeesApi.list({ ...q, page, pageSize, sort: 'dateOfJoining:desc' }));
  return { total: items.length, items };
}
/** Counts follow the department and employment type filters, not the search box. */
const summary = useAsync(async () => {
  const base: EmployeeListQuery = { departmentId: table.filters.departmentId, employmentType: table.filters.employmentType };
  const [all, exited, notice, active] = await Promise.all([
    employeesApi.list({ ...base, pageSize: 1 }),
    employeesApi.list({ ...base, status: 'EXITED', pageSize: 1 }),
    everyone({ ...base, status: 'ON_NOTICE' }),
    everyone({ ...base, status: 'ACTIVE' }),
  ]);
  return { all: all.meta.total, exited: exited.meta.total, notice, active };
});
watch(() => [table.filters.departmentId, table.filters.employmentType], () => void summary.run());

const joinedRecently = computed(() => summary.data.value?.active.items.filter((e) => employeeSignal(e)?.kind === 'new').length ?? 0);
const leavingSoon = computed(() => summary.data.value?.notice.items.filter((e) => employeeSignal(e)?.urgent).length ?? 0);
const onProbation = computed(() => summary.data.value?.active.items.filter((e) => e.probationEndDate && !e.confirmedOn).length ?? 0);
const stripItems = computed<StripItem[]>(() => {
  const s = summary.data.value;
  return [
    { key: 'ALL', label: 'All employees', value: s?.all, tone: 'brand', hint: 'Across all statuses' },
    { key: 'ACTIVE', label: 'Active', value: s?.active.total, tone: 'success', hint: joinedRecently.value ? `+${joinedRecently.value} joined in ${SIGNAL_WINDOW_DAYS} days` : onProbation.value ? `${onProbation.value} on probation` : 'Currently working' },
    { key: 'ON_NOTICE', label: 'On notice', value: s?.notice.total, tone: 'warning', hint: leavingSoon.value ? `${leavingSoon.value} leaving in ${SIGNAL_WINDOW_DAYS} days` : 'Serving notice period' },
    { key: 'EXITED', label: 'Exited', value: s?.exited, tone: 'neutral', hint: 'Former employees' },
  ];
});
const selectedStatus = computed(() => table.filters.status ?? 'ALL');
function selectStatus(key: string | null) {
  // Clicking the selected metric again returns to the default view (active employees).
  table.filters.status = key === 'ALL' ? undefined : ((key ?? 'ACTIVE') as EmployeeStatus);
}
const queue = computed(() => [...(summary.data.value?.active.items ?? []), ...(summary.data.value?.notice.items ?? [])]);
const probationLink = computed(() => (auth.hasFeature('onboarding') && auth.can('onboarding.view', 'TEAM') ? '/hr/onboarding/probation' : null));

// ---- Table / grid --------------------------------------------------------------------------------------------
const columns = computed<TableColumn<Employee>[]>(() => [
  { key: 'name', label: 'Employee', sortField: 'name' },
  // Beside the side panel on laptop widths the code moves under the name and the joining date is left to the
  // employee page, so the table needs no sideways scroll.
  { key: 'employeeCode', label: 'Code', sortField: 'employeeCode', class: 'xl:max-2xl:hidden' },
  { key: 'role', label: 'Designation & department' },
  { key: 'manager', label: 'Manager', class: 'md:max-lg:hidden' },
  { key: 'dateOfJoining', label: 'Joined', sortField: 'dateOfJoining', class: 'xl:max-2xl:hidden' },
  { key: 'status', label: 'Status', sortField: 'status' },
]);
const departmentOptions = computed(() => (departments.data.value ?? []).map((d) => ({ value: d.id, label: d.name })));

const VIEW_KEY = 'hrms.employees.view';
const view = ref<'table' | 'grid'>(localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'table');
watch(view, (v) => localStorage.setItem(VIEW_KEY, v));
const viewOptions = [
  { value: 'table' as const, label: 'Table', icon: Rows3 },
  { value: 'grid' as const, label: 'Grid', icon: LayoutGrid },
];
/** The grid has no column headers to click, so it offers the same orderings as a list. */
const sortOptions = [
  { value: 'name:asc', label: 'Name (A–Z)' },
  { value: 'name:desc', label: 'Name (Z–A)' },
  { value: 'dateOfJoining:desc', label: 'Newest joiners' },
  { value: 'dateOfJoining:asc', label: 'Longest serving' },
  { value: 'employeeCode:asc', label: 'Employee code' },
];
const resultLabel = computed(() => {
  const total = table.meta.value?.total;
  if (total === undefined) return '';
  return `${total.toLocaleString(appLocale())} ${total === 1 ? 'person' : 'people'}`;
});

async function exportCsv() {
  exporting.value = true;
  try {
    await employeesApi.exportCsv({ ...table.filters, search: table.search.value || undefined });
  } catch (e) {
    feedback.error('Could not export employees', e);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div>
    <AppPageHeader
      title="Employees"
      :description="scope && scope !== 'ORGANIZATION' ? `Showing employees in your scope: ${SCOPE_LABELS[scope]?.toLowerCase()}.` : 'Everyone in your organization, their roles and reporting lines.'"
    >
      <template #actions>
        <AppButton variant="ghost" :icon="Network" to="/hr/org-chart">Org chart</AppButton>
        <AppButton v-if="auth.can('employee.export')" variant="secondary" :icon="Download" :loading="exporting" @click="exportCsv">Export CSV</AppButton>
        <AppButton v-if="auth.can('employee.import') && auth.can('employee.create')" variant="secondary" :icon="Upload" @click="importOpen = true">Import</AppButton>
        <AppButton v-if="auth.can('employee.create')" :icon="UserPlus" to="/hr/employees/new">Add employee</AppButton>
      </template>
    </AppPageHeader>

    <AppAlert
      v-if="linkable.data.value?.length"
      tone="info"
      class="mb-4"
      :title="`${linkable.data.value.length} ${linkable.data.value.length === 1 ? 'user has' : 'users have'} no employee record yet`"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span>Users can sign in, but they appear here and can use attendance and leave only once they have an employee record.</span>
        <AppButton size="sm" :icon="UserPlus" @click="fromUsersOpen = true">Create employee records</AppButton>
      </div>
    </AppAlert>

    <AppStatStrip
      class="mb-4"
      label="Headcount by status"
      :items="stripItems"
      :loading="summary.loading.value && !summary.data.value"
      selectable
      :selected="selectedStatus"
      @select="selectStatus"
    />

    <AppSplit aside="md">
      <AppCard :padded="false">
        <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_170px_140px_auto]">
          <AppSearchInput v-model="table.search.value" class="sm:col-span-2 lg:col-span-1" placeholder="Search name, code, email" aria-label="Search employees" />
          <AppSelect v-model="table.filters.departmentId" :options="departmentOptions" placeholder="All departments" aria-label="Filter by department" />
          <AppSelect v-model="table.filters.employmentType" :options="employmentTypeOptions" placeholder="All types" aria-label="Filter by employment type" />
          <AppSegmented v-model="view" class="max-md:hidden lg:w-44" :options="viewOptions" label="Layout" />
        </div>
        <div class="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/70 bg-surface-muted/40 px-4 py-2 text-xs text-fg-muted">
          <span class="font-medium text-fg tabular-nums" aria-live="polite">{{ resultLabel }}</span>
          <span v-if="table.filters.status">· {{ EMPLOYEE_STATUS_LABELS[table.filters.status] }}</span>
          <span v-if="table.filters.departmentId">· {{ departmentOptions.find((d) => d.value === table.filters.departmentId)?.label }}</span>
          <span v-if="table.filters.employmentType">· {{ EMPLOYMENT_TYPE_LABELS[table.filters.employmentType] }}</span>
          <AppButton v-if="table.isFiltered.value" class="ms-auto" size="xs" variant="ghost" :icon="FilterX" @click="table.clearFilters()">Clear filters</AppButton>
          <div v-if="view === 'grid' && table.rows.value.length > 1" :class="['flex items-center gap-2 max-md:hidden', !table.isFiltered.value && 'ms-auto']">
            <span class="font-medium" aria-hidden="true">Sort by</span>
            <AppSelect
              :model-value="sortOptions.some((o) => o.value === table.sort.value) ? table.sort.value : undefined"
              :options="sortOptions"
              placeholder="Default order"
              :clearable="false"
              :searchable="false"
              aria-label="Sort by"
              size="sm"
              class="w-44"
              @update:model-value="(v) => v && (table.sort.value = v)"
            />
          </div>
        </div>

        <!-- Phones always get the table, which already renders rows as cards there. -->
        <div v-if="view === 'grid'" class="@container max-md:hidden" :aria-busy="table.loading.value || undefined">
          <AppErrorState v-if="table.error.value && !table.loading.value" :error="table.error.value" @retry="table.load" />
          <template v-else>
            <ul v-if="table.loading.value && !table.rows.value.length" class="grid gap-4 p-4 @lg:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4" aria-label="Loading employees">
              <li v-for="i in 6" :key="i" class="card overflow-hidden">
                <div class="skeleton h-16 rounded-none" />
                <div class="flex flex-col items-center gap-2 px-4 pb-5">
                  <div class="relative z-10 -mt-10 h-22 w-22 rounded-full bg-surface p-1"><div class="skeleton h-full w-full rounded-full" /></div>
                  <div class="skeleton h-3.5 w-2/3 rounded-full" />
                  <div class="skeleton h-3 w-1/2 rounded-full" />
                  <div class="skeleton mt-4 h-16 w-full rounded-lg" />
                </div>
              </li>
            </ul>
            <ul v-else-if="table.rows.value.length" :class="['grid gap-4 p-4 @lg:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4', table.loading.value && 'opacity-60']" aria-label="Employees">
              <li v-for="e in table.rows.value" :key="e.id"><EmployeeDirectoryCard :employee="e" /></li>
            </ul>
            <AppEmptyState v-else-if="table.isFiltered.value" :icon="SearchX" title="No matches" description="Nothing matches your search or filters.">
              <AppButton variant="secondary" size="sm" :icon="FilterX" @click="table.clearFilters()">Clear filters</AppButton>
            </AppEmptyState>
            <AppEmptyState
              v-else
              :icon="Users"
              title="No employees yet"
              :description="auth.can('employee.create') ? 'Add your first employee, or import them from a spreadsheet.' : 'Employees you can see will appear here.'"
            >
              <AppButton v-if="auth.can('employee.create')" :icon="UserPlus" to="/hr/employees/new">Add employee</AppButton>
            </AppEmptyState>
            <AppPagination v-if="table.meta.value && table.meta.value.total > 0" class="border-t border-line" :meta="table.meta.value" :disabled="table.loading.value" @change="table.setPage" />
          </template>
        </div>

        <AppDataTable
          v-model:sort="table.sort.value"
          :class="view === 'grid' && 'md:hidden'"
          :grid="false"
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          clickable
          caption="Employees"
          empty-title="No employees yet"
          :empty-description="auth.can('employee.create') ? 'Add your first employee, or import them from a spreadsheet.' : 'Employees you can see will appear here.'"
          @page="table.setPage"
          @retry="table.load"
          @row-click="(row) => router.push(`/hr/employees/${row.id}`)"
          :filtered="table.isFiltered.value"
          @clear="table.clearFilters()"
        >
          <template #empty><AppButton v-if="auth.can('employee.create')" :icon="UserPlus" to="/hr/employees/new">Add employee</AppButton></template>
          <template #cell-name="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.fullName" :src="row.avatarUrl" size="sm" :class="row.status === 'EXITED' && 'opacity-60 grayscale'" />
              <div class="min-w-0 xl:max-2xl:max-w-56">
                <p class="truncate font-medium text-fg">{{ row.fullName }}</p>
                <p class="truncate text-xs text-fg-muted">
                  <span class="hidden font-mono xl:max-2xl:inline">{{ row.employeeCode }} · </span>{{ row.workEmail ?? EMPLOYMENT_TYPE_LABELS[row.employmentType] }}
                </p>
              </div>
            </div>
          </template>
          <template #cell-employeeCode="{ row }"><span class="font-mono text-xs whitespace-nowrap text-fg-muted">{{ row.employeeCode }}</span></template>
          <template #cell-role="{ row }">
            <p class="text-fg">{{ row.designation?.name ?? '—' }}</p>
            <p class="text-xs text-fg-muted">{{ row.department?.name ?? 'No department' }}<template v-if="row.location"> · {{ row.location.name }}</template></p>
          </template>
          <template #cell-manager="{ row }">
            <span v-if="row.manager" class="inline-flex items-center gap-2 whitespace-nowrap text-fg-muted">
              <AppAvatar :name="row.manager.name" size="xs" />{{ row.manager.name }}
            </span>
            <span v-else class="text-fg-subtle">—</span>
          </template>
          <template #cell-dateOfJoining="{ row }">
            <p class="whitespace-nowrap text-fg">{{ formatDate(row.dateOfJoining) }}</p>
            <p class="text-xs whitespace-nowrap text-fg-muted">{{ row.status === 'EXITED' ? (row.exitDate ? `Left ${formatDate(row.exitDate)}` : 'Exited') : daysUntil(row.dateOfJoining) > 0 ? `Starts ${relativeDays(row.dateOfJoining)}` : tenure(row.dateOfJoining) }}</p>
          </template>
          <template #cell-status="{ row }">
            <div class="flex flex-col items-start gap-1 max-md:items-end">
              <AppBadge :tone="employeeStatusTone[row.status]" dot>{{ EMPLOYEE_STATUS_LABELS[row.status] }}</AppBadge>
              <span v-if="employeeSignal(row)" :class="['text-xs whitespace-nowrap', employeeSignal(row)!.kind === 'probation-overdue' ? 'font-medium text-danger-fg' : 'text-fg-muted']">
                {{ employeeSignal(row)!.label }}
              </span>
            </div>
          </template>
        </AppDataTable>
      </AppCard>
      <template #aside>
        <EmployeeAttentionCard :employees="queue" :loading="summary.loading.value" :probation-link="probationLink" />
        <LeaveMiniCalendar v-if="showCalendar" :department-id="table.filters.departmentId" />
      </template>
    </AppSplit>

    <CreateFromUsersModal :open="fromUsersOpen" :members="linkable.data.value ?? []" @close="fromUsersOpen = false" @created="onCreated" />
    <ImportEmployeesModal :open="importOpen" @close="importOpen = false" @imported="onImported" />
  </div>
</template>
