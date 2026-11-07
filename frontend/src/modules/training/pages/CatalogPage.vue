<script setup lang="ts">
import { COURSE_CATEGORIES, COURSE_DELIVERIES, type CourseCategory, type CourseDelivery } from '@contracts';
import { GraduationCap } from '@lucide/vue';
import { trainingApi } from '@/modules/training/api/training.api';
import { CATEGORY_LABELS, DELIVERY_LABELS, ENROLLMENT_STATUS_LABELS, enrollmentTone, hours } from '@/modules/training/utils/training-format';
import { AppBadge, AppEmptyState, AppErrorState, AppPageHeader, AppPagination, AppSearchInput, AppSelect, AppSkeleton } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';

const table = useTable((q) => trainingApi.courses(q), { pageSize: 12, filters: { category: undefined as CourseCategory | undefined, delivery: undefined as CourseDelivery | undefined } });
const categoryOptions = COURSE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }));
const deliveryOptions = COURSE_DELIVERIES.map((d) => ({ value: d, label: DELIVERY_LABELS[d] }));
</script>

<template>
  <div>
    <AppPageHeader title="Course catalog" description="Courses you can join, and the ones assigned to you." />
    <div class="mb-4 grid gap-3 sm:grid-cols-[1fr_200px_200px]">
      <AppSearchInput v-model="table.search.value" placeholder="Search courses" aria-label="Search courses" />
      <AppSelect v-model="table.filters.category" :options="categoryOptions" placeholder="All categories" aria-label="Filter by category" />
      <AppSelect v-model="table.filters.delivery" :options="deliveryOptions" placeholder="Any format" aria-label="Filter by format" />
    </div>
    <AppSkeleton v-if="table.loading.value && !table.rows.value.length" :lines="6" />
    <AppErrorState v-else-if="table.error.value" :error="table.error.value" @retry="table.load" />
    <AppEmptyState v-else-if="!table.rows.value.length" class="rounded-2xl bg-surface ring-1 ring-line" :icon="GraduationCap" title="No courses found" description="Try another search, or check back later." />
    <template v-else>
      <ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <li v-for="c in table.rows.value" :key="c.id">
          <RouterLink :to="`/me/training/courses/${c.id}`" class="flex h-full flex-col rounded-2xl bg-surface p-4 ring-1 ring-line transition hover:ring-brand-400">
            <div class="mb-2 flex flex-wrap gap-1.5">
              <AppBadge size="sm">{{ CATEGORY_LABELS[c.category] }}</AppBadge>
              <AppBadge v-if="c.mandatory" size="sm" tone="warning">Mandatory</AppBadge>
              <AppBadge v-if="c.myEnrollment" size="sm" :tone="enrollmentTone[c.myEnrollment.status]">{{ ENROLLMENT_STATUS_LABELS[c.myEnrollment.status] }}</AppBadge>
            </div>
            <p class="font-semibold text-fg">{{ c.title }}</p>
            <p class="mt-1 line-clamp-3 flex-1 text-sm text-fg-muted">{{ c.description }}</p>
            <p class="mt-3 text-xs text-fg-subtle">{{ DELIVERY_LABELS[c.delivery] }}{{ c.durationHours ? ` · ${hours(c.durationHours)}` : '' }}{{ c.delivery !== 'SELF_PACED' ? ` · ${c.upcomingSessions} upcoming session${c.upcomingSessions === 1 ? '' : 's'}` : '' }}{{ !c.selfEnrollment ? ' · by assignment' : '' }}</p>
          </RouterLink>
        </li>
      </ul>
      <AppPagination v-if="table.meta.value && table.meta.value.totalPages > 1" class="mt-4" :meta="table.meta.value" @page="table.setPage" />
    </template>
  </div>
</template>
