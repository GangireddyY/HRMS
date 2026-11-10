<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCopy, Clock, Fingerprint, History, Send, Undo2, XCircle } from '@lucide/vue';
import { rangeMinutes, weekStartOf } from '@contracts';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import TimesheetEntries, { type EditableEntry } from '@/modules/attendance/components/TimesheetEntries.vue';
import type { TimesheetWeek } from '@/modules/attendance/types';
import { addDays, dateRange } from '@/modules/attendance/utils/attendance-format';
import { MISSED_ACTION_LABELS, TIMESHEET_LABELS, WEEKDAY_NAMES, hoursLabel, shortDate, timesheetTone } from '@/modules/attendance/utils/timesheet-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppErrorState, AppPageHeader, AppSkeleton, AppStatStrip, AppTextarea, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

/** My timesheets: log the week's work per project and day, then submit it to my manager for review. */
const route = useRoute();
const router = useRouter();
const feedback = useFeedbackStore();
const { fieldErrors, formError, handle, reset } = useFormErrors();

const weekParam = computed(() => (typeof route.query.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.week) ? route.query.week : undefined));
const week = useAsync(() => attendanceApi.timesheetWeek(weekParam.value));
const history = useAsync(() => attendanceApi.timesheets({ view: 'mine', pageSize: 8 }));
watch(weekParam, () => void week.run());

let nextKey = 1;
const entries = ref<EditableEntry[]>([]);
const note = ref('');
const savedSnapshot = ref('');
const durationOf = (e: EditableEntry) => (e.start && e.end ? rangeMinutes(e.start, e.end) : e.minutes);
const cleaned = () =>
  entries.value
    .map((e) => ({ day: e.day, project: e.project.trim(), activity: e.activity?.trim() || null, start: e.start, end: e.end, minutes: durationOf(e), note: e.note?.trim() || null }))
    .filter((e) => e.project || e.minutes > 0 || e.start);
const snapshot = () => JSON.stringify({ entries: cleaned(), note: note.value.trim() });
const suggestions = computed(() => {
  const prev = w.value?.previous?.entries ?? [];
  return { projects: prev.map((e) => e.project), activities: prev.map((e) => e.activity ?? '').filter(Boolean) };
});

function load(w: TimesheetWeek) {
  entries.value = (w.timesheet?.entries ?? []).map((e) => ({ key: nextKey++, ...e }));
  note.value = w.timesheet?.note ?? '';
  savedSnapshot.value = snapshot();
  reset();
}
watch(() => week.data.value, (w) => w && load(w), { immediate: true });

const w = computed(() => week.data.value);
const status = computed(() => w.value?.timesheet?.status ?? null);
const editable = computed(() => !!w.value?.canEdit);
const dirty = computed(() => editable.value && snapshot() !== savedSnapshot.value);
const thisWeek = computed(() => (w.value ? weekStartOf(w.value.today) : null));
const isCurrentWeek = computed(() => !!w.value && w.value.weekStart === thisWeek.value);
const overdue = computed(() => !!w.value && w.value.today > w.value.dueDate && status.value !== 'APPROVED' && status.value !== 'SUBMITTED');
const loggedTotal = computed(() => entries.value.reduce((sum, e) => sum + durationOf(e), 0));
const expectedTotal = computed(() => w.value?.days.reduce((a, d) => a + d.expectedMinutes, 0) ?? 0);
const punchedTotal = computed(() => w.value?.days.reduce((a, d) => a + (d.workedMinutes ?? 0), 0) ?? 0);

const strip = computed<StripItem[]>(() => [
  { key: 'logged', label: 'Logged', value: hoursLabel(loggedTotal.value), tone: 'brand', hint: expectedTotal.value ? `of ${hoursLabel(expectedTotal.value)} expected` : undefined },
  { key: 'punched', label: 'Punched in attendance', value: hoursLabel(punchedTotal.value), tone: 'info' },
  { key: 'working', label: 'Working days', value: w.value?.days.filter((d) => d.kind === 'WORKING').length ?? 0, tone: 'neutral', hint: offDaysHint.value },
  { key: 'due', label: overdue.value ? 'Was due' : 'Due by', value: w.value ? shortDate(w.value.dueDate) : '—', tone: overdue.value ? 'danger' : 'warning' },
]);
const offDaysHint = computed(() => {
  const d = w.value?.days ?? [];
  const parts = [
    [d.filter((x) => x.kind === 'HOLIDAY').length, 'holiday'],
    [d.filter((x) => x.kind === 'LEAVE').length, 'leave'],
  ].filter(([n]) => n) as [number, string][];
  return parts.length ? parts.map(([n, what]) => `${n} ${what}${n === 1 || what === 'leave' ? '' : 's'}`).join(' · ') : undefined;
});

async function confirmLeave(): Promise<boolean> {
  if (!dirty.value) return true;
  return feedback.confirm({ title: 'Discard your changes?', message: 'The hours you entered for this week are not saved yet.', confirmLabel: 'Discard', danger: true });
}
async function goToWeek(weekStart: string | undefined) {
  if (!(await confirmLeave())) return;
  savedSnapshot.value = snapshot();
  void router.replace({ query: { ...route.query, week: weekStart } });
}
const shiftWeek = (delta: number) => w.value && goToWeek(addDays(w.value.weekStart, delta * 7));
onBeforeRouteLeave(async (to) => (to.path === route.path ? true : confirmLeave()));

/** Days that can still be filled in: past or today, while employed, with nothing entered yet. */
const openDays = () => (w.value?.days ?? []).map((d, i) => ({ d, i })).filter(({ d, i }) => !d.future && d.kind !== 'NOT_EMPLOYED' && !entries.value.some((e) => e.day === i));

/** Last week's activities on the same weekdays, for days of this week that are still empty. */
function copyLastWeek() {
  const prev = w.value?.previous;
  if (!prev) return;
  const open = new Set(openDays().filter(({ d }) => d.kind === 'WORKING').map(({ i }) => i));
  const added = prev.entries.filter((e) => open.has(e.day)).map((e) => ({ ...e, key: nextKey++, note: null }));
  entries.value = [...entries.value, ...added];
  feedback.info(added.length ? `${added.length} ${added.length === 1 ? 'activity' : 'activities'} copied from the week of ${dateRange(prev.weekStart, addDays(prev.weekStart, 6))}` : 'Nothing to copy', added.length ? 'Check the times before you submit.' : 'Every working day already has activities.');
}
/** One activity per punched day, From–To taken from the punches, under the project used most recently. */
function fillFromPunches() {
  const lastProject = [...entries.value].reverse().find((e) => e.project.trim())?.project ?? w.value?.previous?.entries.at(-1)?.project ?? '';
  const added = openDays()
    .filter(({ d }) => d.checkIn && d.checkOut)
    .map(({ d, i }) => ({ key: nextKey++, day: i, project: lastProject, activity: null, start: d.checkIn, end: d.checkOut, minutes: rangeMinutes(d.checkIn!, d.checkOut!), note: null }));
  entries.value = [...entries.value, ...added];
  feedback.info(added.length ? `${added.length} day${added.length === 1 ? '' : 's'} filled from your punches` : 'Nothing to fill', added.length ? (lastProject ? 'Split them into activities if you worked on more than one thing.' : 'Add the project for each day.') : 'Days with punches already have activities.');
}

const saving = ref<'draft' | 'submit' | 'withdraw' | null>(null);
async function save(submit: boolean) {
  if (!w.value) return;
  reset();
  const rows = cleaned();
  if (rows.some((e) => !e.project)) {
    formError.value = 'Every activity needs a project.';
    return;
  }
  if (rows.some((e) => e.start && !e.end)) {
    formError.value = 'Add the To time for every activity that has a From time.';
    return;
  }
  if (submit && !rows.some((e) => e.minutes > 0)) {
    formError.value = 'Add the time you worked before submitting.';
    return;
  }
  saving.value = submit ? 'submit' : 'draft';
  try {
    const body = { weekStart: w.value.weekStart, entries: rows.map((e) => (e.start && e.end ? e : { ...e, start: null, end: null })), note: note.value.trim() || null };
    week.data.value = submit ? await attendanceApi.submitTimesheet(body) : await attendanceApi.saveTimesheet(body);
    if (submit) feedback.success('Timesheet submitted', 'Your manager has been notified.');
    else feedback.success('Draft saved');
    void history.run();
  } catch (e) {
    handle(e, submit ? 'Could not submit the timesheet' : 'Could not save the timesheet');
  } finally {
    saving.value = null;
  }
}
async function withdraw() {
  const sheet = w.value?.timesheet;
  if (!sheet) return;
  saving.value = 'withdraw';
  try {
    week.data.value = await attendanceApi.withdrawTimesheet(sheet.id);
    feedback.success('Timesheet withdrawn', 'Make your changes and submit it again.');
    void history.run();
  } catch (e) {
    feedback.error('Could not withdraw the timesheet', e);
  } finally {
    saving.value = null;
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Timesheets" description="Log what you worked on each day and submit the week for review. Approved timesheets are used for payroll.">
      <template v-if="w?.rules.required" #badges>
        <AppBadge tone="brand" dot>Required every week</AppBadge>
      </template>
    </AppPageHeader>

    <!-- Week switcher -->
    <div class="card flex flex-wrap items-center gap-3 px-3 py-2.5">
      <div class="flex items-center gap-1">
        <AppButton variant="ghost" size="sm" :icon="ChevronLeft" aria-label="Previous week" @click="shiftWeek(-1)" />
        <AppButton variant="ghost" size="sm" :icon="ChevronRight" aria-label="Next week" :disabled="!w || isCurrentWeek" @click="shiftWeek(1)" />
      </div>
      <div class="min-w-0">
        <p class="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{{ isCurrentWeek ? 'This week' : 'Week' }}</p>
        <p class="text-base font-semibold text-fg">{{ w ? dateRange(w.weekStart, w.weekEnd) : '…' }}</p>
      </div>
      <AppBadge v-if="w" :tone="timesheetTone[status ?? 'MISSING']" dot>{{ status ? TIMESHEET_LABELS[status] : overdue ? 'Missing' : 'Not started' }}</AppBadge>
      <AppButton v-if="w && !isCurrentWeek" class="ms-auto" variant="secondary" size="sm" :icon="CalendarClock" @click="goToWeek(undefined)">This week</AppButton>
    </div>

    <AppSkeleton v-if="week.loading.value && !w" :lines="8" />
    <AppErrorState v-else-if="week.error.value" :error="week.error.value" title="Could not load your timesheet" @retry="week.run" />
    <div v-else-if="w" class="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div class="min-w-0 space-y-4">
        <!-- Where this week stands -->
        <div v-if="status === 'APPROVED'" class="flex items-start gap-3 rounded-xl bg-success-soft px-4 py-3 text-sm text-success-fg ring-1 ring-success/20 ring-inset" role="status">
          <CheckCircle2 :size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p class="font-semibold">Approved{{ w.timesheet?.reviewedBy ? ` by ${w.timesheet.reviewedBy}` : '' }} {{ timeAgo(w.timesheet?.reviewedAt) }}</p>
            <p v-if="w.timesheet?.reviewNote" class="mt-0.5">“{{ w.timesheet.reviewNote }}”</p>
          </div>
        </div>
        <div v-else-if="status === 'SUBMITTED'" class="flex flex-wrap items-start gap-3 rounded-xl bg-info-soft px-4 py-3 text-sm text-info-fg ring-1 ring-info/20 ring-inset" role="status">
          <Clock :size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <p class="font-semibold">Submitted {{ timeAgo(w.timesheet?.submittedAt) }} — waiting for review</p>
            <p class="mt-0.5">Need to change something? Withdraw it, edit and submit again.</p>
          </div>
          <AppButton variant="secondary" size="sm" :icon="Undo2" :loading="saving === 'withdraw'" @click="withdraw">Withdraw</AppButton>
        </div>
        <div v-else-if="status === 'REJECTED'" class="flex items-start gap-3 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg ring-1 ring-warning/25 ring-inset" role="status">
          <XCircle :size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p class="font-semibold">Sent back{{ w.timesheet?.reviewedBy ? ` by ${w.timesheet.reviewedBy}` : '' }}</p>
            <p v-if="w.timesheet?.reviewNote" class="mt-0.5">“{{ w.timesheet.reviewNote }}”</p>
            <p class="mt-0.5">Make the changes and submit it again.</p>
          </div>
        </div>
        <div v-else-if="overdue && w.rules.required" class="flex items-start gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-fg ring-1 ring-danger/20 ring-inset" role="alert">
          <AlertTriangle :size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p class="font-semibold">This timesheet was due on {{ shortDate(w.dueDate) }}</p>
            <p class="mt-0.5">{{ MISSED_ACTION_LABELS[w.rules.missedAction].description }} Submit it as soon as you can.</p>
          </div>
        </div>

        <AppStatStrip :items="strip" label="This week" />

        <AppAlert v-if="formError || fieldErrors.entries">{{ formError || fieldErrors.entries }}</AppAlert>

        <AppCard
          :padded="false"
          :title="editable ? 'Your week' : 'Time logged'"
          :description="editable ? 'Add an activity for each piece of work with its From and To time. Future days are locked.' : undefined"
        >
          <template v-if="editable" #actions>
            <AppButton v-if="w.previous" variant="ghost" size="sm" :icon="ClipboardCopy" @click="copyLastWeek">Copy last week</AppButton>
            <AppButton v-if="w.days.some((d) => d.checkIn && d.checkOut)" variant="ghost" size="sm" :icon="Fingerprint" @click="fillFromPunches">Fill from attendance</AppButton>
          </template>
          <TimesheetEntries v-model:entries="entries" :days="w.days" :readonly="!editable" :today="w.today" :suggestions="suggestions" />
          <div v-if="editable || w.timesheet?.note" class="border-t border-line/60 p-4">
            <AppTextarea v-if="editable" v-model="note" label="Note for your reviewer" placeholder="Optional — anything they should know about this week" :rows="2" :maxlength="500" />
            <p v-else class="text-sm text-fg-muted"><span class="font-medium text-fg">Your note:</span> {{ w.timesheet?.note }}</p>
          </div>
        </AppCard>

        <div v-if="editable" class="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-pop backdrop-blur max-sm:bottom-24 max-sm:gap-2 max-sm:px-2.5 max-sm:py-2">
          <p :class="['me-auto text-sm max-sm:hidden', dirty ? 'font-medium text-warning-fg' : 'text-fg-muted']" aria-live="polite">
            {{ dirty ? 'Unsaved changes' : w.timesheet ? `Saved ${timeAgo(w.timesheet.updatedAt)}` : 'Nothing saved yet' }}
          </p>
          <AppButton class="max-sm:flex-1" variant="secondary" :loading="saving === 'draft'" :disabled="!!saving || !dirty" @click="save(false)">{{ dirty ? 'Save draft' : 'Saved' }}</AppButton>
          <AppButton class="max-sm:flex-1" :icon="Send" :loading="saving === 'submit'" :disabled="!!saving || !loggedTotal" @click="save(true)"><span class="max-sm:hidden">Submit for review</span><span class="sm:hidden">Submit</span></AppButton>
        </div>
      </div>

      <aside class="grid min-w-0 gap-4 md:grid-cols-2 2xl:sticky 2xl:top-4 2xl:grid-cols-1" aria-label="Timesheet rules and history">
        <AppCard title="How it works" :icon="CalendarClock">
          <ul class="space-y-3 text-sm">
            <li class="flex gap-2.5">
              <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
              <span class="text-fg-muted">Weeks run Monday to Sunday. Submit by <span class="font-medium text-fg">{{ WEEKDAY_NAMES[w.rules.dueWeekday] }}</span> of the following week.</span>
            </li>
            <li class="flex gap-2.5">
              <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
              <span class="text-fg-muted">Your manager reviews it. If it’s sent back, fix it and submit again.</span>
            </li>
            <li class="flex gap-2.5">
              <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
              <span v-if="w.rules.required" class="text-fg-muted">
                Timesheets are required. If a week isn’t approved in time: <span class="font-medium text-fg">{{ MISSED_ACTION_LABELS[w.rules.missedAction].label.toLowerCase() }}</span>.
              </span>
              <span v-else class="text-fg-muted">Timesheets aren’t required in your organization yet, but you can keep a record of your work.</span>
            </li>
          </ul>
        </AppCard>

        <AppCard :padded="false" title="Recent weeks" :icon="History">
          <AppSkeleton v-if="history.loading.value && !history.data.value" class="p-4" :lines="4" />
          <p v-else-if="!history.data.value?.items.length" class="px-4 pb-4 text-sm text-fg-muted">Weeks you save or submit show up here.</p>
          <ul v-else class="divide-y divide-line/60 border-t border-line/60">
            <li v-for="h in history.data.value.items" :key="h.id">
              <button
                type="button"
                :class="['flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-surface-muted/60', h.weekStart === w.weekStart && 'bg-accent-soft/50']"
                :aria-current="h.weekStart === w.weekStart ? 'true' : undefined"
                @click="goToWeek(h.weekStart)"
              >
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium text-fg">{{ dateRange(h.weekStart, h.weekEnd) }}</span>
                  <span class="block text-xs text-fg-subtle tabular-nums">{{ hoursLabel(h.totalMinutes) }}</span>
                </span>
                <AppBadge :tone="timesheetTone[h.status]" size="sm" dot>{{ TIMESHEET_LABELS[h.status] }}</AppBadge>
              </button>
            </li>
          </ul>
        </AppCard>
      </aside>
    </div>
  </div>
</template>
