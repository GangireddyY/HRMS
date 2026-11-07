<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight, CalendarPlus, FileText, House, PartyPopper, Receipt, Sparkles, Wallet } from '@lucide/vue';
import { authApi } from '@/modules/auth/api/auth.api';
import PunchCard from '@/modules/attendance/components/PunchCard.vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import { useAssistantStore } from '@/modules/assistant/assistant.store';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import { canApproveAnything, daysUntil, loadApprovals, localToday } from '@/modules/insights/approvals';
import LeaveSummaryCard from '@/modules/leave/components/LeaveSummaryCard.vue';
import { leaveApi } from '@/modules/leave/api/leave.api';
import { notificationsApi } from '@/modules/notifications/api/notifications.api';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import { AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppHero, AppInsights, AppQuickActions, AppSkeleton, type Insight, type QuickAction } from '@/shared/components';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { useAsync } from '@/shared/composables/use-async';
import { accessibleWorkspaces, visibleSections } from '@/core/navigation/workspaces';
import { useAuthStore } from '@/core/auth/auth.store';
import { formatDate, formatMoney, timeAgo } from '@/shared/utils/format';

/** The employee's start page: today's attendance, what needs their attention, leave, pay and what's coming up. */
const auth = useAuthStore();
const assistant = useAssistantStore();
const subject = useAccessSubject();
const can = {
  leave: auth.can('leave.view') && auth.hasFeature('leave'),
  policies: auth.can('compliance.view') && auth.hasFeature('compliance'),
  surveys: auth.hasFeature('engagement'),
  payslips: auth.can('payroll.payslip.view') && auth.hasFeature('payroll'),
  onboarding: auth.hasFeature('onboarding') && !!auth.organization,
  approvals: canApproveAnything(auth),
  holidays: auth.hasFeature('attendance') && !!auth.organization,
};

const notifications = useAsync(() => notificationsApi.list({ page: 1, pageSize: 6 }));
const mfa = useAsync(() => authApi.mfaStatus());
const balances = useAsync(() => leaveApi.balances(), { immediate: can.leave });
const myLeave = useAsync(() => leaveApi.requests({ view: 'mine', page: 1, pageSize: 20 }), { immediate: can.leave });
const policies = useAsync(() => complianceApi.mine(), { immediate: can.policies });
const surveys = useAsync(() => engagementApi.surveys({ page: 1, pageSize: 10 }), { immediate: can.surveys });
const payslips = useAsync(() => payrollApi.myPayslips(), { immediate: can.payslips });
const onboarding = useAsync(() => onboardingApi.mine(), { immediate: can.onboarding });
const approvals = useAsync(() => loadApprovals(auth), { immediate: can.approvals });
const year = Number(localToday().slice(0, 4));
const holidays = useAsync(async () => {
  const [a, b] = await Promise.all([attendanceApi.holidays(year), attendanceApi.holidays(year + 1)]);
  return [...a, ...b].filter((h) => h.date >= localToday()).sort((x, y) => x.date.localeCompare(y.date)).slice(0, 4);
}, { immediate: can.holidays });

const hour = new Date().getHours();
const greeting = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${auth.user?.firstName ?? ''}`;
const fullName = computed(() => `${auth.user?.firstName ?? ''} ${auth.user?.lastName ?? ''}`.trim());
const today = localToday();

const mainLeave = computed(() => balances.data.value?.balances.find((b) => !b.leaveType.unlimited && (b.available ?? 0) > 0) ?? null);
const pendingPolicies = computed(() => (policies.data.value ?? []).filter((p) => p.state === 'PENDING' || p.state === 'OVERDUE'));
const openSurveys = computed(() => (surveys.data.value?.items ?? []).filter((s) => s.open && !s.responded));
const pendingLeave = computed(() => (myLeave.data.value?.items ?? []).filter((r) => r.status === 'PENDING'));
const upcomingLeave = computed(() => (myLeave.data.value?.items ?? []).filter((r) => r.status === 'APPROVED' && r.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null);
const latestSlip = computed(() => payslips.data.value?.[0] ?? null);
const waiting = computed(() => (approvals.data.value ?? []).reduce((n, a) => n + a.count, 0));

const heroSummary = computed(() => {
  const parts: string[] = [];
  if (mainLeave.value) parts.push(`${mainLeave.value.available} days of ${mainLeave.value.leaveType.name.toLowerCase()} left`);
  if (upcomingLeave.value) parts.push(`leave from ${formatDate(upcomingLeave.value.startDate)}`);
  if (pendingPolicies.value.length) parts.push(`${pendingPolicies.value.length} polic${pendingPolicies.value.length === 1 ? 'y' : 'ies'} to acknowledge`);
  if (waiting.value) parts.push(`${waiting.value} approval${waiting.value === 1 ? '' : 's'} waiting`);
  const next = holidays.data.value?.[0];
  if (next) parts.push(`${next.name} in ${daysUntil(next.date)} days`);
  if (!parts.length) return null;
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
});

/** What needs the employee's attention, most pressing first. */
const forYou = computed<Insight[]>(() => {
  const out: Insight[] = [];
  for (const p of pendingPolicies.value.slice(0, 2)) out.push({ id: `p${p.id}`, tone: p.state === 'OVERDUE' ? 'danger' : 'warning', text: `Read and acknowledge “${p.title}”${p.dueOn ? ` by ${formatDate(p.dueOn)}` : ''}.`, to: `/me/policies/${p.id}`, action: 'Read' });
  if (waiting.value) out.push({ id: 'approvals', tone: 'warning', text: `${waiting.value} request${waiting.value === 1 ? ' is' : 's are'} waiting for your approval.`, to: (approvals.data.value ?? []).find((a) => a.count)?.to, action: 'Review' });
  const ob = onboarding.data.value;
  if (ob && ob.status === 'IN_PROGRESS' && ob.progress.done < ob.progress.total) out.push({ id: 'onboarding', tone: 'info', text: `Your onboarding checklist is ${Math.round((ob.progress.done / Math.max(1, ob.progress.total)) * 100)}% done (${ob.progress.total - ob.progress.done} to go).`, to: '/me/onboarding', action: 'Continue' });
  for (const s of openSurveys.value.slice(0, 1)) out.push({ id: `s${s.id}`, tone: 'info', text: `Have your say in “${s.title}”${s.anonymous ? ' — answers are anonymous' : ''}.`, to: '/me/engagement', action: 'Answer' });
  if (pendingLeave.value.length) out.push({ id: 'leave', tone: 'info', text: `${pendingLeave.value.length} leave request${pendingLeave.value.length === 1 ? ' is' : 's are'} waiting for approval.`, to: '/me/leave', action: 'View' });
  if (mfa.data.value && !mfa.data.value.enabled) out.push({ id: 'mfa', tone: 'warning', text: 'Protect your account with two-factor authentication.', to: '/me/security', action: 'Set up' });
  const paid = latestSlip.value?.paidAt?.slice(0, 10);
  if (latestSlip.value && paid && daysUntil(paid) >= -10) out.push({ id: 'slip', tone: 'success', text: `Your ${latestSlip.value.period} payslip is ready.`, to: `/me/payslips/${latestSlip.value.id}`, action: 'Open' });
  return out;
});

const actions = computed<QuickAction[]>(() =>
  [
    { key: 'leave', label: 'Apply for leave', description: mainLeave.value ? `${mainLeave.value.available} ${mainLeave.value.leaveType.code} left` : undefined, icon: CalendarPlus, to: '/me/leave', show: auth.can('leave.apply') && auth.hasFeature('leave') },
    { key: 'wfh', label: 'Work from home', description: 'Request a day', icon: House, to: '/me/attendance', show: auth.can('attendance.wfh.apply') && auth.hasFeature('attendance') },
    { key: 'claim', label: 'Claim expense', description: 'Upload a receipt', icon: Receipt, to: '/me/reimbursements', show: auth.can('payroll.reimbursement.apply') && auth.hasFeature('payroll') },
    { key: 'payslips', label: 'Payslips', description: latestSlip.value ? latestSlip.value.period : undefined, icon: Wallet, to: '/me/payslips', show: can.payslips },
    { key: 'policies', label: 'Policies', description: pendingPolicies.value.length ? `${pendingPolicies.value.length} to read` : undefined, icon: FileText, to: '/me/policies', show: can.policies },
    { key: 'ask', label: 'Ask AI', description: 'Questions in plain words', icon: Sparkles, onClick: () => (assistant.open = true), show: true },
  ]
    .filter((a) => a.show)
    .slice(0, 4)
    .map(({ show: _s, ...a }) => a),
);
const workspaces = computed(() => accessibleWorkspaces(subject.value).filter((w) => w.key !== 'me' && visibleSections(w, subject.value).length));
</script>

<template>
  <div class="space-y-4">
    <AppHero :eyebrow="auth.organization?.name" :title="greeting" :summary="heroSummary">
      <template #leading><AppAvatar :name="fullName || 'User'" :src="auth.user?.avatarUrl" size="xl" /></template>
      <template #meta>
        <div class="mt-2 flex flex-wrap gap-1">
          <AppBadge v-for="r in auth.context?.roles" :key="r.id" tone="brand" size="sm">{{ r.name }}</AppBadge>
        </div>
      </template>
    </AppHero>

    <AppQuickActions v-if="actions.length" :actions="actions" :columns="4" />

    <div class="grid items-start gap-4 lg:grid-cols-3">
      <div class="space-y-4 lg:col-span-2">
        <PunchCard v-if="auth.can('attendance.mark')" />
        <LeaveSummaryCard v-if="auth.can('leave.apply')" />
      </div>
      <AppInsights title="For you" caption="Things that need your attention" :items="forYou" :loading="policies.loading.value || approvals.loading.value" />
    </div>

    <div class="grid items-start gap-4 lg:grid-cols-3">
      <AppCard v-if="can.payslips" title="Latest payslip">
        <template #actions><AppButton size="sm" variant="ghost" to="/me/payslips">All</AppButton></template>
        <AppSkeleton v-if="payslips.loading.value" :lines="3" />
        <p v-else-if="!latestSlip" class="text-sm text-fg-muted">No payslips published yet.</p>
        <RouterLink v-else :to="`/me/payslips/${latestSlip.id}`" class="group block">
          <p class="text-xs text-fg-muted">{{ latestSlip.period }}{{ latestSlip.paidAt ? ` · paid ${formatDate(latestSlip.paidAt)}` : '' }}</p>
          <p class="mt-0.5 text-2xl font-semibold tracking-tight text-fg tabular-nums">{{ formatMoney(latestSlip.netPay) }}</p>
          <p class="text-xs text-fg-muted">Net pay · gross {{ formatMoney(latestSlip.gross) }} · deductions {{ formatMoney(latestSlip.totalDeductions) }}</p>
          <p class="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400">Open payslip <ArrowRight :size="13" class="transition group-hover:translate-x-0.5" aria-hidden="true" /></p>
        </RouterLink>
      </AppCard>

      <AppCard v-if="can.holidays" title="Upcoming holidays">
        <p v-if="!holidays.loading.value && !holidays.data.value?.length" class="text-sm text-fg-muted">No upcoming holidays on the calendar.</p>
        <ul v-else class="-my-2 divide-y divide-line/60">
          <li v-for="h in holidays.data.value ?? []" :key="h.id" class="flex items-center gap-3 py-2">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-500/12 dark:text-emerald-300"><PartyPopper :size="15" aria-hidden="true" /></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-fg">{{ h.name }}</span>
              <span class="block truncate text-xs text-fg-muted">{{ formatDate(h.date) }} · in {{ daysUntil(h.date) }} days</span>
            </span>
            <AppBadge v-if="h.isOptional" size="sm">Optional</AppBadge>
          </li>
        </ul>
      </AppCard>

      <AppCard title="Recent notifications" :class="!(can.payslips && can.holidays) && 'lg:col-span-2'">
        <template #actions><AppButton variant="ghost" size="sm" to="/me/notifications">View all</AppButton></template>
        <AppSkeleton v-if="notifications.loading.value" :lines="4" />
        <AppEmptyState v-else-if="!notifications.data.value?.items.length" compact title="No notifications yet" />
        <ul v-else class="-my-2 divide-y divide-line/60">
          <li v-for="n in notifications.data.value.items" :key="n.id" class="flex items-start gap-2 py-2">
            <span :class="['mt-2 h-1.5 w-1.5 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-500']" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <p :class="['truncate text-sm', n.readAt ? 'text-fg-muted' : 'font-medium text-fg']">{{ n.title }}</p>
              <p class="text-xs text-fg-subtle">{{ timeAgo(n.createdAt) }}</p>
            </div>
          </li>
        </ul>
      </AppCard>
    </div>

    <AppCard v-if="workspaces.length" title="Your workspaces" description="Other areas you can work in with your roles">
      <ul class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <li v-for="ws in workspaces" :key="ws.key">
          <RouterLink :to="visibleSections(ws, subject)[0]!.items[0]!.to" class="group flex items-center gap-3 rounded-md border border-line p-3 transition hover:border-brand-500/40 hover:bg-brand-50/40 dark:hover:bg-brand-500/5">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-500/12 dark:text-brand-300"><component :is="ws.icon" :size="16" aria-hidden="true" /></span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-fg">{{ ws.label }}</span>
              <span class="block truncate text-xs text-fg-muted">{{ ws.description }}</span>
            </span>
            <ArrowRight :size="15" class="shrink-0 text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-brand-600" aria-hidden="true" />
          </RouterLink>
        </li>
      </ul>
    </AppCard>
  </div>
</template>
