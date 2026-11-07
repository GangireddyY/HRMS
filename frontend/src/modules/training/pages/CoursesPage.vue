<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Plus } from '@lucide/vue';
import { COURSE_CATEGORIES, COURSE_STATUSES, type CourseCategory, type CourseStatus } from '@contracts';
import { trainingApi } from '@/modules/training/api/training.api';
import CourseFormModal from '@/modules/training/components/CourseFormModal.vue';
import type { CourseDetail, CourseRow } from '@/modules/training/types';
import { CATEGORY_LABELS, COURSE_STATUS_LABELS, DELIVERY_LABELS, courseTone, hours } from '@/modules/training/utils/training-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

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
const columns: TableColumn<CourseRow>[] = [
  { key: 'title', label: 'Course' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'status', label: 'Status' },
  { key: 'people', label: 'Enrolled / completed', align: 'right' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Courses" description="The training catalog: self-paced, classroom and live virtual courses, with optional assessments and certificates.">
      <template v-if="canManage" #actions><AppButton :icon="Plus" @click="formOpen = true">New course</AppButton></template>
    </AppPageHeader>
    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_200px_200px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search title, code or provider" aria-label="Search courses" />
        <AppSelect v-model="table.filters.category" :options="categoryOptions" placeholder="All categories" aria-label="Filter by category" />
        <AppSelect v-if="canManage" v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </div>
      <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Courses" empty-title="No courses yet" @page="table.setPage" @retry="table.load" @row-click="(row) => router.push(`/hr/training/courses/${row.id}`)">
        <template #cell-title="{ row }">
          <p class="font-medium text-fg">{{ row.title }} <AppBadge v-if="row.mandatory" tone="warning" size="sm" class="ms-1">Mandatory</AppBadge></p>
          <p class="text-xs text-fg-muted">{{ row.code }} · {{ CATEGORY_LABELS[row.category] }}{{ row.durationHours ? ` · ${hours(row.durationHours)}` : '' }}</p>
        </template>
        <template #cell-delivery="{ row }">
          <span class="text-fg-muted">{{ DELIVERY_LABELS[row.delivery] }}</span>
          <p v-if="row.delivery !== 'SELF_PACED'" class="text-xs text-fg-subtle">{{ row.upcomingSessions }} upcoming session{{ row.upcomingSessions === 1 ? '' : 's' }}</p>
        </template>
        <template #cell-status="{ row }"><AppBadge :tone="courseTone[row.status]" dot>{{ COURSE_STATUS_LABELS[row.status] }}</AppBadge></template>
        <template #cell-people="{ row }"><span class="tabular-nums text-fg-muted">{{ row.enrolled ?? '—' }} / {{ row.completed ?? '—' }}</span></template>
      </AppDataTable>
    </AppCard>
    <CourseFormModal :open="formOpen" :course="null" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
