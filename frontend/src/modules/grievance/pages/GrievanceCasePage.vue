<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { AlertTriangle, CalendarClock, Check, CheckCircle2, Clock, Eye, EyeOff, Flag, History, Lock, MessagesSquare, Search, ShieldCheck, UserCog, UserX } from '@lucide/vue';
import { GRIEVANCE_OUTCOMES, GRIEVANCE_PRIORITIES, type GrievanceOutcome, type GrievancePriority } from '@contracts';
import { grievanceApi } from '@/modules/grievance/api/grievance.api';
import CaseActivity from '@/modules/grievance/components/CaseActivity.vue';
import CaseComplaintCard from '@/modules/grievance/components/CaseComplaintCard.vue';
import CaseThread from '@/modules/grievance/components/CaseThread.vue';
import type { CaseDetail } from '@/modules/grievance/types';
import { OUTCOME_HELP, OUTCOME_LABELS, PRIORITY_LABELS, STATUS_LABELS, STEPS, priorityTone, statusTone } from '@/modules/grievance/utils/grievance-format';
import { CATEGORY_VISUALS, SLA_BAR, SLA_TEXT, caseSla, daysBetween, plural, todayIso } from '@/modules/grievance/utils/case-sla';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppErrorState, AppFacts, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppTabs, AppTextarea, type Fact } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** A grievance case for the people handling it: status, target date, parties, the complaint, the conversation and every action. */
const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const detail = useAsync(() => grievanceApi.get(id.value));
const handlers = useAsync(() => grievanceApi.handlers(id.value), { immediate: false });
watch(id, () => void detail.run());
const c = computed(() => (detail.data.value?.role === 'HANDLER' ? detail.data.value : null));
watch(
  () => c.value?.permissions.assign,
  (can) => {
    if (can && !handlers.data.value) void handlers.run();
  },
  { immediate: true },
);
const set = (next: CaseDetail) => (detail.data.value = next);
const handlerOptions = computed(() => (handlers.data.value ?? []).map((h) => ({ value: h.id, label: h.name, description: h.email })));
const priorityOptions = GRIEVANCE_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }));

const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<CaseDetail>, success: string) {
  busy.value = key;
  try {
    set(await fn());
    feedback.success(success);
  } catch (e) {
    feedback.error('Could not complete the action', e);
  } finally {
    busy.value = null;
  }
}
const assign = (userId: string | null) => act('assign', () => grievanceApi.assign(id.value, userId), userId ? 'Case assigned' : 'Case unassigned');
const setPriority = (p: GrievancePriority) => act('priority', () => grievanceApi.setPriority(id.value, p), 'Priority updated');
async function close() {
  if (!(await feedback.confirm({ title: `Close ${c.value?.reference}?`, message: 'The case becomes read-only and the complainant is told.', confirmLabel: 'Close case' }))) return;
  await act('close', () => grievanceApi.close(id.value), 'Case closed');
}

const { fieldErrors, formError, handle, reset } = useFormErrors();
const resolving = ref(false);
const resolution = reactive({ outcome: 'UPHELD' as GrievanceOutcome, summary: '', actions: '' });
const outcomeOptions = computed(() =>
  GRIEVANCE_OUTCOMES.filter((o) => o !== 'SETTLED' || !c.value?.posh || c.value.poshDetails?.conciliationRequested).map((o) => ({ value: o, label: OUTCOME_LABELS[o], description: OUTCOME_HELP[o] })),
);
function openResolve() {
  reset();
  Object.assign(resolution, { outcome: 'UPHELD', summary: '', actions: '' });
  resolving.value = true;
}
async function resolve() {
  reset();
  busy.value = 'resolve';
  try {
    set(await grievanceApi.resolve(id.value, { outcome: resolution.outcome, summary: resolution.summary, actions: resolution.actions || null }));
    resolving.value = false;
    feedback.success('Case resolved', 'The complainant has been told.');
  } catch (e) {
    handle(e, 'Could not resolve the case');
  } finally {
    busy.value = null;
  }
}

// ---- Derived from the loaded case ------------------------------------------------------------------------------
const today = todayIso();
const sla = computed(() => (c.value ? caseSla(c.value, today) : null));
const stepIndex = computed(() => (c.value ? STEPS.findIndex((s) => s.status === c.value!.status) : -1));
/** When the case last reached each step (the latest event into that status). */
function stepDate(status: string): string | null {
  const g = c.value!;
  if (status === 'SUBMITTED') return g.submittedOn;
  if (status === 'CLOSED' && g.closedAt) return g.closedAt;
  if (status === 'RESOLVED' && g.resolution) return g.resolution.resolvedAt;
  const e = [...g.events].reverse().find((x) => x.toStatus === status);
  return e?.createdAt ?? (status === 'IN_REVIEW' ? g.acknowledgedAt : null);
}
const lastActivity = computed(() => {
  const g = c.value;
  if (!g) return null;
  return [...g.events.map((e) => e.createdAt), ...g.notes.map((n) => n.createdAt), ...g.attachments.map((f) => f.createdAt), g.updatedAt].sort().at(-1) ?? null;
});
const investigationStarted = computed(() => [...(c.value?.events ?? [])].reverse().find((e) => e.type === 'INVESTIGATING')?.createdAt ?? null);
const dates = computed<Fact[]>(() => {
  const g = c.value!;
  return [
    { label: 'Submitted', value: formatDate(g.submittedOn) },
    { label: 'Acknowledged', value: g.acknowledgedAt ? formatDate(g.acknowledgedAt) : 'Not yet' },
    ...(investigationStarted.value ? [{ label: 'Investigation started', value: formatDate(investigationStarted.value) }] : []),
    { label: g.posh ? 'Inquiry due by' : 'Response due by', value: formatDate(g.dueOn), strong: g.overdue },
    ...(g.resolution ? [{ label: 'Resolved', value: formatDate(g.resolution.resolvedAt) }] : []),
    ...(g.acceptedAt ? [{ label: 'Accepted by the complainant', value: formatDate(g.acceptedAt) }] : []),
    ...(g.reopenUntil && g.status === 'RESOLVED' ? [{ label: 'Can be reopened until', value: formatDate(g.reopenUntil) }] : []),
    ...(g.closedAt ? [{ label: 'Closed', value: formatDate(g.closedAt) }] : []),
    ...(g.withdrawnAt ? [{ label: 'Withdrawn', value: formatDate(g.withdrawnAt) }] : []),
  ];
});
/** How long a finished case took, against its target. */
const took = computed(() => {
  const g = c.value;
  if (!g?.resolution) return null;
  const days = daysBetween(g.submittedOn, g.resolution.resolvedAt);
  return { days, onTime: g.resolution.resolvedAt.slice(0, 10) <= g.dueOn };
});
const nextStep = computed<string | null>(() => {
  const g = c.value;
  if (!g || g.status === 'WITHDRAWN') return null;
  if (g.status === 'CLOSED') return 'This case is closed and read-only.';
  const p = g.permissions;
  if (!p.manage) return 'Read the case and add notes for the people managing it.';
  if (p.acknowledge) return 'Acknowledge the case so the complainant knows it is being looked at.';
  if (p.assign && !g.assignee) return `Choose ${g.posh ? 'a committee member' : 'a handler'} in the Handling panel.`;
  if (p.investigate) return 'Start the investigation when you begin gathering facts.';
  if (p.resolve) return g.posh ? 'Record the committee’s findings and recommendations when the inquiry is complete.' : 'Record the findings and decision when the investigation is complete.';
  if (p.close) return 'Close the case to make it read-only.';
  if (g.status === 'RESOLVED') return 'Waiting for the complainant to accept the resolution or ask to reopen it.';
  return null;
});

const tab = ref('conversation');
const tabs = computed(() => [
  { key: 'conversation', label: 'Messages & evidence', icon: MessagesSquare, count: (c.value?.notes.length ?? 0) + (c.value?.attachments.length ?? 0) },
  { key: 'activity', label: 'Activity', icon: History, count: (c.value?.events.length ?? 0) + (c.value?.notes.length ?? 0) + (c.value?.attachments.length ?? 0) },
]);
</script>

<template>
  <div>
    <AppSkeleton v-if="detail.loading.value && !detail.data.value" :lines="8" />
    <AppErrorState v-else-if="detail.error.value" :error="detail.error.value" @retry="detail.run" />
    <template v-else-if="c">
      <AppPageHeader :title="c.subject" back="/hr/grievances" back-label="Grievances">
        <template #leading>
          <span :class="['flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset max-sm:hidden', CATEGORY_VISUALS[c.category].tile]" aria-hidden="true">
            <component :is="CATEGORY_VISUALS[c.category].icon" :size="22" />
          </span>
        </template>
        <template #badges>
          <AppBadge><span class="font-mono">{{ c.reference }}</span></AppBadge>
          <AppBadge :tone="statusTone[c.status]" dot>{{ STATUS_LABELS[c.status] }}</AppBadge>
          <AppBadge v-if="c.priority" :tone="priorityTone[c.priority]">{{ PRIORITY_LABELS[c.priority] }} priority</AppBadge>
          <AppBadge v-if="c.posh" tone="violet">POSH · Internal Committee</AppBadge>
          <AppBadge v-if="c.reopened" tone="warning">Reopened</AppBadge>
        </template>
        <template v-if="c.permissions.manage" #actions>
          <AppButton v-if="c.permissions.acknowledge" variant="secondary" :icon="Eye" :loading="busy === 'ack'" @click="act('ack', () => grievanceApi.acknowledge(id), 'Case acknowledged')">Acknowledge</AppButton>
          <AppButton v-if="c.permissions.investigate" variant="secondary" :icon="Search" :loading="busy === 'investigate'" @click="act('investigate', () => grievanceApi.investigate(id), 'Investigation started')">Start investigation</AppButton>
          <AppButton v-if="c.permissions.resolve" :icon="CheckCircle2" @click="openResolve">Resolve</AppButton>
          <AppButton v-if="c.permissions.close" :icon="Lock" :loading="busy === 'close'" @click="close">Close case</AppButton>
        </template>
      </AppPageHeader>

      <!-- Case summary: parties, target date and progress -->
      <section class="card mb-4 overflow-hidden" aria-label="Case summary">
        <dl class="grid gap-px bg-line/70 sm:grid-cols-2 lg:grid-cols-4">
          <div class="flex items-center gap-3 bg-surface px-4 py-3">
            <AppAvatar v-if="c.complainant" :name="c.complainant.name" size="md" />
            <div class="min-w-0">
              <dt class="text-xs text-fg-muted">Raised by</dt>
              <dd class="truncate text-sm font-medium text-fg">{{ c.complainant?.name ?? '—' }}</dd>
              <dd class="truncate text-xs text-fg-muted">{{ [c.complainant?.designation, c.complainant?.department].filter(Boolean).join(' · ') || '—' }}</dd>
            </div>
          </div>
          <div class="flex items-center gap-3 bg-surface px-4 py-3">
            <AppAvatar v-if="c.assignee" :name="c.assignee.name" size="md" />
            <span v-else class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-warning/60 text-warning-fg" aria-hidden="true"><UserX :size="16" /></span>
            <div class="min-w-0">
              <dt class="text-xs text-fg-muted">Handled by</dt>
              <dd :class="['truncate text-sm font-medium', c.assignee ? 'text-fg' : 'text-warning-fg']">{{ c.assignee?.name ?? 'Unassigned' }}</dd>
              <dd class="truncate text-xs text-fg-muted">{{ c.assignee ? (c.posh ? 'Internal Committee' : 'Grievance handler') : c.permissions.assign ? 'Choose one in Handling' : 'Waiting for a handler' }}</dd>
            </div>
          </div>
          <div class="flex items-center gap-3 bg-surface px-4 py-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-fg-muted" aria-hidden="true"><Clock :size="16" /></span>
            <div class="min-w-0">
              <dt class="text-xs text-fg-muted">Submitted</dt>
              <dd class="text-sm font-medium text-fg tabular-nums">{{ formatDate(c.submittedOn) }}</dd>
              <dd class="truncate text-xs text-fg-muted">Last activity {{ timeAgo(lastActivity) }}</dd>
            </div>
          </div>
          <div class="bg-surface px-4 py-3">
            <dt class="flex items-center justify-between gap-2 text-xs text-fg-muted">
              <span>{{ c.posh ? 'Inquiry due by' : 'Target date' }}</span>
              <span class="font-medium text-fg tabular-nums">{{ formatDate(c.dueOn) }}</span>
            </dt>
            <template v-if="sla && sla.state !== 'done'">
              <dd :class="['mt-1 flex items-center gap-1 text-sm font-semibold tabular-nums', SLA_TEXT[sla.state]]">
                <AlertTriangle v-if="sla.state === 'overdue'" :size="14" aria-hidden="true" />{{ sla.text }}
              </dd>
              <dd class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                <span :class="['block h-full rounded-full', SLA_BAR[sla.state]]" :style="{ width: `${sla.used}%` }" />
              </dd>
            </template>
            <dd v-else-if="took" :class="['mt-1 flex items-center gap-1 text-sm font-medium', took.onTime ? 'text-success-fg' : 'text-warning-fg']">
              <component :is="took.onTime ? CheckCircle2 : AlertTriangle" :size="14" aria-hidden="true" />Resolved in {{ plural(took.days, 'day') }}{{ took.onTime ? ', within target' : ', after the target' }}
            </dd>
            <dd v-else class="mt-1 text-sm text-fg-muted">{{ STATUS_LABELS[c.status] }}</dd>
          </div>
        </dl>

        <div class="border-t border-line/70 px-4 py-4">
          <ol v-if="c.status !== 'WITHDRAWN'" class="grid grid-cols-5" aria-label="Progress">
            <li v-for="(s, i) in STEPS" :key="s.status" class="relative flex flex-col items-center text-center" :aria-current="i === stepIndex ? 'step' : undefined">
              <span v-if="i > 0" :class="['absolute top-3.5 end-1/2 h-0.5 w-full -translate-y-1/2', i <= stepIndex ? 'bg-brand-500' : 'bg-line']" aria-hidden="true" />
              <span
                :class="[
                  'relative flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                  i < stepIndex || (i === stepIndex && c.status === 'CLOSED')
                    ? 'bg-brand-600 text-white ring-4 ring-surface'
                    : i === stepIndex
                      ? 'bg-accent-soft text-accent-fg shadow-[inset_0_0_0_2px_var(--brand-500)] ring-4 ring-brand-500/15'
                      : 'bg-surface-muted text-fg-subtle ring-4 ring-surface',
                ]"
                aria-hidden="true"
              >
                <Check v-if="i < stepIndex || (i === stepIndex && c.status === 'CLOSED')" :size="14" :stroke-width="3" />
                <template v-else>{{ i + 1 }}</template>
              </span>
              <span :class="['mt-1.5 text-2xs sm:text-xs', i === stepIndex ? 'font-semibold text-fg' : i < stepIndex ? 'text-fg-muted' : 'text-fg-subtle']">
                {{ s.label }}<span v-if="i < stepIndex" class="sr-only"> (done)</span>
              </span>
              <span v-if="i <= stepIndex && stepDate(s.status)" class="text-2xs text-fg-subtle tabular-nums max-sm:hidden">{{ formatDate(stepDate(s.status)) }}</span>
            </li>
          </ol>
          <p v-else class="flex items-center gap-2 text-sm text-fg-muted"><EyeOff :size="15" aria-hidden="true" />The complainant withdrew this case on {{ formatDate(c.withdrawnAt!) }}. It stays here for the record.</p>
        </div>
        <div v-if="nextStep" class="flex items-center gap-3 border-t border-line/70 bg-accent-soft/40 px-4 py-2.5">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white" aria-hidden="true"><Flag :size="13" /></span>
          <p class="text-sm text-fg"><span class="me-1.5 text-2xs font-semibold tracking-wide text-accent-fg uppercase">Next step</span>{{ nextStep }}</p>
        </div>
      </section>

      <AppAlert v-if="c.status !== 'WITHDRAWN' && c.permissions.closeBlocker" tone="info" class="mb-4">{{ c.permissions.closeBlocker }}; you can close it after that, or as soon as they accept the resolution.</AppAlert>
      <AppAlert v-if="!c.permissions.manage" tone="info" class="mb-4">You were assigned to this case: you can read it and add notes. Someone with grievance management access assigns, investigates and resolves it.</AppAlert>

      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div class="min-w-0 space-y-4">
          <section v-if="c.resolution" class="card relative overflow-hidden" aria-labelledby="resolution-title">
            <span class="absolute inset-y-0 start-0 w-1 bg-success" aria-hidden="true" />
            <header class="flex min-h-12 flex-wrap items-center gap-3 border-b border-line/70 px-4 py-2">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-success-soft text-success-fg" aria-hidden="true"><CheckCircle2 :size="16" /></span>
              <div class="min-w-0 flex-1">
                <h2 id="resolution-title" class="text-sm font-semibold text-fg">{{ c.status === 'RESOLVED' || c.status === 'CLOSED' ? 'Resolution' : 'Previous resolution' }}</h2>
                <p v-if="c.resolution.resolvedBy" class="text-xs text-fg-muted">By {{ c.resolution.resolvedBy }} · {{ formatDate(c.resolution.resolvedAt) }}</p>
              </div>
              <AppBadge v-if="c.outcome" tone="success">{{ OUTCOME_LABELS[c.outcome] }}</AppBadge>
            </header>
            <div class="p-4">
              <p class="text-sm whitespace-pre-line text-fg">{{ c.resolution.summary }}</p>
              <div v-if="c.resolution.actions" class="mt-3 rounded-md bg-warning-soft/40 px-3 py-2 ring-1 ring-warning/20 ring-inset">
                <h3 class="mb-1 flex items-center gap-1.5 text-sm font-medium text-fg"><Lock :size="12" class="text-warning-fg" aria-hidden="true" />Actions <span class="font-normal text-fg-muted">(internal)</span></h3>
                <p class="text-sm whitespace-pre-line text-fg">{{ c.resolution.actions }}</p>
              </div>
              <p v-if="c.acceptedAt" class="mt-3 flex items-center gap-1.5 text-xs text-success-fg"><Check :size="12" aria-hidden="true" />Accepted by the complainant on {{ formatDate(c.acceptedAt) }}.</p>
            </div>
          </section>

          <CaseComplaintCard :grievance="c" />

          <AppTabs v-model="tab" :tabs="tabs">
            <CaseThread v-if="tab === 'conversation'" :grievance="c" :can-note="c.permissions.note" :can-attach="c.permissions.attach" @updated="set" />
            <CaseActivity v-else :grievance="c" />
          </AppTabs>
        </div>

        <aside class="space-y-4 lg:sticky lg:top-4" aria-label="Case details">
          <AppCard title="Handling" :icon="UserCog">
            <div class="space-y-4">
              <AppSelect
                v-if="c.permissions.assign"
                :model-value="c.assignee?.id ?? null"
                label="Handled by"
                :options="handlerOptions"
                :placeholder="c.posh ? 'Choose a committee member' : 'Choose a handler'"
                :disabled="busy === 'assign' || handlers.loading.value"
                @update:model-value="(v) => assign((v as string | null) ?? null)"
              />
              <div v-else class="flex items-center gap-2.5">
                <AppAvatar v-if="c.assignee" :name="c.assignee.name" size="sm" />
                <div>
                  <p class="text-xs text-fg-muted">Handled by</p>
                  <p class="text-sm text-fg">{{ c.assignee?.name ?? 'Unassigned' }}</p>
                </div>
              </div>
              <AppSelect
                v-if="c.permissions.priority"
                :model-value="c.priority"
                label="Priority"
                :options="priorityOptions"
                :clearable="false"
                :disabled="busy === 'priority'"
                @update:model-value="(v) => setPriority(v as GrievancePriority)"
              />
              <p class="text-xs text-fg-muted">
                {{ c.posh ? 'Only Internal Committee members not involved in the case can be assigned.' : 'Only grievance handlers not involved in the case can be assigned.' }}
              </p>
            </div>
          </AppCard>

          <AppCard title="Key dates" :icon="CalendarClock">
            <AppFacts :items="dates" />
          </AppCard>

          <div class="rounded-md border border-dashed border-line px-4 py-3 text-xs text-fg-muted">
            <p class="flex items-center gap-1.5 font-medium text-fg"><ShieldCheck :size="13" class="text-accent-fg" aria-hidden="true" />Confidential case</p>
            <p class="mt-1">
              {{ c.posh ? 'Only Internal Committee members handling it can read this case.' : 'Only the people handling this case can read it.' }}
              Internal notes and files are never shown to the complainant, and the person named in the complaint cannot see it.
            </p>
          </div>
        </aside>
      </div>

      <AppModal :open="resolving" :title="`Resolve ${c.reference}`" :description="c.posh ? 'Record the committee’s findings and recommendations.' : 'The summary is shared with the complainant.'" size="lg" @close="resolving = false">
        <form id="resolve-form" class="space-y-4" novalidate @submit.prevent="resolve">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <AppSelect v-model="resolution.outcome" label="Outcome" :options="outcomeOptions" :clearable="false" :error="fieldErrors.outcome" />
          <AppTextarea v-model="resolution.summary" label="Findings and decision" required :rows="5" :maxlength="5000" help="Shared with the complainant." :error="fieldErrors.summary" />
          <AppTextarea v-model="resolution.actions" label="Actions taken or recommended" :rows="3" :maxlength="5000" help="Internal: not shown to the complainant." :error="fieldErrors.actions" />
        </form>
        <template #footer>
          <AppButton variant="secondary" @click="resolving = false">Cancel</AppButton>
          <AppButton type="submit" form="resolve-form" :loading="busy === 'resolve'" :disabled="resolution.summary.trim().length < 10">Resolve</AppButton>
        </template>
      </AppModal>
    </template>
    <AppAlert v-else-if="detail.data.value" tone="info">
      You raised this case, so you can't handle it. <RouterLink :to="`/me/grievances/${id}`" class="font-medium underline">Follow it in My Workspace</RouterLink>.
    </AppAlert>
  </div>
</template>
