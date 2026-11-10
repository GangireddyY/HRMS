<script setup lang="ts">
import { computed, reactive, ref, watch, type Component } from 'vue';
import {
  Briefcase,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  DoorOpen,
  FileText,
  GraduationCap,
  HeartHandshake,
  HeartPulse,
  Hourglass,
  MapPin,
  MessageSquare,
  Printer,
  Rocket,
  Send,
  Sparkles,
  TrendingUp,
  Undo2,
  UserRound,
  Users,
  Wallet,
} from '@lucide/vue';
import { type ExitReason } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { appLocale } from '@/core/locale/locale';
import { exitApi } from '@/modules/exit/api/exit.api';
import AlumniCard from '@/modules/exit/components/AlumniCard.vue';
import ClearanceList from '@/modules/exit/components/ClearanceList.vue';
import MyClearanceChecklist from '@/modules/exit/components/MyClearanceChecklist.vue';
import SettlementStatement from '@/modules/exit/components/SettlementStatement.vue';
import type { ExitDetail } from '@/modules/exit/types';
import { LETTER_LABELS, REASON_LABELS, RESIGNATION_REASONS, SETTLEMENT_LABELS, STATUS_LABELS, TYPE_LABELS, inr, localIso, statusTone } from '@/modules/exit/utils/exit-format';
import { employeesApi } from '@/modules/people/api/people.api';
import { AppAlert, AppBadge, AppButton, AppCard, AppCheckbox, AppDatePicker, AppErrorState, AppFacts, AppPageHeader, AppSkeleton, AppSplit, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Self-service exit: resign, follow notice and clearance, then settlement, letters and the alumni network. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const me = useAsync(() => employeesApi.me());
const mine = useAsync(() => exitApi.mine());
const current = computed(() => mine.data.value?.current ?? null);
const settlement = useAsync(() => exitApi.settlement(current.value!.id), { immediate: false });
const letters = useAsync(() => exitApi.letters(current.value!.id), { immediate: false });
watch(
  () => current.value?.id,
  (id) => {
    if (id && (current.value!.status === 'APPROVED' || current.value!.status === 'COMPLETED')) void settlement.run();
    if (id && current.value!.status === 'COMPLETED') void letters.run();
  },
);
const set = (e: ExitDetail) => {
  if (mine.data.value) mine.data.value = { ...mine.data.value, current: e };
};
const today = localIso(new Date());
const noticeDays = computed(() => me.data.value?.noticePeriodDays ?? 30);
const noticeEnds = computed(() => {
  const d = new Date();
  d.setDate(d.getDate() + noticeDays.value - 1);
  return localIso(d);
});

const RESIGN_STEPS = [
  { title: 'Manager and HR are told', text: 'They review your resignation and may talk to you about it.' },
  { title: 'Last working day confirmed', text: 'Usually the end of your notice period; an earlier day may be agreed.' },
  { title: 'Clearance', text: 'Return assets and hand over work; each team signs off here.' },
  { title: 'Full & final settlement', text: 'Pending salary, leave encashment and recoveries, shown on this page.' },
  { title: 'Letters', text: 'Relieving letter and experience certificate, ready to download.' },
];

// ---- Resign ----
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ reason: null as ExitReason | null, reasonDetail: '', requestedLastDay: undefined as string | undefined });
const REASON_ICONS: Partial<Record<ExitReason, Component>> = {
  BETTER_OPPORTUNITY: Rocket,
  COMPENSATION: Wallet,
  CAREER_GROWTH: TrendingUp,
  RELOCATION: MapPin,
  HIGHER_STUDIES: GraduationCap,
  PERSONAL: UserRound,
  HEALTH: HeartPulse,
  WORK_ENVIRONMENT: Building2,
  MANAGER: Users,
  OTHER: MessageSquare,
};
const busy = ref(false);
async function resign() {
  reset();
  if (!(await feedback.confirm({ title: 'Submit your resignation?', message: `Your notice period is ${noticeDays.value} days. Your manager and HR are told and confirm your last working day.`, confirmLabel: 'Resign' }))) return;
  busy.value = true;
  try {
    const e = await exitApi.resign({ reason: form.reason!, reasonDetail: form.reasonDetail || null, requestedLastDay: form.requestedLastDay ?? null });
    feedback.success('Resignation submitted');
    mine.data.value = { current: e, history: mine.data.value?.history ?? [] };
  } catch (e) {
    handle(e, 'Could not submit your resignation');
  } finally {
    busy.value = false;
  }
}
async function withdraw() {
  if (!current.value || !(await feedback.confirm({ title: 'Withdraw your resignation?', message: 'You carry on as before.', confirmLabel: 'Withdraw' }))) return;
  try {
    await exitApi.withdraw(current.value.id);
    feedback.success('Resignation withdrawn');
    await mine.run();
  } catch (e) {
    feedback.error('Could not withdraw it', e);
  }
}

// ---- Exit survey ----
const survey = reactive({ wouldRecommend: 7 as string | number, wouldRejoin: false, liked: '', improve: '' });
async function sendSurvey() {
  if (!current.value) return;
  busy.value = true;
  try {
    set(await exitApi.feedback(current.value.id, { wouldRecommend: Number(survey.wouldRecommend), wouldRejoin: survey.wouldRejoin, liked: survey.liked || null, improve: survey.improve || null }));
    feedback.success('Thank you for your feedback');
  } catch (e) {
    feedback.error('Could not send your feedback', e);
  } finally {
    busy.value = false;
  }
}
const scoreTone = (n: number) => (n <= 6 ? 'bg-danger-soft text-danger-fg ring-danger/40' : n <= 8 ? 'bg-warning-soft text-warning-fg ring-warning/40' : 'bg-success-soft text-success-fg ring-success/40');
const print = () => window.print();
const askAssistant = () => window.dispatchEvent(new CustomEvent('hrms:assistant-open'));

// ---- Status overview ----
const orgName = computed(() => auth.organization?.name ?? 'us');
const firstName = computed(() => me.data.value?.firstName ?? current.value?.employee?.name.split(' ')[0] ?? '');
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
const tenure = computed(() => {
  const s = current.value?.service;
  if (!s) return '';
  return [s.years ? plural(s.years, 'year') : null, s.months ? plural(s.months, 'month') : null].filter(Boolean).join(' and ') || plural(s.days, 'day');
});
const resignation = computed(() => current.value?.type === 'RESIGNATION');
const hero = computed(() => {
  const e = current.value!;
  if (e.status === 'SUBMITTED')
    return {
      pill: resignation.value ? 'Resignation submitted' : STATUS_LABELS[e.status],
      title: resignation.value ? 'Your resignation is with your manager and HR' : `${TYPE_LABELS[e.type]} is being reviewed`,
      text: `They review it and confirm your last working day.${e.permissions.withdraw ? ' You can withdraw it until then.' : ''}`,
    };
  if (e.status === 'APPROVED')
    return {
      pill: 'Serving notice',
      title: e.lastWorkingDay ? `Your last working day is ${formatDate(e.lastWorkingDay)}` : 'You are serving your notice',
      text: `Thank you for ${tenure.value} with ${orgName.value}. Here is what is left before you go.`,
    };
  if (e.status === 'COMPLETED')
    return {
      pill: 'Exit completed',
      title: firstName.value ? `Thank you, ${firstName.value}` : 'Thank you',
      text: `Your exit was completed${e.completedAt ? ` on ${formatDate(e.completedAt)}` : ''}, after ${tenure.value} with ${orgName.value}. We wish you every success.`,
    };
  return { pill: STATUS_LABELS[e.status], title: TYPE_LABELS[e.type], text: e.closedReason ?? '' };
});
/** Share of the notice already served, for the countdown ring. */
const noticeServed = computed(() => {
  const e = current.value;
  if (!e?.lastWorkingDay) return 0;
  const total = Date.parse(e.lastWorkingDay) - Date.parse(e.submittedOn);
  return total > 0 ? Math.min(1, Math.max(0, (Date.parse(today) - Date.parse(e.submittedOn)) / total)) : 1;
});
const lastDayTile = computed(() => {
  const iso = current.value?.lastWorkingDay ?? current.value?.requestedLastDay ?? current.value?.noticeEndsOn;
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return { day: d.getDate(), month: d.toLocaleDateString(appLocale(), { month: 'short', year: 'numeric' }) };
});
const facts = computed(() => {
  const e = current.value!;
  return [
    { label: resignation.value ? 'Resigned on' : 'Notice given', value: formatDate(e.submittedOn), icon: CalendarDays },
    { label: 'Notice period', value: `${e.noticeDays} days · ends ${formatDate(e.noticeEndsOn)}${e.noticeWaived ? ' (waived)' : ''}`, icon: Hourglass },
    {
      label: 'Last working day',
      value: e.lastWorkingDay ? formatDate(e.lastWorkingDay) : e.requestedLastDay ? `${formatDate(e.requestedLastDay)} (requested)` : 'To be confirmed',
      icon: CalendarCheck,
    },
    { label: 'Service', value: `${e.service.years} years, ${e.service.months} months`, icon: Briefcase },
  ];
});

type StepState = 'done' | 'current' | 'upcoming';
const steps = computed(() => {
  const e = current.value;
  if (!e) return [];
  const accepted = e.status === 'APPROVED' || e.status === 'COMPLETED';
  const cleared = e.clearance.total > 0 && e.clearance.done === e.clearance.total;
  const sStatus = settlement.data.value?.status ?? e.settlement?.status ?? null;
  const paidOn = settlement.data.value?.paidOn ?? null;
  const list = [
    { key: 'resigned', label: resignation.value ? 'Resigned' : 'Notice given', detail: formatDate(e.submittedOn), done: true },
    { key: 'accepted', label: resignation.value ? 'Accepted' : 'Confirmed', detail: accepted ? (e.decidedAt ? formatDate(e.decidedAt) : 'Done') : 'With your manager and HR', done: accepted },
    { key: 'clearance', label: 'Clearance', detail: e.clearance.total ? `${e.clearance.done} of ${e.clearance.total} signed off` : 'Starts once accepted', done: cleared },
    { key: 'settlement', label: 'Settlement', detail: sStatus === 'PAID' ? (paidOn ? `Paid ${formatDate(paidOn)}` : 'Paid') : sStatus ? SETTLEMENT_LABELS[sStatus] : 'After your last day', done: sStatus === 'PAID' },
    { key: 'completed', label: 'Completed', detail: e.status === 'COMPLETED' ? formatDate(e.completedAt) : e.lastWorkingDay ? `From ${formatDate(e.lastWorkingDay)}` : 'After your last day', done: e.status === 'COMPLETED' },
  ];
  const at = list.findIndex((s) => !s.done);
  return list.map((s, i) => ({ ...s, state: (s.done ? 'done' : i === at ? 'current' : 'upcoming') as StepState }));
});
const keyDates = computed(() => {
  const e = current.value!;
  const s = settlement.data.value;
  return [
    { label: resignation.value ? 'Resigned' : 'Notice given', date: e.submittedOn, done: true },
    { label: resignation.value ? 'Resignation accepted' : 'Exit confirmed', date: e.decidedAt, done: !!e.decidedAt },
    { label: 'Notice period ends', date: e.noticeEndsOn, done: e.noticeEndsOn <= today },
    { label: 'Last working day', date: e.lastWorkingDay, done: !!e.lastWorkingDay && e.lastWorkingDay < today },
    { label: s?.paidOn ? 'Settlement paid' : 'Settlement due by', date: s?.paidOn ?? s?.dueOn ?? e.settlement?.dueOn ?? null, done: !!s?.paidOn },
    { label: 'Exit completed', date: e.completedAt, done: !!e.completedAt },
  ].filter((d) => d.date);
});
const canEditClearance = computed(() => !!current.value && (current.value.permissions.clear || current.value.permissions.clearManager));
const CIRC = 2 * Math.PI * 42;
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Resignation & exit" description="Resign, follow your notice period and clearance, and see your full & final settlement." />
    <AppSkeleton v-if="mine.loading.value && !mine.data.value" :lines="6" />
    <AppErrorState v-else-if="mine.error.value" :error="mine.error.value" @retry="mine.run" />
    <template v-else-if="mine.data.value">
      <!-- No exit in progress: resign -->
      <template v-if="!current">
        <AppAlert v-if="me.data.value === null" tone="info">Only employees can resign here.</AppAlert>
        <AppAlert v-else-if="me.data.value && me.data.value.status !== 'ACTIVE'" tone="info">You are {{ me.data.value.status === 'ON_NOTICE' ? 'already serving notice' : 'no longer active' }}.</AppAlert>
        <template v-else-if="me.data.value">
          <section class="card overflow-hidden" aria-labelledby="resign-intro">
            <div class="flex flex-wrap items-center gap-6 bg-gradient-to-br from-slate-500/10 via-surface to-brand-500/10 px-6 py-5 dark:from-slate-400/10 dark:to-brand-500/15">
              <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface text-accent-fg shadow-xs ring-1 ring-line" aria-hidden="true"><DoorOpen :size="22" /></span>
              <div class="min-w-0 flex-1 basis-80">
                <h2 id="resign-intro" class="text-lg font-semibold tracking-tight text-fg">Thinking about moving on?</h2>
                <p class="mt-0.5 max-w-2xl text-sm text-fg-muted">If you have decided to resign, you can do it here. Your manager and HR are told and confirm your last working day; a conversation with your manager first often helps.</p>
              </div>
              <dl class="flex gap-6">
                <div>
                  <dt class="text-2xs font-medium text-fg-muted">Notice period</dt>
                  <dd class="text-xl font-semibold text-fg tabular-nums">{{ noticeDays }} <span class="text-sm font-normal text-fg-muted">days</span></dd>
                </div>
                <div>
                  <dt class="text-2xs font-medium text-fg-muted">Would end on</dt>
                  <dd class="text-xl font-semibold text-fg tabular-nums">{{ formatDate(noticeEnds) }}</dd>
                </div>
              </dl>
            </div>
          </section>
          <AppSplit>
            <AppCard title="Resign" :icon="DoorOpen" :description="`Your notice period is ${noticeDays} days: it would end on ${formatDate(noticeEnds)}.`">
              <form id="resign-form" class="space-y-5" novalidate @submit.prevent="resign">
                <AppAlert v-if="formError">{{ formError }}</AppAlert>
                <fieldset>
                  <legend class="label">Main reason <span class="text-danger">*</span></legend>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3" role="radiogroup" aria-label="Main reason">
                    <button
                      v-for="r in RESIGNATION_REASONS"
                      :key="r"
                      type="button"
                      role="radio"
                      :aria-checked="form.reason === r"
                      :class="[
                        'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-start text-sm ring-1 transition ring-inset focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
                        form.reason === r ? 'bg-accent-soft font-medium text-fg ring-brand-500/50' : 'text-fg-muted ring-line hover:bg-surface-muted hover:text-fg',
                      ]"
                      @click="form.reason = r"
                    >
                      <span :class="['flex h-7 w-7 shrink-0 items-center justify-center rounded-md', form.reason === r ? 'bg-brand-600 text-white' : 'bg-surface-muted text-fg-muted']" aria-hidden="true">
                        <component :is="REASON_ICONS[r] ?? MessageSquare" :size="14" />
                      </span>
                      <span class="truncate">{{ REASON_LABELS[r] }}</span>
                    </button>
                  </div>
                  <p v-if="fieldErrors.reason" class="error-text" role="alert">{{ fieldErrors.reason }}</p>
                </fieldset>
                <div class="grid gap-4 md:grid-cols-2">
                  <AppDatePicker v-model="form.requestedLastDay" label="Preferred last working day" :min="today" help="Leaving before the end of your notice period may mean notice pay is recovered, unless it is waived." :error="fieldErrors.requestedLastDay" />
                </div>
                <AppTextarea v-model="form.reasonDetail" label="Anything you'd like to add" :rows="5" :maxlength="2000" placeholder="Optional" />
              </form>
              <template #footer>
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <p class="text-xs text-fg-muted">You can withdraw it until it is accepted.</p>
                  <AppButton type="submit" form="resign-form" :icon="Send" :loading="busy" :disabled="!form.reason">Submit resignation</AppButton>
                </div>
              </template>
            </AppCard>
            <template #aside>
              <AppCard title="What happens next">
                <ol class="relative space-y-3 border-s border-line ps-4 text-sm">
                  <li v-for="(step, i) in RESIGN_STEPS" :key="step.title" class="relative">
                    <span class="absolute top-0 -start-[25px] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-brand-600 text-2xs font-semibold text-white">{{ i + 1 }}</span>
                    <p class="font-medium text-fg">{{ step.title }}</p>
                    <p class="text-xs text-fg-muted">{{ step.text }}</p>
                  </li>
                </ol>
              </AppCard>
              <AppCard title="Your notice">
                <AppFacts :items="[{ label: 'Notice period', value: `${noticeDays} days` }, { label: 'Would end on', value: formatDate(noticeEnds), strong: true }]" />
              </AppCard>
            </template>
          </AppSplit>
        </template>
      </template>

      <!-- Exit in progress or completed -->
      <template v-else>
        <section class="card overflow-hidden print:hidden" aria-labelledby="exit-title">
          <div class="relative flex flex-wrap items-center gap-6 hero-soft px-6 py-6 text-fg">
            <div class="relative min-w-0 flex-1 basis-80">
              <p class="inline-flex items-center gap-1.5 rounded-full bg-surface/80 px-2.5 py-0.5 text-xs font-medium ring-1 ring-line/70">
                <component :is="current.status === 'COMPLETED' ? HeartHandshake : current.status === 'APPROVED' ? CalendarClock : Hourglass" :size="13" aria-hidden="true" />
                {{ hero.pill }}
              </p>
              <h2 id="exit-title" class="mt-3 text-2xl font-semibold tracking-tight">{{ hero.title }}</h2>
              <p class="mt-1 max-w-2xl text-sm text-fg-muted">{{ hero.text }}</p>
              <p class="mt-3 text-xs text-fg-muted">{{ TYPE_LABELS[current.type] }} · {{ REASON_LABELS[current.reason] }}<template v-if="current.employee?.designation"> · {{ current.employee.designation }}</template></p>
              <AppButton v-if="current.permissions.withdraw" class="mt-4" size="sm" variant="secondary" :icon="Undo2" @click="withdraw">Withdraw resignation</AppButton>
            </div>
            <div v-if="current.status === 'APPROVED' && current.daysLeft !== null" class="relative flex items-center gap-4">
              <div class="relative h-28 w-28">
                <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                  <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" class="stroke-fg/10" />
                  <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" stroke-linecap="round" class="stroke-brand-600 dark:stroke-brand-400 transition-[stroke-dashoffset] duration-700" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - noticeServed)" />
                </svg>
                <div class="absolute inset-0 flex flex-col items-center justify-center">
                  <span class="text-3xl leading-8 font-semibold tabular-nums">{{ current.daysLeft }}</span>
                  <span class="text-2xs text-fg-muted">{{ current.daysLeft === 1 ? 'day to go' : 'days to go' }}</span>
                </div>
              </div>
              <p class="text-sm text-fg-muted">
                <span class="block text-xs text-fg-subtle">Notice served</span>
                <span class="text-2xl font-semibold text-fg tabular-nums">{{ Math.round(noticeServed * 100) }}%</span>
              </p>
            </div>
            <div v-else-if="lastDayTile" class="relative flex w-24 shrink-0 flex-col items-center rounded-xl bg-surface/80 py-2.5 ring-1 ring-line">
              <span class="text-2xs font-semibold tracking-wide text-fg-muted uppercase">{{ current.status === 'COMPLETED' ? 'Last day' : current.lastWorkingDay ? 'Last day' : 'Notice ends' }}</span>
              <span class="text-3xl leading-9 font-semibold tabular-nums">{{ lastDayTile.day }}</span>
              <span class="text-2xs text-fg-muted">{{ lastDayTile.month }}</span>
            </div>
          </div>
          <dl class="grid gap-px bg-line/70 sm:grid-cols-2 lg:grid-cols-4">
            <div v-for="f in facts" :key="f.label" class="flex items-center gap-3 bg-surface px-5 py-3.5">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-fg-muted" aria-hidden="true"><component :is="f.icon" :size="16" /></span>
              <div class="min-w-0">
                <dt class="text-xs text-fg-muted">{{ f.label }}</dt>
                <dd class="truncate text-sm font-medium text-fg" :title="f.value">{{ f.value }}</dd>
              </div>
            </div>
          </dl>
        </section>

        <!-- Exit process -->
        <nav v-if="current.status !== 'WITHDRAWN' && current.status !== 'CANCELLED'" class="card px-4 py-3 print:hidden" aria-label="Exit process">
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

        <AppAlert v-if="current.status === 'APPROVED' && current.shortfallDays && !current.noticeWaived" tone="warning" class="print:hidden">Your last working day is {{ current.shortfallDays }} days before the end of your notice period; notice pay for those days may be recovered in your settlement.</AppAlert>

        <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px] print:block">
          <div class="flex min-w-0 flex-col gap-4">
            <div v-if="current.clearanceItems.length" :class="['print:hidden', current.status === 'COMPLETED' && 'order-last']">
              <ClearanceList v-if="canEditClearance" :exit="current" @updated="set" />
              <MyClearanceChecklist v-else :exit="current" />
            </div>

            <AppCard v-if="current.permissions.feedback" title="Exit survey" :icon="MessageSquare" description="Your answers go to HR only and help us improve." class="print:hidden">
              <div class="space-y-5">
                <fieldset>
                  <legend class="label">How likely are you to recommend working here?</legend>
                  <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How likely are you to recommend working here, from 0 to 10">
                    <button
                      v-for="n in 11"
                      :key="n - 1"
                      type="button"
                      role="radio"
                      :aria-checked="Number(survey.wouldRecommend) === n - 1"
                      :class="[
                        'h-9 w-9 rounded-md text-sm font-medium ring-1 transition ring-inset tabular-nums focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
                        Number(survey.wouldRecommend) === n - 1 ? scoreTone(n - 1) : 'text-fg-muted ring-line hover:bg-surface-muted hover:text-fg',
                      ]"
                      @click="survey.wouldRecommend = n - 1"
                    >
                      {{ n - 1 }}
                    </button>
                  </div>
                  <p class="mt-1.5 flex max-w-[29rem] justify-between text-2xs text-fg-subtle"><span>Not at all likely</span><span>Extremely likely</span></p>
                </fieldset>
                <AppCheckbox v-model="survey.wouldRejoin" label="I would consider coming back" />
                <div class="grid gap-4 md:grid-cols-2">
                  <AppTextarea v-model="survey.liked" label="What did you like most?" :rows="3" :maxlength="2000" />
                  <AppTextarea v-model="survey.improve" label="What should we improve?" :rows="3" :maxlength="2000" />
                </div>
              </div>
              <template #footer>
                <div class="flex justify-end"><AppButton :icon="Send" :loading="busy" @click="sendSurvey">Send feedback</AppButton></div>
              </template>
            </AppCard>
            <p v-else-if="current.feedbackGiven" class="card flex items-center gap-3 bg-success-soft/40 px-4 py-3 text-sm text-success-fg print:hidden">
              <CheckCircle2 :size="16" aria-hidden="true" />Thank you — you have shared your exit feedback.
            </p>

            <AppCard v-if="current.status === 'COMPLETED' && current.type !== 'DEATH'" title="Your letters" :icon="FileText" description="Open a letter to read, print or save it as PDF." class="print:hidden">
              <ul v-if="letters.data.value?.length" class="grid gap-3 sm:grid-cols-2">
                <li v-for="l in letters.data.value" :key="l.id" class="flex items-center gap-3 rounded-xl p-3 ring-1 ring-line">
                  <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg" aria-hidden="true"><FileText :size="20" /></span>
                  <div class="min-w-0 flex-1">
                    <p class="flex items-center gap-2 truncate text-sm font-medium text-fg">{{ LETTER_LABELS[l.type] }}<AppBadge v-if="l.revokedAt" size="sm" tone="danger">Revoked</AppBadge></p>
                    <p class="truncate text-xs text-fg-muted">{{ l.reference }} · dated {{ formatDate(l.letterDate) }}</p>
                  </div>
                  <AppButton size="sm" variant="secondary" :to="`/me/exit/${current.id}/letters/${l.id}`">Open</AppButton>
                </li>
              </ul>
              <p v-else-if="!letters.loading.value" class="text-sm text-fg-muted">Your relieving letter and experience certificate appear here once HR issues them.</p>
            </AppCard>

            <template v-if="settlement.data.value">
              <div class="flex flex-wrap items-center justify-between gap-2 print:hidden">
                <p class="text-sm text-fg-muted">
                  <span class="font-medium text-fg">Full &amp; final settlement</span> ·
                  {{ settlement.data.value.paidOn ? `paid ${formatDate(settlement.data.value.paidOn)}` : `due by ${formatDate(settlement.data.value.dueOn)}` }}
                </p>
                <AppButton variant="secondary" :icon="Printer" @click="print">Print statement</AppButton>
              </div>
              <SettlementStatement :settlement="settlement.data.value" :organization="auth.organization?.name" />
            </template>
            <AppAlert v-else-if="current.status === 'APPROVED' || current.status === 'COMPLETED'" tone="info" class="print:hidden">Your full &amp; final settlement appears here once it has been approved.</AppAlert>

            <AlumniCard v-if="current.status === 'COMPLETED'" class="print:hidden" />
          </div>

          <aside class="space-y-4 print:hidden">
            <AppCard :title="resignation ? 'Your resignation' : 'Your exit'">
              <div class="space-y-3 text-sm">
                <div class="flex flex-wrap items-center gap-2">
                  <AppBadge :tone="statusTone[current.status]" dot>{{ STATUS_LABELS[current.status] }}</AppBadge>
                  <AppBadge>{{ REASON_LABELS[current.reason] }}</AppBadge>
                </div>
                <div v-if="current.reasonDetail">
                  <p class="text-2xs font-medium text-fg-muted">In your words</p>
                  <p class="mt-0.5 text-fg">“{{ current.reasonDetail }}”</p>
                </div>
                <div v-if="current.decisionNote" class="rounded-md bg-surface-muted/70 px-3 py-2">
                  <p class="text-fg">“{{ current.decisionNote }}”</p>
                  <p class="mt-0.5 text-xs text-fg-muted">— {{ current.decidedBy }}<template v-if="current.decidedAt">, {{ formatDate(current.decidedAt) }}</template></p>
                </div>
                <p v-if="current.settlement && !settlement.data.value" class="text-xs text-fg-muted">Settlement: {{ SETTLEMENT_LABELS[current.settlement.status] }} · {{ inr(current.settlement.netPayable) }}</p>
              </div>
            </AppCard>

            <AppCard title="Key dates">
              <ol class="relative space-y-3 border-s border-line ps-4 text-sm">
                <li v-for="d in keyDates" :key="d.label" class="relative">
                  <span :class="['absolute top-1 -start-[21px] h-2.5 w-2.5 rounded-full ring-2 ring-surface', d.done ? 'bg-success' : 'bg-line-strong']" aria-hidden="true" />
                  <p :class="['font-medium', d.done ? 'text-fg' : 'text-fg-muted']">{{ d.label }}<span class="sr-only">{{ d.done ? ' (passed)' : ' (upcoming)' }}</span></p>
                  <p class="text-xs text-fg-muted">{{ formatDate(d.date) }}</p>
                </li>
              </ol>
            </AppCard>

            <section class="card overflow-hidden">
              <div class="bg-gradient-to-br from-violet-500/10 via-transparent to-brand-300/10 p-4">
                <p class="flex items-center gap-2 text-sm font-semibold text-fg"><Sparkles :size="15" class="text-violet-500" aria-hidden="true" />Questions about leaving?</p>
                <p class="mt-1 text-xs text-fg-muted">Ask about your notice, clearance, settlement or letters — any time.</p>
                <AppButton class="mt-3 w-full" size="sm" variant="secondary" :icon="Sparkles" @click="askAssistant">Ask AI</AppButton>
              </div>
            </section>
          </aside>
        </div>
      </template>

      <AppCard v-if="mine.data.value.history.length" title="Earlier" class="print:hidden" :padded="false">
        <ul class="divide-y divide-line/70 text-sm">
          <li v-for="h in mine.data.value.history" :key="h.id" class="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span class="text-fg">{{ TYPE_LABELS[h.type] }} · {{ formatDate(h.submittedOn) }}<span v-if="h.closedReason" class="ms-1 text-xs text-fg-muted">· {{ h.closedReason }}</span></span>
            <AppBadge :tone="statusTone[h.status]" size="sm" dot>{{ STATUS_LABELS[h.status] }}</AppBadge>
          </li>
        </ul>
      </AppCard>
    </template>
  </div>
</template>
