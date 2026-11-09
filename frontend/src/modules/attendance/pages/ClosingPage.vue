<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { CalendarClock, CircleAlert, CircleCheck, CircleDashed, ChevronLeft, ChevronRight, Clock, FileText, History, Lock, LockOpen, ShieldCheck, Wallet } from '@lucide/vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { AttendancePeriod } from '@/modules/attendance/types';
import { formatMinutes, monthLabel } from '@/modules/attendance/utils/attendance-format';
import { localToday, plural, relativeDay } from '@/modules/attendance/utils/attendance-ops';
import { AppBadge, AppButton, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton, AppStatStrip, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime } from '@/shared/utils/format';

/** Month-end close: check each ended month is ready (no open corrections or overtime), lock it, reopen if needed. */
const feedback = useFeedbackStore();
const year = ref(new Date().getFullYear());
const periods = useAsync(() => attendanceApi.periods(year.value));
watch(year, () => {
  filter.value = null;
  void periods.run();
});
const busy = ref<number | null>(null);
const key = (p: AttendancePeriod) => `${p.year}-${String(p.month).padStart(2, '0')}`;
const label = (p: AttendancePeriod) => monthLabel(key(p));

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

// ---- Readiness ---------------------------------------------------------------------------------------------------
type State = 'closed' | 'ready' | 'blocked' | 'open';
const today = localToday();
const thisMonth = today.slice(0, 7);
const blockers = (p: AttendancePeriod) => p.pendingRegularizations + p.pendingOvertime;
const stateOf = (p: AttendancePeriod): State => (p.closed ? 'closed' : !p.ended ? 'open' : blockers(p) ? 'blocked' : 'ready');
const STATE: Record<State, { label: string; tone: 'success' | 'brand' | 'warning' | 'neutral'; icon: Component; tile: string }> = {
  closed: { label: 'Closed', tone: 'success', icon: Lock, tile: 'bg-success-soft text-success-fg' },
  ready: { label: 'Ready to close', tone: 'brand', icon: CircleCheck, tile: 'bg-accent-soft text-accent-fg' },
  blocked: { label: 'Needs review', tone: 'warning', icon: CircleAlert, tile: 'bg-warning-soft text-warning-fg' },
  open: { label: 'In progress', tone: 'neutral', icon: CircleDashed, tile: 'bg-surface-muted text-fg-muted' },
};
const openLabel = (p: AttendancePeriod) => (key(p) === thisMonth ? 'In progress' : 'Upcoming');
const lastDay = (p: AttendancePeriod) => new Date(Date.UTC(p.year, p.month, 0)).toISOString().slice(0, 10);
const endedAgo = (p: AttendancePeriod) => `Ended ${relativeDay(lastDay(p), today)}`;

const list = computed(() => periods.data.value ?? []);
const counts = computed(() => {
  const c: Record<State, number> = { closed: 0, ready: 0, blocked: 0, open: 0 };
  for (const p of list.value) c[stateOf(p)]++;
  return c;
});
const filter = ref<string | null>(null);
const strip = computed<StripItem[]>(() => [
  { key: 'closed', label: 'Closed', value: counts.value.closed, tone: 'success', hint: 'Locked for payroll' },
  { key: 'ready', label: 'Ready to close', value: counts.value.ready, tone: 'brand', hint: 'Nothing pending' },
  { key: 'blocked', label: 'Needs review', value: counts.value.blocked, tone: 'warning', hint: 'Open requests' },
  { key: 'open', label: 'In progress / upcoming', value: counts.value.open, tone: 'neutral' },
]);
const shown = computed(() => (filter.value ? list.value.filter((p) => stateOf(p) === filter.value) : list.value));

/** The month to close next: the latest one that has ended and is still open. */
const focus = computed(() => [...list.value].reverse().find((p) => p.ended && !p.closed) ?? null);
const earlierOpen = computed(() => (focus.value ? list.value.filter((p) => p.ended && !p.closed && p.month < focus.value!.month).length : 0));
const steps = computed(() => {
  const p = focus.value;
  if (!p) return [];
  return [
    { done: true, title: 'Month has ended', detail: endedAgo(p) },
    {
      done: !p.pendingRegularizations,
      title: 'Corrections reviewed',
      detail: p.pendingRegularizations ? `${plural(p.pendingRegularizations, 'regularization')} still pending` : 'No pending regularizations',
      to: p.pendingRegularizations ? '/hr/attendance/regularizations' : undefined,
    },
    {
      done: !p.pendingOvertime,
      title: 'Overtime decided',
      detail: p.pendingOvertime ? `${plural(p.pendingOvertime, 'overtime entry', 'overtime entries')} to approve or reject` : 'No overtime waiting',
      to: p.pendingOvertime ? '/hr/attendance/regularizations?tab=overtime' : undefined,
    },
  ];
});
const doneSteps = computed(() => steps.value.filter((s) => s.done).length);

const summaryTiles = (p: AttendancePeriod) => {
  const s = p.summary ?? {};
  return [
    { label: 'Present', value: s.present },
    { label: 'Half day', value: s.halfDay },
    { label: 'Late', value: s.late },
    { label: 'Missed', value: s.missedPunch },
  ].filter((t) => t.value !== undefined);
};
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Monthly closing" description="Lock each month's attendance once it is final, so payroll uses stable numbers.">
      <template #actions>
        <div class="flex items-center gap-1 rounded-md bg-surface p-0.5 ring-1 ring-line">
          <AppButton size="sm" variant="ghost" :icon="ChevronLeft" aria-label="Previous year" @click="year--" />
          <span class="w-14 text-center text-sm font-semibold tabular-nums" aria-live="polite">{{ year }}</span>
          <AppButton size="sm" variant="ghost" :icon="ChevronRight" aria-label="Next year" @click="year++" />
        </div>
      </template>
    </AppPageHeader>

    <AppSkeleton v-if="periods.loading.value && !periods.data.value" :lines="8" />
    <AppErrorState v-else-if="periods.error.value" :error="periods.error.value" @retry="periods.run" />
    <template v-else>
      <!-- Next month to close, with its readiness checks -->
      <section v-if="focus" class="card overflow-hidden" aria-labelledby="close-next">
        <div class="grid gap-px bg-line/70 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div class="bg-surface p-5">
            <div class="flex flex-wrap items-start gap-3">
              <span :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', STATE[stateOf(focus)].tile]" aria-hidden="true"><CalendarClock :size="18" /></span>
              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium text-fg-muted">Next to close</p>
                <h2 id="close-next" class="text-lg font-semibold text-fg">{{ label(focus) }}</h2>
              </div>
              <div class="flex items-center gap-3">
                <span class="text-xs text-fg-muted tabular-nums">{{ doneSteps }} of {{ steps.length + 1 }} steps</span>
                <AppButton :icon="Lock" :loading="busy === focus.month" :disabled="blockers(focus) > 0" @click="close(focus)">Close {{ label(focus) }}</AppButton>
              </div>
            </div>
            <ol class="mt-5 grid gap-3 md:grid-cols-4" aria-label="Readiness checks">
              <li v-for="(s, i) in steps" :key="s.title" :class="['relative rounded-lg p-3 ring-1 ring-inset', s.done ? 'bg-success-soft/50 ring-success/20' : 'bg-warning-soft/60 ring-warning/25']">
                <p class="flex items-center gap-2 text-sm font-medium text-fg">
                  <component :is="s.done ? CircleCheck : CircleAlert" :size="16" :class="s.done ? 'text-success-fg' : 'text-warning-fg'" aria-hidden="true" />
                  <span><span class="sr-only">Step {{ i + 1 }}, {{ s.done ? 'done' : 'to do' }}: </span>{{ s.title }}</span>
                </p>
                <p class="mt-1 text-xs text-fg-muted">{{ s.detail }}</p>
                <RouterLink v-if="s.to" :to="s.to" class="mt-2 inline-flex text-xs font-medium text-accent-fg hover:underline">Review now</RouterLink>
              </li>
              <li :class="['rounded-lg p-3 ring-1 ring-inset', blockers(focus) ? 'bg-surface-muted/60 ring-line' : 'bg-accent-soft ring-brand-600/15']">
                <p class="flex items-center gap-2 text-sm font-medium text-fg">
                  <Lock :size="16" :class="blockers(focus) ? 'text-fg-subtle' : 'text-accent-fg'" aria-hidden="true" />
                  <span><span class="sr-only">Step {{ steps.length + 1 }}: </span>Lock the month</span>
                </p>
                <p class="mt-1 text-xs text-fg-muted">{{ blockers(focus) ? 'Available once the checks pass' : 'Everything is in; close it now' }}</p>
              </li>
            </ol>
            <p v-if="earlierOpen" class="mt-3 flex items-center gap-1.5 text-xs text-fg-muted">
              <History :size="13" aria-hidden="true" />{{ plural(earlierOpen, 'earlier month') }} of {{ year }} {{ earlierOpen === 1 ? 'is' : 'are' }} still open.
              <button type="button" class="font-medium text-accent-fg hover:underline" @click="filter = 'ready'">Show ready months</button>
            </p>
          </div>
          <aside class="bg-surface-muted/40 p-5 text-sm">
            <h3 class="font-semibold text-fg">What closing does</h3>
            <ul class="mt-3 space-y-3 text-fg-muted">
              <li class="flex gap-2.5"><Lock :size="15" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />Punches, corrections and regularizations for the month are locked.</li>
              <li class="flex gap-2.5"><Wallet :size="15" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />Payroll uses the final attendance, including approved overtime.</li>
              <li class="flex gap-2.5"><FileText :size="15" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />A summary of the month is kept with the closing.</li>
              <li class="flex gap-2.5"><ShieldCheck :size="15" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />It can be reopened; both actions are in the audit log.</li>
            </ul>
          </aside>
        </div>
      </section>

      <AppStatStrip :label="`${year} by status`" :items="strip" selectable :selected="filter" @select="(k) => (filter = k)" />

      <AppEmptyState v-if="!shown.length" compact :icon="CircleCheck" title="No months here" description="No month of this year is in that state.">
        <AppButton size="sm" variant="secondary" @click="filter = null">Show all months</AppButton>
      </AppEmptyState>
      <ul v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" :aria-label="`Months of ${year}`">
        <li v-for="p in shown" :key="p.month" :class="['card flex flex-col p-4', key(p) === thisMonth && 'ring-2 ring-brand-500/30', focus?.month === p.month && 'ring-2 ring-warning/30']">
          <div class="flex items-start gap-3">
            <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', STATE[stateOf(p)].tile]" aria-hidden="true"><component :is="STATE[stateOf(p)].icon" :size="16" /></span>
            <div class="min-w-0 flex-1">
              <p class="font-semibold text-fg">{{ label(p) }}</p>
              <p class="mt-0.5 truncate text-xs text-fg-muted">
                <template v-if="p.closed">Closed {{ formatDateTime(p.closedAt) }}{{ p.closedBy ? ` by ${p.closedBy}` : '' }}</template>
                <template v-else-if="!p.ended">{{ key(p) === thisMonth ? 'Closes after the month ends' : 'Not started yet' }}</template>
                <template v-else>{{ endedAgo(p) }}</template>
              </p>
            </div>
            <AppBadge :tone="STATE[stateOf(p)].tone" size="sm" dot>{{ stateOf(p) === 'open' ? openLabel(p) : STATE[stateOf(p)].label }}</AppBadge>
          </div>

          <dl v-if="p.closed && p.summary" class="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
            <div v-for="t in summaryTiles(p)" :key="t.label" class="rounded-lg bg-surface-muted p-2">
              <dt class="text-fg-muted">{{ t.label }}</dt>
              <dd class="text-base font-semibold text-fg tabular-nums">{{ t.value }}</dd>
            </div>
          </dl>
          <p v-if="p.closed && p.summary?.overtimeMinutes" class="mt-2 flex items-center gap-1.5 text-xs text-fg-muted"><Clock :size="12" aria-hidden="true" />{{ formatMinutes(p.summary.overtimeMinutes) }} overtime recorded</p>

          <ul v-if="!p.closed && (p.ended || blockers(p))" class="mt-4 space-y-1.5 text-xs">
            <li :class="['flex items-center gap-2', p.pendingRegularizations ? 'font-medium text-warning-fg' : 'text-fg-muted']">
              <component :is="p.pendingRegularizations ? CircleAlert : CircleCheck" :size="13" :class="p.pendingRegularizations ? '' : 'text-success-fg'" aria-hidden="true" />
              <template v-if="p.pendingRegularizations">
                {{ plural(p.pendingRegularizations, 'pending regularization') }} –
                <RouterLink to="/hr/attendance/regularizations" class="underline">review</RouterLink>
              </template>
              <template v-else>Corrections reviewed</template>
            </li>
            <li :class="['flex items-center gap-2', p.pendingOvertime ? 'font-medium text-warning-fg' : 'text-fg-muted']">
              <component :is="p.pendingOvertime ? CircleAlert : CircleCheck" :size="13" :class="p.pendingOvertime ? '' : 'text-success-fg'" aria-hidden="true" />
              <template v-if="p.pendingOvertime">
                {{ p.pendingOvertime }} overtime entr{{ p.pendingOvertime === 1 ? 'y' : 'ies' }} to approve –
                <RouterLink to="/hr/attendance/regularizations?tab=overtime" class="underline">review</RouterLink>
              </template>
              <template v-else>Overtime decided</template>
            </li>
          </ul>

          <div class="mt-auto flex justify-end pt-4">
            <AppButton v-if="p.closed" size="sm" variant="secondary" :icon="LockOpen" :loading="busy === p.month" @click="reopen(p)">Reopen</AppButton>
            <AppButton v-else-if="p.ended" size="sm" :icon="Lock" :loading="busy === p.month" :disabled="p.pendingRegularizations > 0 || p.pendingOvertime > 0" @click="close(p)">Close month</AppButton>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>
