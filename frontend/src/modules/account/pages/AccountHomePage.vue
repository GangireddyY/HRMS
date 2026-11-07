<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight, Bell, KeyRound, ShieldCheck } from '@lucide/vue';
import { authApi } from '@/modules/auth/api/auth.api';
import PunchCard from '@/modules/attendance/components/PunchCard.vue';
import LeaveSummaryCard from '@/modules/leave/components/LeaveSummaryCard.vue';
import { notificationsApi } from '@/modules/notifications/api/notifications.api';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppSkeleton, AppStatCard } from '@/shared/components';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { useAsync } from '@/shared/composables/use-async';
import { accessibleWorkspaces, visibleSections } from '@/core/navigation/workspaces';
import { useAuthStore } from '@/core/auth/auth.store';
import { timeAgo } from '@/shared/utils/format';

const auth = useAuthStore();
const subject = useAccessSubject();
const notifications = useAsync(() => notificationsApi.list({ page: 1, pageSize: 5 }));
const mfa = useAsync(() => authApi.mfaStatus());

const greeting = computed(() => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
});
const workspaces = computed(() => accessibleWorkspaces(subject.value).filter((w) => w.key !== 'me' && visibleSections(w, subject.value).length));
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-4">
      <AppAvatar :name="`${auth.user?.firstName ?? ''} ${auth.user?.lastName ?? ''}`" size="xl" />
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold tracking-tight sm:text-[28px]">{{ greeting }}, {{ auth.user?.firstName }}</h1>
        <div class="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <span>{{ auth.organization?.name }}</span>
          <AppBadge v-for="r in auth.context?.roles" :key="r.id" tone="brand" size="sm">{{ r.name }}</AppBadge>
        </div>
      </div>
    </div>

    <PunchCard v-if="auth.can('attendance.mark')" />
    <LeaveSummaryCard v-if="auth.can('leave.apply')" />

    <div class="grid gap-4 sm:grid-cols-3">
      <AppStatCard label="Two-factor authentication" :value="mfa.data.value ? (mfa.data.value.enabled ? 'Enabled' : 'Off') : undefined" :loading="mfa.loading.value" :icon="ShieldCheck" :tone="mfa.data.value?.enabled ? 'success' : 'warning'" />
      <AppStatCard label="Last sign-in" :value="timeAgo(auth.user?.lastLoginAt)" :icon="KeyRound" />
      <AppStatCard label="Unread notifications" :value="notifications.data.value?.items.filter((n) => !n.readAt).length" :loading="notifications.loading.value" :icon="Bell" />
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <AppCard class="lg:col-span-2" title="Recent notifications">
        <template #actions><AppButton variant="ghost" size="sm" to="/me/notifications">View all</AppButton></template>
        <AppSkeleton v-if="notifications.loading.value" :lines="4" />
        <AppErrorState v-else-if="notifications.error.value" :error="notifications.error.value" @retry="notifications.run" />
        <AppEmptyState v-else-if="!notifications.data.value?.items.length" title="No notifications yet" description="Updates about your account and requests appear here." />
        <ul v-else class="-my-2 divide-y divide-line/70">
          <li v-for="n in notifications.data.value.items" :key="n.id" class="flex items-start justify-between gap-3 py-3">
            <div class="min-w-0">
              <p :class="['truncate text-sm', n.readAt ? 'text-fg-muted' : 'font-medium text-fg']">{{ n.title }}</p>
              <p v-if="n.body" class="truncate text-xs text-fg-muted">{{ n.body }}</p>
            </div>
            <span class="shrink-0 text-xs text-fg-subtle">{{ timeAgo(n.createdAt) }}</span>
          </li>
        </ul>
      </AppCard>

      <AppCard title="Your workspaces" description="Areas you can access with your current roles.">
        <AppEmptyState v-if="!workspaces.length" title="Self-service only" description="Your role gives you access to your own profile and requests." />
        <ul v-else class="space-y-2">
          <li v-for="ws in workspaces" :key="ws.key">
            <RouterLink
              :to="visibleSections(ws, subject)[0]!.items[0]!.to"
              class="group flex items-center gap-3 rounded-xl border border-line p-3 transition hover:border-brand-500/40 hover:bg-brand-50/40 dark:hover:bg-brand-500/5"
            >
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-600/10 ring-inset dark:bg-brand-500/12 dark:text-brand-300">
                <component :is="ws.icon" :size="17" aria-hidden="true" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium text-fg">{{ ws.label }}</span>
                <span class="block text-xs text-fg-muted">{{ ws.description }}</span>
              </span>
              <ArrowRight :size="15" class="shrink-0 text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-brand-600" aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
        <AppAlert v-if="mfa.data.value && !mfa.data.value.enabled" tone="warning" title="Protect your account" class="mt-4">
          Turn on two-factor authentication. <RouterLink to="/me/security" class="font-medium underline underline-offset-2">Set it up</RouterLink>
        </AppAlert>
        <AppBadge v-else-if="mfa.data.value" class="mt-4" tone="success" dot>Account protected with 2FA</AppBadge>
      </AppCard>
    </div>
  </div>
</template>
