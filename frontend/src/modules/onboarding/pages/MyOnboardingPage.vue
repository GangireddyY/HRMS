<script setup lang="ts">
import { computed, ref } from 'vue';
import { AlertTriangle, ArrowRight, CalendarCheck, CalendarDays, Check, ClipboardCheck, Clock, Flag, HandHeart, Hourglass, PartyPopper, Rocket, Sparkles, UserRound, Users } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import ChecklistTasks from '@/modules/onboarding/components/ChecklistTasks.vue';
import RecommendModal from '@/modules/onboarding/components/RecommendModal.vue';
import type { CaseDetail, ProbationDue } from '@/modules/onboarding/types';
import { PHASES, PHASE_LABELS, RECOMMENDATION_LABELS, REVIEW_STATUS_LABELS, daysFromToday, dueLabel, isFinished, needsViewer, phaseOf, reviewStatusTone } from '@/modules/onboarding/utils/onboarding-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSegmented, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Self-service onboarding: your own checklist, plus what managers owe their new team members. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const mine = useAsync(() => onboardingApi.mine());
const team = useAsync(() => onboardingApi.teamTasks());
const probation = useAsync(async () => (await onboardingApi.probationDue(60)).filter((d) => d.isDirectReport));
const myReviews = useAsync(() => onboardingApi.reviews({ view: 'mine', pageSize: 10 }));

function onUpdated(next: CaseDetail) {
  mine.data.value = next;
}
const recommendFor = ref<ProbationDue | null>(null);
async function onSubmitted() {
  recommendFor.value = null;
  feedback.success('Recommendation submitted', 'HR will make the decision.');
  await Promise.all([probation.run(), myReviews.run()]);
}
const nothing = computed(() => !mine.loading.value && !mine.data.value && !team.data.value?.length && !probation.data.value?.length && !myReviews.data.value?.items.length);

// ---- Your own onboarding ---------------------------------------------------------------------------------------
const d = computed(() => mine.data.value);
const pct = computed(() => (d.value?.progress.total ? Math.round((d.value.progress.done / d.value.progress.total) * 100) : 0));
const firstName = computed(() => d.value?.employee.name.split(' ')[0] ?? '');
const orgName = computed(() => auth.organization?.name ?? 'the team');
const joinIn = computed(() => (d.value ? daysFromToday(d.value.joiningDate) : 0));
const journey = computed(() => {
  if (!d.value) return '';
  if (d.value.status === 'COMPLETED') return `Onboarding completed${d.value.completedAt ? ` on ${formatDate(d.value.completedAt)}` : ''}. Welcome to ${orgName.value}!`;
  if (joinIn.value > 1) return `You join on ${formatDate(d.value.joiningDate)} — ${joinIn.value} days to go. Get a head start below.`;
  if (joinIn.value === 1) return 'You join tomorrow. Get a head start below.';
  if (joinIn.value === 0) return "It's your first day — welcome! Here's what to do next.";
  return `Day ${-joinIn.value + 1} at ${orgName.value}. Here's what's left to settle in.`;
});
const yours = computed(() => (d.value ? d.value.tasks.filter((t) => needsViewer(d.value!, t)) : []));
const nextTask = computed(() => [...yours.value].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null);
const stats = computed(() => {
  const p = d.value?.progress;
  return [
    { key: 'you', label: 'Waiting for you', value: yours.value.length, icon: UserRound, tone: yours.value.length ? 'text-accent-fg bg-accent-soft' : 'text-success-fg bg-success-soft' },
    { key: 'verify', label: 'Awaiting HR check', value: p?.awaitingVerification ?? 0, icon: Hourglass, tone: 'text-warning-fg bg-warning-soft' },
    { key: 'overdue', label: 'Overdue', value: p?.overdue ?? 0, icon: AlertTriangle, tone: p?.overdue ? 'text-danger-fg bg-danger-soft' : 'text-fg-muted bg-surface-muted' },
  ];
});
const phases = computed(() => {
  if (!d.value) return [];
  const list = PHASES.map((key) => {
    const tasks = d.value!.tasks.filter((t) => phaseOf(t.dueDate, d.value!.joiningDate) === key);
    return { key, label: PHASE_LABELS[key], total: tasks.length, done: tasks.filter(isFinished).length };
  }).filter((p) => p.total);
  const current = list.findIndex((p) => p.done < p.total);
  return list.map((p, i) => ({ ...p, state: p.done === p.total ? 'done' : i === current ? 'current' : 'upcoming' }));
});
const lastDue = computed(() => (d.value?.tasks.length ? [...d.value.tasks].sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0]!.dueDate : null));

const filter = ref<'all' | 'mine' | 'open'>('all');
const filterOptions = computed(() => [
  { value: 'all' as const, label: `All ${d.value?.progress.total ?? ''}`.trim() },
  { value: 'mine' as const, label: `Your tasks ${yours.value.length}` },
  { value: 'open' as const, label: `Open ${d.value ? d.value.tasks.filter((t) => !isFinished(t)).length : ''}`.trim() },
]);
/** Scrolls to a task or phase and briefly highlights it. */
function jump(id: string) {
  if (filter.value !== 'all') filter.value = 'all';
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: id.startsWith('task-') ? 'center' : 'start' });
    el.classList.add('ring-2', 'ring-brand-500', 'ring-inset');
    setTimeout(() => el.classList.remove('ring-2', 'ring-brand-500', 'ring-inset'), 1600);
  });
}
const askAssistant = () => window.dispatchEvent(new CustomEvent('hrms:assistant-open'));
const CIRC = 2 * Math.PI * 42;

// ---- Managers --------------------------------------------------------------------------------------------------
const joinText = (iso: string) => {
  const n = daysFromToday(iso);
  return n > 0 ? `Joins ${formatDate(iso)} · in ${n} day${n === 1 ? '' : 's'}` : n === 0 ? 'Joins today' : `Joined ${formatDate(iso)} · ${-n} day${n === -1 ? '' : 's'} ago`;
};
const probationTone = (days: number) => (days < 0 ? 'bg-danger-soft text-danger-fg' : days <= 14 ? 'bg-warning-soft text-warning-fg' : 'bg-surface-muted text-fg-muted');
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Onboarding" description="Your joining checklist, and onboarding tasks for people joining your team." />

    <AppSkeleton v-if="mine.loading.value && !mine.data.value" :lines="6" />
    <AppErrorState v-else-if="mine.error.value" :error="mine.error.value" @retry="mine.run" />
    <template v-else-if="d">
      <!-- Welcome -->
      <section class="card overflow-hidden">
        <div class="relative flex flex-wrap items-center gap-6 hero-banner px-6 py-6 text-white">
          <div class="relative min-w-0 flex-1">
            <p class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
              <component :is="d.status === 'COMPLETED' ? PartyPopper : Rocket" :size="13" aria-hidden="true" />
              {{ d.status === 'COMPLETED' ? 'All set' : 'Onboarding in progress' }}
            </p>
            <h2 class="mt-3 text-2xl font-semibold tracking-tight">{{ d.status === 'COMPLETED' ? `You're all set, ${firstName}!` : `Welcome aboard, ${firstName}!` }}</h2>
            <p class="mt-1 max-w-2xl text-sm text-white/85">{{ journey }}</p>
            <p v-if="d.employee.designation || d.employee.department" class="mt-3 text-xs text-white/75">
              {{ [d.employee.designation?.name, d.employee.department?.name].filter(Boolean).join(' · ') }} · {{ orgName }}
            </p>
          </div>
          <div class="relative flex items-center gap-4">
            <div class="relative h-28 w-28">
              <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" class="stroke-white/20" />
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" stroke-linecap="round" class="stroke-white transition-[stroke-dashoffset] duration-700" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - pct / 100)" />
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center">
                <span class="text-2xl font-semibold tabular-nums">{{ pct }}%</span>
                <span class="text-2xs text-white/80">complete</span>
              </div>
            </div>
            <p class="text-sm text-white/85"><span class="block text-2xl font-semibold text-white tabular-nums">{{ d.progress.done }}<span class="text-base font-normal text-white/70">/{{ d.progress.total }}</span></span>tasks done</p>
          </div>
        </div>
        <div class="grid gap-px bg-line/70 sm:grid-cols-3">
          <div v-for="s in stats" :key="s.key" class="flex items-center gap-3 bg-surface px-5 py-3.5">
            <span :class="['flex h-9 w-9 items-center justify-center rounded-lg', s.tone]" aria-hidden="true"><component :is="s.icon" :size="17" /></span>
            <div>
              <p class="text-xl leading-6 font-semibold text-fg tabular-nums">{{ s.value }}</p>
              <p class="text-xs text-fg-muted">{{ s.label }}</p>
            </div>
          </div>
        </div>
        <div v-if="nextTask" class="flex flex-wrap items-center gap-3 border-t border-line/70 bg-accent-soft/40 px-5 py-3">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white" aria-hidden="true"><Flag :size="15" /></span>
          <div class="min-w-0 flex-1">
            <p class="text-2xs font-semibold tracking-wide text-accent-fg uppercase">Next up</p>
            <p class="truncate text-sm font-medium text-fg">{{ nextTask.title }} <span :class="['ms-1 text-xs font-normal', nextTask.overdue ? 'text-danger-fg' : 'text-fg-muted']">· {{ dueLabel(nextTask.dueDate, nextTask.overdue) }}</span></p>
          </div>
          <AppButton size="sm" :icon-right="ArrowRight" @click="jump(`task-${nextTask.id}`)">Go to task</AppButton>
        </div>
        <div v-else-if="d.status === 'IN_PROGRESS'" class="flex items-center gap-3 border-t border-line/70 bg-success-soft/50 px-5 py-3 text-sm text-success-fg">
          <Check :size="16" aria-hidden="true" />Nothing is waiting for you right now — the rest is with your manager and HR.
        </div>
      </section>

      <!-- Journey -->
      <nav v-if="phases.length > 1" class="card px-4 py-3" aria-label="Onboarding phases">
        <ol class="flex flex-wrap items-center gap-2">
          <template v-for="(p, i) in phases" :key="p.key">
            <li>
              <button
                type="button"
                :class="[
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-start transition hover:bg-surface-muted',
                  p.state === 'current' && 'bg-accent-soft/60 ring-1 ring-brand-500/25 ring-inset',
                ]"
                :aria-current="p.state === 'current' ? 'step' : undefined"
                @click="jump(`phase-${p.key}`)"
              >
                <span
                  :class="[
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    p.state === 'done' ? 'bg-success text-white' : p.state === 'current' ? 'bg-brand-600 text-white' : 'bg-surface-muted text-fg-muted ring-1 ring-line ring-inset',
                  ]"
                  aria-hidden="true"
                >
                  <Check v-if="p.state === 'done'" :size="14" :stroke-width="3" />
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <span>
                  <span class="block text-sm font-medium text-fg">{{ p.label }}</span>
                  <span class="block text-2xs text-fg-muted tabular-nums">{{ p.done }} of {{ p.total }} done</span>
                </span>
              </button>
            </li>
            <li v-if="i < phases.length - 1" class="hidden h-px w-8 bg-line sm:block lg:w-14" aria-hidden="true" />
          </template>
        </ol>
      </nav>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section class="card">
          <header class="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
            <div class="flex items-center gap-3">
              <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><ClipboardCheck :size="16" /></span>
              <div>
                <h2 class="text-sm font-semibold text-fg">Your joining checklist</h2>
                <p class="text-xs text-fg-muted">Tasks marked “Your action” are yours; the rest are done by your manager or HR.</p>
              </div>
            </div>
            <AppSegmented v-model="filter" class="w-full sm:w-auto" size="sm" :options="filterOptions" label="Show tasks" />
          </header>
          <div class="p-4">
            <ChecklistTasks :detail="d" :filter="filter" @updated="onUpdated" />
          </div>
        </section>

        <aside class="space-y-4">
          <AppCard title="Your people">
            <ul class="space-y-3">
              <li v-if="d.manager" class="flex items-center gap-3">
                <AppAvatar :name="d.manager.name" size="md" />
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-fg">{{ d.manager.name }}</p>
                  <p class="text-xs text-fg-muted">Your manager</p>
                </div>
              </li>
              <li v-if="d.buddy" class="flex items-center gap-3">
                <AppAvatar :name="d.buddy.name" size="md" />
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-fg">{{ d.buddy.name }}</p>
                  <p class="inline-flex items-center gap-1 text-xs text-fg-muted"><HandHeart :size="12" aria-hidden="true" />Your onboarding buddy</p>
                </div>
              </li>
            </ul>
            <p v-if="d.buddy" class="mt-3 rounded-md bg-surface-muted/70 px-3 py-2 text-xs text-fg-muted">{{ d.buddy.name.split(' ')[0] }} is here to help you settle in — ask anything, big or small.</p>
            <p v-if="!d.manager && !d.buddy" class="text-sm text-fg-muted">HR will introduce your manager and buddy soon.</p>
          </AppCard>

          <AppCard title="Key dates">
            <ul class="space-y-3 text-sm">
              <li class="flex items-start gap-3">
                <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-fg" aria-hidden="true"><CalendarDays :size="14" /></span>
                <div><p class="font-medium text-fg">Joining day</p><p class="text-xs text-fg-muted">{{ formatDate(d.joiningDate) }}</p></div>
              </li>
              <li v-if="lastDue" class="flex items-start gap-3">
                <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><Clock :size="14" /></span>
                <div><p class="font-medium text-fg">Last task due</p><p class="text-xs text-fg-muted">{{ formatDate(lastDue) }}</p></div>
              </li>
              <li v-if="d.completedAt" class="flex items-start gap-3">
                <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-success-soft text-success-fg" aria-hidden="true"><CalendarCheck :size="14" /></span>
                <div><p class="font-medium text-fg">Completed</p><p class="text-xs text-fg-muted">{{ formatDate(d.completedAt) }}</p></div>
              </li>
            </ul>
          </AppCard>

          <section class="card overflow-hidden">
            <div class="bg-gradient-to-br from-violet-500/10 via-transparent to-sky-500/10 p-4">
              <p class="flex items-center gap-2 text-sm font-semibold text-fg"><Sparkles :size="15" class="text-violet-500" aria-hidden="true" />Questions about joining?</p>
              <p class="mt-1 text-xs text-fg-muted">Ask about documents, policies, payroll or your first week — any time.</p>
              <AppButton class="mt-3 w-full" size="sm" variant="secondary" :icon="Sparkles" @click="askAssistant">Ask AI</AppButton>
            </div>
          </section>
        </aside>
      </div>
    </template>

    <!-- Managers: new team members -->
    <AppCard v-if="team.data.value?.length" title="New members of your team" :icon="Users" description="Tasks you own in their onboarding.">
      <ul class="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        <li v-for="t in team.data.value" :key="t.caseId" class="flex flex-col rounded-xl p-4 ring-1 ring-line">
          <div class="flex items-start gap-3">
            <AppAvatar :name="t.employee.name" size="lg" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-fg">{{ t.employee.name }}</p>
              <p class="truncate text-xs text-fg-muted">{{ [t.employee.designation?.name, t.employee.department?.name].filter(Boolean).join(' · ') || t.employee.employeeCode }}</p>
              <p class="mt-1 text-xs text-fg-muted">{{ joinText(t.joiningDate) }}</p>
            </div>
            <AppBadge v-if="t.tasks.some((x) => x.overdue)" tone="danger" size="sm" dot>Overdue</AppBadge>
          </div>
          <div class="mt-4">
            <div class="mb-1 flex justify-between text-2xs text-fg-muted">
              <span>Your tasks</span>
              <span class="tabular-nums">{{ t.tasks.filter(isFinished).length }} of {{ t.tasks.length }} done</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
              <div class="h-full rounded-full bg-brand-500" :style="{ width: `${(t.tasks.filter(isFinished).length / Math.max(1, t.tasks.length)) * 100}%` }" />
            </div>
          </div>
          <AppButton class="mt-4 self-start" size="sm" variant="secondary" :icon-right="ArrowRight" :to="`/me/onboarding/cases/${t.caseId}`">Open checklist</AppButton>
        </li>
      </ul>
    </AppCard>

    <AppCard v-if="probation.data.value?.length" title="Probation reviews for your team" :icon="ClipboardCheck" description="Recommend confirming or extending; HR makes the decision." :padded="false">
      <ul class="divide-y divide-line/70">
        <li v-for="p in probation.data.value" :key="p.employee.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
          <AppAvatar :name="p.employee.name" size="md" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-fg">{{ p.employee.name }}</p>
            <p class="truncate text-xs text-fg-muted">{{ [p.employee.designation?.name, p.employee.department?.name].filter(Boolean).join(' · ') }}{{ p.employee.designation || p.employee.department ? ' · ' : '' }}Probation ends {{ formatDate(p.probationEndDate) }}</p>
          </div>
          <span :class="['rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums', probationTone(p.daysLeft)]">
            {{ p.daysLeft < 0 ? `${-p.daysLeft} days overdue` : p.daysLeft === 0 ? 'Ends today' : `${p.daysLeft} days left` }}
          </span>
          <AppBadge v-if="p.pendingReview" tone="warning" size="sm">{{ RECOMMENDATION_LABELS[p.pendingReview.recommendation] }} · awaiting decision</AppBadge>
          <AppButton v-else size="sm" @click="recommendFor = p">Review</AppButton>
        </li>
      </ul>
    </AppCard>

    <AppCard v-if="myReviews.data.value?.items.length" title="Your recommendations" :padded="false">
      <ul class="divide-y divide-line/70">
        <li v-for="r in myReviews.data.value.items" :key="r.id" class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <AppAvatar :name="r.employee?.name ?? '?'" size="sm" />
          <span class="min-w-0 flex-1 text-fg">
            <span class="font-medium">{{ r.employee?.name }}</span> · {{ RECOMMENDATION_LABELS[r.recommendation] }}{{ r.extendTo ? ` until ${formatDate(r.extendTo)}` : '' }}
            <span class="block text-xs text-fg-muted">Submitted {{ formatDate(r.submittedAt) }}<template v-if="r.reviewNote"> · “{{ r.reviewNote }}”</template></span>
          </span>
          <AppBadge :tone="reviewStatusTone[r.status]" dot>{{ REVIEW_STATUS_LABELS[r.status] }}</AppBadge>
        </li>
      </ul>
    </AppCard>

    <AppCard v-if="nothing">
      <AppEmptyState :icon="ClipboardCheck" title="Nothing to do here" description="Your joining checklist and onboarding tasks for new team members will appear here." />
    </AppCard>

    <RecommendModal :open="!!recommendFor" :due="recommendFor" @close="recommendFor = null" @submitted="onSubmitted" />
  </div>
</template>
