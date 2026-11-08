<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ENROLLMENT_STATUSES, type EnrollmentStatus } from '@contracts';
import { trainingApi } from '@/modules/training/api/training.api';
import type { Enrollment } from '@/modules/training/types';
import { CERTIFICATION_LABELS, ENROLLMENT_STATUS_LABELS, certificationTone, enrollmentTone } from '@/modules/training/utils/training-format';
import { AppAvatar, AppBadge, AppCard, AppDataTable, AppPageHeader, AppSelect, AppTabs, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { formatDate } from '@/shared/utils/format';

/** Training of the people in scope: everything, overdue assignments, and certifications expiring or expired. */
const router = useRouter();
const view = ref<'all' | 'overdue' | 'expiring' | 'expired'>('all');
const tabs = [
  { key: 'all', label: 'All training' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'expiring', label: 'Certifications expiring' },
  { key: 'expired', label: 'Expired' },
];
const table = useTable(
  (q) =>
    view.value === 'expiring' || view.value === 'expired'
      ? trainingApi.certifications({ page: q.page, pageSize: q.pageSize, state: view.value === 'expiring' ? 'EXPIRING' : 'EXPIRED' })
      : trainingApi.enrollments({ ...q, view: 'team', overdue: view.value === 'overdue' || undefined }),
  { filters: { status: undefined as EnrollmentStatus | undefined } },
);
watch(view, () => void table.load());
const statusOptions = ENROLLMENT_STATUSES.map((s) => ({ value: s, label: ENROLLMENT_STATUS_LABELS[s] }));
const certView = computed(() => view.value === 'expiring' || view.value === 'expired');
const columns = computed<TableColumn<Enrollment>[]>(() => [
  { key: 'employee', label: 'Employee' },
  { key: 'course', label: 'Course' },
  ...(certView.value ? [{ key: 'expires', label: 'Expires' }] : [{ key: 'due', label: 'Due' }, { key: 'status', label: 'Status' }]),
]);
</script>

<template>
  <div>
    <AppPageHeader title="Team training" description="Who is enrolled in what, overdue assignments and certifications that need renewing." />
    <AppTabs v-model="view" :tabs="tabs">
      <AppCard :padded="false">
        <div v-if="view === 'all'" class="flex items-center justify-end gap-2 border-b border-line/70 px-4 py-2">
          <AppSelect size="sm" v-model="table.filters.status" class="w-56" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Team training" :empty-title="view === 'overdue' ? 'Nothing overdue' : certView ? 'No certifications to renew' : 'No training yet'" @page="table.setPage" @retry="table.load" @row-click="(row) => router.push(`/hr/training/enrollments/${row.id}`)" :filtered="table.isFiltered.value" @clear="table.clearFilters()">
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee.name" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ row.employee.department ?? row.employee.employeeCode }}</p>
              </div>
            </div>
          </template>
          <template #cell-course="{ row }">
            <p class="text-fg">{{ row.course.title }}</p>
            <p class="text-xs text-fg-muted">{{ row.course.code }} · {{ row.source === 'ASSIGNED' ? 'assigned' : 'self-enrolled' }}</p>
          </template>
          <template #cell-due="{ row }"><span :class="row.overdue ? 'font-medium text-danger-fg' : 'text-fg-muted'">{{ row.dueDate ? formatDate(row.dueDate) : '—' }}</span></template>
          <template #cell-status="{ row }"><AppBadge :tone="enrollmentTone[row.status]" dot>{{ ENROLLMENT_STATUS_LABELS[row.status] }}</AppBadge></template>
          <template #cell-expires="{ row }">
            <span class="text-fg-muted">{{ row.expiresOn ? formatDate(row.expiresOn) : '—' }}</span>
            <AppBadge v-if="row.certification" :tone="certificationTone[row.certification]" size="sm" class="ms-2">{{ CERTIFICATION_LABELS[row.certification] }}</AppBadge>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>
  </div>
</template>
