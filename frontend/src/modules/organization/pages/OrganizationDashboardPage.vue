<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { Activity, Building2, CalendarDays, ChevronRight, FileClock, History, KeyRound, Laptop, MailPlus, Network, Settings2, ShieldCheck, Users } from '@lucide/vue';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { useAuthStore } from '@/core/auth/auth.store';
import { appLocale } from '@/core/locale/locale';
import { isAllowed, type AccessRule } from '@/core/navigation/access-rules';
import { organizationApi } from '@/modules/organization/api/organization.api';
import { AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppHero, AppSkeleton, AppStatCard } from '@/shared/components';
import SignInActivityChart from '@/modules/audit/components/SignInActivityChart.vue';
import AccessHealthCard, { type HealthCheck } from '@/modules/organization/components/AccessHealthCard.vue';
import PlanUsageCard from '@/modules/organization/components/PlanUsageCard.vue';
import SecurityPostureCard from '@/modules/organization/components/SecurityPostureCard.vue';
import SetupChecklist from '@/modules/organization/components/SetupChecklist.vue';
import { useAsync } from '@/shared/composables/use-async';
import { fullName, humanize, timeAgo } from '@/shared/utils/format';

/**
 * Administration overview: setup progress, who can sign in, how secure sign-in is, what changed recently, the plan in
 * use, and shortcuts to the admin pages the user may open.
 */
const auth = useAuthStore();
const router = useRouter();
const subject = useAccessSubject();
const canOpen = (to: string) => isAllowed(router.resolve(to).meta.access as AccessRule | undefined, subject.value);
const overview = useAsync(() => organizationApi.overview());
const policy = useAsync(() => organizationApi.securityPolicy());
const subscription = useAsync(() => organizationApi.subscription());
const o = computed(() => overview.data.value);

const summary = computed(() => {
  if (!o.value) return null;
  const parts = [`${o.value.members.active} active user${o.value.members.active === 1 ? '' : 's'}`, `${o.value.mfaAdoption}% use two-factor sign-in`];
  if (o.value.members.invited) parts.push(`${o.value.members.invited} invitation${o.value.members.invited === 1 ? '' : 's'} pending`);
  if (o.value.mfaAdoption < 80) parts.push('consider requiring 2FA in Settings → Security');
  return `${parts.join(' · ')}.`;
});

/** Sign-ins in the chart's 14-day window. */
const signIns = computed(() => {
  const since = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);
  const rows = (o.value?.loginActivity ?? []).filter((s) => s.day >= since);
  const ok = rows.filter((s) => s.outcome === 'SUCCESS').reduce((n, s) => n + s.count, 0);
  const failed = rows.filter((s) => s.outcome === 'FAILURE' || s.outcome === 'LOCKED').reduce((n, s) => n + s.count, 0);
  return { ok, failed, failRate: ok + failed ? Math.round((failed / (ok + failed)) * 100) : 0 };
});

const settingsTo = canOpen('/admin/organization') ? '/admin/organization' : undefined;
const usersTo = auth.can('user.view') ? '/admin/users' : undefined;
const historyTo = canOpen('/admin/login-history') ? '/admin/login-history' : undefined;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const checks = computed<HealthCheck[]>(() => {
  const v = o.value;
  if (!v) return [];
  const out: HealthCheck[] = [];
  const p = policy.data.value;
  if (p) out.push({ key: 'mfa-required', title: 'Two-factor sign-in required', detail: p.mfaRequired ? 'Everyone must use a second factor to sign in.' : 'Not required — a stolen password is enough to sign in.', state: p.mfaRequired ? 'pass' : 'fail', to: settingsTo, action: 'Require' });
  out.push({ key: 'mfa-adoption', title: 'Two-factor adoption', detail: `${v.mfaAdoption}% of active users have it on (aim for 80% or more).`, state: v.mfaAdoption >= 80 ? 'pass' : v.mfaAdoption >= 50 ? 'warn' : 'fail', to: settingsTo, action: 'Security' });
  out.push({ key: 'invites', title: 'Invitations accepted', detail: v.members.invited ? `${plural(v.members.invited, 'invitation')} not accepted yet — resend or revoke stale ones.` : 'No invitations are waiting.', state: v.members.invited ? 'warn' : 'pass', to: usersTo, action: 'Users' });
  out.push({ key: 'suspended', title: 'Suspended accounts', detail: v.members.suspended ? `${plural(v.members.suspended, 'account')} can't sign in. Remove access for people who have left.` : 'No suspended accounts.', state: v.members.suspended ? 'info' : 'pass', to: usersTo, action: 'Review' });
  out.push({ key: 'failed', title: 'Failed sign-ins', detail: signIns.value.failed ? `${plural(signIns.value.failed, 'failed attempt')} in 14 days (${signIns.value.failRate}% of attempts).` : 'No failed attempts in the last 14 days.', state: signIns.value.failRate >= 10 && signIns.value.failed >= 5 ? 'warn' : 'pass', to: historyTo, action: 'History' });
  const s = subscription.data.value;
  if (s) {
    const ratio = s.plan.maxUsers ? s.userCount / s.plan.maxUsers : 0;
    out.push({ key: 'seats', title: 'Seats available', detail: s.plan.maxUsers ? `${s.userCount} of ${s.plan.maxUsers} seats in use on the ${s.plan.name} plan.` : `No user limit on the ${s.plan.name} plan.`, state: ratio >= 1 ? 'fail' : ratio >= 0.9 ? 'warn' : 'pass', to: settingsTo, action: 'Plan' });
  }
  return out;
});

const SHORTCUTS = [
  { to: '/admin/organization', label: 'Organization settings', description: 'Profile, regional defaults, security', icon: Building2 },
  { to: '/admin/structure', label: 'Structure', description: 'Departments, designations, locations', icon: Network },
  { to: '/admin/holidays', label: 'Holidays', description: 'The holiday calendar for each year', icon: CalendarDays },
  { to: '/admin/users', label: 'Users', description: 'Invite, suspend and assign roles', icon: Users },
  { to: '/admin/roles', label: 'Roles and permissions', description: 'What each role can see and do', icon: ShieldCheck },
  { to: '/admin/audit-logs', label: 'Audit log', description: 'Every change: who, what and when', icon: FileClock },
  { to: '/admin/login-history', label: 'Login history', description: 'Sign-ins and failed attempts', icon: History },
];
const shortcuts = SHORTCUTS.filter((s) => canOpen(s.to));
</script>

<template>
  <div class="space-y-4">
    <AppHero eyebrow="Administration" :title="auth.organization?.name ?? 'Administration'" :summary="summary" :loading="overview.loading.value">
      <template #meta>
        <div v-if="subscription.data.value" class="mt-2 flex flex-wrap items-center gap-2">
          <AppBadge tone="brand" size="sm">{{ subscription.data.value.plan.name }} plan</AppBadge>
          <span class="text-xs text-fg-muted tabular-nums">
            {{ subscription.data.value.userCount }}{{ subscription.data.value.plan.maxUsers ? ` of ${subscription.data.value.plan.maxUsers}` : '' }} seats ·
            {{ subscription.data.value.modules.filter((m) => !m.core && m.entitled).length }} modules
          </span>
        </div>
      </template>
      <template #actions>
        <AppButton v-if="auth.can('user.invite')" :icon="MailPlus" to="/admin/users?invite=1">Invite user</AppButton>
        <AppButton v-if="auth.can('role.view')" variant="secondary" :icon="ShieldCheck" to="/admin/roles">Roles &amp; permissions</AppButton>
      </template>
    </AppHero>

    <SetupChecklist />

    <AppErrorState v-if="overview.error.value" :error="overview.error.value" @retry="overview.run" />
    <template v-else>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <AppStatCard label="Active users" :value="o?.members.active" :loading="overview.loading.value" :icon="Users" :hint="o?.members.suspended ? `${o.members.suspended} suspended` : undefined" :to="usersTo" />
        <AppStatCard label="Pending invitations" :value="o?.members.invited" :loading="overview.loading.value" :icon="MailPlus" tone="warning" :to="usersTo" />
        <AppStatCard label="MFA adoption" :value="o ? `${o.mfaAdoption}%` : undefined" :loading="overview.loading.value" :icon="KeyRound" :tone="(o?.mfaAdoption ?? 0) >= 80 ? 'success' : 'warning'" hint="Active users with 2FA" />
        <AppStatCard label="Active sessions" :value="o?.activeSessions" :loading="overview.loading.value" :icon="Laptop" tone="success" />
        <AppStatCard label="Roles" :value="o?.roles" :loading="overview.loading.value" :icon="ShieldCheck" tone="info" :to="auth.can('role.view') ? '/admin/roles' : undefined" />
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <AppCard class="lg:col-span-2" title="Sign-in activity" description="Last 14 days" :icon="Activity" fill>
          <template v-if="o" #actions>
            <span class="flex items-center gap-3 text-xs text-fg-muted">
              <span><span class="font-semibold text-fg tabular-nums">{{ signIns.ok.toLocaleString(appLocale()) }}</span> successful</span>
              <span :class="signIns.failed ? 'text-danger-fg' : ''"><span class="font-semibold tabular-nums">{{ signIns.failed.toLocaleString(appLocale()) }}</span> failed</span>
            </span>
          </template>
          <AppSkeleton v-if="overview.loading.value" line-class="h-64" />
          <SignInActivityChart v-else-if="o" :stats="o.loginActivity" />
        </AppCard>
        <AccessHealthCard :checks="checks" :loading="overview.loading.value" />
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <SecurityPostureCard :adoption="o?.mfaAdoption ?? null" :active-users="o?.members.active ?? 0" :policy="policy.data.value" :loading="overview.loading.value || policy.loading.value" :settings-to="settingsTo" />
        <PlanUsageCard :subscription="subscription.data.value" :loading="subscription.loading.value" :settings-to="settingsTo" />
        <AppCard title="Recent activity" :icon="FileClock" fill>
          <template #actions><AppButton v-if="auth.can('audit.view')" variant="ghost" size="sm" to="/admin/audit-logs">Audit log</AppButton></template>
          <AppSkeleton v-if="overview.loading.value" :lines="6" />
          <AppEmptyState v-else-if="!o?.recentActivity.length" class="flex-1" compact :icon="FileClock" title="No activity yet" description="Changes to users, roles and settings appear here." />
          <ol v-else class="relative">
            <li v-for="(a, i) in o.recentActivity" :key="a.id" class="relative flex gap-3 pb-4 last:pb-0">
              <span v-if="i < o.recentActivity.length - 1" class="absolute top-8 bottom-0 start-[13px] w-px bg-line" aria-hidden="true" />
              <AppAvatar :name="a.actor ? fullName(a.actor) : 'System'" size="sm" class="relative" />
              <div class="min-w-0 pt-0.5">
                <p class="text-sm leading-snug text-fg">{{ a.summary ?? humanize(a.action) }}</p>
                <p class="mt-0.5 text-xs text-fg-subtle">{{ a.actor ? fullName(a.actor) : 'System' }} · {{ timeAgo(a.createdAt) }}</p>
              </div>
            </li>
          </ol>
        </AppCard>
      </div>

      <AppCard v-if="shortcuts.length" title="Administration" description="Everything you can configure" :icon="Settings2" :padded="false">
        <ul class="grid sm:grid-cols-2 xl:grid-cols-4">
          <li v-for="s in shortcuts" :key="s.to" class="border-line/60 max-sm:border-b sm:border-e sm:border-b">
            <RouterLink :to="s.to" class="group flex h-full items-center gap-3 px-4 py-3 transition hover:bg-surface-muted/50">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg" aria-hidden="true"><component :is="s.icon" :size="17" /></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-fg">{{ s.label }}</span>
                <span class="block truncate text-xs text-fg-muted">{{ s.description }}</span>
              </span>
              <ChevronRight :size="15" class="shrink-0 text-fg-subtle transition group-hover:translate-x-0.5" aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
      </AppCard>
    </template>
  </div>
</template>
