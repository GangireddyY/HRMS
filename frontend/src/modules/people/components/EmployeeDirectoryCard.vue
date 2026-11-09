<script setup lang="ts">
import { computed } from 'vue';
import { Building2, CalendarDays, Hash, Mail, MapPin } from '@lucide/vue';
import type { Employee } from '@/modules/people/types';
import { tenure } from '@/modules/people/utils/dates';
import { employeeSignal } from '@/modules/people/utils/employee-signals';
import { EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, employeeStatusTone } from '@/modules/people/utils/labels';
import { AppAvatar, AppBadge } from '@/shared/components';
import { profileCover } from '@/shared/utils/profile-cover';

/** A people-directory card for the Employees grid: cover, photo, role, placement, lifecycle signal and reporting line. */
const props = defineProps<{ employee: Employee }>();

const signal = computed(() => employeeSignal(props.employee));
const headline = computed(() => props.employee.designation?.name ?? EMPLOYMENT_TYPE_LABELS[props.employee.employmentType]);

const cover = computed(() => profileCover(props.employee.id));
</script>

<template>
  <RouterLink
    :to="`/hr/employees/${employee.id}`"
    class="group card card-interactive flex h-full flex-col overflow-hidden focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:outline-none"
    :aria-label="`${employee.fullName}, ${headline}, ${EMPLOYEE_STATUS_LABELS[employee.status]}`"
  >
    <div :class="['relative h-16 border-b border-line/50', employee.status === 'EXITED' && 'grayscale']" :style="cover" aria-hidden="true">
      <span class="absolute end-2 top-2 rounded-full bg-surface shadow-xs">
        <AppBadge :tone="employeeStatusTone[employee.status]" size="sm" dot>{{ EMPLOYEE_STATUS_LABELS[employee.status] }}</AppBadge>
      </span>
    </div>

    <div class="flex flex-1 flex-col items-center px-4 pb-4 text-center">
      <div class="relative z-10 -mt-10 rounded-full bg-surface p-1 shadow-xs">
        <AppAvatar :name="employee.fullName" :src="employee.avatarUrl" size="2xl" />
      </div>
      <p class="mt-2 w-full truncate text-base font-semibold text-fg group-hover:text-accent-fg group-hover:underline">{{ employee.fullName }}</p>
      <p class="mt-0.5 w-full truncate text-sm text-fg-muted">{{ headline }}</p>
      <div class="mt-2 flex min-h-5 flex-wrap justify-center gap-1">
        <AppBadge v-if="signal" :tone="signal.tone" size="sm">{{ signal.label }}</AppBadge>
        <AppBadge v-else size="sm">{{ EMPLOYMENT_TYPE_LABELS[employee.employmentType] }}</AppBadge>
      </div>

      <ul class="mt-3 w-full space-y-1.5 text-start text-xs text-fg-muted">
        <li class="flex min-w-0 items-center gap-2">
          <Building2 :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
          <span class="truncate">{{ employee.department?.name ?? 'No department' }}</span>
        </li>
        <li class="flex min-w-0 items-center gap-2">
          <MapPin :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
          <span class="truncate">{{ employee.location?.name ?? 'No location' }}</span>
        </li>
        <li class="flex min-w-0 items-center gap-2">
          <Mail :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
          <span class="truncate">{{ employee.workEmail ?? employee.personalEmail ?? 'No email' }}</span>
        </li>
        <li class="flex min-w-0 items-center gap-2">
          <Hash :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
          <span class="truncate font-mono">{{ employee.employeeCode }}</span>
          <span class="ms-auto inline-flex shrink-0 items-center gap-1"><CalendarDays :size="12" aria-hidden="true" />{{ tenure(employee.dateOfJoining) }}</span>
        </li>
      </ul>

      <div class="mt-auto w-full pt-3">
        <div class="flex items-center gap-2 border-t border-line/70 pt-3 text-start text-xs">
          <template v-if="employee.manager">
            <AppAvatar :name="employee.manager.name" size="xs" />
            <span class="min-w-0 truncate text-fg-muted">Reports to <span class="font-medium text-fg">{{ employee.manager.name }}</span></span>
          </template>
          <span v-else class="text-fg-subtle">No manager</span>
        </div>
      </div>
    </div>
  </RouterLink>
</template>
