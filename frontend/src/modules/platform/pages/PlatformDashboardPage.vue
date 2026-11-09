<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight, Building2, ChartColumn, CreditCard, FileClock, Laptop, LogIn, Users } from '@lucide/vue';
import type { OrganizationStatus } from '@contracts';
import { platformApi } from '@/modules/platform/api/platform.api';
import OrgMark from '@/modules/platform/components/OrgMark.vue';
import { ORG_STATUS_BAR, planVisual } from '@/modules/platform/utils/platform-visuals';
import { AppBadge, AppButton, AppCard, AppErrorState, AppHero, AppSkeleton, AppStatCard } from '@/shared/components';
import SignInActivityChart from '@/modules/audit/components/SignInActivityChart.vue';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { appLocale } from '@/core/locale/locale';
import { formatDate, timeAgo } from '@/shared/utils/format';
import { organizationTone, statusLabel } from '@/shared/utils/status';

/** Super-admin overview: tenants, people and sign-in health across the platform. */
const auth = useAuthStore();
const dashboard = useAsync(() => platformApi.dashboard());
const num = (n: number) => n.toLocaleString(appLocale());
const summary = computed(() => {
  const d = dashboard.data.value;
  if (!d) return null;
  const top = [...d.plans].sort((a, b) => b.organizations - a.organizations)[0];
  return `${d.organizations.active} active organization${d.organizations.active === 1 ? '' : 's'} · ${d.activeUsers} active users · ${d.activeSessions} live sessions${top ? ` · most on ${top.name}` : ''}.`;
});

/** Sign-ins per day (oldest first) and the failure share over the charted period. */
const signIns = computed(() => {
  const stats = dashboard.data.value?.loginActivity ?? [];
  const byDay = new Map<string, { ok: number; failed: number }>();
  for (const s of stats) {
    const d = byDay.get(s.day) ?? { ok: 0, failed: 0 };
    if (s.outcome === 'SUCCESS') d.ok += s.count;
    else if (s.outcome === 'FAILURE' || s.outcome === 'LOCKED') d.failed += s.count;
    byDay.set(s.day, d);
  }
  const days = [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  const ok = days.reduce((n, d) => n + d.ok, 0);
  const failed = days.reduce((n, d) => n + d.failed, 0);
  return { ok, failed, spark: days.map((d) => d.ok), failureRate: ok + failed ? Math.round((failed / (ok + failed)) * 100) : 0 };
});

const STATUSES: OrganizationStatus[] = ['ACTIVE', 'PENDING', 'SUSPENDED', 'DEACTIVATED'];
const statusRows = computed(() => {
  const o = dashboard.data.value?.organizations;
  if (!o) return [];
  const count: Record<OrganizationStatus, number> = { ACTIVE: o.active, PENDING: o.pending, SUSPENDED: o.suspended, DEACTIVATED: o.deactivated };
  return STATUSES.map((s) => ({ status: s, count: count[s], share: o.total ? (count[s] / o.total) * 100 : 0 }));
});
const needsAttention = computed(() => (dashboard.data.value ? dashboard.data.value.organizations.pending + dashboard.data.value.organizations.suspended : 0));

const planRows = computed(() => {
  const plans = dashboard.data.value?.plans ?? [];
  const total = plans.reduce((n, p) => n + p.organizations, 0);
  return [...plans].sort((a, b) => b.organizations - a.organizations).map((p) => ({ ...p, share: total ? Math.round((p.organizations / total) * 100) : 0 }));
});

const shortcuts = computed(() => [
  { to: '/platform/organizations', label: 'Organizations', hint: 'Tenants, status and administrators', icon: Building2 },
  { to: '/platform/plans', label: 'Plans & entitlements', hint: 'Limits, pricing and modules', icon: CreditCard },
  ...(auth.canPlatform('platform.audit.view') ? [{ to: '/platform/audit-logs', label: 'Platform audit log', hint: 'Every privileged change', icon: FileClock }] : []),
]);
</script>

<template>
  <div class="space-y-4">
    <AppHero eyebrow="Platform" title="Platform overview" :summary="summary" :loading="dashboard.loading.value">
      <template #actions>
        <AppButton variant="secondary" :icon="CreditCard" to="/platform/plans">Plans</AppButton>
        <AppButton to="/platform/organizations?create=1" :icon="Building2">New organization</AppButton>
      </template>
    </AppHero>
    <AppErrorState v-if="dashboard.error.value" :error="dashboard.error.value" @retry="dashboard.run" />
    <template v-else>
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AppStatCard
          label="Active organizations"
          :value="dashboard.data.value?.organizations.active"
          :hint="dashboard.data.value ? `${dashboard.data.value.organizations.total} total · ${dashboard.data.value.organizations.suspended} suspended` : undefined"
          :loading="dashboard.loading.value"
          :icon="Building2"
          to="/platform/organizations"
        />
        <AppStatCard
          label="Active users"
          :value="dashboard.data.value ? num(dashboard.data.value.activeUsers) : undefined"
          :hint="dashboard.data.value?.organizations.active ? `≈ ${Math.round(dashboard.data.value.activeUsers / dashboard.data.value.organizations.active)} per organization` : undefined"
          :loading="dashboard.loading.value"
          :icon="Users"
          tone="success"
        />
        <AppStatCard label="Live sessions" :value="dashboard.data.value ? num(dashboard.data.value.activeSessions) : undefined" hint="Signed in right now" :loading="dashboard.loading.value" :icon="Laptop" tone="info" />
        <AppStatCard
          label="Sign-ins, last 14 days"
          :value="dashboard.data.value ? num(signIns.ok) : undefined"
          :hint="dashboard.data.value ? `${num(signIns.failed)} failed · ${signIns.failureRate}% failure rate` : undefined"
          :loading="dashboard.loading.value"
          :icon="LogIn"
          :tone="signIns.failureRate >= 20 ? 'warning' : 'brand'"
          :spark="signIns.spark"
        />
      </div>

      <div class="grid gap-4 lg:grid-cols-5">
        <AppCard class="lg:col-span-3" title="Platform sign-ins" :icon="ChartColumn" description="Last 14 days, all tenants">
          <AppSkeleton v-if="dashboard.loading.value" line-class="h-64" />
          <SignInActivityChart v-else-if="dashboard.data.value" :stats="dashboard.data.value.loginActivity" />
        </AppCard>

        <div class="space-y-4 lg:col-span-2">
          <AppCard title="Tenant status" :icon="Building2" :description="needsAttention ? `${needsAttention} need attention` : 'All tenants are healthy'">
            <AppSkeleton v-if="dashboard.loading.value" :lines="4" />
            <template v-else-if="dashboard.data.value">
              <div class="flex h-2.5 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="statusRows.map((r) => `${statusLabel(r.status)}: ${r.count}`).join(', ')">
                <span v-for="r in statusRows.filter((x) => x.count)" :key="r.status" :class="['h-full', ORG_STATUS_BAR[r.status]]" :style="{ width: `${r.share}%` }" />
              </div>
              <ul class="mt-3 -mx-2 grid grid-cols-2 gap-1">
                <li v-for="r in statusRows" :key="r.status">
                  <RouterLink :to="{ path: '/platform/organizations', query: { status: r.status } }" class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-surface-muted/70">
                    <span :class="['h-2 w-2 shrink-0 rounded-full', ORG_STATUS_BAR[r.status]]" aria-hidden="true" />
                    <span class="flex-1 truncate text-fg-muted">{{ statusLabel(r.status) }}</span>
                    <span class="font-semibold text-fg tabular-nums">{{ r.count }}</span>
                  </RouterLink>
                </li>
              </ul>
            </template>
          </AppCard>

          <AppCard title="Organizations by plan" :icon="CreditCard">
            <AppSkeleton v-if="dashboard.loading.value" :lines="3" />
            <ul v-else class="space-y-3.5">
              <li v-for="p in planRows" :key="p.code" class="flex items-center gap-3">
                <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', planVisual(p.code).tile]" aria-hidden="true"><component :is="planVisual(p.code).icon" :size="15" /></span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline justify-between gap-2 text-sm">
                    <span class="truncate font-medium text-fg">{{ p.name }}</span>
                    <span class="text-fg-muted tabular-nums"><span class="font-semibold text-fg">{{ p.organizations }}</span> · {{ p.share }}%</span>
                  </div>
                  <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                    <div :class="['h-full rounded-full transition-[width] duration-500', planVisual(p.code).bar]" :style="{ width: `${Math.max(p.share, p.organizations ? 4 : 0)}%` }" />
                  </div>
                </div>
              </li>
            </ul>
          </AppCard>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-5">
        <AppCard class="lg:col-span-3" title="Newest organizations" :icon="Building2" :padded="false">
          <template #actions><AppButton variant="link" size="sm" :icon-right="ArrowRight" to="/platform/organizations">View all</AppButton></template>
          <div v-if="dashboard.loading.value" class="p-4"><AppSkeleton :lines="4" /></div>
          <ul v-else-if="dashboard.data.value?.recentOrganizations.length" class="divide-y divide-line/70">
            <li v-for="o in dashboard.data.value.recentOrganizations" :key="o.id">
              <RouterLink :to="`/platform/organizations/${o.id}`" class="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60">
                <OrgMark :name="o.name" size="md" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-fg group-hover:text-accent-fg">{{ o.name }}</span>
                  <span class="mt-0.5 block text-xs text-fg-muted">
                    {{ o.plan.name }} · created <span :title="formatDate(o.createdAt)">{{ timeAgo(o.createdAt) }}</span>
                  </span>
                </span>
                <AppBadge :tone="organizationTone[o.status]" dot>{{ statusLabel(o.status) }}</AppBadge>
              </RouterLink>
            </li>
          </ul>
          <p v-else class="px-4 py-8 text-center text-sm text-fg-muted">No organizations yet.</p>
        </AppCard>

        <AppCard class="lg:col-span-2" title="Shortcuts" :padded="false">
          <ul class="divide-y divide-line/70">
            <li v-for="s in shortcuts" :key="s.to">
              <RouterLink :to="s.to" class="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg ring-1 ring-brand-600/15 ring-inset" aria-hidden="true"><component :is="s.icon" :size="16" /></span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium text-fg">{{ s.label }}</span>
                  <span class="block truncate text-xs text-fg-muted">{{ s.hint }}</span>
                </span>
                <ArrowRight :size="15" class="text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-fg rtl:rotate-180" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
        </AppCard>
      </div>
    </template>
  </div>
</template>
