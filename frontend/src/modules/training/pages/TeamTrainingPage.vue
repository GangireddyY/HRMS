<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { AlertTriangle, ArrowRight, Award, BookOpen, CalendarClock, CalendarX2, CheckCircle2, ChevronRight, Hourglass, Library, ListTodo } from '@lucide/vue';
import { CERTIFICATION_WARNING_DAYS, ENROLLMENT_STATUSES, type EnrollmentStatus } from '@contracts';
import { trainingApi } from '@/modules/training/api/training.api';
import type { Enrollment } from '@/modules/training/types';
import { COURSE_VISUALS, daysUntil, overdueBy, relativeDay } from '@/modules/training/utils/course-visuals';
import { CERTIFICATION_LABELS, ENROLLMENT_STATUS_LABELS, certificationTone, enrollmentTone } from '@/modules/training/utils/training-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSelect, AppStatStrip, AppTabs, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { formatDate } from '@/shared/utils/format';

/** Training of the people in scope, compliance first: overdue assignments and certifications expiring or expired, then everything. */
const router = useRouter();
type View = 'all' | 'overdue' | 'expiring' | 'expired';
const view = ref<View>('all');
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
  ...(certView.value ? [{ key: 'expires', label: 'Certificate' }] : [{ key: 'due', label: 'Due' }, { key: 'status', label: 'Status' }]),
  { key: 'open', label: '', class: 'w-10' },
]);

// ---- Summary: totals per bucket (page size 1 reads just the count; the attention buckets keep a few rows) -----------------
const summary = useAsync(async () => {
  const team = (q: { status?: EnrollmentStatus; overdue?: boolean; pageSize?: number }) => trainingApi.enrollments({ page: 1, pageSize: q.pageSize ?? 1, view: 'team', status: q.status, overdue: q.overdue });
  const [overdue, expiring, expired, notStarted, inProgress, completed] = await Promise.all([
    team({ overdue: true, pageSize: 5 }),
    trainingApi.certifications({ page: 1, pageSize: 5, state: 'EXPIRING' }),
    trainingApi.certifications({ page: 1, pageSize: 5, state: 'EXPIRED' }),
    team({ status: 'ENROLLED' }),
    team({ status: 'IN_PROGRESS' }),
    team({ status: 'COMPLETED' }),
  ]);
  return { overdue, expiring, expired, notStarted: notStarted.meta.total, inProgress: inProgress.meta.total, completed: completed.meta.total };
});
const s = computed(() => summary.data.value);
const stripItems = computed<StripItem[]>(() => [
  { key: 'overdue', label: 'Overdue', value: s.value?.overdue.meta.total, tone: s.value?.overdue.meta.total ? 'danger' : 'neutral', hint: 'Assigned, past due date' },
  { key: 'expiring', label: 'Expiring', value: s.value?.expiring.meta.total, tone: s.value?.expiring.meta.total ? 'warning' : 'neutral', hint: `Within ${CERTIFICATION_WARNING_DAYS} days` },
  { key: 'expired', label: 'Expired', value: s.value?.expired.meta.total, tone: s.value?.expired.meta.total ? 'danger' : 'neutral', hint: 'Not renewed yet' },
  { key: 'ENROLLED', label: 'Not started', value: s.value?.notStarted, tone: 'neutral' },
  { key: 'IN_PROGRESS', label: 'In progress', value: s.value?.inProgress, tone: 'info' },
  { key: 'COMPLETED', label: 'Completed', value: s.value?.completed, tone: 'success' },
]);
const stripSelected = computed(() => (view.value !== 'all' ? view.value : (table.filters.status ?? null)));
function selectStrip(key: string | null) {
  if (key === 'overdue' || key === 'expiring' || key === 'expired') {
    table.filters.status = undefined;
    view.value = key;
  } else {
    view.value = 'all';
    table.filters.status = (key ?? undefined) as EnrollmentStatus | undefined;
  }
}
const tabs = computed(() => [
  { key: 'all', label: 'All training', icon: BookOpen },
  { key: 'overdue', label: 'Overdue', icon: AlertTriangle, count: s.value?.overdue.meta.total ?? null },
  { key: 'expiring', label: 'Certifications expiring', icon: Hourglass, count: s.value?.expiring.meta.total ?? null },
  { key: 'expired', label: 'Expired', icon: CalendarX2, count: s.value?.expired.meta.total ?? null },
]);

// ---- Needs attention: overdue, then expired, then expiring ------------------------------------------------------------
const attention = computed(() => {
  if (!s.value) return [];
  return [
    ...s.value.overdue.items.map((e) => ({ e, kind: 'overdue' as const, text: e.dueDate ? overdueBy(e.dueDate) : 'Overdue', tone: 'bg-danger-soft text-danger-fg', icon: AlertTriangle })),
    ...s.value.expired.items.map((e) => ({ e, kind: 'expired' as const, text: e.expiresOn ? `Expired ${relativeDay(e.expiresOn)}` : 'Expired', tone: 'bg-danger-soft text-danger-fg', icon: CalendarX2 })),
    ...s.value.expiring.items.map((e) => ({ e, kind: 'expiring' as const, text: e.expiresOn ? `Expires ${relativeDay(e.expiresOn)}` : 'Expiring', tone: 'bg-warning-soft text-warning-fg', icon: Hourglass })),
  ].slice(0, 6);
});
const attentionTotal = computed(() => (s.value ? s.value.overdue.meta.total + s.value.expired.meta.total + s.value.expiring.meta.total : 0));
const showAttention = computed(() => view.value === 'all' && !table.filters.status && !!s.value);

const dueChip = (e: Enrollment) => {
  if (!e.dueDate || e.status === 'COMPLETED' || e.status === 'CANCELLED') return null;
  if (e.overdue) return { text: overdueBy(e.dueDate), tone: 'bg-danger-soft text-danger-fg', icon: AlertTriangle };
  return { text: `Due ${relativeDay(e.dueDate)}`, tone: daysUntil(e.dueDate) <= 7 ? 'bg-warning-soft text-warning-fg' : 'bg-surface-muted text-fg-muted', icon: CalendarClock };
};
const open = (row: Enrollment) => router.push(`/hr/training/enrollments/${row.id}`);
const emptyDescription = computed(() =>
  view.value === 'overdue' ? 'Everyone with a due date is on track.' : certView.value ? `No certifications ${view.value === 'expired' ? 'have lapsed' : `expire in the next ${CERTIFICATION_WARNING_DAYS} days`}.` : 'Assign a course from the catalog to get people started.',
);
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Team training" description="Who is enrolled in what, overdue assignments and certifications that need renewing.">
      <template #actions><AppButton variant="secondary" :icon="Library" to="/hr/training/courses">Courses</AppButton></template>
    </AppPageHeader>

    <AppStatStrip :items="stripItems" :loading="summary.loading.value && !s" selectable :selected="stripSelected" label="Training status — select to filter" @select="selectStrip" />

    <section v-if="showAttention && attention.length" class="card overflow-hidden" aria-labelledby="attention-title">
      <header class="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 bg-danger-soft/30 px-4 py-2.5">
        <div class="flex items-center gap-3">
          <span class="flex h-8 w-8 items-center justify-center rounded-md bg-danger text-white" aria-hidden="true"><ListTodo :size="16" /></span>
          <div>
            <h2 id="attention-title" class="text-sm font-semibold text-fg">Needs attention</h2>
            <p class="text-xs text-fg-muted">{{ attentionTotal }} compliance item{{ attentionTotal === 1 ? '' : 's' }} — overdue training first, then certificates to renew.</p>
          </div>
        </div>
        <div class="flex gap-1">
          <AppButton v-if="s!.overdue.meta.total" size="sm" variant="ghost" :icon-right="ArrowRight" @click="selectStrip('overdue')">All overdue</AppButton>
          <AppButton v-if="s!.expired.meta.total + s!.expiring.meta.total" size="sm" variant="ghost" :icon-right="ArrowRight" @click="selectStrip(s!.expired.meta.total ? 'expired' : 'expiring')">Renewals</AppButton>
        </div>
      </header>
      <ul class="grid gap-px bg-line/70 md:grid-cols-2">
        <li v-for="a in attention" :key="`${a.kind}-${a.e.id}`" class="bg-surface md:last:odd:col-span-2">
          <RouterLink :to="`/hr/training/enrollments/${a.e.id}`" class="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-muted/50">
            <AppAvatar :name="a.e.employee.name" size="sm" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-fg">{{ a.e.employee.name }}</span>
              <span class="block truncate text-xs text-fg-muted">{{ a.e.course.title }}<template v-if="a.e.course.mandatory"> · mandatory</template></span>
            </span>
            <span :class="['inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', a.tone]"><component :is="a.icon" :size="12" aria-hidden="true" />{{ a.text }}</span>
          </RouterLink>
        </li>
      </ul>
    </section>
    <div v-else-if="showAttention && !attentionTotal" class="card flex items-center gap-3 px-4 py-3">
      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-fg" aria-hidden="true"><CheckCircle2 :size="16" /></span>
      <p class="text-sm text-fg"><span class="font-medium">All caught up.</span> <span class="text-fg-muted">Nothing is overdue and no certifications need renewing in the next {{ CERTIFICATION_WARNING_DAYS }} days.</span></p>
    </div>

    <AppTabs v-model="view" :tabs="tabs">
      <AppCard :padded="false">
        <div v-if="view === 'all'" class="flex items-center justify-end gap-2 border-b border-line/70 px-4 py-2">
          <AppSelect size="sm" v-model="table.filters.status" class="w-56" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Team training" :empty-title="view === 'overdue' ? 'Nothing overdue' : certView ? 'No certifications to renew' : 'No training yet'" :empty-description="emptyDescription" @page="table.setPage" @retry="table.load" @row-click="open" :filtered="table.isFiltered.value" @clear="table.clearFilters()">
          <template #empty><AppButton v-if="view === 'all'" size="sm" variant="secondary" :icon="Library" to="/hr/training/courses">Go to courses</AppButton></template>
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
            <div class="flex min-w-0 items-center gap-2.5">
              <span :class="['flex h-7 w-7 shrink-0 items-center justify-center rounded-md max-md:hidden', COURSE_VISUALS[row.course.category].tile]" aria-hidden="true"><component :is="COURSE_VISUALS[row.course.category].icon" :size="14" /></span>
              <div class="min-w-0">
                <p class="flex items-center gap-1.5 text-fg"><span class="truncate">{{ row.course.title }}</span><AppBadge v-if="row.course.mandatory" tone="violet" size="sm">Mandatory</AppBadge></p>
                <p class="truncate text-xs text-fg-muted"><span class="font-mono">{{ row.course.code }}</span> · {{ row.source === 'ASSIGNED' ? 'assigned' : 'self-enrolled' }}</p>
              </div>
            </div>
          </template>
          <template #cell-due="{ row }">
            <template v-if="dueChip(row)">
              <span :class="['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', dueChip(row)!.tone]"><component :is="dueChip(row)!.icon" :size="12" aria-hidden="true" />{{ dueChip(row)!.text }}</span>
              <p class="mt-0.5 text-2xs text-fg-subtle">{{ formatDate(row.dueDate) }}</p>
            </template>
            <span v-else-if="row.completedOn" class="text-xs text-fg-muted">Completed {{ formatDate(row.completedOn) }}</span>
            <span v-else class="text-fg-subtle">{{ row.dueDate ? formatDate(row.dueDate) : '—' }}</span>
          </template>
          <template #cell-status="{ row }"><AppBadge :tone="enrollmentTone[row.status]" dot>{{ ENROLLMENT_STATUS_LABELS[row.status] }}</AppBadge></template>
          <template #cell-expires="{ row }">
            <div class="flex flex-wrap items-center gap-2">
              <AppBadge v-if="row.certification" :tone="certificationTone[row.certification]" size="sm" dot>{{ CERTIFICATION_LABELS[row.certification] }}</AppBadge>
              <span class="text-sm text-fg">{{ row.expiresOn ? formatDate(row.expiresOn) : '—' }}</span>
              <span v-if="row.expiresOn" :class="['text-xs', row.certification === 'EXPIRED' ? 'text-danger-fg' : 'text-warning-fg']">{{ relativeDay(row.expiresOn) }}</span>
            </div>
            <p v-if="row.certificateNumber" class="mt-0.5 flex items-center gap-1 text-2xs text-fg-subtle"><Award :size="11" aria-hidden="true" /><span class="font-mono">{{ row.certificateNumber }}</span></p>
          </template>
          <template #cell-open><ChevronRight :size="16" class="text-fg-subtle max-md:hidden" aria-hidden="true" /></template>
        </AppDataTable>
      </AppCard>
    </AppTabs>
  </div>
</template>
