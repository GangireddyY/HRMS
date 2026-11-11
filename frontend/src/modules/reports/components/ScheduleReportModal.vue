<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import { REPORT_FREQUENCIES, REPORT_FREQUENCY_LABELS, REPORT_MAX_MONTH_DAY, REPORT_PERIOD_LABELS, REPORT_PERIODS, type ReportFrequency, type ReportPeriod } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { reportsApi, type ReportScheduleView, type SavedReportRow } from '@/modules/reports/api/reports.api';
import { AppAlert, AppButton, AppModal, AppSegmented, AppSelect, AppSwitch } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Create or edit a scheduled email of one of your saved reports. */
const props = defineProps<{ open: boolean; schedule: ReportScheduleView | null; reports: SavedReportRow[]; datedDatasets: string[]; defaultReportId?: string | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const { fieldErrors, formError, handle, reset } = useFormErrors();

const mine = computed(() => props.reports.filter((r) => r.mine).map((r) => ({ value: r.id, label: r.name })));
const form = reactive({ savedReportId: null as string | null, frequency: 'WEEKLY' as ReportFrequency, dayOfWeek: 1, dayOfMonth: 1, hour: 8, format: 'xlsx' as 'csv' | 'xlsx', period: 'PREVIOUS_WEEK' as ReportPeriod, isActive: true });
const recipients = ref<{ userId: string; name: string }[]>([]);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const s = props.schedule;
    Object.assign(form, {
      savedReportId: s?.savedReportId ?? props.defaultReportId ?? mine.value[0]?.value ?? null,
      frequency: s?.frequency ?? 'WEEKLY',
      dayOfWeek: s?.dayOfWeek ?? 1,
      dayOfMonth: s?.dayOfMonth ?? 1,
      hour: s?.hour ?? 8,
      format: s?.format ?? 'xlsx',
      period: s?.period ?? 'PREVIOUS_WEEK',
      isActive: s?.isActive ?? true,
    });
    recipients.value = s ? s.recipients.map((r) => ({ userId: r.userId, name: r.name })) : auth.user ? [{ userId: auth.user.id, name: `${auth.user.firstName} ${auth.user.lastName}`.trim() }] : [];
    void search('');
  },
  { immediate: true },
);

const report = computed(() => props.reports.find((r) => r.id === form.savedReportId) ?? null);
const dated = computed(() => !!report.value && props.datedDatasets.includes(report.value.dataset));
// A sensible period for the frequency, unless the user picked one.
watch(
  () => form.frequency,
  (f) => {
    if (props.schedule) return;
    form.period = f === 'DAILY' ? 'PREVIOUS_DAY' : f === 'WEEKLY' ? 'PREVIOUS_WEEK' : 'PREVIOUS_MONTH';
  },
);

const FREQUENCIES = REPORT_FREQUENCIES.map((f) => ({ value: f, label: REPORT_FREQUENCY_LABELS[f] }));
const PERIODS = REPORT_PERIODS.map((p) => ({ value: p, label: REPORT_PERIOD_LABELS[p] }));
const DAYS = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: d, label: new Date(2024, 0, d).toLocaleDateString([], { weekday: 'long' }) }));
const MONTH_DAYS = Array.from({ length: REPORT_MAX_MONTH_DAY }, (_, i) => ({ value: i + 1, label: `Day ${i + 1}` }));
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' }) }));
const FORMATS = [
  { value: 'xlsx' as const, label: 'Excel' },
  { value: 'csv' as const, label: 'CSV' },
];

const people = ref<{ value: string; label: string; description?: string }[]>([]);
let timer: ReturnType<typeof setTimeout> | undefined;
function search(q: string) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      people.value = (await reportsApi.scheduleRecipients(q)).map((p) => ({ value: p.userId, label: p.name, description: p.email }));
    } catch {
      people.value = [];
    }
  }, 200);
}
const pick = ref<string | null>(null);
watch(pick, (id) => {
  if (!id) return;
  const p = people.value.find((x) => x.value === id);
  if (p && !recipients.value.some((r) => r.userId === id)) recipients.value = [...recipients.value, { userId: id, name: p.label }];
  pick.value = null;
});
const available = computed(() => people.value.filter((p) => !recipients.value.some((r) => r.userId === p.value)));

const saving = ref(false);
async function save() {
  if (!form.savedReportId) return;
  reset();
  saving.value = true;
  try {
    await reportsApi.saveSchedule(
      {
        savedReportId: form.savedReportId,
        frequency: form.frequency,
        dayOfWeek: form.frequency === 'WEEKLY' ? form.dayOfWeek : null,
        dayOfMonth: form.frequency === 'MONTHLY' ? form.dayOfMonth : null,
        hour: form.hour,
        format: form.format,
        period: dated.value ? form.period : 'SAVED',
        recipientIds: recipients.value.map((r) => r.userId),
        isActive: form.isActive,
      },
      props.schedule?.id,
    );
    feedback.success(props.schedule ? 'Schedule updated' : 'Report scheduled');
    emit('saved');
  } catch (e) {
    handle(e, 'Could not save the schedule');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="schedule ? 'Edit scheduled report' : 'Schedule a report'" description="Emailed to each recipient with only the rows their own access allows." size="md" @close="emit('close')">
    <form id="schedule-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppAlert v-if="!mine.length" tone="info">Save a report first; you can schedule reports you saved.</AppAlert>
      <AppSelect v-model="form.savedReportId" label="Report" required :options="mine" :error="fieldErrors.savedReportId" />
      <AppSegmented v-model="form.frequency" :options="FREQUENCIES" label="How often" size="sm" />
      <div class="grid gap-3 sm:grid-cols-2">
        <AppSelect v-if="form.frequency === 'WEEKLY'" v-model="form.dayOfWeek" label="On" :options="DAYS" :error="fieldErrors.dayOfWeek" />
        <AppSelect v-if="form.frequency === 'MONTHLY'" v-model="form.dayOfMonth" label="On" :options="MONTH_DAYS" :error="fieldErrors.dayOfMonth" />
        <AppSelect v-model="form.hour" label="At" :options="HOURS" help="Your organization's time" />
      </div>
      <AppSelect v-if="dated" v-model="form.period" label="Covering" :options="PERIODS" help="Each run covers this period, counted from the day it runs." />
      <AppSegmented v-model="form.format" :options="FORMATS" label="File format" size="sm" />
      <div>
        <AppSelect v-model="pick" label="Recipients" placeholder="Add a member…" :options="available" searchable remote :error="fieldErrors.recipientIds" @search="search" />
        <ul v-if="recipients.length" class="mt-2 flex flex-wrap gap-2" aria-label="Recipients">
          <li v-for="r in recipients" :key="r.userId" class="inline-flex items-center gap-2 rounded-full bg-surface-muted py-1 ps-3 pe-2 text-sm text-fg">
            {{ r.name }}
            <button type="button" class="rounded-full p-0.5 text-fg-subtle hover:bg-surface hover:text-fg" :aria-label="`Remove ${r.name}`" @click="recipients = recipients.filter((x) => x.userId !== r.userId)"><X :size="13" /></button>
          </li>
        </ul>
        <p class="mt-1 text-xs text-fg-muted">Anyone who can't export reports or see this data is skipped.</p>
      </div>
      <AppSwitch v-model="form.isActive" label="Active" description="Paused schedules keep their settings but don't send." />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton form="schedule-form" type="submit" :loading="saving" :disabled="!form.savedReportId || !recipients.length">{{ schedule ? 'Save' : 'Schedule' }}</AppButton>
    </template>
  </AppModal>
</template>
