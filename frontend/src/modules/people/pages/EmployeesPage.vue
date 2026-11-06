<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Download, UserPlus } from '@lucide/vue';
import type { EmployeeStatus } from '@contracts';
import { employeesApi, structureApi } from '@/modules/people/api/people.api';
import type { Employee } from '@/modules/people/types';
import { EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, employeeStatusOptions, employeeStatusTone } from '@/modules/people/utils/labels';
import CreateFromUsersModal from '@/modules/people/components/CreateFromUsersModal.vue';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';
import { SCOPE_LABELS } from '@/shared/utils/status';

const auth = useAuthStore();
const router = useRouter();
const feedback = useFeedbackStore();
const departments = useAsync(() => structureApi.departments());
const table = useTable((q) => employeesApi.list(q), {
  sort: 'name:asc',
  filters: { status: 'ACTIVE' as EmployeeStatus | undefined, departmentId: undefined as string | undefined },
});
const scope = computed(() => auth.context?.permissions['employee.view']);
const exporting = ref(false);
const linkable = useAsync(() => (auth.can('employee.create') ? employeesApi.linkableMembers() : Promise.resolve([])));
const fromUsersOpen = ref(false);

async function onCreated(count: number) {
  fromUsersOpen.value = false;
  feedback.success(`${count} employee record${count === 1 ? '' : 's'} created`, 'Open each one to add department, designation, manager and shift.');
  await Promise.all([table.load(), linkable.run()]);
}

const columns: TableColumn<Employee>[] = [
  { key: 'name', label: 'Employee', sortField: 'name' },
  { key: 'employeeCode', label: 'Code', sortField: 'employeeCode' },
  { key: 'role', label: 'Designation & department' },
  { key: 'manager', label: 'Manager' },
  { key: 'dateOfJoining', label: 'Joined', sortField: 'dateOfJoining' },
  { key: 'status', label: 'Status', sortField: 'status' },
];
const departmentOptions = computed(() => (departments.data.value ?? []).map((d) => ({ value: d.id, label: d.name })));

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
    <AppPageHeader title="Employees" :description="scope && scope !== 'ORGANIZATION' ? `Showing employees in your scope: ${SCOPE_LABELS[scope]?.toLowerCase()}.` : 'Everyone in your organization, their roles and reporting lines.'">
      <template #actions>
        <AppButton v-if="auth.can('employee.export')" variant="secondary" :icon="Download" :loading="exporting" @click="exportCsv">Export CSV</AppButton>
        <AppButton v-if="auth.can('employee.create')" :icon="UserPlus" to="/hr/employees/new">Add employee</AppButton>
      </template>
    </AppPageHeader>

    <AppAlert v-if="linkable.data.value?.length" tone="info" class="mb-4" :title="`${linkable.data.value.length} ${linkable.data.value.length === 1 ? 'user has' : 'users have'} no employee record yet`">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span>Users can sign in, but they appear here and can use attendance and leave only once they have an employee record.</span>
        <AppButton size="sm" :icon="UserPlus" @click="fromUsersOpen = true">Create employee records</AppButton>
      </div>
    </AppAlert>

    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line p-4 sm:grid-cols-[1fr_200px_180px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search name, code or email" aria-label="Search employees" />
        <AppSelect v-model="table.filters.departmentId" :options="departmentOptions" placeholder="All departments" aria-label="Filter by department" />
        <AppSelect v-model="table.filters.status" :options="employeeStatusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </div>
      <AppDataTable
        v-model:sort="table.sort.value"
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        clickable
        caption="Employees"
        empty-title="No employees found"
        :empty-description="auth.can('employee.create') ? 'Add your first employee or change the filters.' : 'Try a different search or filter.'"
        @page="table.setPage"
        @retry="table.load"
        @row-click="(row) => router.push(`/hr/employees/${row.id}`)"
      >
        <template #cell-name="{ row }">
          <div class="flex items-center gap-3">
            <AppAvatar :name="row.fullName" size="sm" />
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.fullName }}</p>
              <p class="truncate text-xs text-fg-muted">{{ row.workEmail ?? EMPLOYMENT_TYPE_LABELS[row.employmentType] }}</p>
            </div>
          </div>
        </template>
        <template #cell-employeeCode="{ row }"><span class="font-mono text-xs text-fg-muted">{{ row.employeeCode }}</span></template>
        <template #cell-role="{ row }">
          <p class="text-fg">{{ row.designation?.name ?? '—' }}</p>
          <p class="text-xs text-fg-muted">{{ row.department?.name ?? 'No department' }}</p>
        </template>
        <template #cell-manager="{ row }"><span class="text-fg-muted">{{ row.manager?.name ?? '—' }}</span></template>
        <template #cell-dateOfJoining="{ row }"><span class="text-fg-muted">{{ formatDate(row.dateOfJoining) }}</span></template>
        <template #cell-status="{ row }"><AppBadge :tone="employeeStatusTone[row.status]" dot>{{ EMPLOYEE_STATUS_LABELS[row.status] }}</AppBadge></template>
      </AppDataTable>
    </AppCard>

    <CreateFromUsersModal :open="fromUsersOpen" :members="linkable.data.value ?? []" @close="fromUsersOpen = false" @created="onCreated" />
  </div>
</template>
