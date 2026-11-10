<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import { useRouter } from 'vue-router';
import { AlertTriangle, Building2, CalendarClock, Check, ChevronRight, CircleHelp, Clock, EyeOff, FileText, HeartHandshake, HeartPulse, LifeBuoy, Lock, MessageSquare, Paperclip, Plus, Scale, ShieldAlert, ShieldCheck, UserCheck, Users, Wallet } from '@lucide/vue';
import { GRIEVANCE_REOPEN_DAYS, GRIEVANCE_RESOLUTION_DAYS, OPEN_GRIEVANCE_STATUSES, POSH_INQUIRY_DAYS, type GrievanceCategory } from '@contracts';
import { grievanceApi } from '@/modules/grievance/api/grievance.api';
import GrievanceFormModal from '@/modules/grievance/components/GrievanceFormModal.vue';
import type { CaseDetail, CaseSummary } from '@/modules/grievance/types';
import { CATEGORY_LABELS, OUTCOME_LABELS, STATUS_LABELS, STEPS, statusTone } from '@/modules/grievance/utils/grievance-format';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPagination, AppPageHeader, AppSkeleton, AppStatStrip, type StripItem } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Self-service grievances: raise a concern confidentially and follow each case to a resolution. */
const router = useRouter();
const feedback = useFeedbackStore();
const table = useTable((q) => grievanceApi.mine(q), { pageSize: 10 });
const formOpen = ref(false);
async function onSaved(c: CaseDetail, failed: string[]) {
  formOpen.value = false;
  feedback.success(`${c.reference} submitted`, c.posh ? 'The Internal Committee has been notified.' : 'The people handling grievances have been notified.');
  if (failed.length) feedback.error('Some files were not added', `${failed.join(', ')} — add them from the case page.`);
  await router.push(`/me/grievances/${c.id}`);
}

const CATEGORY_ICONS: Record<GrievanceCategory, Component> = {
  WORKPLACE: Building2,
  MANAGER: Users,
  PAY_BENEFITS: Wallet,
  DISCRIMINATION: Scale,
  HARASSMENT: ShieldAlert,
  SAFETY: HeartPulse,
  POLICY: FileText,
  OTHER: MessageSquare,
  POSH: ShieldCheck,
};

// ---- Dates and targets -----------------------------------------------------------------------------------------
const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const days = (from: string, to: string) => Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY);
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
const isOpen = (c: CaseSummary) => OPEN_GRIEVANCE_STATUSES.includes(c.status);
/** Share of the target time already used, for the progress bar of an open case. */
const targetUsed = (c: CaseSummary) => Math.min(100, Math.max(4, (days(c.submittedOn, today) / Math.max(1, days(c.submittedOn, c.dueOn))) * 100));
function targetText(c: CaseSummary): string {
  const left = days(today, c.dueOn);
  if (c.overdue) return `${plural(-left, 'day')} past the target date`;
  return left === 0 ? 'Target date is today' : `${plural(left, 'day')} left`;
}
const stepIndex = (c: CaseSummary) => STEPS.findIndex((s) => s.status === c.status);
const reopenBy = (c: CaseSummary) => (c.resolvedOn ? new Date(Date.parse(c.resolvedOn) + GRIEVANCE_REOPEN_DAYS * DAY).toISOString().slice(0, 10) : null);

// ---- Summary and filters ---------------------------------------------------------------------------------------
const rows = computed(() => table.rows.value);
const single = computed(() => (table.meta.value?.totalPages ?? 1) <= 1);
type View = 'open' | 'review' | 'overdue' | 'closed';
const MATCH: Record<View, (c: CaseSummary) => boolean> = {
  open: isOpen,
  review: (c) => c.status === 'RESOLVED',
  overdue: (c) => c.overdue,
  closed: (c) => c.status === 'CLOSED' || c.status === 'WITHDRAWN',
};
const view = ref<View | null>(null);
const count = (v: View) => rows.value.filter(MATCH[v]).length;
const strip = computed<StripItem[]>(() => [
  { key: 'open', label: 'Open', value: count('open'), hint: count('open') ? 'Being looked into' : 'Nothing in progress', tone: 'info' },
  { key: 'review', label: 'Resolved — your review', value: count('review'), hint: 'Accept or ask to reopen', tone: 'success' },
  { key: 'overdue', label: 'Past target date', value: count('overdue'), hint: count('overdue') ? 'You can message the handler' : 'All within their target', tone: 'danger' },
  { key: 'closed', label: 'Closed', value: count('closed'), hint: single.value ? 'Closed or withdrawn' : 'On this page', tone: 'neutral' },
]);
const shown = computed(() => (view.value ? rows.value.filter(MATCH[view.value]) : rows.value));

const HOW: { icon: Component; title: string; text: string }[] = [
  { icon: Lock, title: 'Confidential', text: 'Only the people handling your case can read it, and the details are stored encrypted.' },
  { icon: EyeOff, title: 'Hidden from the other person', text: 'Anyone you name in your complaint cannot see the case.' },
  { icon: Clock, title: 'A clear timeline', text: `Grievances have a target of ${GRIEVANCE_RESOLUTION_DAYS} days. You can message the handler and add evidence at any time.` },
  { icon: ShieldCheck, title: 'Sexual harassment (POSH)', text: `Goes only to the Internal Committee — not HR or administrators — and the inquiry finishes within ${POSH_INQUIRY_DAYS} days.` },
  { icon: HeartHandshake, title: 'No retaliation', text: 'Retaliation for raising a concern in good faith is not allowed.' },
];
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Grievances" description="Raise a concern confidentially and follow it to a resolution." />

    <!-- Reassurance -->
    <section class="card overflow-hidden" aria-labelledby="speak-up-title">
      <div class="relative flex flex-wrap items-center gap-6 bg-gradient-to-br from-brand-500/12 via-surface to-brand-300/10 px-6 py-6 dark:from-brand-500/20 dark:via-surface dark:to-brand-400/10">
        <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm" aria-hidden="true"><ShieldCheck :size="26" /></span>
        <div class="min-w-0 flex-1 basis-80">
          <h2 id="speak-up-title" class="text-xl font-semibold tracking-tight text-fg">If something at work isn't right, you can tell us safely</h2>
          <p class="mt-1 max-w-2xl text-sm text-fg-muted">Your concern goes only to the people who handle grievances — or to the Internal Committee for sexual harassment. You'll see every update here and can reply at any point.</p>
          <ul class="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-fg-muted">
            <li class="inline-flex items-center gap-1.5"><Lock :size="13" class="text-accent-fg" aria-hidden="true" />Confidential and encrypted</li>
            <li class="inline-flex items-center gap-1.5"><EyeOff :size="13" class="text-accent-fg" aria-hidden="true" />Not visible to the person you name</li>
            <li class="inline-flex items-center gap-1.5"><CalendarClock :size="13" class="text-accent-fg" aria-hidden="true" />{{ GRIEVANCE_RESOLUTION_DAYS }}-day target</li>
          </ul>
        </div>
        <div class="flex flex-col items-start gap-1.5">
          <AppButton size="lg" :icon="Plus" @click="formOpen = true">Raise a concern</AppButton>
          <span class="text-2xs text-fg-subtle">You can attach evidence and add more later</span>
        </div>
      </div>
    </section>

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div class="min-w-0 space-y-4">
        <AppSkeleton v-if="table.loading.value && !rows.length" :lines="5" />
        <AppErrorState v-else-if="table.error.value" :error="table.error.value" @retry="table.load" />
        <section v-else-if="!rows.length" class="card">
          <AppEmptyState :icon="LifeBuoy" title="You haven't raised any concerns" description="When you raise one, it appears here with its progress, the target date and every reply from the people handling it.">
            <AppButton :icon="Plus" @click="formOpen = true">Raise a concern</AppButton>
          </AppEmptyState>
        </section>
        <template v-else>
          <AppStatStrip :items="strip" :selectable="single" :selected="view" label="Your cases" @select="(k) => (view = k as View | null)" />

          <section class="card" aria-labelledby="cases-title">
            <header class="flex items-center gap-3 border-b border-line/70 px-4 py-3">
              <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><LifeBuoy :size="16" /></span>
              <div class="min-w-0 flex-1">
                <h2 id="cases-title" class="text-sm font-semibold text-fg">Your cases</h2>
                <p class="text-xs text-fg-muted">Newest first. Open a case to read updates, reply or add evidence.</p>
              </div>
              <AppButton v-if="view" size="sm" variant="ghost" @click="view = null">Show all</AppButton>
            </header>
            <ul class="divide-y divide-line/70">
              <li v-for="c in shown" :key="c.id" :class="['relative px-4 py-4 transition hover:bg-surface-muted/40', c.overdue && 'bg-danger-soft/20']">
                <span v-if="c.overdue" class="absolute inset-y-0 start-0 w-1 bg-danger" aria-hidden="true" />
                <div class="flex flex-wrap items-start gap-x-4 gap-y-3">
                  <span :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', c.posh ? 'bg-violet-50 text-violet-600 ring-violet-600/15 dark:bg-violet-500/15 dark:text-violet-300' : 'bg-surface-muted text-fg-muted ring-line']" aria-hidden="true">
                    <component :is="CATEGORY_ICONS[c.category]" :size="18" />
                  </span>
                  <div class="min-w-0 flex-1 basis-64">
                    <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <RouterLink :to="`/me/grievances/${c.id}`" class="truncate font-medium text-fg after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-500 focus-visible:after:ring-inset">{{ c.subject }}</RouterLink>
                      <span class="font-mono text-2xs text-fg-subtle">{{ c.reference }}</span>
                    </p>
                    <p class="mt-0.5 text-xs text-fg-muted">
                      {{ CATEGORY_LABELS[c.category] }} · submitted {{ formatDate(c.submittedOn) }}
                      <template v-if="c.posh"> · Internal Committee</template>
                    </p>
                  </div>
                  <AppBadge :tone="statusTone[c.status]" dot>{{ STATUS_LABELS[c.status] }}</AppBadge>
                  <ChevronRight :size="16" class="mt-0.5 text-fg-subtle" aria-hidden="true" />
                </div>

                <div class="mt-3 grid gap-4 ps-14 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <ol v-if="c.status !== 'WITHDRAWN'" class="grid grid-cols-5 gap-1.5" aria-label="Progress">
                    <li v-for="(s, i) in STEPS" :key="s.status" :aria-current="i === stepIndex(c) ? 'step' : undefined">
                      <span :class="['mb-1.5 block h-1.5 rounded-full', i < stepIndex(c) || (i === stepIndex(c) && c.status === 'CLOSED') ? 'bg-brand-500' : i === stepIndex(c) ? 'bg-brand-500/60 ring-2 ring-brand-500/25' : 'bg-surface-muted']" aria-hidden="true" />
                      <span :class="['flex items-center gap-1 text-2xs', i === stepIndex(c) ? 'font-semibold text-fg' : i < stepIndex(c) ? 'text-fg-muted' : 'text-fg-subtle']">
                        <Check v-if="i < stepIndex(c)" :size="10" :stroke-width="3" class="text-accent-fg" aria-hidden="true" />{{ s.label }}
                        <span v-if="i < stepIndex(c)" class="sr-only">(done)</span>
                      </span>
                    </li>
                  </ol>
                  <p v-else class="text-xs text-fg-muted">You withdrew this case. It stays here for your records.</p>

                  <div class="text-xs">
                    <template v-if="isOpen(c)">
                      <p class="flex items-center justify-between gap-2">
                        <span class="text-fg-muted">Target: resolved by <span class="font-medium text-fg">{{ formatDate(c.dueOn) }}</span></span>
                        <span :class="['inline-flex items-center gap-1 font-medium tabular-nums', c.overdue ? 'text-danger-fg' : targetUsed(c) >= 75 ? 'text-warning-fg' : 'text-fg-muted']">
                          <AlertTriangle v-if="c.overdue" :size="12" aria-hidden="true" />{{ targetText(c) }}
                        </span>
                      </p>
                      <span class="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                        <span :class="['block h-full rounded-full', c.overdue ? 'bg-danger' : targetUsed(c) >= 75 ? 'bg-warning' : 'bg-brand-500']" :style="{ width: `${c.overdue ? 100 : targetUsed(c)}%` }" />
                      </span>
                      <p class="mt-1.5 inline-flex items-center gap-1.5 text-fg-muted">
                        <UserCheck :size="12" aria-hidden="true" />
                        <template v-if="c.assignee">Handled by <span class="font-medium text-fg">{{ c.assignee.name }}</span></template>
                        <template v-else>Waiting to be picked up</template>
                      </p>
                    </template>
                    <template v-else-if="c.status === 'RESOLVED'">
                      <p class="text-fg-muted">
                        Resolved {{ c.resolvedOn ? formatDate(c.resolvedOn) : '' }}<template v-if="c.outcome"> · <span class="font-medium text-fg">{{ OUTCOME_LABELS[c.outcome] }}</span></template>
                      </p>
                      <p class="mt-1 rounded-md bg-success-soft/60 px-2.5 py-1.5 text-success-fg">
                        <template v-if="c.posh">Read the Internal Committee's findings on the case page.</template>
                        <template v-else>Read the resolution, then accept it{{ reopenBy(c) && reopenBy(c)! >= today ? ` — or ask to reopen it by ${formatDate(reopenBy(c))}` : '' }}.</template>
                      </p>
                    </template>
                    <template v-else-if="c.status === 'CLOSED'">
                      <p class="text-fg-muted">
                        Closed<template v-if="c.resolvedOn"> · resolved {{ formatDate(c.resolvedOn) }}</template><template v-if="c.outcome"> · <span class="font-medium text-fg">{{ OUTCOME_LABELS[c.outcome] }}</span></template>
                      </p>
                      <p v-if="c.assignee" class="mt-1 text-fg-subtle">Handled by {{ c.assignee.name }}</p>
                    </template>
                    <p v-else class="text-fg-subtle">No further action is needed.</p>
                  </div>
                </div>
              </li>
            </ul>
            <AppEmptyState v-if="!shown.length" compact :icon="LifeBuoy" title="Nothing here" description="No cases match this filter.">
              <AppButton size="sm" variant="secondary" @click="view = null">Show all cases</AppButton>
            </AppEmptyState>
            <div v-if="table.meta.value && table.meta.value.totalPages > 1" class="border-t border-line p-3">
              <AppPagination :meta="table.meta.value" @change="table.setPage" />
            </div>
          </section>
        </template>
      </div>

      <aside class="space-y-4">
        <AppCard title="How it works" :icon="ShieldCheck">
          <ul class="space-y-3">
            <li v-for="h in HOW" :key="h.title" class="flex items-start gap-3">
              <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-fg" aria-hidden="true"><component :is="h.icon" :size="14" /></span>
              <div class="min-w-0">
                <p class="text-sm font-medium text-fg">{{ h.title }}</p>
                <p class="text-xs text-fg-muted">{{ h.text }}</p>
              </div>
            </li>
          </ul>
          <p class="mt-4 rounded-md bg-surface-muted/70 px-3 py-2 text-xs text-fg-muted">Your name is visible to the people handling your case, so they can follow up with you.</p>
        </AppCard>

        <AppCard title="Before you start" :icon="CircleHelp">
          <ul class="space-y-2 text-xs text-fg-muted">
            <li class="flex gap-2"><Check :size="13" class="mt-0.5 shrink-0 text-accent-fg" aria-hidden="true" />What happened, when and where — in your own words.</li>
            <li class="flex gap-2"><Check :size="13" class="mt-0.5 shrink-0 text-accent-fg" aria-hidden="true" />Who it is about and anyone who saw it (both optional).</li>
            <li class="flex gap-2"><Paperclip :size="13" class="mt-0.5 shrink-0 text-accent-fg" aria-hidden="true" />Screenshots, emails or documents — PDF or images, up to 5 MB each.</li>
          </ul>
        </AppCard>
      </aside>
    </div>

    <GrievanceFormModal :open="formOpen" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
