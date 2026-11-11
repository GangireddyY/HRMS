<script setup lang="ts">
import { ref } from 'vue';
import { CalendarClock, Pencil, Plus, Send, Trash2 } from '@lucide/vue';
import { REPORT_FREQUENCY_LABELS, type ReportRunStatus } from '@contracts';
import { reportsApi, type ReportScheduleView, type SavedReportRow } from '@/modules/reports/api/reports.api';
import ScheduleReportModal from '@/modules/reports/components/ScheduleReportModal.vue';
import { AppBadge, AppButton, AppCard } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime } from '@/shared/utils/format';

/** Your scheduled report emails: when they go next, how the last one went, send now, edit, delete. */
const props = defineProps<{ reports: SavedReportRow[]; datedDatasets: string[]; loadedReportId: string | null }>();
const feedback = useFeedbackStore();
const schedules = useAsync(() => reportsApi.schedules());

const STATUS: Record<ReportRunStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  SENT: { label: 'Sent', tone: 'success' },
  PARTIAL: { label: 'Partly sent', tone: 'warning' },
  FAILED: { label: 'Failed', tone: 'danger' },
  SKIPPED: { label: 'Nobody to send to', tone: 'neutral' },
};
const DAY = (d: number) => new Date(2024, 0, d).toLocaleDateString([], { weekday: 'short' });
const when = (s: ReportScheduleView) => {
  const at = new Date(2000, 0, 1, s.hour).toLocaleTimeString([], { hour: 'numeric' });
  if (s.frequency === 'WEEKLY') return `${DAY(s.dayOfWeek ?? 1)} at ${at}`;
  if (s.frequency === 'MONTHLY') return `Day ${s.dayOfMonth} at ${at}`;
  return `Daily at ${at}`;
};

const open = ref(false);
const editing = ref<ReportScheduleView | null>(null);
function edit(s: ReportScheduleView | null) {
  editing.value = s;
  open.value = true;
}
async function saved() {
  open.value = false;
  await schedules.run();
}
const busy = ref<string | null>(null);
async function sendNow(s: ReportScheduleView) {
  busy.value = s.id;
  try {
    const r = await reportsApi.sendSchedule(s.id);
    if (r.lastStatus === 'SENT') feedback.success(`"${s.reportName}" sent to ${s.recipients.length} recipient${s.recipients.length === 1 ? '' : 's'}`);
    else feedback.warning(STATUS[r.lastStatus ?? 'FAILED'].label, r.lastError ?? undefined);
    await schedules.run();
  } catch (e) {
    feedback.error('Could not send the report', e);
  } finally {
    busy.value = null;
  }
}
async function remove(s: ReportScheduleView) {
  if (!(await feedback.confirm({ title: `Stop emailing "${s.reportName}"?`, message: 'The saved report stays; only this schedule is deleted.', confirmLabel: 'Delete schedule', danger: true }))) return;
  await reportsApi.removeSchedule(s.id);
  await schedules.run();
}
</script>

<template>
  <AppCard title="Scheduled emails" :icon="CalendarClock" :padded="false">
    <template #actions>
      <AppButton size="sm" variant="ghost" :icon="Plus" :disabled="!props.reports.some((r) => r.mine)" @click="edit(null)">Schedule</AppButton>
    </template>
    <p v-if="!schedules.data.value?.length" class="px-4 py-3 text-sm text-fg-muted">Email a saved report every day, week or month.</p>
    <ul v-else class="divide-y divide-line/70">
      <li v-for="s in schedules.data.value" :key="s.id" class="space-y-1 px-3 py-2.5">
        <div class="flex items-center gap-2">
          <p class="min-w-0 flex-1 truncate text-sm font-medium text-fg">{{ s.reportName }}</p>
          <AppBadge v-if="!s.isActive" size="sm" tone="neutral">Paused</AppBadge>
          <AppBadge v-else-if="s.lastStatus" size="sm" :tone="STATUS[s.lastStatus].tone">{{ STATUS[s.lastStatus].label }}</AppBadge>
        </div>
        <p class="text-2xs text-fg-muted">
          {{ REPORT_FREQUENCY_LABELS[s.frequency] }} · {{ when(s) }} · {{ s.format.toUpperCase() }} · {{ s.recipients.length }} recipient{{ s.recipients.length === 1 ? '' : 's' }}
        </p>
        <p v-if="s.isActive && s.nextRunAt" class="text-2xs text-fg-subtle">Next {{ formatDateTime(s.nextRunAt) }}</p>
        <p v-if="s.lastError" class="text-2xs text-warning-fg" :title="s.lastError">{{ s.lastError }}</p>
        <div class="flex justify-end gap-1">
          <AppButton size="xs" variant="ghost" :icon="Send" :loading="busy === s.id" @click="sendNow(s)">Send now</AppButton>
          <AppButton size="xs" variant="ghost" :icon="Pencil" :aria-label="`Edit the schedule for ${s.reportName}`" @click="edit(s)" />
          <AppButton size="xs" variant="ghost" :icon="Trash2" :aria-label="`Delete the schedule for ${s.reportName}`" @click="remove(s)" />
        </div>
      </li>
    </ul>
    <ScheduleReportModal :open="open" :schedule="editing" :reports="reports" :dated-datasets="datedDatasets" :default-report-id="loadedReportId" @close="open = false" @saved="saved" />
  </AppCard>
</template>
