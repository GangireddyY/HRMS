<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import { leaveApi } from '@/modules/leave/api/leave.api';
import type { LeaveCalendar } from '@/modules/leave/types';
import { structureApi } from '@/modules/people/api/people.api';
import { currentMonth, monthLabel, shiftMonth, WEEKDAY_SHORT } from '@/modules/attendance/utils/attendance-format';
import { formatDays, formatLeaveRange, LEAVE_STATUS_LABELS, todayIso } from '@/modules/leave/utils/leave-format';
import { AppAvatar, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSelect, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';

type Entry = LeaveCalendar['entries'][number];

const month = ref(currentMonth());
const departmentId = ref<string | null>(null);
const calendar = useAsync(() => leaveApi.calendar(month.value, departmentId.value ?? undefined));
const departments = useAsync(() => structureApi.departments());
watch([month, departmentId], () => void calendar.run());

const today = todayIso();
const departmentOptions = computed(() => (departments.data.value ?? []).map((d) => ({ value: d.id, label: d.name })));
const holidays = computed(() => new Map((calendar.data.value?.holidays ?? []).filter((h) => !h.isOptional).map((h) => [h.date, h.name])));
const weekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

/** One row per person with leave this month; each day cell shows the leave covering it (if any). */
const rows = computed(() => {
  const byEmployee = new Map<string, { employee: Entry['employee']; entries: Entry[] }>();
  for (const e of calendar.data.value?.entries ?? []) {
    const row = byEmployee.get(e.employee.id) ?? { employee: e.employee, entries: [] };
    row.entries.push(e);
    byEmployee.set(e.employee.id, row);
  }
  return [...byEmployee.values()].sort((a, b) => a.employee.name.localeCompare(b.employee.name));
});
const onDay = (entries: Entry[], date: string) => entries.find((e) => e.startDate <= date && e.endDate >= date);
const half = (e: Entry, date: string) => (e.startDate === e.endDate ? e.startSession !== 'FULL' : (date === e.startDate && e.startSession === 'SECOND_HALF') || (date === e.endDate && e.endSession === 'FIRST_HALF'));
const outToday = computed(() => (calendar.data.value?.entries ?? []).filter((e) => e.status === 'APPROVED' && e.startDate <= today && e.endDate >= today).length);
const types = computed(() => {
  const m = new Map<string, Entry['leaveType']>();
  for (const e of calendar.data.value?.entries ?? []) m.set(e.leaveType.id, e.leaveType);
  return [...m.values()];
});
</script>

<template>
  <div>
    <AppPageHeader title="Team leave calendar" :description="month === currentMonth() ? `${outToday} ${outToday === 1 ? 'person is' : 'people are'} on leave today.` : 'Approved and pending leave in your scope.'">
      <template #actions>
        <AppSelect v-model="departmentId" class="w-56 max-sm:w-full" :options="departmentOptions" placeholder="All departments" aria-label="Filter by department" />
        <div class="flex items-center gap-1">
          <AppButton variant="secondary" :icon="ChevronLeft" aria-label="Previous month" @click="month = shiftMonth(month, -1)" />
          <span class="min-w-36 text-center text-sm font-medium text-fg">{{ monthLabel(month) }}</span>
          <AppButton variant="secondary" :icon="ChevronRight" aria-label="Next month" @click="month = shiftMonth(month, 1)" />
        </div>
      </template>
    </AppPageHeader>

    <AppCard :padded="false">
      <AppSkeleton v-if="calendar.loading.value && !calendar.data.value" class="p-5" :lines="6" />
      <AppErrorState v-else-if="calendar.error.value" :error="calendar.error.value" title="Could not load the calendar" @retry="calendar.run" />
      <AppEmptyState v-else-if="!rows.length" title="No leave this month" description="Approved and pending leave of people in your scope shows here." />
      <div v-else class="overflow-x-auto">
        <table class="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th class="sticky left-0 z-10 min-w-52 border-b border-line bg-surface px-4 py-2 text-left font-medium text-fg-muted">Employee</th>
              <th
                v-for="d in calendar.data.value!.days"
                :key="d"
                class="min-w-8 border-b border-line px-0.5 py-2 text-center font-medium"
                :class="[weekend(d) || holidays.has(d) ? 'bg-surface-muted/70 text-fg-subtle' : 'text-fg-muted', d === today && 'text-brand-600 dark:text-brand-300']"
                :title="holidays.get(d)"
              >
                <span class="block text-[10px] uppercase">{{ WEEKDAY_SHORT[new Date(`${d}T00:00:00Z`).getUTCDay()]!.slice(0, 2) }}</span>
                <span class="tabular-nums">{{ Number(d.slice(8)) }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.employee.id">
              <th scope="row" class="sticky left-0 z-10 border-b border-line bg-surface px-4 py-2 text-left font-normal">
                <span class="flex items-center gap-2.5">
                  <AppAvatar :name="r.employee.name" size="xs" />
                  <span class="min-w-0">
                    <RouterLink :to="`/hr/employees/${r.employee.id}`" class="block truncate text-sm font-medium text-fg hover:underline">{{ r.employee.name }}</RouterLink>
                    <span class="block truncate text-fg-subtle">{{ r.employee.department ?? r.employee.employeeCode }}</span>
                  </span>
                </span>
              </th>
              <td v-for="d in calendar.data.value!.days" :key="d" class="border-b border-line p-0.5" :class="(weekend(d) || holidays.has(d)) && 'bg-surface-muted/70'">
                <template v-for="e in [onDay(r.entries, d)]" :key="d">
                  <div
                    v-if="e"
                    class="h-7 rounded-md"
                    :class="e.status === 'PENDING' && 'opacity-60 [background-image:repeating-linear-gradient(135deg,transparent_0_4px,rgb(255_255_255/0.45)_4px_8px)]'"
                    :style="{ backgroundColor: e.leaveType.color, ...(half(e, d) ? { width: '50%', marginLeft: d === e.endDate && e.endSession === 'FIRST_HALF' ? 0 : 'auto' } : {}) }"
                    :title="`${e.leaveType.name} · ${formatLeaveRange(e)} · ${formatDays(e.days)} · ${LEAVE_STATUS_LABELS[e.status]}`"
                    role="img"
                    :aria-label="`${r.employee.name}: ${e.leaveType.name} ${LEAVE_STATUS_LABELS[e.status].toLowerCase()} on ${d}`"
                  />
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <ul class="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line px-4 py-3 text-xs text-fg-muted" aria-label="Legend">
          <li v-for="t in types" :key="t.id" class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm" :style="{ backgroundColor: t.color }" aria-hidden="true" />{{ t.name }}</li>
          <li class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-fg-subtle opacity-60 [background-image:repeating-linear-gradient(135deg,transparent_0_2px,rgb(255_255_255/0.5)_2px_4px)]" aria-hidden="true" />Pending</li>
          <li class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-surface-muted ring-1 ring-line" aria-hidden="true" />Weekend / holiday</li>
        </ul>
      </div>
    </AppCard>
  </div>
</template>
