<script setup lang="ts">
import { Building2, CircleSlash, Laptop, Users } from '@lucide/vue';
import { platformApi } from '@/modules/platform/api/platform.api';
import { AppAvatar, AppBadge, AppButton, AppCard, AppErrorState, AppPageHeader, AppSkeleton, AppStatCard } from '@/shared/components';
import SignInActivityChart from '@/modules/audit/components/SignInActivityChart.vue';
import { useAsync } from '@/shared/composables/use-async';
import { formatDate } from '@/shared/utils/format';
import { organizationTone, statusLabel } from '@/shared/utils/status';

const dashboard = useAsync(() => platformApi.dashboard());

/** Bar width relative to the largest plan (at least a sliver so empty plans stay visible). */
function planShare(count: number): number {
  const max = Math.max(1, ...(dashboard.data.value?.plans.map((p) => p.organizations) ?? [1]));
  return count === 0 ? 2 : Math.round((count / max) * 100);
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Platform overview" description="Tenants, subscriptions and platform-wide activity.">
      <template #actions><AppButton to="/platform/organizations?create=1" :icon="Building2">New organization</AppButton></template>
    </AppPageHeader>
    <AppErrorState v-if="dashboard.error.value" :error="dashboard.error.value" @retry="dashboard.run" />
    <template v-else>
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AppStatCard
          label="Active organizations"
          :value="dashboard.data.value?.organizations.active"
          :hint="dashboard.data.value ? `${dashboard.data.value.organizations.total} total` : undefined"
          :loading="dashboard.loading.value"
          :icon="Building2"
          to="/platform/organizations"
        />
        <AppStatCard label="Suspended" :value="dashboard.data.value?.organizations.suspended" :loading="dashboard.loading.value" :icon="CircleSlash" tone="danger" />
        <AppStatCard label="Active users" :value="dashboard.data.value?.activeUsers" :loading="dashboard.loading.value" :icon="Users" tone="success" />
        <AppStatCard label="Live sessions" :value="dashboard.data.value?.activeSessions" :loading="dashboard.loading.value" :icon="Laptop" />
      </div>
      <div class="grid gap-4 lg:grid-cols-5">
        <AppCard class="lg:col-span-3" title="Platform sign-ins" description="Last 14 days, all tenants">
          <AppSkeleton v-if="dashboard.loading.value" line-class="h-64" />
          <SignInActivityChart v-else-if="dashboard.data.value" :stats="dashboard.data.value.loginActivity" />
        </AppCard>
        <div class="space-y-4 lg:col-span-2">
          <AppCard title="Organizations by plan">
            <AppSkeleton v-if="dashboard.loading.value" :lines="3" />
            <ul v-else class="space-y-4">
              <li v-for="p in dashboard.data.value?.plans" :key="p.code">
                <div class="flex items-center justify-between text-sm">
                  <span class="font-medium text-fg">{{ p.name }}</span>
                  <span class="tabular-nums text-fg-muted">{{ p.organizations }}</span>
                </div>
                <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                  <div class="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-500" :style="{ width: `${planShare(p.organizations)}%` }" />
                </div>
              </li>
            </ul>
          </AppCard>
          <AppCard title="Newest organizations" :padded="false">
            <div v-if="dashboard.loading.value" class="p-4"><AppSkeleton :lines="4" /></div>
            <ul v-else class="divide-y divide-line/70">
              <li v-for="o in dashboard.data.value?.recentOrganizations" :key="o.id">
                <RouterLink :to="`/platform/organizations/${o.id}`" class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60">
                  <AppAvatar :name="o.name" size="sm" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium text-fg">{{ o.name }}</span>
                    <span class="block text-xs text-fg-muted">{{ o.plan.name }} · {{ formatDate(o.createdAt) }}</span>
                  </span>
                  <AppBadge :tone="organizationTone[o.status]" dot>{{ statusLabel(o.status) }}</AppBadge>
                </RouterLink>
              </li>
            </ul>
          </AppCard>
        </div>
      </div>
    </template>
  </div>
</template>
