<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { BarChart3, BadgeCheck, Briefcase, CalendarDays, CalendarRange, ChevronDown, FileWarning, LogOut, Megaphone, MessageSquareWarning, Plane, Rocket, Scale, ShieldCheck, UserPlus, Users, Wallet } from '@lucide/vue';
import { MODULES, PERMISSIONS, SCOPE_RANK, type PermissionScope } from '@contracts';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { useAuthStore } from '@/core/auth/auth.store';
import { appLocale } from '@/core/locale/locale';
import { isAllowed, type AccessRule } from '@/core/navigation/access-rules';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import { exitApi } from '@/modules/exit/api/exit.api';
import { grievanceApi } from '@/modules/grievance/api/grievance.api';
import HiringPipelineCard from '@/modules/hr/components/HiringPipelineCard.vue';
import HrPriorities, { type Priority, type PrioritySeverity } from '@/modules/hr/components/HrPriorities.vue';
import { addDaysIso, daysUntil, loadAbsences, loadApprovals, localToday } from '@/modules/insights/approvals';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import { documentsApi } from '@/modules/people/api/people.api';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import { reportsApi } from '@/modules/reports/api/reports.api';
import TrendChart from '@/modules/reports/components/TrendChart.vue';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppHero, AppInsights, AppPersonList, AppStatCard, type Insight, type PersonRow } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate } from '@/shared/utils/format';
import { SCOPE_LABELS, scopeTone } from '@/shared/utils/status';

/**
 * HR command centre: what needs doing first (decisions and deadlines), what changed (KPIs with trends), what to watch
 * (insights worked out from the data), who's away and what's coming up. Every widget appears only with the access and
 * modules it needs; follow-up sources load only when the user can open the page they link to.
 */
const auth = useAuthStore();
const router = useRouter();
const subject = useAccessSubject();
const canOpen = (to: string) => isAllowed(router.resolve(to).meta.access as AccessRule | undefined, subject.value);
const can = {
  headcount: auth.can('reports.view', 'TEAM') && auth.hasFeature('reports'),
  leave: auth.can('leave.view', 'TEAM') && auth.hasFeature('leave'),
  jobs: auth.can('recruitment.view') && auth.hasFeature('recruitment'),
  probation: auth.can('onboarding.view', 'TEAM') && auth.hasFeature('onboarding'),
  holidays: auth.hasFeature('attendance'),
  events: auth.hasFeature('engagement'),
  documents: canOpen('/hr/documents/expiring'),
  onboarding: canOpen('/hr/onboarding') && auth.hasFeature('onboarding'),
  exits: canOpen('/hr/exits'),
  grievances: canOpen('/hr/grievances'),
  compliance: canOpen('/hr/compliance/calendar'),
};

const today = localToday();
const headcount = useAsync(() => reportsApi.run('headcount', {}), { immediate: can.headcount });
const approvals = useAsync(() => loadApprovals(auth));
const absences = useAsync(() => loadAbsences(7), { immediate: can.leave });
const jobs = useAsync(() => recruitmentApi.jobs({ status: 'OPEN', page: 1, pageSize: 6 }), { immediate: can.jobs });
const probation = useAsync(() => onboardingApi.probationDue(30), { immediate: can.probation });
const year = Number(today.slice(0, 4));
const holidays = useAsync(async () => {
  const [a, b] = await Promise.all([attendanceApi.holidays(year), attendanceApi.holidays(year + 1)]);
  return [...a, ...b].filter((h) => h.date >= localToday()).sort((x, y) => x.date.localeCompare(y.date)).slice(0, 4);
}, { immediate: can.holidays });
const events = useAsync(() => engagementApi.announcements({ category: 'EVENT', page: 1, pageSize: 10 }), { immediate: can.events });
const documents = useAsync(() => documentsApi.expiring(30), { immediate: can.documents });
const onboarding = useAsync(() => fetchAllPages((page, pageSize) => onboardingApi.cases({ status: 'IN_PROGRESS', page, pageSize })), { immediate: can.onboarding });
const exits = useAsync(() => fetchAllPages((page, pageSize) => exitApi.list({ status: 'OPEN', page, pageSize })), { immediate: can.exits });
const grievances = useAsync(() => grievanceApi.stats(), { immediate: can.grievances });
const compliance = useAsync(() => complianceApi.calendar({ from: today, to: addDaysIso(today, 30), overdue: true }), { immediate: can.compliance });

const trend = computed(() => headcount.data.value?.trend ?? []);
const series = (key: string) => trend.value.map((t) => Number(t[key] ?? 0));
const thisMonth = computed(() => trend.value.at(-1) ?? null);
const summary = computed(() => headcount.data.value?.summary ?? {});
const outToday = computed(() => (absences.data.value ?? []).filter((a) => a.startDate <= today && a.endDate >= today));
const waiting = computed(() => (approvals.data.value ?? []).reduce((n, a) => n + a.count, 0));
const upcomingEvents = computed(() => (events.data.value?.items ?? []).filter((e) => e.eventStartsAt && e.eventStartsAt.slice(0, 10) >= today).slice(0, 3));
const headcountTrend = computed(() => {
  const s = series('headcount');
  if (s.length < 2 || s[0] === s.at(-1)) return undefined;
  const diff = s.at(-1)! - s[0]!;
  return { label: `${diff > 0 ? '+' : '−'}${Math.abs(diff)} in ${s.length - 1} months`, direction: diff > 0 ? ('up' as const) : ('down' as const) };
});

const hour = new Date().getHours();
const greeting = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${auth.user?.firstName ?? ''}`;
const dateLine = new Date().toLocaleDateString(appLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
const eyebrow = [auth.organization?.name, dateLine].filter(Boolean).join(' · ');
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

// ---- Work queue -------------------------------------------------------------------------------------------------
const APPROVAL_DETAIL: Record<string, string> = {
  leave: 'Time off to approve or decline',
  regularizations: 'Missed or wrong punches to correct',
  wfh: 'Remote work days to approve',
  overtime: 'Extra hours to approve',
  claims: 'Expenses to approve for reimbursement',
  loans: 'Loan and salary advance requests',
  payroll: 'Runs submitted for your approval',
  requisitions: 'New positions to approve',
  exits: 'Resignations to accept',
  probation: 'Manager recommendations to decide',
};
const parts = (...p: (string | false)[]) => p.filter(Boolean).join(' · ');
const severity = (urgent: number, soon: number): PrioritySeverity => (urgent ? 'urgent' : soon ? 'soon' : 'normal');
const priorities = computed<Priority[]>(() => {
  const out: Priority[] = (approvals.data.value ?? []).map((a) => ({ key: `approve-${a.key}`, label: a.label, detail: APPROVAL_DETAIL[a.key] ?? 'Waiting for your decision', count: a.count, to: a.to, icon: a.icon, severity: 'soon', group: 'decide' }));

  const due = (probation.data.value ?? []).filter((p) => !p.pendingReview);
  if (due.length) {
    const late = due.filter((p) => p.daysLeft < 0).length;
    const week = due.filter((p) => p.daysLeft >= 0 && p.daysLeft <= 7).length;
    const later = due.length - late - week;
    out.push({ key: 'probation', label: 'Probation periods ending', detail: parts(!!late && `${late} overdue`, !!week && `${week} this week`, !!later && `${later} within 30 days`), count: due.length, to: '/hr/onboarding/probation', icon: BadgeCheck, severity: severity(late, week), group: 'follow' });
  }

  const docs = documents.data.value ?? [];
  if (docs.length) {
    const expired = docs.filter((d) => d.expired).length;
    const week = docs.filter((d) => !d.expired && daysUntil(d.expiryDate) <= 7).length;
    out.push({ key: 'documents', label: 'Documents expiring', detail: parts(!!expired && `${expired} expired`, !!week && `${week} this week`, !!(docs.length - expired - week) && `${docs.length - expired - week} within 30 days`), count: docs.length, to: '/hr/documents/expiring', icon: FileWarning, severity: severity(expired, week), group: 'follow' });
  }

  const cases = onboarding.data.value ?? [];
  const behind = cases.filter((c) => c.progress.overdue > 0).length;
  const verify = cases.filter((c) => c.progress.awaitingVerification > 0).length;
  const joining = cases.filter((c) => daysUntil(c.joiningDate) >= 0 && daysUntil(c.joiningDate) <= 7).length;
  const attention = cases.filter((c) => c.progress.overdue > 0 || c.progress.awaitingVerification > 0 || (daysUntil(c.joiningDate) >= 0 && daysUntil(c.joiningDate) <= 7)).length;
  if (attention) out.push({ key: 'onboarding', label: 'New joiners to support', detail: parts(!!behind && `${behind} behind schedule`, !!verify && `${verify} with documents to verify`, !!joining && `${joining} joining this week`), count: attention, to: '/hr/onboarding', icon: Rocket, severity: severity(behind, verify + joining), group: 'follow' });

  const open = exits.data.value ?? [];
  const lastDay = (e: (typeof open)[number]) => daysUntil((e.lastWorkingDay ?? e.noticeEndsOn).slice(0, 10));
  const leaving = open.filter((e) => e.status === 'APPROVED' && lastDay(e) >= 0 && lastDay(e) <= 7).length;
  const past = open.filter((e) => e.status === 'APPROVED' && lastDay(e) < 0).length;
  const settle = open.filter((e) => e.settlement?.overdue).length;
  const exitCount = open.filter((e) => (e.status === 'APPROVED' && lastDay(e) <= 7) || e.settlement?.overdue).length;
  if (exitCount) out.push({ key: 'exits', label: 'Exits to wrap up', detail: parts(!!leaving && `${leaving} leaving this week`, !!past && `${past} past last day`, !!settle && `${settle} settlement overdue`), count: exitCount, to: '/hr/exits', icon: LogOut, severity: severity(past + settle, leaving), group: 'follow' });

  const g = grievances.data.value;
  const gs = g?.all ?? g?.assigned ?? g?.posh;
  if (gs && (gs.overdue || gs.unassigned)) out.push({ key: 'grievances', label: 'Open grievances', detail: parts(!!gs.overdue && `${gs.overdue} past response time`, !!gs.unassigned && `${gs.unassigned} unassigned`), count: gs.open, to: '/hr/grievances', icon: MessageSquareWarning, severity: severity(gs.overdue, gs.unassigned ?? 0), group: 'follow' });

  const c = compliance.data.value?.counts;
  if (c && c.overdue + c.dueSoon) out.push({ key: 'compliance', label: 'Statutory filings', detail: parts(!!c.overdue && `${c.overdue} overdue`, !!c.dueSoon && `${c.dueSoon} due in 7 days`), count: c.overdue + c.dueSoon, to: '/hr/compliance/calendar', icon: Scale, severity: severity(c.overdue, c.dueSoon), group: 'follow' });
  return out;
});

const followLoading = computed(() => [probation, documents, onboarding, exits, grievances, compliance].some((s) => s.loading.value));

const insights = computed<Insight[]>(() => {
  const out: Insight[] = [];
  const s = summary.value;
  if (waiting.value) out.push({ id: 'waiting', tone: 'warning', text: `${waiting.value} request${waiting.value === 1 ? ' is' : 's are'} waiting for your decision. Clearing them quickly keeps payroll and attendance accurate.`, to: (approvals.data.value ?? []).find((q) => q.count)?.to, action: 'Review' });
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

/** Upcoming events and holidays in date order, each with a calendar tile. */
const comingUp = computed(() =>
  [
    ...upcomingEvents.value.map((e) => ({ id: `e-${e.id}`, date: e.eventStartsAt!.slice(0, 10), title: e.title, meta: e.eventLocation, kind: 'Event' as const, optional: false })),
    ...(holidays.data.value ?? []).map((h) => ({ id: `h-${h.id}`, date: h.date, title: h.name, meta: null, kind: 'Holiday' as const, optional: h.isOptional })),
  ].sort((a, b) => a.date.localeCompare(b.date)),
);
const tileMonth = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(appLocale(), { month: 'short' });
const inDays = (d: string) => {
  const n = daysUntil(d);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `in ${n} days`;
};

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
    <AppHero :eyebrow="eyebrow" :title="greeting" :summary="heroSummary" :loading="approvals.loading.value && !heroSummary">
      <template #actions>
        <AppButton v-for="(a, i) in actions" :key="a.key" :variant="i === 0 ? 'primary' : 'secondary'" :icon="a.icon" :to="a.to">{{ a.label }}</AppButton>
      </template>
    </AppHero>

    <div v-if="can.headcount || can.jobs" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <template v-if="can.headcount">
        <AppStatCard label="Headcount" :value="summary.headcount" :loading="headcount.loading.value" :icon="Users" :spark="series('headcount')" :trend="headcountTrend" to="/hr/reports/headcount" />
        <AppStatCard label="Joined this month" :value="thisMonth?.joiners" :loading="headcount.loading.value" tone="success" :icon="UserPlus" :spark="series('joiners')" hint="12-month trend" />
        <AppStatCard label="Left this month" :value="thisMonth?.leavers" :loading="headcount.loading.value" tone="danger" :icon="LogOut" :spark="series('leavers')" to="/hr/reports/attrition" />
        <AppStatCard label="Serving notice" :value="summary.onNotice" :loading="headcount.loading.value" tone="warning" :icon="CalendarDays" to="/hr/exits" />
      </template>
      <AppStatCard v-if="can.jobs" label="Open roles" :value="jobs.data.value?.meta.total" :loading="jobs.loading.value" tone="info" :icon="Briefcase" to="/hr/recruitment/jobs" />
    </div>

    <!-- Cards in a row share one height (fill), so headers, bodies and empty states line up. -->
    <div class="grid gap-4 lg:grid-cols-3">
      <HrPriorities class="lg:col-span-2" :items="priorities" :loading="approvals.loading.value && !approvals.data.value" :follow-loading="followLoading" />
      <AppInsights :items="insights" :loading="approvals.loading.value || headcount.loading.value" />
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <TrendChart v-if="can.headcount && chart.length" class="lg:col-span-2" title="Headcount at month end" description="Last 12 months" :points="chart" format="number" kind="line" height="h-56" />
      <AppCard title="Coming up" description="Events and holidays ahead" :icon="CalendarRange" fill :padded="false" :class="!(can.headcount && chart.length) && 'lg:col-span-3'">
        <AppEmptyState v-if="!comingUp.length" class="flex-1" compact :icon="CalendarRange" title="Nothing scheduled yet" description="Company events and holidays appear here once they are added." />
        <ul v-else class="divide-y divide-line/60">
          <li v-for="e in comingUp" :key="e.id" class="flex items-center gap-3 px-4 py-2.5">
            <span
              :class="['flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg ring-1 ring-inset', e.kind === 'Event' ? 'bg-special-soft text-special-fg ring-special/20' : 'bg-success-soft text-success-fg ring-success/20']"
              aria-hidden="true"
            >
              <span class="text-2xs leading-none font-semibold uppercase">{{ tileMonth(e.date) }}</span>
              <span class="text-base leading-5 font-semibold tabular-nums">{{ Number(e.date.slice(8, 10)) }}</span>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-fg">{{ e.title }}</span>
              <span class="block truncate text-xs text-fg-muted">
                <span class="sr-only">{{ formatDate(e.date) }} · </span>{{ e.kind }}{{ e.meta ? ` · ${e.meta}` : '' }}
              </span>
            </span>
            <span class="shrink-0 text-end">
              <span class="block text-xs font-medium text-fg tabular-nums">{{ inDays(e.date) }}</span>
              <AppBadge v-if="e.optional" size="sm">Optional</AppBadge>
            </span>
          </li>
        </ul>
      </AppCard>
    </div>

    <div v-if="can.jobs || can.leave" class="grid gap-4 lg:grid-cols-3">
      <HiringPipelineCard v-if="can.jobs" :class="can.leave ? 'lg:col-span-2' : 'lg:col-span-3'" :jobs="jobs.data.value?.items ?? []" :total="jobs.data.value?.meta.total ?? 0" :loading="jobs.loading.value" :can-post="auth.can('recruitment.manage')" />
      <AppCard v-if="can.leave" :icon="Plane" fill title="Out this week" :description="outToday.length ? `${outToday.length} on leave today` : 'Approved leave in the next 7 days'" :class="!can.jobs && 'lg:col-span-3'">
        <template #actions><AppButton size="sm" variant="ghost" to="/hr/leave/calendar">Calendar</AppButton></template>
        <AppPersonList :people="absentPeople" :loading="absences.loading.value" empty="Nobody is on leave this week" empty-description="Approved leave for the next 7 days shows up here." :empty-icon="Plane" />
      </AppCard>
    </div>

    <details class="card group">
      <summary class="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2">
        <span class="flex min-w-0 items-center gap-3">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs">
            <ShieldCheck :size="16" aria-hidden="true" />
          </span>
          <span class="min-w-0">
            <span class="block text-sm font-semibold text-fg">Your access</span>
            <span class="block text-xs text-fg-muted">Modules in your plan and the record scope your roles grant</span>
          </span>
        </span>
        <ChevronDown :size="16" class="text-fg-subtle transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul class="grid gap-2 border-t border-line/70 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <li v-for="m in moduleAccess" :key="m.key" class="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
          <span class="min-w-0">
            <span class="block truncate text-sm font-medium text-fg">{{ m.name }}</span>
            <span class="block text-xs text-fg-muted">{{ m.granted.length }} permission{{ m.granted.length === 1 ? '' : 's' }}</span>
          </span>
          <AppBadge v-if="m.broadest" :tone="scopeTone[m.broadest]" size="sm">{{ SCOPE_LABELS[m.broadest] }}</AppBadge>
        </li>
      </ul>
    </details>
  </div>
</template>
