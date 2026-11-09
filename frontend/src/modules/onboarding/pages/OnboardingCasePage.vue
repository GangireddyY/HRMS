<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { AlertTriangle, ArrowRight, CalendarCheck, CalendarDays, CalendarX, Check, CircleCheckBig, ClipboardCheck, Clock, ExternalLink, FileSearch, Flag, HandHeart, Plus, StickyNote, UserRound, XCircle } from '@lucide/vue';
import { ONBOARDING_ASSIGNEES } from '@contracts';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import AddTaskModal from '@/modules/onboarding/components/AddTaskModal.vue';
import ChecklistTasks from '@/modules/onboarding/components/ChecklistTasks.vue';
import type { CaseDetail } from '@/modules/onboarding/types';
import {
  ASSIGNEE_LABELS,
  CASE_STATUS_LABELS,
  PHASES,
  PHASE_LABELS,
  STAGE_LABELS,
  caseStage,
  caseStatusTone,
  daysFromToday,
  dueLabel,
  isFinished,
  joinRelative,
  needsViewer,
  phaseOf,
  stageTone,
} from '@/modules/onboarding/utils/onboarding-format';
import { employeesApi } from '@/modules/people/api/people.api';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppErrorState, AppModal, AppPageHeader, AppSegmented, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** One onboarding case. Used by HR (/hr/onboarding/:id) and by joiners' managers (/me/onboarding/cases/:id). */
const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const detail = useAsync(() => onboardingApi.get(id.value));
watch(id, () => void detail.run());
const backTo = computed(() => (route.path.startsWith('/me/') ? '/me/onboarding' : '/hr/onboarding'));

const d = computed(() => detail.data.value);
const manage = computed(() => !!d.value?.permissions.manage && d.value.status === 'IN_PROGRESS');
const pct = computed(() => (d.value?.progress.total ? Math.round((d.value.progress.done / d.value.progress.total) * 100) : 0));
function onUpdated(next: CaseDetail) {
  detail.data.value = next;
}

const colleagues = useAsync(() => (manage.value ? employeesApi.list({ status: 'ACTIVE', pageSize: 100, sort: 'name:asc' }) : Promise.resolve(null)), { immediate: false });
watch(manage, (m) => m && !colleagues.data.value && void colleagues.run(), { immediate: true });
const buddyOptions = computed(() => (colleagues.data.value?.items ?? []).filter((e) => e.id !== d.value?.employee.id).map((e) => ({ value: e.id, label: e.fullName, description: e.designation?.name })));
async function setBuddy(buddyId: string | null | undefined) {
  try {
    detail.data.value = await onboardingApi.update(id.value, { buddyId: buddyId ?? null });
    feedback.success(buddyId ? 'Buddy assigned' : 'Buddy removed');
  } catch (e) {
    feedback.error('Could not change the buddy', e);
  }
}

const addOpen = ref(false);
async function onTaskAdded(next: CaseDetail) {
  addOpen.value = false;
  detail.data.value = next;
  feedback.success('Task added');
}

const completing = ref(false);
async function complete() {
  if (!(await feedback.confirm({ title: 'Complete onboarding?', message: `${d.value!.employee.name} is notified that their onboarding is complete.`, confirmLabel: 'Complete onboarding' }))) return;
  completing.value = true;
  try {
    detail.data.value = await onboardingApi.complete(id.value);
    feedback.success('Onboarding completed');
  } catch (e) {
    feedback.error('Could not complete onboarding', e);
  } finally {
    completing.value = false;
  }
}

const cancelOpen = ref(false);
const cancelReason = ref('');
async function cancel() {
  try {
    detail.data.value = await onboardingApi.cancel(id.value, cancelReason.value);
    cancelOpen.value = false;
    feedback.success('Onboarding cancelled');
  } catch (e) {
    feedback.error('Could not cancel onboarding', e);
  }
}

// ---- Summary ---------------------------------------------------------------------------------------------------
const stage = computed(() => (d.value ? caseStage(d.value) : null));
const yours = computed(() => (d.value ? d.value.tasks.filter((t) => needsViewer(d.value!, t)) : []));
const openTasks = computed(() => (d.value ? d.value.tasks.filter((t) => !isFinished(t)) : []));
/** The most pressing open task: the oldest overdue one, else the next one due. */
const nextTask = computed(() => {
  if (d.value?.status !== 'IN_PROGRESS') return null;
  const sorted = [...openTasks.value].filter((t) => t.state !== 'SUBMITTED').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return sorted[0] ?? null;
});
const phases = computed(() => {
  if (!d.value) return [];
  const list = PHASES.map((key) => {
    const tasks = d.value!.tasks.filter((t) => phaseOf(t.dueDate, d.value!.joiningDate) === key);
    return { key, label: PHASE_LABELS[key], total: tasks.length, done: tasks.filter(isFinished).length, overdue: tasks.filter((t) => t.overdue && !isFinished(t)).length };
  }).filter((p) => p.total);
  const current = list.findIndex((p) => p.done < p.total);
  return list.map((p, i) => ({ ...p, state: p.done === p.total ? 'done' : i === current ? 'current' : 'upcoming' }));
});
const owners = computed(() =>
  ONBOARDING_ASSIGNEES.map((a) => {
    const all = d.value?.tasks.filter((t) => t.assignee === a) ?? [];
    return { key: a, label: ASSIGNEE_LABELS[a], total: all.length, done: all.filter(isFinished).length, overdue: all.filter((t) => t.overdue && !isFinished(t)).length };
  }).filter((o) => o.total),
);
const OWNER_BAR: Record<string, string> = { EMPLOYEE: 'bg-brand-500', MANAGER: 'bg-special', HR: 'bg-info' };
const dueRange = computed(() => {
  const dates = (d.value?.tasks ?? []).map((t) => t.dueDate).sort();
  return dates.length ? { first: dates[0]!, last: dates.at(-1)! } : null;
});
const joinIn = computed(() => (d.value ? daysFromToday(d.value.joiningDate) : 0));
const keyDates = computed(() => {
  const x = d.value;
  if (!x) return [];
  return [
    { label: 'Onboarding started', date: x.createdAt, icon: Flag, tone: 'bg-surface-muted text-fg-muted', hint: null },
    { label: 'Joining day', date: x.joiningDate, icon: CalendarDays, tone: 'bg-accent-soft text-accent-fg', hint: joinIn.value >= 0 ? joinRelative(x.joiningDate) : `Joined ${-joinIn.value} day${joinIn.value === -1 ? '' : 's'} ago` },
    ...(dueRange.value ? [{ label: 'Last task due', date: dueRange.value.last, icon: Clock, tone: 'bg-surface-muted text-fg-muted', hint: null }] : []),
    ...(x.completedAt ? [{ label: 'Completed', date: x.completedAt, icon: CalendarCheck, tone: 'bg-success-soft text-success-fg', hint: null }] : []),
    ...(x.cancelledAt ? [{ label: 'Cancelled', date: x.cancelledAt, icon: CalendarX, tone: 'bg-danger-soft text-danger-fg', hint: null }] : []),
  ];
});

const filter = ref<'all' | 'mine' | 'open'>('all');
const filterOptions = computed(() => [
  { value: 'all' as const, label: `All ${d.value?.progress.total ?? ''}`.trim() },
  { value: 'mine' as const, label: `Yours ${yours.value.length}` },
  { value: 'open' as const, label: `Open ${openTasks.value.length}` },
]);
/** Scrolls to a task or phase and briefly highlights it. */
function jump(target: string) {
  if (filter.value !== 'all') filter.value = 'all';
  requestAnimationFrame(() => {
    const el = document.getElementById(target);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: target.startsWith('task-') ? 'center' : 'start' });
    el.classList.add('ring-2', 'ring-brand-500', 'ring-inset');
    setTimeout(() => el.classList.remove('ring-2', 'ring-brand-500', 'ring-inset'), 1600);
  });
}
const CIRC = 2 * Math.PI * 42;
</script>

<template>
  <div>
    <AppSkeleton v-if="detail.loading.value && !d" :lines="8" />
    <AppErrorState v-else-if="detail.error.value" :error="detail.error.value" title="Could not load the onboarding" @retry="detail.run" />
    <template v-else-if="d">
      <AppPageHeader :title="d.employee.name" :description="[d.employee.designation?.name, d.employee.department?.name, d.employee.employeeCode].filter(Boolean).join(' · ')" :back="backTo" back-label="Onboarding">
        <template #leading><AppAvatar :name="d.employee.name" size="xl" /></template>
        <template #badges>
          <AppBadge :tone="caseStatusTone[d.status]" dot>{{ CASE_STATUS_LABELS[d.status] }}</AppBadge>
          <AppBadge v-if="stage && d.status === 'IN_PROGRESS'" :tone="stageTone[stage]">{{ STAGE_LABELS[stage] }}</AppBadge>
        </template>
        <template v-if="manage" #actions>
          <AppButton variant="ghost" :icon="XCircle" @click="cancelOpen = true; cancelReason = ''">Cancel onboarding</AppButton>
          <AppButton variant="secondary" :icon="Plus" @click="addOpen = true">Add task</AppButton>
          <AppButton :icon="CircleCheckBig" :loading="completing" :disabled="d.progress.requiredOpen > 0" :title="d.progress.requiredOpen ? `${d.progress.requiredOpen} required task${d.progress.requiredOpen === 1 ? '' : 's'} still open` : undefined" @click="complete">Complete onboarding</AppButton>
        </template>
      </AppPageHeader>

      <AppAlert v-if="d.status === 'CANCELLED'" tone="warning" class="mb-4" title="Onboarding cancelled">{{ d.cancelReason }}</AppAlert>

      <!-- Summary: progress, phases and what to do next -->
      <section class="card mb-4 overflow-hidden" aria-label="Onboarding progress">
        <div class="flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4">
          <div class="flex items-center gap-4">
            <div class="relative h-20 w-20 shrink-0">
              <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="10" class="stroke-surface-muted" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke-width="10"
                  stroke-linecap="round"
                  :class="['transition-[stroke-dashoffset] duration-700', pct === 100 || stage === 'ready' || stage === 'completed' ? 'stroke-success' : 'stroke-brand-500']"
                  :stroke-dasharray="CIRC"
                  :stroke-dashoffset="CIRC * (1 - pct / 100)"
                />
              </svg>
              <span class="absolute inset-0 flex items-center justify-center text-lg font-semibold text-fg tabular-nums">{{ pct }}%</span>
            </div>
            <div>
              <p class="text-lg font-semibold text-fg tabular-nums">{{ d.progress.done }} of {{ d.progress.total }} tasks done</p>
              <p class="text-sm text-fg-muted">
                <template v-if="d.status === 'COMPLETED'">Completed {{ formatDate(d.completedAt) }}</template>
                <template v-else-if="d.status === 'CANCELLED'">Cancelled {{ formatDate(d.cancelledAt) }}</template>
                <template v-else-if="d.progress.requiredOpen">{{ d.progress.requiredOpen }} required task{{ d.progress.requiredOpen === 1 ? '' : 's' }} left before it can be completed</template>
                <span v-else class="font-medium text-success-fg">All required tasks are done — ready to complete</span>
              </p>
              <p class="mt-0.5 text-xs text-fg-subtle">{{ joinIn > 0 ? `${joinRelative(d.joiningDate)} · ${formatDate(d.joiningDate)}` : `Joined ${formatDate(d.joiningDate)} · ${joinRelative(d.joiningDate)}` }}</p>
            </div>
          </div>
          <dl class="ms-auto grid grid-cols-3 gap-2 max-sm:w-full">
            <div :class="['rounded-lg px-4 py-2 ring-1 ring-inset', d.progress.overdue ? 'bg-danger-soft/60 ring-danger/20' : 'bg-surface-muted/50 ring-line/60']">
              <dt class="flex items-center gap-1.5 text-xs text-fg-muted"><AlertTriangle :size="12" :class="d.progress.overdue ? 'text-danger-fg' : ''" aria-hidden="true" />Overdue</dt>
              <dd :class="['text-xl font-semibold tabular-nums', d.progress.overdue ? 'text-danger-fg' : 'text-fg']">{{ d.progress.overdue }}</dd>
            </div>
            <div :class="['rounded-lg px-4 py-2 ring-1 ring-inset', d.progress.awaitingVerification ? 'bg-warning-soft/60 ring-warning/25' : 'bg-surface-muted/50 ring-line/60']">
              <dt class="flex items-center gap-1.5 text-xs text-fg-muted"><FileSearch :size="12" :class="d.progress.awaitingVerification ? 'text-warning-fg' : ''" aria-hidden="true" />To verify</dt>
              <dd :class="['text-xl font-semibold tabular-nums', d.progress.awaitingVerification ? 'text-warning-fg' : 'text-fg']">{{ d.progress.awaitingVerification }}</dd>
            </div>
            <div class="rounded-lg bg-surface-muted/50 px-4 py-2 ring-1 ring-line/60 ring-inset">
              <dt class="flex items-center gap-1.5 text-xs text-fg-muted"><UserRound :size="12" aria-hidden="true" />Yours</dt>
              <dd class="text-xl font-semibold text-fg tabular-nums">{{ yours.length }}</dd>
            </div>
          </dl>
        </div>

        <nav v-if="phases.length > 1" class="border-t border-line/70 px-4 py-3" aria-label="Onboarding phases">
          <ol class="flex flex-wrap items-center gap-2">
            <template v-for="(p, i) in phases" :key="p.key">
              <li>
                <button
                  type="button"
                  :class="['flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-start transition hover:bg-surface-muted', p.state === 'current' && 'bg-accent-soft/60 ring-1 ring-brand-500/25 ring-inset']"
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
                    <span class="block text-sm font-medium text-fg">{{ p.label }}<span class="sr-only"> ({{ p.state === 'done' ? 'done' : p.state === 'current' ? 'in progress' : 'not started' }})</span></span>
                    <span class="block text-2xs text-fg-muted tabular-nums">
                      {{ p.done }} of {{ p.total }} done<template v-if="p.overdue"> · <span class="font-medium text-danger-fg">{{ p.overdue }} overdue</span></template>
                    </span>
                  </span>
                </button>
              </li>
              <li v-if="i < phases.length - 1" :class="['hidden h-px w-6 sm:block lg:w-12', p.state === 'done' ? 'bg-success/50' : 'bg-line']" aria-hidden="true" />
            </template>
          </ol>
        </nav>

        <div v-if="nextTask" :class="['flex flex-wrap items-center gap-3 border-t border-line/70 px-5 py-3', nextTask.overdue ? 'bg-danger-soft/30' : 'bg-accent-soft/40']">
          <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white', nextTask.overdue ? 'bg-danger' : 'bg-brand-600']" aria-hidden="true">
            <component :is="nextTask.overdue ? AlertTriangle : Flag" :size="15" />
          </span>
          <div class="min-w-0 flex-1">
            <p :class="['text-2xs font-semibold tracking-wide uppercase', nextTask.overdue ? 'text-danger-fg' : 'text-accent-fg']">{{ nextTask.overdue ? 'Most overdue' : 'Next up' }}</p>
            <p class="truncate text-sm font-medium text-fg">
              {{ nextTask.title }}
              <span :class="['ms-1 text-xs font-normal', nextTask.overdue ? 'text-danger-fg' : 'text-fg-muted']">· {{ ASSIGNEE_LABELS[nextTask.assignee] }} · {{ dueLabel(nextTask.dueDate, nextTask.overdue) }}</span>
            </p>
          </div>
          <AppButton size="sm" variant="secondary" :icon-right="ArrowRight" @click="jump(`task-${nextTask.id}`)">Go to task</AppButton>
        </div>
      </section>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section class="card min-w-0">
          <header class="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
            <div class="flex items-center gap-3">
              <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><ClipboardCheck :size="16" /></span>
              <div>
                <h2 class="text-sm font-semibold text-fg">Checklist</h2>
                <p class="text-xs text-fg-muted">Grouped by when each task is due relative to the joining day.</p>
              </div>
            </div>
            <AppSegmented v-model="filter" class="w-full sm:w-auto" size="sm" :options="filterOptions" label="Show tasks" />
          </header>
          <div class="p-4">
            <ChecklistTasks :detail="d" :filter="filter" @updated="onUpdated" />
          </div>
        </section>

        <aside class="space-y-4">
          <AppCard title="People">
            <ul class="space-y-3">
              <li class="flex items-center gap-3">
                <AppAvatar :name="d.employee.name" size="md" />
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-fg">{{ d.employee.name }}</p>
                  <p class="text-xs text-fg-muted">New joiner · {{ d.employee.employeeCode }}</p>
                </div>
              </li>
              <li class="flex items-center gap-3">
                <AppAvatar v-if="d.manager" :name="d.manager.name" size="md" />
                <span v-else class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-fg-subtle ring-1 ring-line ring-inset" aria-hidden="true"><UserRound :size="16" /></span>
                <div class="min-w-0">
                  <p :class="['truncate text-sm', d.manager ? 'font-medium text-fg' : 'text-fg-muted']">{{ d.manager?.name ?? 'No manager' }}</p>
                  <p class="text-xs text-fg-muted">Manager</p>
                </div>
              </li>
              <li class="flex items-center gap-3">
                <AppAvatar v-if="d.buddy" :name="d.buddy.name" size="md" />
                <span v-else class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-fg-subtle" aria-hidden="true"><HandHeart :size="15" /></span>
                <div class="min-w-0">
                  <p :class="['truncate text-sm', d.buddy ? 'font-medium text-fg' : 'text-fg-muted']">{{ d.buddy?.name ?? 'No buddy yet' }}</p>
                  <p class="inline-flex items-center gap-1 text-xs text-fg-muted"><HandHeart :size="12" aria-hidden="true" />Onboarding buddy</p>
                </div>
              </li>
            </ul>
            <div v-if="manage" class="mt-4 border-t border-line/70 pt-3">
              <AppSelect :model-value="d.buddy?.id ?? null" :options="buddyOptions" label="Buddy" :placeholder="d.buddy ? 'No buddy' : 'Assign a buddy'" searchable size="sm" @update:model-value="setBuddy" />
              <p v-if="!d.buddy" class="mt-1.5 text-2xs text-fg-subtle">A colleague who helps them settle in; they are notified.</p>
            </div>
            <template v-if="d.permissions.manage" #footer>
              <AppButton class="w-full" size="sm" variant="secondary" :icon="ExternalLink" :to="`/hr/employees/${d.employee.id}`">Open employee record</AppButton>
            </template>
          </AppCard>

          <AppCard v-if="owners.length" title="Who owes what">
            <ul class="space-y-3">
              <li v-for="o in owners" :key="o.key">
                <div class="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span class="font-medium text-fg">{{ o.label }}</span>
                  <span class="text-fg-muted tabular-nums">
                    <span v-if="o.overdue" class="me-1.5 font-medium text-danger-fg">{{ o.overdue }} overdue</span>{{ o.done }}/{{ o.total }}
                  </span>
                </div>
                <div class="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="Math.round((o.done / o.total) * 100)" aria-valuemin="0" aria-valuemax="100" :aria-label="`${o.label} tasks done`">
                  <div :class="['h-full rounded-full', o.done === o.total ? 'bg-success' : OWNER_BAR[o.key]]" :style="{ width: `${(o.done / o.total) * 100}%` }" />
                </div>
              </li>
            </ul>
          </AppCard>

          <AppCard title="Key dates">
            <ul class="space-y-3 text-sm">
              <li v-for="k in keyDates" :key="k.label" class="flex items-start gap-3">
                <span :class="['mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', k.tone]" aria-hidden="true"><component :is="k.icon" :size="14" /></span>
                <div class="min-w-0">
                  <p class="font-medium text-fg">{{ k.label }}</p>
                  <p class="text-xs text-fg-muted">{{ formatDate(k.date) }}<template v-if="k.hint"> · {{ k.hint }}</template></p>
                </div>
              </li>
            </ul>
          </AppCard>

          <AppCard v-if="d.notes && manage" title="Notes for HR" :icon="StickyNote">
            <p class="text-sm whitespace-pre-line text-fg">{{ d.notes }}</p>
          </AppCard>
        </aside>
      </div>

      <AddTaskModal :open="addOpen" :case-id="d.id" :joining-date="d.joiningDate" @close="addOpen = false" @saved="onTaskAdded" />
      <AppModal :open="cancelOpen" title="Cancel onboarding?" :description="d.employee.name" size="sm" @close="cancelOpen = false">
        <AppTextarea v-model="cancelReason" label="Reason" required :rows="3" :maxlength="500" placeholder="e.g. The offer was withdrawn" />
        <template #footer>
          <AppButton variant="secondary" @click="cancelOpen = false">Cancel</AppButton>
          <AppButton variant="danger" :disabled="cancelReason.trim().length < 3" @click="cancel">Cancel onboarding</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
