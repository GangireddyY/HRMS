<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  ArrowRight,
  Briefcase,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Hourglass,
  LayoutDashboard,
  MessageSquare,
  Quote,
  RotateCcw,
  UserCheck,
  Wallet,
  XCircle,
} from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import { exitApi } from '@/modules/exit/api/exit.api';
import ClearanceList from '@/modules/exit/components/ClearanceList.vue';
import ExitLettersPanel from '@/modules/exit/components/ExitLettersPanel.vue';
import SettlementPanel from '@/modules/exit/components/SettlementPanel.vue';
import type { ExitDetail } from '@/modules/exit/types';
import { DEPARTMENT_LABELS, REASON_LABELS, SETTLEMENT_LABELS, STATUS_LABELS, TYPE_LABELS, daysUntil, exitSteps, inr, localIso, relativeDays, serviceLabel, settlementTone, statusTone } from '@/modules/exit/utils/exit-format';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { AppAlert, AppApprovalProgress, AppAvatar, AppBadge, AppButton, AppCard, AppCheckbox, AppDatePicker, AppErrorState, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppTabs, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** One exit for HR, the manager, clearance teams and payroll: notice, clearance, settlement and letters. */
const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const detail = useAsync(() => exitApi.get(id.value));
watch(id, () => void detail.run());
const e = computed(() => detail.data.value);
const set = (next: ExitDetail) => (detail.data.value = next);
const tab = ref('overview');
const tabs = computed(() => [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  ...(e.value?.clearanceItems.length ? [{ key: 'clearance', label: 'Clearance', icon: ClipboardCheck, count: e.value.clearance.total - e.value.clearance.done || null }] : []),
  ...(e.value?.permissions.settle ? [{ key: 'settlement', label: 'Full & final', icon: Wallet }] : []),
  ...(e.value?.permissions.letters ? [{ key: 'letters', label: 'Letters', icon: FileText }] : []),
]);

const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<ExitDetail>, success: string) {
  busy.value = key;
  try {
    set(await fn());
    feedback.success(success);
    return true;
  } catch (err) {
    feedback.error('Could not complete the action', err);
    return false;
  } finally {
    busy.value = null;
  }
}

// Accepting / changing the last working day.
const dayModal = ref<'approve' | 'edit' | null>(null);
const dayForm = reactive({ lastWorkingDay: undefined as string | undefined, waiveNotice: false, note: '' });
function openDay(kind: 'approve' | 'edit') {
  const x = e.value!;
  Object.assign(dayForm, { lastWorkingDay: x.lastWorkingDay ?? x.requestedLastDay ?? x.noticeEndsOn, waiveNotice: x.noticeWaived, note: '' });
  dayModal.value = kind;
}
const shortfall = computed(() => {
  if (!e.value || !dayForm.lastWorkingDay || dayForm.waiveNotice) return 0;
  return Math.max(0, Math.round((Date.parse(e.value.noticeEndsOn) - Date.parse(dayForm.lastWorkingDay)) / 86_400_000));
});
async function saveDay() {
  const ok =
    dayModal.value === 'approve'
      ? await act('day', () => exitApi.approve(id.value, { lastWorkingDay: dayForm.lastWorkingDay!, waiveNotice: dayForm.waiveNotice, note: dayForm.note || null }), 'Resignation accepted')
      : await act('day', () => exitApi.update(id.value, { lastWorkingDay: dayForm.lastWorkingDay!, waiveNotice: dayForm.waiveNotice }), 'Last working day updated');
  if (ok) dayModal.value = null;
}
async function complete() {
  if (!(await feedback.confirm({ title: `Complete ${e.value?.employee?.name}'s exit?`, message: 'Their status becomes Exited from the last working day.', confirmLabel: 'Complete exit' }))) return;
  await act('complete', () => exitApi.complete(id.value), 'Exit completed');
}
const cancelling = ref(false);
const cancelReason = ref('');
async function cancel() {
  if (await act('cancel', () => exitApi.cancel(id.value, cancelReason.value), 'Exit cancelled')) cancelling.value = false;
}
const rehireOptions = [
  { value: 'yes', label: 'Eligible for rehire' },
  { value: 'no', label: 'Not eligible for rehire' },
];
const rehire = computed({
  get: () => (e.value?.eligibleForRehire === true ? 'yes' : e.value?.eligibleForRehire === false ? 'no' : null),
  set: (v: string | null) => void act('rehire', () => exitApi.update(id.value, { eligibleForRehire: v === null ? null : v === 'yes' }), 'Saved'),
});

// ---- Summary ---------------------------------------------------------------------------------------------------
const today = localIso(new Date());
const closed = computed(() => e.value?.status === 'WITHDRAWN' || e.value?.status === 'CANCELLED');
const resignation = computed(() => e.value?.type === 'RESIGNATION');
const lastDayIso = computed(() => e.value?.lastWorkingDay ?? e.value?.requestedLastDay ?? e.value?.noticeEndsOn ?? null);
const lastDayTile = computed(() => {
  if (!lastDayIso.value) return null;
  const dt = new Date(`${lastDayIso.value.slice(0, 10)}T00:00:00`);
  return {
    label: e.value?.lastWorkingDay ? 'Last day' : e.value?.requestedLastDay ? 'Asked for' : 'Notice ends',
    day: dt.getDate(),
    month: dt.toLocaleDateString(appLocale(), { month: 'short', year: 'numeric' }),
    weekday: dt.toLocaleDateString(appLocale(), { weekday: 'long' }),
  };
});
const countdown = computed(() => {
  const x = e.value;
  if (!x || closed.value || !lastDayIso.value) return null;
  const d = daysUntil(lastDayIso.value);
  if (x.status === 'COMPLETED') return { text: `Left ${relativeDays(lastDayIso.value)}`, tone: 'text-fg-muted' };
  if (!x.lastWorkingDay) return { text: `Last day to be confirmed`, tone: 'text-warning-fg' };
  if (d < 0) return { text: `Last day was ${-d} day${d === -1 ? '' : 's'} ago`, tone: 'text-danger-fg' };
  if (d === 0) return { text: 'Last working day is today', tone: 'text-warning-fg' };
  return { text: `${d} day${d === 1 ? '' : 's'} to go`, tone: d <= 14 ? 'text-warning-fg' : 'text-info-fg' };
});
/** Share of the notice already served (submission to last day). */
const noticeServed = computed(() => {
  const x = e.value;
  if (!x?.lastWorkingDay) return null;
  const total = Date.parse(x.lastWorkingDay) - Date.parse(x.submittedOn);
  return total > 0 ? Math.min(1, Math.max(0, (Date.parse(today) - Date.parse(x.submittedOn)) / total)) : 1;
});
const facts = computed(() => {
  const x = e.value!;
  const shortfallNote = x.type === 'RESIGNATION' ? 'May be recovered' : 'Paid in lieu';
  return [
    { label: resignation.value ? 'Resigned on' : 'Notice given on', value: formatDate(x.submittedOn), sub: relativeDays(x.submittedOn).replace(/^./, (c) => c.toUpperCase()), icon: CalendarDays },
    { label: 'Notice period', value: `${x.noticeDays} days`, sub: `Ends ${formatDate(x.noticeEndsOn)}`, icon: Hourglass },
    {
      label: 'Notice not served',
      value: x.noticeWaived ? 'Waived' : x.shortfallDays ? `${x.shortfallDays} days` : 'None',
      sub: x.noticeWaived ? 'No recovery' : x.shortfallDays ? shortfallNote : 'Full notice served',
      icon: CalendarClock,
      warn: !x.noticeWaived && x.shortfallDays > 0,
    },
    { label: 'Service', value: `${x.service.years}y ${x.service.months}m`, sub: serviceLabel(x.service), icon: Briefcase },
  ];
});
const steps = computed(() => {
  const x = e.value;
  if (!x) return [];
  const detailFor: Record<string, string> = {
    submitted: formatDate(x.submittedOn),
    accepted: x.decidedAt ? formatDate(x.decidedAt) : x.status === 'SUBMITTED' ? 'Waiting' : '—',
    clearance: x.clearance.total ? `${x.clearance.done} of ${x.clearance.total} signed off` : 'Starts once accepted',
    settlement: x.settlement ? `${SETTLEMENT_LABELS[x.settlement.status]} · ${inr(x.settlement.netPayable)}` : 'Not worked out',
    exited: x.completedAt ? formatDate(x.completedAt) : x.lastWorkingDay ? `From ${formatDate(x.lastWorkingDay)}` : 'After the last day',
  };
  return exitSteps(x).map((s) => ({ ...s, detail: detailFor[s.key]! }));
});
const keyDates = computed(() => {
  const x = e.value!;
  return [
    { label: resignation.value ? 'Resigned' : 'Notice given', date: x.submittedOn, done: true },
    { label: resignation.value ? 'Resignation accepted' : 'Exit confirmed', date: x.decidedAt, done: !!x.decidedAt },
    // Once someone has left early, the end of their notice is no longer a date to watch.
    { label: 'Notice period ends', date: x.status === 'COMPLETED' && x.lastWorkingDay && x.lastWorkingDay < x.noticeEndsOn ? null : x.noticeEndsOn, done: x.noticeEndsOn <= today },
    { label: 'Last working day', date: x.lastWorkingDay, done: !!x.lastWorkingDay && x.lastWorkingDay < today },
    { label: 'Settlement due by', date: x.settlement && x.settlement.status !== 'PAID' ? x.settlement.dueOn : null, done: false },
    { label: 'Exit completed', date: x.completedAt, done: !!x.completedAt },
    { label: STATUS_LABELS[x.status], date: closed.value ? x.closedAt : null, done: true },
  ].filter((k) => k.date);
});
const pendingClearance = computed(() => e.value?.clearanceItems.filter((i) => i.status === 'PENDING') ?? []);
const clearancePct = computed(() => (e.value?.clearance.total ? Math.round((e.value.clearance.done / e.value.clearance.total) * 100) : 0));
</script>

<template>
  <div>
    <AppSkeleton v-if="detail.loading.value && !e" :lines="8" />
    <AppErrorState v-else-if="detail.error.value" :error="detail.error.value" @retry="detail.run" />
    <template v-else-if="e">
      <AppPageHeader :title="e.employee?.name ?? 'Exit'" :description="[e.employee?.designation, e.employee?.department, e.employee?.employeeCode].filter(Boolean).join(' · ')" back="/hr/exits" back-label="Exits">
        <template #leading><AppAvatar :name="e.employee?.name ?? '?'" size="xl" /></template>
        <template #badges>
          <AppBadge :tone="statusTone[e.status]" dot>{{ STATUS_LABELS[e.status] }}</AppBadge>
          <AppBadge>{{ TYPE_LABELS[e.type] }}</AppBadge>
        </template>
        <template #actions>
          <AppButton v-if="e.permissions.cancel" variant="ghost" :icon="XCircle" @click="cancelling = true">Cancel exit</AppButton>
          <AppButton v-if="e.permissions.manage && e.status === 'APPROVED'" variant="secondary" :icon="CalendarClock" @click="openDay('edit')">Change last day</AppButton>
          <AppButton v-if="e.permissions.approve" :icon="UserCheck" @click="openDay('approve')">Accept resignation</AppButton>
          <AppButton v-if="e.permissions.manage && e.status === 'APPROVED'" :icon="CheckCircle2" :disabled="!e.permissions.complete" :loading="busy === 'complete'" @click="complete">Complete exit</AppButton>
        </template>
      </AppPageHeader>

      <!-- Summary: last day, key facts and the workflow -->
      <section class="card mb-4 overflow-hidden" aria-label="Exit summary">
        <div class="flex flex-wrap items-stretch">
          <div v-if="lastDayTile" class="flex items-center gap-4 border-line/70 px-5 py-4 max-lg:w-full max-lg:border-b lg:border-e">
            <div :class="['flex w-20 shrink-0 flex-col items-center overflow-hidden rounded-xl ring-1 ring-inset', closed ? 'ring-line' : 'ring-brand-500/25']">
              <span :class="['w-full py-0.5 text-center text-2xs font-semibold tracking-wide uppercase', closed ? 'bg-surface-muted text-fg-muted' : 'bg-brand-600 text-white']">{{ lastDayTile.label }}</span>
              <span class="pt-1 text-3xl leading-9 font-semibold text-fg tabular-nums">{{ lastDayTile.day }}</span>
              <span class="pb-1.5 text-2xs text-fg-muted">{{ lastDayTile.month }}</span>
            </div>
            <div class="min-w-0">
              <p class="text-sm text-fg-muted">{{ lastDayTile.weekday }}</p>
              <p v-if="countdown" :class="['text-lg font-semibold tabular-nums', countdown.tone]">{{ countdown.text }}</p>
              <p v-else class="text-lg font-semibold text-fg-muted">{{ STATUS_LABELS[e.status] }}</p>
              <div v-if="e.status === 'APPROVED' && noticeServed !== null" class="mt-1.5 w-44">
                <div class="mb-0.5 flex justify-between text-2xs text-fg-muted"><span>Notice served</span><span class="tabular-nums">{{ Math.round(noticeServed * 100) }}%</span></div>
                <div class="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="Math.round(noticeServed * 100)" aria-valuemin="0" aria-valuemax="100" aria-label="Notice served">
                  <div class="h-full rounded-full bg-info" :style="{ width: `${noticeServed * 100}%` }" />
                </div>
              </div>
            </div>
          </div>
          <dl class="grid flex-1 grid-cols-2 gap-px bg-line/60 xl:grid-cols-4">
            <div v-for="f in facts" :key="f.label" class="flex items-center gap-3 bg-surface px-4 py-3.5">
              <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', f.warn ? 'bg-warning-soft text-warning-fg' : 'bg-surface-muted text-fg-muted']" aria-hidden="true"><component :is="f.icon" :size="16" /></span>
              <div class="min-w-0">
                <dt class="text-xs text-fg-muted">{{ f.label }}</dt>
                <dd :class="['text-sm font-semibold tabular-nums', f.warn ? 'text-warning-fg' : 'text-fg']">{{ f.value }}</dd>
                <dd class="truncate text-2xs text-fg-muted" :title="f.sub">{{ f.sub }}</dd>
              </div>
            </div>
          </dl>
        </div>
        <nav v-if="!closed" class="border-t border-line/70 px-4 py-3" aria-label="Exit process">
          <ol class="flex flex-wrap items-center gap-2">
            <template v-for="(s, i) in steps" :key="s.key">
              <li :class="['flex items-center gap-2.5 rounded-lg px-2.5 py-1.5', s.state === 'current' && 'bg-accent-soft/60 ring-1 ring-brand-500/25 ring-inset']" :aria-current="s.state === 'current' ? 'step' : undefined">
                <span
                  :class="[
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    s.state === 'done' ? 'bg-success text-white' : s.state === 'current' ? 'bg-brand-600 text-white' : 'bg-surface-muted text-fg-muted ring-1 ring-line ring-inset',
                  ]"
                  aria-hidden="true"
                >
                  <Check v-if="s.state === 'done'" :size="14" :stroke-width="3" />
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <span>
                  <span class="block text-sm font-medium text-fg">{{ s.label }}<span class="sr-only"> ({{ s.state === 'done' ? 'done' : s.state === 'current' ? 'in progress' : 'not started' }})</span></span>
                  <span class="block text-2xs text-fg-muted tabular-nums">{{ s.detail }}</span>
                </span>
              </li>
              <li v-if="i < steps.length - 1" :class="['hidden h-px w-6 sm:block lg:w-10', s.state === 'done' ? 'bg-success/50' : 'bg-line']" aria-hidden="true" />
            </template>
          </ol>
        </nav>
      </section>

      <AppAlert v-if="e.permissions.completeBlocker" tone="info" class="mb-4">{{ e.permissions.completeBlocker }}.</AppAlert>
      <AppAlert v-if="e.status === 'CANCELLED' || e.status === 'WITHDRAWN'" tone="info" class="mb-4">{{ STATUS_LABELS[e.status] }}{{ e.closedAt ? ` on ${formatDate(e.closedAt)}` : '' }}{{ e.closedReason ? `: ${e.closedReason}` : '' }}</AppAlert>

      <AppTabs v-model="tab" :tabs="tabs">
        <div v-if="tab === 'overview'" class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div class="min-w-0 space-y-4">
            <AppCard title="Separation" :icon="Briefcase">
              <div class="flex flex-wrap items-center gap-2">
                <AppBadge tone="neutral">{{ TYPE_LABELS[e.type] }}</AppBadge>
                <AppBadge tone="violet">{{ REASON_LABELS[e.reason] }}</AppBadge>
                <span v-if="e.requestedLastDay && !e.lastWorkingDay" class="text-xs text-fg-muted">Asked for {{ formatDate(e.requestedLastDay) }} as the last day</span>
              </div>
              <blockquote v-if="e.reasonDetail" class="mt-3 flex gap-2 rounded-lg bg-surface-muted/60 px-3 py-2.5 text-sm whitespace-pre-line text-fg">
                <Quote :size="14" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" /><span>{{ e.reasonDetail }}</span>
              </blockquote>
              <ul v-if="e.decidedBy || e.completedBy" class="mt-4 space-y-3 border-t border-line/70 pt-3 text-sm">
                <li v-if="e.decidedBy" class="flex items-start gap-3">
                  <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-fg" aria-hidden="true"><UserCheck :size="14" /></span>
                  <div class="min-w-0">
                    <p class="text-fg"><span class="font-medium">{{ resignation ? 'Accepted' : 'Confirmed' }}</span> by {{ e.decidedBy }}<span v-if="e.decidedAt" class="text-fg-muted"> · {{ formatDate(e.decidedAt) }}</span></p>
                    <p v-if="e.decisionNote" class="text-xs text-fg-muted">“{{ e.decisionNote }}”</p>
                  </div>
                </li>
                <li v-if="e.completedBy" class="flex items-start gap-3">
                  <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-fg-muted" aria-hidden="true"><CheckCircle2 :size="14" /></span>
                  <p class="text-fg"><span class="font-medium">Exit completed</span> by {{ e.completedBy }}<span v-if="e.completedAt" class="text-fg-muted"> · {{ formatDate(e.completedAt) }}</span></p>
                </li>
              </ul>
            </AppCard>

            <div class="grid gap-4 md:grid-cols-2">
              <AppCard title="Clearance" :icon="ClipboardCheck" fill>
                <template v-if="e.clearance.total">
                  <div class="mb-1 flex items-baseline justify-between text-xs text-fg-muted">
                    <span>{{ pendingClearance.length ? `${pendingClearance.length} pending` : 'All signed off' }}</span>
                    <span class="font-medium text-fg tabular-nums">{{ e.clearance.done }} of {{ e.clearance.total }}</span>
                  </div>
                  <div class="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="clearancePct" aria-valuemin="0" aria-valuemax="100" aria-label="Clearance progress">
                    <div :class="['h-full rounded-full', pendingClearance.length ? 'bg-brand-500' : 'bg-success']" :style="{ width: `${clearancePct}%` }" />
                  </div>
                  <ul v-if="pendingClearance.length" class="mt-3 space-y-1.5 text-sm">
                    <li v-for="i in pendingClearance.slice(0, 4)" :key="i.id" class="flex items-center gap-2">
                      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
                      <span class="min-w-0 flex-1 truncate text-fg">{{ i.title }}</span>
                      <span class="text-xs text-fg-muted">{{ DEPARTMENT_LABELS[i.department] }}</span>
                    </li>
                    <li v-if="pendingClearance.length > 4" class="text-xs text-fg-muted">and {{ pendingClearance.length - 4 }} more</li>
                  </ul>
                  <div class="mt-auto pt-3"><AppButton size="sm" variant="link" :icon-right="ArrowRight" @click="tab = 'clearance'">Open clearance</AppButton></div>
                </template>
                <p v-else class="text-sm text-fg-muted">Clearance starts when the exit is confirmed.</p>
              </AppCard>

              <AppCard title="Full & final" :icon="Wallet" fill>
                <template v-if="e.settlement">
                  <div class="flex items-center justify-between gap-2">
                    <AppBadge :tone="e.settlement.overdue ? 'danger' : settlementTone[e.settlement.status]" dot>{{ SETTLEMENT_LABELS[e.settlement.status] }}{{ e.settlement.overdue ? ' · overdue' : '' }}</AppBadge>
                    <span class="text-xs text-fg-muted">{{ e.settlement.status === 'PAID' ? 'Paid' : `Due ${formatDate(e.settlement.dueOn)}` }}</span>
                  </div>
                  <p class="mt-3 text-xs text-fg-muted">Net payable</p>
                  <p class="text-2xl font-semibold tracking-tight text-fg tabular-nums">{{ inr(e.settlement.netPayable) }}</p>
                </template>
                <p v-else class="text-sm text-fg-muted">{{ e.status === 'APPROVED' || e.status === 'COMPLETED' ? 'Not worked out yet. Payroll calculates it from the last working day.' : 'Worked out once the exit is accepted.' }}</p>
                <div v-if="e.permissions.settle" class="mt-auto pt-3"><AppButton size="sm" variant="link" :icon-right="ArrowRight" @click="tab = 'settlement'">Open settlement</AppButton></div>
              </AppCard>
            </div>
          </div>

          <aside class="space-y-4">
            <AppCard v-if="e.employee" title="Employee">
              <div class="flex items-center gap-3">
                <AppAvatar :name="e.employee.name" size="lg" />
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold text-fg">{{ e.employee.name }}</p>
                  <p class="truncate text-xs text-fg-muted">{{ [e.employee.designation, e.employee.department].filter(Boolean).join(' · ') }}</p>
                </div>
              </div>
              <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt class="text-2xs font-medium text-fg-muted">Employee code</dt><dd class="text-fg">{{ e.employee.employeeCode }}</dd></div>
                <div><dt class="text-2xs font-medium text-fg-muted">Type</dt><dd class="text-fg">{{ EMPLOYMENT_TYPE_LABELS[e.employee.employmentType] }}</dd></div>
                <div><dt class="text-2xs font-medium text-fg-muted">Joined</dt><dd class="text-fg tabular-nums">{{ formatDate(e.employee.dateOfJoining) }}</dd></div>
                <div><dt class="text-2xs font-medium text-fg-muted">Service</dt><dd class="text-fg">{{ e.service.years }}y {{ e.service.months }}m</dd></div>
              </dl>
              <template v-if="e.permissions.manage" #footer>
                <AppButton block size="sm" variant="secondary" :icon="ExternalLink" :to="`/hr/employees/${e.employee.id}`">Open employee record</AppButton>
              </template>
            </AppCard>

            <AppCard v-if="e.chain" title="Acceptance">
              <AppApprovalProgress :progress="e.chain" />
            </AppCard>

            <AppCard title="Key dates">
              <ol class="relative space-y-3 border-s border-line ps-4 text-sm">
                <li v-for="k in keyDates" :key="k.label" class="relative">
                  <span :class="['absolute top-1 -start-[21px] h-2.5 w-2.5 rounded-full ring-2 ring-surface', k.done ? 'bg-success' : 'bg-line-strong']" aria-hidden="true" />
                  <p :class="['font-medium', k.done ? 'text-fg' : 'text-fg-muted']">{{ k.label }}<span class="sr-only">{{ k.done ? ' (passed)' : ' (upcoming)' }}</span></p>
                  <p class="text-xs text-fg-muted">{{ formatDate(k.date) }}<template v-if="!k.done"> · {{ relativeDays(k.date!) }}</template></p>
                </li>
              </ol>
            </AppCard>

            <AppCard v-if="e.permissions.manage" title="Exit survey" :icon="MessageSquare">
              <template v-if="e.feedback">
                <div class="flex items-center gap-3">
                  <span
                    :class="[
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg font-semibold tabular-nums',
                      e.feedback.wouldRecommend >= 9 ? 'bg-success-soft text-success-fg' : e.feedback.wouldRecommend >= 7 ? 'bg-warning-soft text-warning-fg' : 'bg-danger-soft text-danger-fg',
                    ]"
                  >
                    {{ e.feedback.wouldRecommend }}
                  </span>
                  <div class="text-sm">
                    <p class="font-medium text-fg">Would recommend: {{ e.feedback.wouldRecommend }}/10</p>
                    <p class="text-xs text-fg-muted">{{ e.feedback.wouldRejoin ? 'Would come back' : 'Would not come back' }}</p>
                  </div>
                </div>
                <dl class="mt-3 space-y-2 text-sm">
                  <div v-if="e.feedback.liked"><dt class="text-2xs font-medium text-fg-muted">Liked</dt><dd class="text-fg">{{ e.feedback.liked }}</dd></div>
                  <div v-if="e.feedback.improve"><dt class="text-2xs font-medium text-fg-muted">Improve</dt><dd class="text-fg">{{ e.feedback.improve }}</dd></div>
                </dl>
              </template>
              <p v-else class="text-sm text-fg-muted">Not answered yet.</p>
            </AppCard>

            <AppCard v-if="e.permissions.manage" title="Rehire" :icon="RotateCcw">
              <AppSelect v-model="rehire" label="Eligibility" placeholder="Not decided" :options="rehireOptions" :disabled="busy === 'rehire'" />
              <p class="mt-1.5 text-2xs text-fg-subtle">Shown in the alumni directory to people who manage exits.</p>
            </AppCard>
          </aside>
        </div>
        <ClearanceList v-else-if="tab === 'clearance'" :exit="e" @updated="set" />
        <ExitLettersPanel v-else-if="tab === 'letters'" :exit="e" />
        <SettlementPanel v-else :exit="e" @changed="detail.run" />
      </AppTabs>

      <AppModal :open="!!dayModal" :title="dayModal === 'approve' ? `Accept ${e.employee?.name}'s resignation` : 'Change the last working day'" size="sm" @close="dayModal = null">
        <div class="space-y-4">
          <AppDatePicker v-model="dayForm.lastWorkingDay" label="Last working day" required :min="e.submittedOn" />
          <p class="text-xs text-fg-muted">Notice ends {{ formatDate(e.noticeEndsOn) }}.<template v-if="shortfall"> {{ shortfall }} days would not be served{{ e.type === 'RESIGNATION' ? ' and can be recovered' : ' and are paid in lieu' }}.</template></p>
          <AppCheckbox v-model="dayForm.waiveNotice" label="Waive the notice not served" />
          <AppTextarea v-if="dayModal === 'approve'" v-model="dayForm.note" label="Note to the employee" :rows="2" :maxlength="1000" />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="dayModal = null">Cancel</AppButton>
          <AppButton :loading="busy === 'day'" :disabled="!dayForm.lastWorkingDay" @click="saveDay">{{ dayModal === 'approve' ? 'Accept' : 'Save' }}</AppButton>
        </template>
      </AppModal>
      <AppModal :open="cancelling" title="Cancel this exit?" description="The employee becomes active again." size="sm" @close="cancelling = false">
        <AppTextarea v-model="cancelReason" label="Reason" required :rows="3" :maxlength="1000" />
        <template #footer>
          <AppButton variant="secondary" @click="cancelling = false">Keep it</AppButton>
          <AppButton variant="danger" :loading="busy === 'cancel'" :disabled="cancelReason.trim().length < 3" @click="cancel">Cancel exit</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
