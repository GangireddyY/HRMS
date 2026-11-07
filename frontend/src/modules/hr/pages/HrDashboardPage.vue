<script setup lang="ts">
import { computed } from 'vue';
import { BarChart3, Briefcase, CalendarDays, ChevronDown, LogOut, Megaphone, PartyPopper, UserPlus, Users, Wallet } from '@lucide/vue';
import { MODULES, PERMISSIONS, SCOPE_RANK, type PermissionScope } from '@contracts';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import { daysUntil, loadAbsences, loadApprovals, localToday } from '@/modules/insights/approvals';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import { reportsApi } from '@/modules/reports/api/reports.api';
import TrendChart from '@/modules/reports/components/TrendChart.vue';
import { AppActionQueue, AppBadge, AppButton, AppCard, AppHero, AppInsights, AppPersonList, AppStatCard, type Insight, type PersonRow, type QueueItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { formatDate } from '@/shared/utils/format';
import { SCOPE_LABELS, scopeTone } from '@/shared/utils/status';

/**
 * HR action centre: what changed (KPIs with trends), what needs a decision (approvals), what to watch (insights worked
 * out from the data), who's away and what's coming up. Every widget appears only with the access and modules it needs.
 */
const auth = useAuthStore();
const can = {
  headcount: auth.can('reports.view', 'TEAM') && auth.hasFeature('reports'),
  leave: auth.can('leave.view', 'TEAM') && auth.hasFeature('leave'),
  jobs: auth.can('recruitment.view') && auth.hasFeature('recruitment'),
  probation: auth.can('onboarding.view', 'TEAM') && auth.hasFeature('onboarding'),
  holidays: auth.hasFeature('attendance'),
  events: auth.hasFeature('engagement'),
};

const headcount = useAsync(() => reportsApi.run('headcount', {}), { immediate: can.headcount });
const approvals = useAsync(() => loadApprovals(auth));
const absences = useAsync(() => loadAbsences(7), { immediate: can.leave });
const jobs = useAsync(() => recruitmentApi.jobs({ status: 'OPEN', page: 1, pageSize: 6 }), { immediate: can.jobs });
const probation = useAsync(() => onboardingApi.probationDue(30), { immediate: can.probation });
const year = Number(localToday().slice(0, 4));
const holidays = useAsync(async () => {
  const [a, b] = await Promise.all([attendanceApi.holidays(year), attendanceApi.holidays(year + 1)]);
  return [...a, ...b].filter((h) => h.date >= localToday()).sort((x, y) => x.date.localeCompare(y.date)).slice(0, 4);
}, { immediate: can.holidays });
const events = useAsync(() => engagementApi.announcements({ category: 'EVENT', page: 1, pageSize: 10 }), { immediate: can.events });

const trend = computed(() => headcount.data.value?.trend ?? []);
const series = (key: string) => trend.value.map((t) => Number(t[key] ?? 0));
const thisMonth = computed(() => trend.value.at(-1) ?? null);
const summary = computed(() => headcount.data.value?.summary ?? {});
const today = localToday();
const outToday = computed(() => (absences.data.value ?? []).filter((a) => a.startDate <= today && a.endDate >= today));
const waiting = computed(() => (approvals.data.value ?? []).reduce((n, a) => n + a.count, 0));
const queue = computed<QueueItem[]>(() => approvals.data.value ?? []);
const upcomingEvents = computed(() => (events.data.value?.items ?? []).filter((e) => e.eventStartsAt && e.eventStartsAt.slice(0, 10) >= today).slice(0, 3));

const hour = new Date().getHours();
const greeting = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${auth.user?.firstName ?? ''}`;
const heroSummary = computed(() => {
  const parts: string[] = [];
  if (!approvals.loading.value) parts.push(waiting.value ? `${waiting.value} item${waiting.value === 1 ? '' : 's'} waiting for you` : 'nothing waiting for your approval');
  if (can.leave && absences.data.value) parts.push(`${outToday.value.length} out today`);
  if (can.jobs && jobs.data.value) parts.push(`${jobs.data.value.meta.total} open role${jobs.data.value.meta.total === 1 ? '' : 's'}`);
  const next = holidays.data.value?.[0];
  if (next) parts.push(`${next.name} in ${daysUntil(next.date)} day${daysUntil(next.date) === 1 ? '' : 's'}`);
  if (!parts.length) return null;
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
});

const insights = computed<Insight[]>(() => {
  const out: Insight[] = [];
  const s = summary.value;
  if (waiting.value) out.push({ id: 'waiting', tone: 'warning', text: `${waiting.value} request${waiting.value === 1 ? ' is' : 's are'} waiting for your decision. Clearing them quickly keeps payroll and attendance accurate.`, to: queue.value.find((q) => q.count)?.to, action: 'Review' });
  if (Number(s.onNotice) > 0) out.push({ id: 'notice', tone: 'warning', text: `${s.onNotice} ${Number(s.onNotice) === 1 ? 'person is' : 'people are'} serving notice — plan handovers and backfills.`, to: '/hr/exits', action: 'Exits' });
  const dueProbation = probation.data.value?.length ?? 0;
  if (dueProbation) out.push({ id: 'probation', tone: 'info', text: `${dueProbation} probation period${dueProbation === 1 ? ' ends' : 's end'} in the next 30 days — managers need to recommend confirmation.`, to: '/hr/onboarding/probation', action: 'Probation' });
  const m = thisMonth.value;
  if (m && Number(m.leavers) > Number(m.joiners)) out.push({ id: 'attrition', tone: 'danger', text: `More people left than joined this month (${m.leavers} vs ${m.joiners}).`, to: '/hr/reports/attrition', action: 'Attrition' });
  const noApplicants = (jobs.data.value?.items ?? []).filter((j) => !Object.values(j.pipeline).some((n) => (n ?? 0) > 0));
  if (noApplicants.length) out.push({ id: 'jobs', tone: 'info', text: `${noApplicants.length} open role${noApplicants.length === 1 ? ' has' : 's have'} no applicants yet — consider sharing ${noApplicants.length === 1 ? 'it' : 'them'} on the careers page.`, to: '/hr/recruitment/jobs', action: 'Jobs' });
  if (Number(s.joinersLast30Days) > 0) out.push({ id: 'joiners', tone: 'success', text: `${s.joinersLast30Days} ${Number(s.joinersLast30Days) === 1 ? 'person' : 'people'} joined in the last 30 days — check their onboarding is on track.`, to: '/hr/onboarding', action: 'Onboarding' });
  if (outToday.value.length >= 3) out.push({ id: 'out', tone: 'info', text: `${outToday.value.length} people are on leave today.`, to: '/hr/leave/calendar', action: 'Calendar' });
  return out.slice(0, 6);
});

const absentPeople = computed<PersonRow[]>(() =>
  (absences.data.value ?? []).map((a) => ({
    id: a.id,
    name: a.employee.name,
    meta: `${a.leaveType} · ${a.startDate === a.endDate ? formatDate(a.startDate) : `${formatDate(a.startDate)} – ${formatDate(a.endDate)}`}`,
    badge: a.startDate <= today && a.endDate >= today ? 'Today' : null,
    badgeTone: 'warning',
    to: `/hr/employees/${a.employee.id}`,
  })),
);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const chart = computed(() => trend.value.map((t) => ({ label: `${MONTH_NAMES[Number(String(t.month).slice(5)) - 1]} ${String(t.month).slice(2, 4)}`, value: Number(t.headcount ?? 0) })));

const actions = computed(() =>
  [
    { key: 'employee', label: 'Add employee', icon: UserPlus, to: '/hr/employees/new', show: auth.can('employee.create') },
    { key: 'job', label: 'Post a job', icon: Briefcase, to: '/hr/recruitment/jobs', show: auth.can('recruitment.manage') && auth.hasFeature('recruitment') },
    { key: 'payroll', label: 'Payroll', icon: Wallet, to: '/hr/payroll/runs', show: auth.can('payroll.process') && auth.hasFeature('payroll') },
    { key: 'announce', label: 'Announce', icon: Megaphone, to: '/hr/engagement/announcements', show: auth.can('engagement.manage') && auth.hasFeature('engagement') },
    { key: 'reports', label: 'Reports', icon: BarChart3, to: '/hr/reports', show: can.headcount },
  ].filter((a) => a.show),
);

/** Entitled business modules with the user's broadest scope and granted actions. */
const moduleAccess = computed(() =>
  MODULES.filter((m) => !m.core && auth.hasFeature(m.key))
    .map((m) => {
      const granted = PERMISSIONS.filter((p) => p.module === m.key && auth.context?.permissions[p.key]);
      const broadest = granted.reduce<PermissionScope | null>((acc, p) => {
        const s = auth.context!.permissions[p.key]!;
        return !acc || SCOPE_RANK[s] > SCOPE_RANK[acc] ? s : acc;
      }, null);
      return { ...m, granted, broadest };
    })
    .filter((m) => m.granted.length > 0),
);
</script>

<template>
  <div class="space-y-4">
    <AppHero :eyebrow="auth.organization?.name" :title="greeting" :summary="heroSummary" :loading="approvals.loading.value && !heroSummary">
      <template #actions>
        <AppButton v-for="(a, i) in actions" :key="a.key" :variant="i === 0 ? 'primary' : 'secondary'" :icon="a.icon" :to="a.to">{{ a.label }}</AppButton>
      </template>
    </AppHero>

    <div v-if="can.headcount || can.jobs" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <template v-if="can.headcount">
        <AppStatCard label="Headcount" :value="summary.headcount" :loading="headcount.loading.value" :icon="Users" :spark="series('headcount')" to="/hr/reports/headcount" />
        <AppStatCard label="Joined this month" :value="thisMonth?.joiners" :loading="headcount.loading.value" tone="success" :icon="UserPlus" :spark="series('joiners')" hint="12-month trend" />
        <AppStatCard label="Left this month" :value="thisMonth?.leavers" :loading="headcount.loading.value" tone="danger" :icon="LogOut" :spark="series('leavers')" to="/hr/reports/attrition" />
        <AppStatCard label="Serving notice" :value="summary.onNotice" :loading="headcount.loading.value" tone="warning" :icon="CalendarDays" to="/hr/exits" />
      </template>
      <AppStatCard v-if="can.jobs" label="Open roles" :value="jobs.data.value?.meta.total" :loading="jobs.loading.value" tone="info" :icon="Briefcase" to="/hr/recruitment/jobs" />
    </div>

    <div class="grid items-start gap-4 lg:grid-cols-3">
      <AppActionQueue :items="queue" :loading="approvals.loading.value" />
      <AppInsights :items="insights" :loading="approvals.loading.value || headcount.loading.value" />
      <AppCard v-if="can.leave" title="Out this week" :description="outToday.length ? `${outToday.length} on leave today` : 'Approved leave in the next 7 days'">
        <template #actions><AppButton size="sm" variant="ghost" to="/hr/leave/calendar">Calendar</AppButton></template>
        <AppPersonList :people="absentPeople" :loading="absences.loading.value" empty="Nobody is on leave this week." />
      </AppCard>
    </div>

    <div class="grid items-start gap-4 lg:grid-cols-3">
      <TrendChart v-if="can.headcount && chart.length" class="lg:col-span-2" title="Headcount at month end" :points="chart" format="number" />
      <AppCard title="Coming up" :class="!(can.headcount && chart.length) && 'lg:col-span-3'">
        <ul class="-my-1.5 divide-y divide-line/60">
          <li v-for="e in upcomingEvents" :key="e.id" class="flex items-center gap-2.5 py-2">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-600 dark:bg-violet-500/12 dark:text-violet-300"><Megaphone :size="15" aria-hidden="true" /></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[13px] font-medium text-fg">{{ e.title }}</span>
              <span class="block truncate text-xs text-fg-muted">{{ formatDate(e.eventStartsAt) }}{{ e.eventLocation ? ` · ${e.eventLocation}` : '' }}</span>
            </span>
          </li>
          <li v-for="h in holidays.data.value ?? []" :key="h.id" class="flex items-center gap-2.5 py-2">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-500/12 dark:text-emerald-300"><PartyPopper :size="15" aria-hidden="true" /></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[13px] font-medium text-fg">{{ h.name }}</span>
              <span class="block truncate text-xs text-fg-muted">{{ formatDate(h.date) }} · in {{ daysUntil(h.date) }} days</span>
            </span>
            <AppBadge v-if="h.isOptional" size="sm">Optional</AppBadge>
          </li>
          <li v-if="!upcomingEvents.length && !holidays.data.value?.length" class="py-2 text-[13px] text-fg-muted">Nothing scheduled yet.</li>
        </ul>
      </AppCard>
    </div>

    <AppCard v-if="can.jobs && jobs.data.value?.items.length" title="Hiring pipeline" description="Open roles and where their candidates are">
      <template #actions><AppButton size="sm" variant="ghost" to="/hr/recruitment/jobs">All jobs</AppButton></template>
      <ul class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        <li v-for="j in jobs.data.value.items" :key="j.id">
          <RouterLink :to="`/hr/recruitment/jobs/${j.id}`" class="block rounded-md border border-line p-3 transition hover:border-brand-500/40 hover:bg-brand-50/30 dark:hover:bg-brand-500/5">
            <p class="truncate text-[13px] font-medium text-fg">{{ j.title }}</p>
            <p class="truncate text-xs text-fg-muted">{{ [j.requisition.department?.name, j.requisition.location?.name].filter(Boolean).join(' · ') || j.requisition.code }}</p>
            <div class="mt-2 flex flex-wrap gap-1">
              <AppBadge v-for="(n, stage) in j.pipeline" v-show="n" :key="stage" size="sm" :tone="stage === 'HIRED' ? 'success' : stage === 'OFFER' ? 'violet' : 'neutral'">{{ String(stage).charAt(0) + String(stage).slice(1).toLowerCase() }} {{ n }}</AppBadge>
              <span v-if="!Object.values(j.pipeline).some((n) => n)" class="text-xs text-fg-subtle">No applicants yet</span>
            </div>
          </RouterLink>
        </li>
      </ul>
    </AppCard>

    <details class="card group">
      <summary class="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5">
        <span>
          <span class="block text-sm font-semibold text-fg">Your access</span>
          <span class="block text-xs text-fg-muted">Modules in your plan and the record scope your roles grant</span>
        </span>
        <ChevronDown :size="16" class="text-fg-subtle transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul class="grid gap-2 border-t border-line/70 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <li v-for="m in moduleAccess" :key="m.key" class="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
          <span class="min-w-0">
            <span class="block truncate text-[13px] font-medium text-fg">{{ m.name }}</span>
            <span class="block text-xs text-fg-muted">{{ m.granted.length }} permission{{ m.granted.length === 1 ? '' : 's' }}</span>
          </span>
          <AppBadge v-if="m.broadest" :tone="scopeTone[m.broadest]" size="sm">{{ SCOPE_LABELS[m.broadest] }}</AppBadge>
        </li>
      </ul>
    </details>
  </div>
</template>
