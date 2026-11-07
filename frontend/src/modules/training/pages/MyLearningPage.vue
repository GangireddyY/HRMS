<script setup lang="ts">
import { computed } from 'vue';
import { Award, BookOpen, ChevronRight } from '@lucide/vue';
import { trainingApi } from '@/modules/training/api/training.api';
import type { Enrollment } from '@/modules/training/types';
import { CERTIFICATION_LABELS, DELIVERY_LABELS, ENROLLMENT_STATUS_LABELS, certificationTone, enrollmentTone, sessionWhen } from '@/modules/training/utils/training-format';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { formatDate } from '@/shared/utils/format';

const list = useAsync(() => trainingApi.enrollments({ view: 'mine', pageSize: 100 }));
const rows = computed(() => list.data.value?.items ?? []);
const todo = computed(() => rows.value.filter((e) => e.status === 'ENROLLED' || e.status === 'IN_PROGRESS').sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')));
const done = computed(() => rows.value.filter((e) => e.status === 'COMPLETED'));
const other = computed(() => rows.value.filter((e) => e.status === 'FAILED' || e.status === 'NO_SHOW'));
const line = (e: Enrollment) => [DELIVERY_LABELS[e.course.delivery], e.session ? sessionWhen(e.session) : null, e.source === 'ASSIGNED' ? 'assigned to you' : null].filter(Boolean).join(' · ');
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="My learning" description="Courses you're taking, what's due, and your certificates.">
      <template #actions><AppButton variant="secondary" :icon="BookOpen" to="/me/training/catalog">Browse catalog</AppButton></template>
    </AppPageHeader>
    <AppSkeleton v-if="list.loading.value && !list.data.value" :lines="6" />
    <AppErrorState v-else-if="list.error.value" :error="list.error.value" @retry="list.run" />
    <template v-else>
      <AppCard title="To do" :padded="false">
        <AppEmptyState v-if="!todo.length" :icon="BookOpen" title="Nothing to do" description="Courses you enrol in or are assigned appear here." compact />
        <ul v-else class="divide-y divide-line">
          <li v-for="e in todo" :key="e.id">
            <RouterLink :to="`/me/training/enrollments/${e.id}`" class="flex flex-wrap items-center gap-3 px-4 py-4 hover:bg-surface-muted/50">
              <div class="min-w-0 flex-1">
                <p class="font-medium text-fg">{{ e.course.title }}</p>
                <p class="text-xs text-fg-muted">{{ line(e) }}</p>
              </div>
              <span v-if="e.dueDate" class="text-xs" :class="e.overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-fg-muted'">{{ e.overdue ? 'Overdue since' : 'Due' }} {{ formatDate(e.dueDate) }}</span>
              <AppBadge :tone="enrollmentTone[e.status]" dot>{{ ENROLLMENT_STATUS_LABELS[e.status] }}</AppBadge>
              <ChevronRight :size="16" class="text-fg-subtle" aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
      </AppCard>
      <AppCard title="Certificates" :padded="false">
        <AppEmptyState v-if="!done.length" :icon="Award" title="No certificates yet" description="Finish a course to earn one." compact />
        <ul v-else class="divide-y divide-line">
          <li v-for="e in done" :key="e.id">
            <RouterLink :to="`/me/training/enrollments/${e.id}`" class="flex flex-wrap items-center gap-3 px-4 py-4 hover:bg-surface-muted/50">
              <Award :size="18" class="text-brand-500" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <p class="font-medium text-fg">{{ e.course.title }}</p>
                <p class="text-xs text-fg-muted">Completed {{ formatDate(e.completedOn!) }} · {{ e.certificateNumber }}{{ e.expiresOn ? ` · valid until ${formatDate(e.expiresOn)}` : '' }}</p>
              </div>
              <AppBadge v-if="e.certification" :tone="certificationTone[e.certification]" size="sm">{{ CERTIFICATION_LABELS[e.certification] }}</AppBadge>
              <ChevronRight :size="16" class="text-fg-subtle" aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
      </AppCard>
      <AppCard v-if="other.length" title="Not completed" :padded="false">
        <ul class="divide-y divide-line">
          <li v-for="e in other" :key="e.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
            <p class="min-w-0 flex-1 text-fg">{{ e.course.title }}</p>
            <AppBadge :tone="enrollmentTone[e.status]" size="sm">{{ ENROLLMENT_STATUS_LABELS[e.status] }}</AppBadge>
            <AppButton size="sm" variant="ghost" :to="`/me/training/courses/${e.course.id}`">Try again</AppButton>
          </li>
        </ul>
      </AppCard>
    </template>
  </div>
</template>
