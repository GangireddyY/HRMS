<script setup lang="ts">
import { ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, Lock, LockOpen } from '@lucide/vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { AttendancePeriod } from '@/modules/attendance/types';
import { monthLabel } from '@/modules/attendance/utils/attendance-format';
import { AppBadge, AppButton, AppCard, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime } from '@/shared/utils/format';

const feedback = useFeedbackStore();
const year = ref(new Date().getFullYear());
const periods = useAsync(() => attendanceApi.periods(year.value));
watch(year, () => void periods.run());
const busy = ref<number | null>(null);
const label = (p: AttendancePeriod) => monthLabel(`${p.year}-${String(p.month).padStart(2, '0')}`);

async function close(p: AttendancePeriod) {
  if (!(await feedback.confirm({ title: `Close ${label(p)}?`, message: 'Punches, corrections and regularizations for this month will be locked. Payroll can then use the final attendance.', confirmLabel: 'Close month' }))) return;
  await act(p, () => attendanceApi.close(p.year, p.month), `${label(p)} closed`);
}
async function reopen(p: AttendancePeriod) {
  if (!(await feedback.confirm({ title: `Reopen ${label(p)}?`, message: 'Attendance for this month can be changed again. Reopening is recorded in the audit log.', confirmLabel: 'Reopen', danger: true }))) return;
  await act(p, () => attendanceApi.reopen(p.year, p.month), `${label(p)} reopened`);
}
async function act(p: AttendancePeriod, fn: () => Promise<AttendancePeriod>, message: string) {
  busy.value = p.month;
  try {
    await fn();
    feedback.success(message);
    await periods.run();
  } catch (e) {
    feedback.error('Could not update the month', e);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Monthly closing" description="Lock each month's attendance once it is final, so payroll uses stable numbers.">
      <template #actions>
        <div class="flex items-center gap-1">
          <AppButton size="sm" variant="ghost" :icon="ChevronLeft" aria-label="Previous year" @click="year--" />
          <span class="w-14 text-center text-sm font-semibold tabular-nums">{{ year }}</span>
          <AppButton size="sm" variant="ghost" :icon="ChevronRight" aria-label="Next year" @click="year++" />
        </div>
      </template>
    </AppPageHeader>
    <AppSkeleton v-if="periods.loading.value && !periods.data.value" :lines="8" />
    <AppErrorState v-else-if="periods.error.value" :error="periods.error.value" @retry="periods.run" />
    <div v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      <AppCard v-for="p in periods.data.value ?? []" :key="p.month">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="font-semibold text-fg">{{ label(p) }}</p>
            <p class="mt-0.5 text-xs text-fg-muted">
              <template v-if="p.closed">Closed {{ formatDateTime(p.closedAt) }}{{ p.closedBy ? ` by ${p.closedBy}` : '' }}</template>
              <template v-else-if="!p.ended">In progress</template>
              <template v-else>Ready to close</template>
            </p>
          </div>
          <AppBadge :tone="p.closed ? 'success' : p.ended ? 'warning' : 'neutral'" dot>{{ p.closed ? 'Closed' : p.ended ? 'Open' : 'Current / future' }}</AppBadge>
        </div>
        <dl v-if="p.summary" class="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div class="rounded-lg bg-surface-muted p-2"><dt class="text-fg-muted">Present</dt><dd class="text-base font-semibold text-fg">{{ p.summary.present }}</dd></div>
          <div class="rounded-lg bg-surface-muted p-2"><dt class="text-fg-muted">Half day</dt><dd class="text-base font-semibold text-fg">{{ p.summary.halfDay }}</dd></div>
          <div class="rounded-lg bg-surface-muted p-2"><dt class="text-fg-muted">Late</dt><dd class="text-base font-semibold text-fg">{{ p.summary.late }}</dd></div>
        </dl>
        <p v-if="p.pendingRegularizations" class="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300">
          {{ p.pendingRegularizations }} pending regularization{{ p.pendingRegularizations === 1 ? '' : 's' }} –
          <RouterLink to="/hr/attendance/regularizations" class="underline">review</RouterLink>
        </p>
        <div class="mt-4 flex justify-end">
          <AppButton v-if="p.closed" size="sm" variant="secondary" :icon="LockOpen" :loading="busy === p.month" @click="reopen(p)">Reopen</AppButton>
          <AppButton v-else-if="p.ended" size="sm" :icon="Lock" :loading="busy === p.month" :disabled="p.pendingRegularizations > 0" @click="close(p)">Close month</AppButton>
        </div>
      </AppCard>
    </div>
  </div>
</template>
