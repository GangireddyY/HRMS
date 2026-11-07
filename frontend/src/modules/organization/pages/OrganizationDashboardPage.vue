<script setup lang="ts">
import { computed } from 'vue';
import { Laptop, MailPlus, ShieldCheck, Users } from '@lucide/vue';
import { organizationApi } from '@/modules/organization/api/organization.api';
import { AppAvatar, AppButton, AppCard, AppEmptyState, AppErrorState, AppHero, AppSkeleton, AppStatCard } from '@/shared/components';
import SignInActivityChart from '@/modules/audit/components/SignInActivityChart.vue';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { fullName, humanize, timeAgo } from '@/shared/utils/format';

const auth = useAuthStore();
const overview = useAsync(() => organizationApi.overview());
const summary = computed(() => {
  const o = overview.data.value;
  if (!o) return null;
  const parts = [`${o.members.active} active user${o.members.active === 1 ? '' : 's'}`, `${o.mfaAdoption}% use two-factor sign-in`];
  if (o.members.invited) parts.push(`${o.members.invited} invitation${o.members.invited === 1 ? '' : 's'} pending`);
  if (o.mfaAdoption < 80) parts.push('consider requiring 2FA in Settings → Security');
  return `${parts.join(' · ')}.`;
});
</script>

<template>
  <div class="space-y-4">
    <AppHero eyebrow="Administration" :title="auth.organization?.name ?? 'Administration'" :summary="summary" :loading="overview.loading.value">
      <template #actions>
        <AppButton v-if="auth.can('user.invite')" :icon="MailPlus" to="/admin/users?invite=1">Invite user</AppButton>
        <AppButton v-if="auth.can('role.view')" variant="secondary" :icon="ShieldCheck" to="/admin/roles">Roles &amp; permissions</AppButton>
      </template>
    </AppHero>

    <AppErrorState v-if="overview.error.value" :error="overview.error.value" @retry="overview.run" />
    <template v-else>
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AppStatCard label="Active users" :value="overview.data.value?.members.active" :loading="overview.loading.value" :icon="Users" :to="auth.can('user.view') ? '/admin/users' : undefined" />
        <AppStatCard
          label="Pending invitations"
          :value="overview.data.value?.members.invited"
          :loading="overview.loading.value"
          :icon="MailPlus"
          tone="warning"
          :to="auth.can('user.view') ? '/admin/users' : undefined"
        />
        <AppStatCard label="MFA adoption" :value="overview.data.value ? `${overview.data.value.mfaAdoption}%` : undefined" :loading="overview.loading.value" :icon="ShieldCheck" :tone="(overview.data.value?.mfaAdoption ?? 0) >= 80 ? 'success' : 'warning'" hint="Active users with 2FA" />
        <AppStatCard label="Active sessions" :value="overview.data.value?.activeSessions" :loading="overview.loading.value" :icon="Laptop" tone="success" />
      </div>

      <div class="grid gap-4 lg:grid-cols-5">
        <AppCard class="lg:col-span-3" title="Sign-in activity" description="Last 14 days">
          <AppSkeleton v-if="overview.loading.value" line-class="h-64" />
          <SignInActivityChart v-else-if="overview.data.value" :stats="overview.data.value.loginActivity" />
        </AppCard>
        <AppCard class="lg:col-span-2" title="Recent activity">
          <template #actions><AppButton v-if="auth.can('audit.view')" variant="ghost" size="sm" to="/admin/audit-logs">Audit log</AppButton></template>
          <AppSkeleton v-if="overview.loading.value" :lines="6" />
          <AppEmptyState v-else-if="!overview.data.value?.recentActivity.length" title="No activity yet" />
          <ol v-else class="relative">
            <li v-for="(a, i) in overview.data.value.recentActivity" :key="a.id" class="relative flex gap-3 pb-4 last:pb-0">
              <span
                v-if="i < overview.data.value.recentActivity.length - 1"
                class="absolute top-8 bottom-0 left-[13px] w-px bg-line"
                aria-hidden="true"
              />
              <AppAvatar :name="a.actor ? fullName(a.actor) : 'System'" size="sm" class="relative" />
              <div class="min-w-0 pt-0.5">
                <p class="text-sm leading-snug text-fg">{{ a.summary ?? humanize(a.action) }}</p>
                <p class="mt-0.5 text-xs text-fg-subtle">{{ a.actor ? fullName(a.actor) : 'System' }} · {{ timeAgo(a.createdAt) }}</p>
              </div>
            </li>
          </ol>
        </AppCard>
      </div>
    </template>
  </div>
</template>
