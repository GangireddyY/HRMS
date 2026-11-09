<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { AlertTriangle, CalendarX2, ChevronRight, FileClock, Library, ListChecks, Plus, Users } from '@lucide/vue';
import { COURSE_CATEGORIES, COURSE_STATUSES, type CourseCategory, type CourseStatus } from '@contracts';
import { trainingApi } from '@/modules/training/api/training.api';
import CourseFormModal from '@/modules/training/components/CourseFormModal.vue';
import type { CourseDetail, CourseRow } from '@/modules/training/types';
import { COURSE_VISUALS, DELIVERY_ICON, pct } from '@/modules/training/utils/course-visuals';
import { CATEGORY_LABELS, COURSE_STATUS_LABELS, DELIVERY_LABELS, courseTone, hours, isSessionBasedDelivery } from '@/modules/training/utils/training-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';

/** Course catalogue administration: status summary, what needs attention, and every course with its learner progress. */
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('training.manage'));
const table = useTable((q) => trainingApi.courses({ ...q, manage: canManage.value || undefined }), {
  filters: { category: undefined as CourseCategory | undefined, status: undefined as CourseStatus | undefined },
});
const categoryOptions = COURSE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }));
const statusOptions = COURSE_STATUSES.map((s) => ({ value: s, label: COURSE_STATUS_LABELS[s] }));
const formOpen = ref(false);
async function onSaved(c: CourseDetail) {
  formOpen.value = false;
  feedback.success('Course created', 'Add sessions or questions, then publish it.');
  await router.push(`/hr/training/courses/${c.id}`);
}
const columns = computed<TableColumn<CourseRow>[]>(() => [
  { key: 'title', label: 'Course' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'status', label: 'Status' },
  ...(canManage.value ? [{ key: 'people', label: 'Learners', class: 'w-56' }] : []),
  { key: 'open', label: '', class: 'w-10' },
]);

// ---- Summary (every course in the catalogue, whatever the table shows) ------------------------------------------------
const all = useAsync(() => fetchAllPages((page, pageSize) => trainingApi.courses({ page, pageSize, manage: canManage.value || undefined })));
const courses = computed(() => all.data.value ?? []);
const learners = (c: CourseRow) => (c.enrolled ?? 0) + (c.completed ?? 0);
const completionRate = (c: CourseRow) => pct(c.completed ?? 0, learners(c));
const byStatus = (s: CourseStatus) => courses.value.filter((c) => c.status === s);
const published = computed(() => byStatus('PUBLISHED'));
const totals = computed(() => {
  const active = courses.value.reduce((n, c) => n + (c.enrolled ?? 0), 0);
  const done = courses.value.reduce((n, c) => n + (c.completed ?? 0), 0);
  return { active, done, rate: pct(done, active + done) };
});
const stripItems = computed<StripItem[]>(() =>
  canManage.value
    ? [
        { key: 'PUBLISHED', label: 'Published', value: published.value.length, tone: 'success', hint: `${published.value.filter((c) => c.mandatory).length} mandatory` },
        { key: 'DRAFT', label: 'Drafts', value: byStatus('DRAFT').length, tone: 'neutral', hint: byStatus('DRAFT').length ? 'Not visible to learners yet' : 'Nothing waiting' },
        { key: 'ARCHIVED', label: 'Archived', value: byStatus('ARCHIVED').length, tone: 'warning', hint: 'Out of the catalog' },
        { key: 'learning', label: 'Learning now', value: totals.value.active, tone: 'info', hint: 'Enrolled, not yet completed' },
        { key: 'rate', label: 'Completion rate', value: totals.value.active + totals.value.done ? `${totals.value.rate}%` : '—', tone: 'brand', hint: `${totals.value.done} completion${totals.value.done === 1 ? '' : 's'}` },
      ]
    : [
        { key: 'all', label: 'Courses', value: courses.value.length, tone: 'brand', hint: 'In the catalog' },
        { key: 'mandatory', label: 'Mandatory', value: courses.value.filter((c) => c.mandatory).length, tone: 'violet' },
        { key: 'sessions', label: 'Upcoming sessions', value: courses.value.reduce((n, c) => n + c.upcomingSessions, 0), tone: 'info', hint: 'Classroom and virtual' },
        { key: 'selfpaced', label: 'Self-paced', value: courses.value.filter((c) => c.delivery === 'SELF_PACED').length, tone: 'success', hint: 'Start any time' },
      ],
);
/** Only the status metrics filter the list; the others are figures. */
const selectStrip = (key: string | null) => {
  if (key === null || (COURSE_STATUSES as readonly string[]).includes(key)) table.filters.status = (key ?? undefined) as CourseStatus | undefined;
};

// ---- Needs attention -----------------------------------------------------------------------------------------------
interface Attention {
  id: string;
  course: CourseRow;
  text: string;
  tone: 'danger' | 'warning' | 'info';
  icon: typeof AlertTriangle;
}
const attention = computed<Attention[]>(() => {
  const out: Attention[] = [];
  for (const c of published.value) {
    if (isSessionBasedDelivery(c.delivery) && !c.upcomingSessions) out.push({ id: `s${c.id}`, course: c, text: 'No upcoming session — learners can’t enrol', tone: 'warning', icon: CalendarX2 });
    if (canManage.value && c.mandatory && learners(c) >= 3 && completionRate(c) < 50) out.push({ id: `r${c.id}`, course: c, text: `Mandatory, only ${completionRate(c)}% completed`, tone: 'danger', icon: AlertTriangle });
  }
  for (const c of byStatus('DRAFT')) out.push({ id: `d${c.id}`, course: c, text: c.hasAssessment && !c.questionCount ? 'Draft — add assessment questions, then publish' : 'Draft — publish to open it to learners', tone: 'info', icon: FileClock });
  return out;
});
const attentionTone = { danger: 'bg-danger-soft text-danger-fg', warning: 'bg-warning-soft text-warning-fg', info: 'bg-info-soft text-info-fg' };

// ---- Catalogue mix ---------------------------------------------------------------------------------------------------
const mix = computed(() => {
  const by = new Map<CourseCategory, { courses: number; learners: number; done: number }>();
  for (const c of courses.value.filter((x) => x.status !== 'ARCHIVED')) {
    const m = by.get(c.category) ?? { courses: 0, learners: 0, done: 0 };
    m.courses++;
    m.learners += learners(c);
    m.done += c.completed ?? 0;
    by.set(c.category, m);
  }
  return [...by.entries()].map(([category, m]) => ({ category, ...m })).sort((a, b) => b.courses - a.courses);
});
const mixMax = computed(() => Math.max(1, ...mix.value.map((m) => m.courses)));
const open = (row: CourseRow) => router.push(`/hr/training/courses/${row.id}`);
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Courses" description="The training catalog: self-paced, classroom and live virtual courses, with optional assessments and certificates.">
      <template #actions>
        <AppButton variant="secondary" :icon="Users" to="/hr/training/team">Team training</AppButton>
        <AppButton v-if="canManage" :icon="Plus" @click="formOpen = true">New course</AppButton>
      </template>
    </AppPageHeader>

    <AppStatStrip :items="stripItems" :loading="all.loading.value && !all.data.value" :selectable="canManage" :selected="table.filters.status ?? null" label="Catalog summary" @select="selectStrip" />

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <AppCard :padded="false" class="min-w-0">
        <div :class="['grid gap-3 border-b border-line/70 px-4 py-3', canManage ? 'sm:grid-cols-[1fr_190px_170px]' : 'sm:grid-cols-[1fr_200px]']">
          <AppSearchInput v-model="table.search.value" placeholder="Search title, code or provider" aria-label="Search courses" />
          <AppSelect v-model="table.filters.category" :options="categoryOptions" placeholder="All categories" aria-label="Filter by category" />
          <AppSelect v-if="canManage" v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Courses" empty-title="No courses yet" :empty-description="canManage ? 'Create your first course: self-paced content, a classroom session or a live virtual class.' : 'Courses appear here once HR publishes them.'" @page="table.setPage" @retry="table.load" @row-click="open" :filtered="table.isFiltered.value" @clear="table.clearFilters()">
          <template #empty><AppButton v-if="canManage" :icon="Plus" @click="formOpen = true">New course</AppButton></template>
          <template #cell-title="{ row }">
            <div class="flex min-w-0 items-center gap-3">
              <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', COURSE_VISUALS[row.category].tile]" :title="CATEGORY_LABELS[row.category]" aria-hidden="true">
                <component :is="COURSE_VISUALS[row.category].icon" :size="17" />
              </span>
              <div class="min-w-0">
                <p class="flex flex-wrap items-center gap-1.5 font-medium text-fg">
                  <span class="truncate">{{ row.title }}</span>
                  <AppBadge v-if="row.mandatory" tone="violet" size="sm">Mandatory</AppBadge>
                </p>
                <p class="truncate text-xs text-fg-muted"><span class="font-mono">{{ row.code }}</span> · {{ CATEGORY_LABELS[row.category] }}{{ row.durationHours ? ` · ${hours(row.durationHours)}` : '' }}{{ row.provider ? ` · ${row.provider}` : '' }}</p>
              </div>
            </div>
          </template>
          <template #cell-delivery="{ row }">
            <span class="inline-flex items-center gap-1.5 text-fg"><component :is="DELIVERY_ICON[row.delivery]" :size="14" class="text-fg-muted" aria-hidden="true" />{{ DELIVERY_LABELS[row.delivery] }}</span>
            <p v-if="isSessionBasedDelivery(row.delivery)" :class="['text-xs', !row.upcomingSessions && row.status === 'PUBLISHED' ? 'font-medium text-warning-fg' : 'text-fg-subtle']">
              {{ row.upcomingSessions ? `${row.upcomingSessions} upcoming session${row.upcomingSessions === 1 ? '' : 's'}` : 'No upcoming session' }}
            </p>
            <p v-else class="text-xs text-fg-subtle">{{ row.hasAssessment ? `Assessment · pass ${row.passMark}%` : 'Mark as done' }}</p>
          </template>
          <template #cell-status="{ row }"><AppBadge :tone="courseTone[row.status]" dot>{{ COURSE_STATUS_LABELS[row.status] }}</AppBadge></template>
          <template #cell-people="{ row }">
            <div v-if="learners(row)" class="min-w-36">
              <div class="flex items-baseline justify-between gap-2 text-xs">
                <span class="text-fg-muted"><span class="font-semibold text-fg tabular-nums">{{ row.completed ?? 0 }}</span> of <span class="tabular-nums">{{ learners(row) }}</span> completed</span>
                <span class="font-medium text-fg tabular-nums">{{ completionRate(row) }}%</span>
              </div>
              <div class="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`${completionRate(row)}% completed, ${row.enrolled ?? 0} in progress or not started`">
                <span class="h-full bg-success" :style="{ width: `${completionRate(row)}%` }" />
                <span class="h-full bg-info/45" :style="{ width: `${100 - completionRate(row)}%` }" />
              </div>
            </div>
            <span v-else class="text-xs text-fg-subtle">No learners yet</span>
          </template>
          <template #cell-open><ChevronRight :size="16" class="text-fg-subtle max-md:hidden" aria-hidden="true" /></template>
        </AppDataTable>
      </AppCard>

      <aside class="space-y-4">
        <AppCard title="Needs attention" :icon="ListChecks" :description="attention.length ? `${attention.length} item${attention.length === 1 ? '' : 's'} to look at` : 'Nothing needs you right now'" :padded="false">
          <div v-if="all.loading.value && !all.data.value" class="space-y-3 p-4"><div v-for="i in 3" :key="i" class="skeleton h-9 rounded-lg" /></div>
          <p v-else-if="!attention.length" class="px-4 py-5 text-sm text-fg-muted">Every published course is open for enrolment and no drafts are waiting.</p>
          <ul v-else class="divide-y divide-line/70">
            <li v-for="a in attention.slice(0, 6)" :key="a.id">
              <RouterLink :to="`/hr/training/courses/${a.course.id}`" class="flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-muted/50">
                <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', attentionTone[a.tone]]" aria-hidden="true"><component :is="a.icon" :size="15" /></span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-fg">{{ a.course.title }}</span>
                  <span class="block truncate text-xs text-fg-muted">{{ a.text }}</span>
                </span>
                <ChevronRight :size="15" class="shrink-0 text-fg-subtle" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
        </AppCard>

        <AppCard v-if="mix.length" title="Catalog mix" :icon="Library" description="Active courses by category">
          <ul class="space-y-3">
            <li v-for="m in mix" :key="m.category">
              <div class="mb-1 flex items-center gap-2 text-xs">
                <span :class="['flex h-5 w-5 items-center justify-center rounded', COURSE_VISUALS[m.category].tile]" aria-hidden="true"><component :is="COURSE_VISUALS[m.category].icon" :size="11" /></span>
                <span class="flex-1 font-medium text-fg">{{ CATEGORY_LABELS[m.category] }}</span>
                <span class="text-fg-muted tabular-nums">{{ m.courses }} course{{ m.courses === 1 ? '' : 's' }}<template v-if="canManage"> · {{ m.learners }} learner{{ m.learners === 1 ? '' : 's' }}</template></span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                <div :class="['h-full rounded-full', COURSE_VISUALS[m.category].bar]" :style="{ width: `${(m.courses / mixMax) * 100}%` }" />
              </div>
            </li>
          </ul>
        </AppCard>
      </aside>
    </div>
    <CourseFormModal :open="formOpen" :course="null" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
